"""RFC 6238 TOTP, implemented on the standard library.

Deliberately not a dependency. TOTP is a HMAC, a counter and a truncation --
about thirty lines -- and keeping it here means the second factor has no
supply chain of its own. Swap in pyotp if you would rather; the interface is
`verify(secret, code)`.

IMAP has no second factor, so this layer is the only thing standing between a
leaked mailbox password and a signed-in session. Blueprint, section 3.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
import urllib.parse

#: 30-second steps, 6 digits: what every authenticator app expects.
STEP_SECONDS = 30
DIGITS = 6

#: Accept the neighbouring steps either side of now. One step of slop covers
#: ordinary clock drift and a user typing the code as it rolls over. More than
#: one widens the window an attacker gets for a phished code.
DEFAULT_WINDOW = 1


def new_secret() -> str:
    """A fresh base32 secret, the format authenticator apps import."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _hotp(secret_b32: str, counter: int) -> str:
    padding = "=" * (-len(secret_b32) % 8)
    key = base64.b32decode(secret_b32.upper() + padding, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10 ** DIGITS)).zfill(DIGITS)


def code_at(secret_b32: str, when: float | None = None) -> str:
    """The code valid at `when`. Exposed mainly so tests can be honest."""
    now = time.time() if when is None else when
    return _hotp(secret_b32, int(now // STEP_SECONDS))


def verify(secret_b32: str, code: str, when: float | None = None,
           window: int = DEFAULT_WINDOW) -> bool:
    """Constant-time check of `code` against the steps around now."""
    if not secret_b32 or not code:
        return False
    code = str(code).strip().replace(" ", "")
    if not code.isdigit() or len(code) != DIGITS:
        return False
    now = time.time() if when is None else when
    counter = int(now // STEP_SECONDS)
    ok = False
    for drift in range(-window, window + 1):
        # No early return: comparing every candidate keeps the time taken
        # independent of which step matched.
        ok |= secrets.compare_digest(_hotp(secret_b32, counter + drift), code)
    return ok


def provisioning_uri(secret_b32: str, address: str, issuer: str = "Terafort Mail") -> str:
    """otpauth:// URI for the QR code shown during enrolment."""
    label = urllib.parse.quote("%s:%s" % (issuer, address))
    params = urllib.parse.urlencode({
        "secret": secret_b32,
        "issuer": issuer,
        "algorithm": "SHA1",
        "digits": DIGITS,
        "period": STEP_SECONDS,
    })
    return "otpauth://totp/%s?%s" % (label, params)


def new_recovery_codes(count: int = 10) -> list[str]:
    """One-time codes for the phone-in-a-river case.

    Returned in the clear exactly once, at enrolment. Only their hashes are
    stored -- see `Mailbox.recovery_code_hashes`.
    """
    return ["%s-%s" % (secrets.token_hex(3), secrets.token_hex(3))
            for _ in range(count)]


def hash_recovery_code(code: str) -> str:
    """SHA-256 is right here where Argon2id would be wrong: these codes are
    160 bits of our own randomness, not a human-chosen secret, so there is no
    dictionary to grind."""
    return hashlib.sha256(code.strip().lower().encode("utf-8")).hexdigest()
