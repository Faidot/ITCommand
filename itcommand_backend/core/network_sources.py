"""Pull host lists from network equipment (MikroTik, pfSense, ntopng).

A sweep only sees the segment the server sits on. Asking the router or
firewall directly reveals everything it has a lease or ARP entry for, across
every VLAN it serves — which is usually the whole picture.

Each adapter returns the same shape as `core.discovery.sweep`, so results flow
into `DiscoveredHost` through one code path.

Contract, matching `core.notify`: best-effort, never raises. Returns
(results, error).
"""
import base64
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request

from core.discovery import normalise_mac, vendor_from_mac


TIMEOUT_SECONDS = 15


def _request(integration, path, *, params=None, headers=None):
    """GET JSON from the device. Returns (payload, error)."""
    url = f"{integration.base_url.rstrip('/')}/{path.lstrip('/')}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    request = urllib.request.Request(
        url, headers={"Accept": "application/json", **(headers or {})}
    )

    context = None
    if integration.use_tls and not integration.verify_tls:
        # Network gear almost always ships a self-signed certificate. This is
        # opt-in per integration and defaults to off only because refusing
        # would make the feature unusable on a normal LAN.
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS, context=context) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = "check the username and password" if exc.code in (401, 403) else exc.reason
        return None, f"HTTP {exc.code}: {detail}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return None, f"Could not reach {integration.host}: {exc}"

    try:
        return json.loads(body), ""
    except ValueError:
        return None, "The device did not return JSON — check the URL and that its API is enabled."


def _basic_auth(integration):
    raw = f"{integration.username}:{integration.get_secret()}".encode("utf-8")
    return {"Authorization": "Basic " + base64.b64encode(raw).decode("ascii")}


def _row(ip, mac="", hostname="", via="", extra=None):
    mac = normalise_mac(mac)
    return {
        "ip_address": ip,
        "mac_address": mac,
        "hostname": (hostname or "")[:255],
        "vendor_guess": vendor_from_mac(mac),
        "open_ports": [],
        "discovered_via": via,
        **(extra or {}),
    }


def _valid_ip(value):
    import ipaddress

    try:
        ipaddress.ip_address(str(value).strip())
        return True
    except (ValueError, TypeError):
        return False


def from_mikrotik(integration):
    """RouterOS v7 REST: DHCP leases plus the ARP table."""
    headers = _basic_auth(integration)
    rows = {}

    leases, error = _request(integration, "/rest/ip/dhcp-server/lease", headers=headers)
    if error:
        return [], error
    for lease in leases or []:
        ip = lease.get("address")
        if _valid_ip(ip):
            rows[ip] = _row(
                ip,
                lease.get("mac-address", ""),
                lease.get("host-name", ""),
                via=f"MIKROTIK:{integration.name}",
            )

    # ARP fills in statically-addressed hosts that never took a lease.
    arp, arp_error = _request(integration, "/rest/ip/arp", headers=headers)
    if not arp_error:
        for entry in arp or []:
            ip = entry.get("address")
            if _valid_ip(ip) and ip not in rows:
                rows[ip] = _row(
                    ip, entry.get("mac-address", ""), "",
                    via=f"MIKROTIK:{integration.name}",
                )

    return list(rows.values()), ""


def from_pfsense(integration):
    """pfSense REST API package, or OPNsense's equivalent endpoints."""
    headers = _basic_auth(integration)
    rows = {}

    #: pfSense and OPNsense disagree on paths; try each and use what answers.
    candidates = (
        "/api/v2/status/dhcp_server/leases",
        "/api/v1/services/dhcpd/lease",
        "/api/diagnostics/dhcp/searchLease",
    )
    payload = None
    last_error = ""
    for path in candidates:
        payload, last_error = _request(integration, path, headers=headers)
        if payload is not None:
            break
    if payload is None:
        return [], last_error or "No DHCP lease endpoint answered."

    # Responses nest the list under different keys depending on version.
    leases = payload
    if isinstance(payload, dict):
        for key in ("data", "rows", "leases"):
            if isinstance(payload.get(key), list):
                leases = payload[key]
                break
        else:
            leases = []

    for lease in leases or []:
        if not isinstance(lease, dict):
            continue
        ip = lease.get("ip") or lease.get("address")
        if _valid_ip(ip):
            rows[ip] = _row(
                ip,
                lease.get("mac") or lease.get("mac-address", ""),
                lease.get("hostname", ""),
                via=f"PFSENSE:{integration.name}",
            )

    return list(rows.values()), ""


def from_ntopng(integration):
    """ntopng REST v2: hosts it has actually seen traffic from."""
    headers = _basic_auth(integration)
    payload, error = _request(
        integration,
        "/lua/rest/v2/get/host/active.lua",
        params={"ifid": integration_ifid(integration)},
        headers=headers,
    )
    if error:
        return [], error

    hosts = payload.get("rsp", payload) if isinstance(payload, dict) else payload
    if isinstance(hosts, dict):
        hosts = hosts.get("data", [])

    rows = {}
    for host in hosts or []:
        if not isinstance(host, dict):
            continue
        ip = host.get("ip") or host.get("host") or host.get("name")
        if _valid_ip(ip):
            rows[ip] = _row(
                ip,
                host.get("mac", ""),
                host.get("name", "") if not _valid_ip(host.get("name")) else "",
                via=f"NTOPNG:{integration.name}",
            )
    return list(rows.values()), ""


def integration_ifid(integration):
    """ntopng addresses interfaces by numeric id; 0 is the usual default."""
    return 0


def from_generic(integration):
    """Any endpoint returning a JSON list of objects with ip/mac/hostname."""
    payload, error = _request(integration, "/", headers=_basic_auth(integration))
    if error:
        return [], error

    items = payload
    if isinstance(payload, dict):
        for key in ("data", "results", "hosts", "rows"):
            if isinstance(payload.get(key), list):
                items = payload[key]
                break
        else:
            items = []

    rows = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        ip = item.get("ip") or item.get("ip_address") or item.get("address")
        if _valid_ip(ip):
            rows[ip] = _row(
                ip,
                item.get("mac") or item.get("mac_address", ""),
                item.get("hostname") or item.get("name", ""),
                via=f"GENERIC:{integration.name}",
            )
    return list(rows.values()), ""


ADAPTERS = {
    "MIKROTIK": from_mikrotik,
    "PFSENSE": from_pfsense,
    "NTOPNG": from_ntopng,
    "GENERIC": from_generic,
}


def fetch_hosts(integration):
    """Pull the host list from one integration. Returns (results, error)."""
    adapter = ADAPTERS.get(integration.kind)
    if not adapter:
        return [], f"No adapter for {integration.kind}."
    if not integration.is_enabled:
        return [], "This integration is disabled."
    try:
        return adapter(integration)
    except Exception as exc:  # an adapter bug must not 500 the request
        return [], f"{type(exc).__name__}: {exc}"
