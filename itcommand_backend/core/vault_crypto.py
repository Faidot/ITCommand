"""End-to-end (public-key envelope) crypto for privately-shared vault credentials.

Design
------
Each vault user owns an RSA-3072 keypair, created the first time they set a
*personal vault password*:

  * the PUBLIC key is stored in plaintext — anyone can seal a secret *to* the user.
  * the PRIVATE key is stored encrypted with a key derived (PBKDF2-HMAC-SHA256)
    from the user's personal password + a per-user random salt. The server never
    persists the personal password or the decrypted private key.

Sharing a credential = re-sealing its secret to each recipient's public key
(hybrid: a random Fernet data-key encrypts the payload; that data-key is then
RSA-OAEP-encrypted to the recipient). Only the recipient, by entering their
personal password, can recover the private key and open the sealed blob — not
other managers, not a superadmin, not anyone holding the org key or the DB.
"""

import os
import json
import base64

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

KDF_ITERATIONS = 200_000
RSA_KEY_SIZE = 3072


# ───────────────────────────── keypair lifecycle ─────────────────────────────

def generate_user_keypair() -> tuple[str, str]:
    """Return (private_pem, public_pem) for a fresh RSA-3072 keypair."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=RSA_KEY_SIZE)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode('utf-8')
    public_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode('utf-8')
    return private_pem, public_pem


def _derive_fernet_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=KDF_ITERATIONS)
    return base64.urlsafe_b64encode(kdf.derive(password.encode('utf-8')))


def encrypt_private_key(private_pem: str, password: str) -> tuple[str, str]:
    """Encrypt the private key PEM under a key derived from `password`.
    Returns (encrypted_private_key, salt_b64).
    """
    salt = os.urandom(16)
    f = Fernet(_derive_fernet_key(password, salt))
    enc = f.encrypt(private_pem.encode('utf-8')).decode('utf-8')
    return enc, base64.b64encode(salt).decode('utf-8')


def decrypt_private_key(encrypted_private_key: str, password: str, salt_b64: str) -> str:
    """Recover the private key PEM. Raises cryptography.fernet.InvalidToken on a
    wrong password (callers should treat that as 'incorrect personal password').
    """
    salt = base64.b64decode(salt_b64)
    f = Fernet(_derive_fernet_key(password, salt))
    return f.decrypt(encrypted_private_key.encode('utf-8')).decode('utf-8')


# ───────────────────────────── seal / open a secret ─────────────────────────────

def seal_for_public_key(plaintext: str, public_pem: str) -> str:
    """Hybrid-encrypt `plaintext` to a recipient's public key. Returns a JSON
    string holding the RSA-wrapped data-key and the Fernet-encrypted payload.
    """
    pub = serialization.load_pem_public_key(public_pem.encode('utf-8'))
    data_key = Fernet.generate_key()  # 32 random bytes, urlsafe-b64 (44 bytes)
    token = Fernet(data_key).encrypt(plaintext.encode('utf-8')).decode('utf-8')
    wrapped = pub.encrypt(
        data_key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                     algorithm=hashes.SHA256(), label=None),
    )
    return json.dumps({'v': 1, 'k': base64.b64encode(wrapped).decode('utf-8'), 'd': token})


def open_with_private_key(sealed: str, private_pem: str) -> str:
    """Inverse of seal_for_public_key. Returns the plaintext string."""
    obj = json.loads(sealed)
    priv = serialization.load_pem_private_key(private_pem.encode('utf-8'), password=None)
    data_key = priv.decrypt(
        base64.b64decode(obj['k']),
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
                     algorithm=hashes.SHA256(), label=None),
    )
    return Fernet(data_key).decrypt(obj['d'].encode('utf-8')).decode('utf-8')
