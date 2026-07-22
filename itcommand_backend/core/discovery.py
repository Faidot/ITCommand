"""Network sweep: find what is actually answering on a subnet.

`ping_check` walks known devices one at a time, which is fine for a handful of
records but hopeless for a /24 — 254 hosts at up to 10s each is over 40
minutes. This module runs probes concurrently and keeps per-host timeouts
short, so a /24 completes in seconds.

Everything here is best-effort and never raises: a host that refuses to answer
is simply absent, and a scan that hits a permission problem records the failure
rather than crashing the request.
"""
import ipaddress
import re
import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.utils import timezone


#: Enough for a LAN round trip; anything slower is treated as down.
PING_TIMEOUT_SECONDS = 1
#: Ceiling on concurrent pings. High enough to be fast, low enough not to
#: exhaust file descriptors or look like a SYN flood to an IDS.
MAX_WORKERS = 64
#: Refuse to sweep anything larger than a /22 in one go (1022 hosts).
MAX_HOSTS = 1024
#: Ports worth probing to hint at what a host is.
COMMON_PORTS = (22, 80, 443, 445, 3389, 8080, 8443, 161, 53, 3306, 5432)
PORT_TIMEOUT_SECONDS = 0.4

_MAC_RE = re.compile(r"([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})", re.IGNORECASE)

#: A small OUI table covering common network kit. Full IEEE registry is 30k+
#: rows; this names the vendors that matter for an IT inventory and degrades
#: gracefully to "" for anything else.
OUI_VENDORS = {
    "00:0C:29": "VMware", "00:50:56": "VMware", "00:1C:14": "VMware",
    "08:00:27": "VirtualBox", "52:54:00": "QEMU/KVM",
    "00:15:5D": "Microsoft Hyper-V",
    "B8:27:EB": "Raspberry Pi", "DC:A6:32": "Raspberry Pi", "E4:5F:01": "Raspberry Pi",
    "00:1B:21": "Intel", "00:1E:67": "Intel", "3C:FD:FE": "Intel",
    "00:25:90": "Super Micro", "0C:C4:7A": "Super Micro",
    "00:0C:42": "MikroTik", "4C:5E:0C": "MikroTik", "48:8F:5A": "MikroTik",
    "D4:CA:6D": "MikroTik", "2C:C8:1B": "MikroTik", "18:FD:74": "MikroTik",
    "00:1A:8C": "Ubiquiti", "24:A4:3C": "Ubiquiti", "78:8A:20": "Ubiquiti",
    "FC:EC:DA": "Ubiquiti", "74:83:C2": "Ubiquiti",
    "00:09:0F": "Fortinet", "00:1B:17": "Palo Alto Networks",
    "00:00:0C": "Cisco", "00:1A:A1": "Cisco", "00:26:0B": "Cisco",
    "00:1D:71": "Cisco", "F4:CF:E2": "Cisco",
    "00:24:E8": "Dell", "B8:2A:72": "Dell", "18:66:DA": "Dell", "F8:BC:12": "Dell",
    "00:1F:29": "HP", "3C:D9:2B": "HP", "94:57:A5": "HP", "00:17:A4": "HP",
    "00:03:93": "Apple", "AC:DE:48": "Apple", "F0:18:98": "Apple",
    "3C:07:54": "Apple", "A4:83:E7": "Apple",
    "00:1D:0F": "TP-Link", "50:C7:BF": "TP-Link", "C0:4A:00": "TP-Link",
    "00:18:4D": "Netgear", "20:4E:7F": "Netgear",
    "00:17:88": "Philips Hue", "00:04:F2": "Polycom",
    "00:80:77": "Brother", "00:26:73": "Brother",
    "00:00:48": "Epson", "00:1B:A9": "Brother",
    "00:15:99": "Samsung", "00:12:FB": "Samsung",
}


def _is_windows():
    return sys.platform.startswith("win")


def normalise_mac(value):
    """Lower-case, colon-separated, zero-padded — so lookups actually match."""
    if not value:
        return ""
    parts = re.split(r"[:\-]", str(value).strip())
    if len(parts) != 6:
        return ""
    try:
        return ":".join(f"{int(part, 16):02x}" for part in parts)
    except (ValueError, TypeError):
        return ""


def vendor_from_mac(mac):
    mac = normalise_mac(mac)
    if not mac:
        return ""
    return OUI_VENDORS.get(mac[:8].upper(), "")


def expand_target(target, *, limit=MAX_HOSTS):
    """Turn '192.168.1.0/24' or a bare IP into a list of addresses.

    Returns (hosts, error). Refuses anything above `limit` rather than
    quietly truncating, so the caller can explain why.
    """
    try:
        network = ipaddress.ip_network(str(target).strip(), strict=False)
    except ValueError as exc:
        return [], f"Not a valid IP address or CIDR range: {exc}"

    hosts = [str(host) for host in network.hosts()] or [str(network.network_address)]
    if len(hosts) > limit:
        return [], (
            f"{network} contains {len(hosts)} addresses; the limit is {limit}. "
            f"Scan a smaller range (a /22 or narrower)."
        )
    return hosts, ""


