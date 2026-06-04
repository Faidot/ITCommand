import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from pathlib import Path

# Try to load .env from the backend root
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

def get_cipher():
    key = os.getenv('VAULT_ENCRYPTION_KEY')
    if not key:
        raise ValueError("VAULT_ENCRYPTION_KEY is not set in environment variables.")
    return Fernet(key.encode('utf-8'))

def encrypt_value(value: str) -> str:
    if not value:
        return value
    cipher = get_cipher()
    return cipher.encrypt(value.encode('utf-8')).decode('utf-8')

def decrypt_value(encrypted_value: str) -> str:
    if not encrypted_value:
        return encrypted_value
    cipher = get_cipher()
    return cipher.decrypt(encrypted_value.encode('utf-8')).decode('utf-8')
