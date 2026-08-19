"""Key derivation, sealing and unsealing for Terafort Mail.

The whole security story of this app rests on one idea: the mailbox password
is the root of the key hierarchy, and it exists only inside a live session.
Nothing here ever writes a password, a KEK or a DEK to disk.

    password --Argon2id(salt)--> KEK --unwraps--> DEK --AES-GCM--> message bodies

A stolen database yields `wrapped_dek` and ciphertext, and neither is useful
without a password nobody stored. See the blueprint, section 6.
"""
from __future__ import annotations

import os
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
from django.conf import settings

#: AES-256-GCM. 12-byte nonce is the standard choice and the only size that
#: lets us skip the extra GHASH pass over a longer nonce.
NONCE_BYTES = 12
KEY_BYTES = 32
SALT_BYTES = 16

#: Argon2id parameters. These are deliberately on the cheap side of what you
#: would use for a stored password hash, because we are NOT storing a hash --
#: Dovecot already decided the password was right. This derivation only has to
#: make an offline attack on a stolen `wrapped_dek` expensive, and it runs on
#: every login, so it also has to stay off the critical path. ~64MB / 3 passes
#: lands around 60-90ms on a modern core.
ARGON2_MEMORY_KIB = 64 * 1024
ARGON2_ITERATIONS = 3
ARGON2_LANES = 4


class SealError(Exception):
    """Raised when ciphertext will not open: wrong key, or tampered bytes."""


def new_salt() -> bytes:
    return secrets.token_bytes(SALT_BYTES)


def new_key() -> bytes:
    return secrets.token_bytes(KEY_BYTES)


def derive_kek(password: str, salt: bytes) -> bytes:
    """Turn a mailbox password into a key-encrypting key.

    Deterministic for a given (password, salt), which is what lets a later
    login unwrap the DEK that an earlier login wrapped.
    """
    if not isinstance(salt, (bytes, bytearray)) or len(salt) != SALT_BYTES:
        raise ValueError("salt must be %d bytes" % SALT_BYTES)
    kdf = Argon2id(
        salt=bytes(salt),
        length=KEY_BYTES,
        iterations=ARGON2_ITERATIONS,
        lanes=ARGON2_LANES,
        memory_cost=ARGON2_MEMORY_KIB,
    )
    return kdf.derive(password.encode("utf-8"))


def seal(key: bytes, plaintext: bytes, aad: bytes | None = None) -> bytes:
    """AES-256-GCM. Returns nonce || ciphertext || tag as one opaque blob.

    `aad` binds the ciphertext to a context -- we pass the mailbox id for
    message bodies, so a body row copied into another mailbox will not open
    even if an attacker also has that mailbox's key.
    """
    if len(key) != KEY_BYTES:
        raise ValueError("key must be %d bytes" % KEY_BYTES)
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad)


def unseal(key: bytes, blob: bytes, aad: bytes | None = None) -> bytes:
    if len(key) != KEY_BYTES:
        raise ValueError("key must be %d bytes" % KEY_BYTES)
    if blob is None or len(blob) <= NONCE_BYTES:
        raise SealError("blob too short to contain a nonce and a tag")
    nonce, body = blob[:NONCE_BYTES], blob[NONCE_BYTES:]
    try:
        return AESGCM(key).decrypt(nonce, body, aad)
    except InvalidTag as exc:
        raise SealError("ciphertext did not authenticate") from exc


# ---------------------------------------------------------------------------
# DEK wrapping
# ---------------------------------------------------------------------------

def wrap_dek(dek: bytes, password: str, salt: bytes) -> bytes:
    return seal(derive_kek(password, salt), dek, aad=b"tfm-dek-v1")


def unwrap_dek(wrapped: bytes, password: str, salt: bytes) -> bytes:
    """Recover the DEK, or raise SealError if the password has changed.

    A SealError here is the signal described in the blueprint: the user changed
    their password in cPanel while we were away, the cache can never be read
    again, and the caller must discard it and re-sync. It is not an error the
    user should ever see.
    """
    return unseal(derive_kek(password, salt), wrapped, aad=b"tfm-dek-v1")


# ---------------------------------------------------------------------------
# Server-side sealing (session records)
# ---------------------------------------------------------------------------

def _server_key() -> bytes:
    """The key that seals session records before they reach Redis.

    This one does live in the environment, and it has to: something has to
    protect the credential between the login request and the Redis SET. It
    buys us the property that a Redis dump alone -- an RDB left on a backup
    volume, say -- is not a pile of plaintext passwords.
    """
    raw = settings.MAIL_SESSION_SEAL_KEY
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if len(raw) != KEY_BYTES:
        raise ValueError(
            "MAIL_SESSION_SEAL_KEY must be exactly %d bytes; got %d"
            % (KEY_BYTES, len(raw))
        )
    return raw


def seal_for_server(plaintext: bytes) -> bytes:
    return seal(_server_key(), plaintext, aad=b"tfm-session-v1")


def unseal_for_server(blob: bytes) -> bytes:
    return unseal(_server_key(), blob, aad=b"tfm-session-v1")


def constant_time_equal(a: bytes, b: bytes) -> bool:
    return secrets.compare_digest(a, b)
