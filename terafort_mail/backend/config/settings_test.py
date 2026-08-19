"""Test settings: SQLite, in-process session store, no network.

The route sweep and the crypto suite run fully here. The Postgres row-level
security test detects the backend and skips loudly rather than passing
silently -- see tests/test_isolation.py.
"""
from .settings import *  # noqa: F401,F403

DEBUG = False
SECRET_KEY = "test-only"
ALLOWED_HOSTS = ["testserver", "localhost"]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# In-process store. Nothing in the suite may depend on a running Redis.
MAIL_REDIS_URL = ""

MAIL_SESSION_SEAL_KEY = "0123456789abcdef0123456789abcdef"
MAIL_HANDOFF_HMAC_KEY = "test-handoff-key"
MAIL_COOKIE_SECURE = False
MAIL_SESSION_COOKIE = "tfm_sid"      # __Host- needs Secure, which the test client is not
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0
MAIL_HANDOFF_BIND_IP = True          # exercised on purpose

# Both doors open in the suite so both stay tested.
MAIL_DIRECT_LOGIN_ENABLED = True
MAIL_INTERNAL_HMAC_KEY = "test-internal-key"
MAIL_INTERNAL_SERVICES = ["itcommand"]

# Throttling off: the isolation sweep fires hundreds of requests and would
# otherwise be testing the throttle rather than the isolation.
REST_FRAMEWORK = dict(REST_FRAMEWORK)  # noqa: F405
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {"mail_login": None, "mail_mfa": None}

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
LOGGING = {"version": 1, "disable_existing_loggers": False,
           "handlers": {"null": {"class": "logging.NullHandler"}},
           "root": {"handlers": ["null"]}}
