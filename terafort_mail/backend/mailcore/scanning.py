"""Scanning attachments before anyone can open one.

ClamAV over its local socket when it is there. When it is not, the behaviour
is chosen by configuration rather than assumed, because the two reasonable
answers point opposite ways:

    MAIL_BLOCK_UNSCANNED = True    refuse the download. Safe, and it breaks
                                   every attachment the day clamd dies.
    MAIL_BLOCK_UNSCANNED = False   serve it, marked unscanned. Available, and
                                   it means "scanned" is not a guarantee.

Whichever you pick, the response carries `X-Scan-Status` so the answer is
never silently assumed.
"""
from __future__ import annotations

import logging
import socket
from dataclasses import dataclass

from django.conf import settings

log = logging.getLogger("mailcore.scanning")

CHUNK = 8192
TIMEOUT = 30


@dataclass
class Verdict:
    status: str      # clean | infected | failed
    detail: str = ""


def scan(data: bytes, *, filename: str = "") -> Verdict:
    """Ask clamd. Never raises — a scanner failure is a verdict, not a crash."""
    address = getattr(settings, "MAIL_CLAMAV_SOCKET", "")
    if not address:
        return Verdict("failed", "no scanner configured")

    try:
        sock = _connect(address)
    except OSError as exc:
        log.warning("clamd unreachable at %s: %s", address, exc)
        return Verdict("failed", "scanner unreachable")

    try:
        sock.settimeout(TIMEOUT)
        sock.sendall(b"zINSTREAM\0")
        for i in range(0, len(data), CHUNK):
            chunk = data[i:i + CHUNK]
            sock.sendall(len(chunk).to_bytes(4, "big") + chunk)
        sock.sendall((0).to_bytes(4, "big"))

        reply = b""
        while b"\0" not in reply and len(reply) < 4096:
            more = sock.recv(1024)
            if not more:
                break
            reply += more
    except (OSError, socket.timeout) as exc:
        log.warning("clamd scan of %r failed: %s", filename, exc)
        return Verdict("failed", "scan did not complete")
    finally:
        try:
            sock.close()
        except OSError:
            pass

    text = reply.decode("utf-8", "replace").strip("\0 \n")
    if text.endswith("OK"):
        return Verdict("clean")
    if "FOUND" in text:
        threat = text.split(":")[-1].replace("FOUND", "").strip()
        log.warning("infected attachment %r: %s", filename, threat)
        return Verdict("infected", threat)
    return Verdict("failed", text[:200])


def _connect(address: str):
    if address.startswith("/"):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(TIMEOUT)
        sock.connect(address)
        return sock
    host, _, port = address.rpartition(":")
    return socket.create_connection((host or "127.0.0.1", int(port or 3310)), TIMEOUT)
