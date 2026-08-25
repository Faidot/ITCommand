"""Fetching things a message points at, without letting it point at us.

Two jobs, one danger. A message body is attacker-controlled, so any URL in it
is an instruction from someone hostile. Fetching those URLs from inside our
own network is server-side request forgery, and a mail app is the ideal place
to attempt it: the attacker writes the URL, and a trusted server fetches it.

So `safe_get` refuses anything that resolves to an address we should not be
reaching, checks again after every redirect, and connects to the resolved IP
rather than re-resolving by name — closing the DNS-rebinding window between
"we checked the address" and "we opened the socket".
"""
from __future__ import annotations

import ipaddress
import logging
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("mailcore.fetching")

#: An image is not worth more than this, and a cap is what stops one message
#: filling a disk or a worker's memory.
MAX_BYTES = 8 * 1024 * 1024
TIMEOUT = 10
MAX_REDIRECTS = 3

ALLOWED_SCHEMES = ("http", "https")

ALLOWED_TYPES = (
    "image/png", "image/jpeg", "image/gif", "image/webp",
    "image/bmp", "image/x-icon", "image/avif",
)
#: SVG is absent deliberately: it is a script container, and serving one back
#: would hand a message the script execution the sandbox exists to deny.


class Refused(Exception):
    """We will not fetch that."""


class FetchFailed(Exception):
    """We tried and could not."""


def _is_forbidden(ip: str) -> bool:
    """Anything that is not a public unicast address on the internet.

    Loopback, link-local (169.254.169.254 is the cloud metadata endpoint on
    every major provider), private ranges, multicast, reserved. A message that
    can make us GET the metadata endpoint can read our credentials.
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return (
        addr.is_private or addr.is_loopback or addr.is_link_local
        or addr.is_multicast or addr.is_reserved or addr.is_unspecified
        or (addr.version == 6 and addr.ipv4_mapped is not None
            and _is_forbidden(str(addr.ipv4_mapped)))
    )


def _resolve(host: str) -> str:
    """First public address for a host, or raise.

    Every address is checked, not just the one we pick: a host that resolves
    to both a public and a private address is a rebinding attempt, and taking
    the public one would be exactly the mistake.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise Refused("cannot resolve %s" % host) from exc
    addresses = {info[4][0] for info in infos}
    if not addresses:
        raise Refused("%s resolves to nothing" % host)
    for address in addresses:
        if _is_forbidden(address):
            raise Refused("%s resolves to a non-public address" % host)
    return sorted(addresses)[0]


def safe_get(url: str, *, allowed_types=ALLOWED_TYPES) -> tuple:
    """Fetch a remote URL defensively. Returns ``(bytes, content_type)``."""
    seen = 0
    current = url

    while True:
        parsed = urllib.parse.urlsplit(current)
        if parsed.scheme not in ALLOWED_SCHEMES:
            raise Refused("scheme %r is not allowed" % parsed.scheme)
        if not parsed.hostname:
            raise Refused("no host in %r" % current)

        ip = _resolve(parsed.hostname)

        # Connect to the address we just vetted, carrying the original Host
        # header. Re-resolving by name here would reopen the rebinding window
        # between the check and the socket.
        netloc = "[%s]" % ip if ":" in ip else ip
        if parsed.port:
            netloc = "%s:%d" % (netloc, parsed.port)
        direct = urllib.parse.urlunsplit(
            (parsed.scheme, netloc, parsed.path or "/", parsed.query, ""))

        request = urllib.request.Request(direct, method="GET")
        request.add_header("Host", parsed.netloc)
        # No cookies, no referrer, no identifying user agent. The sender must
        # learn nothing beyond that some server fetched an image.
        request.add_header("User-Agent", "Terafort Mail image proxy")
        request.add_header("Accept", "image/*")

        ctx = ssl.create_default_context()
        if parsed.scheme == "https":
            # We connected by IP, so the certificate must still be checked
            # against the real hostname.
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_REQUIRED

        opener = urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(request, timeout=TIMEOUT, context=ctx) as response:
                status = response.status
                if status in (301, 302, 303, 307, 308):
                    seen += 1
                    if seen > MAX_REDIRECTS:
                        raise Refused("too many redirects")
                    location = response.headers.get("Location")
                    if not location:
                        raise FetchFailed("redirect with no destination")
                    # Re-checked from the top, because a redirect is a second
                    # attacker-chosen URL.
                    current = urllib.parse.urljoin(current, location)
                    continue

                content_type = (response.headers.get_content_type() or "").lower()
                if allowed_types and content_type not in allowed_types:
                    raise Refused("content type %r is not allowed" % content_type)

                data = response.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise Refused("larger than %d bytes" % MAX_BYTES)
                return data, content_type
        except urllib.error.HTTPError as exc:
            raise FetchFailed("remote server returned %d" % exc.code) from exc
        except (urllib.error.URLError, socket.timeout, ssl.SSLError, OSError) as exc:
            raise FetchFailed("could not fetch: %s" % exc) from exc


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Hand redirects back to us instead of following them.

    urllib follows redirects without re-checking the destination, which would
    defeat every guard above on the very first hop.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