def ping(ip, timeout=PING_TIMEOUT_SECONDS):
    """True if the host answers ICMP. Never raises."""
    if _is_windows():
        command = ["ping", "-n", "1", "-w", str(int(timeout * 1000)), str(ip)]
    else:
        # macOS wants -W in milliseconds, Linux in seconds; -c 1 keeps it quick
        # either way and a wrong unit only costs us a fraction of a second.
        command = ["ping", "-c", "1", "-W", str(max(1, int(timeout))), str(ip)]
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout + 2,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def reverse_dns(ip):
    try:
        socket.setdefaulttimeout(1)
        return socket.gethostbyaddr(str(ip))[0]
    except (OSError, socket.herror, socket.gaierror):
        return ""
    finally:
        socket.setdefaulttimeout(None)


def arp_table():
    """Read the OS ARP cache as {ip: mac}.

    A ping populates the local ARP cache, so calling this after a sweep gives
    MAC addresses for everything on the same L2 segment. Hosts behind a router
    will not appear — that is expected, and why the vendor integrations exist.
    """
    # -n keeps it numeric: without it, `arp -a` does a reverse-DNS lookup per
    # entry and a slow resolver stalls the entire scan.
    command = ["arp", "-a"] if _is_windows() else ["arp", "-an"]
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=10
        )
    except (subprocess.TimeoutExpired, OSError, FileNotFoundError):
        return {}

    table = {}
    for line in (result.stdout or "").splitlines():
        ip_match = re.search(r"\(?(\d{1,3}(?:\.\d{1,3}){3})\)?", line)
        mac_match = _MAC_RE.search(line)
        if ip_match and mac_match:
            mac = normalise_mac(mac_match.group(1))
            if mac and mac != "00:00:00:00:00:00":
                table[ip_match.group(1)] = mac
    return table


def open_ports(ip, ports=COMMON_PORTS, timeout=PORT_TIMEOUT_SECONDS):
    """TCP-connect probe of a few well-known ports. Never raises."""
    found = []
    for port in ports:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(timeout)
                if sock.connect_ex((str(ip), port)) == 0:
                    found.append(port)
        except OSError:
            continue
    return found


def sweep(target, *, probe_ports=False, progress=None):
    """Ping every address in `target` concurrently.

    Returns (results, error) where each result is a dict ready to upsert into
    DiscoveredHost.
    """
    hosts, error = expand_target(target)
    if error:
        return [], error

    alive = []
    completed = 0
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, max(1, len(hosts)))) as pool:
        futures = {pool.submit(ping, host): host for host in hosts}
        for future in as_completed(futures):
            host = futures[future]
            completed += 1
            if progress and completed % 32 == 0:
                progress(completed, len(hosts))
            try:
                if future.result():
                    alive.append(host)
            except Exception:
                continue

    # One ARP read after the sweep — the pings we just sent populated the cache.
    macs = arp_table()

    results = []
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, max(1, len(alive)))) as pool:
        dns_futures = {pool.submit(reverse_dns, host): host for host in alive}
        port_futures = (
            {pool.submit(open_ports, host): host for host in alive}
            if probe_ports
            else {}
        )
        hostnames = {}
        for future in as_completed(dns_futures):
            try:
                hostnames[dns_futures[future]] = future.result()
            except Exception:
                hostnames[dns_futures[future]] = ""
        ports_by_host = {}
        for future in as_completed(port_futures):
            try:
                ports_by_host[port_futures[future]] = future.result()
            except Exception:
                ports_by_host[port_futures[future]] = []

    for host in sorted(alive, key=lambda value: ipaddress.ip_address(value)):
        mac = macs.get(host, "")
        results.append({
            "ip_address": host,
            "mac_address": mac,
            "hostname": hostnames.get(host, ""),
            "vendor_guess": vendor_from_mac(mac),
            "open_ports": ports_by_host.get(host, []),
            "discovered_via": "SWEEP",
        })
    return results, ""


def record_results(results, scan):
    """Upsert sightings into DiscoveredHost. Returns (found, newly_seen)."""
    from core.models import DiscoveredHost

    new_count = 0
    for row in results:
        existing = DiscoveredHost.objects.filter(ip_address=row["ip_address"]).first()
        if existing:
            existing.mac_address = row["mac_address"] or existing.mac_address
            existing.hostname = row["hostname"] or existing.hostname
            existing.vendor_guess = row["vendor_guess"] or existing.vendor_guess
            if row["open_ports"]:
                existing.open_ports = row["open_ports"]
            existing.discovered_via = row["discovered_via"]
            existing.times_seen += 1
            existing.last_seen_at = timezone.now()
            existing.last_scan = scan
            existing.save()
        else:
            DiscoveredHost.objects.create(last_scan=scan, **row)
            new_count += 1
    return len(results), new_count
