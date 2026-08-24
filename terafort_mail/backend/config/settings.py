"""Settings for Terafort Mail.

Separate project, separate database, separate deployment from IT Command. The
two share exactly two things: a Redis session store and a pair of secrets
(the session seal key and the handoff HMAC key). Nothing else crosses.
"""
from pathlib import Path

from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config("SECRET_KEY", default="dev-only-change-me")
DEBUG = config("DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "rest_framework",
    "mailcore",
]
# Note the absences: no django.contrib.auth, no sessions framework, no admin.
# Mail users are not Django users -- there is no password hash and no auth
# table for them, which is the point. Adding auth back would create exactly
# the "administrator can read any mailbox" surface the design rules out.

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "mailcore.middleware.RowLevelSecurityMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "APP_DIRS": True,
    "DIRS": [],
    "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
}]

DATABASES = {
    "default": {
        "ENGINE": config("DB_ENGINE", default="django.db.backends.postgresql"),
        "NAME": config("DB_NAME", default="terafort_mail"),
        "USER": config("DB_USER", default="tfmail"),
        "PASSWORD": config("DB_PASSWORD", default=""),
        "HOST": config("DB_HOST", default="localhost"),
        "PORT": config("DB_PORT", default="5432"),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
USE_TZ = True
TIME_ZONE = config("TIME_ZONE", default="Europe/London")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "mailcore.authentication.MailSessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_THROTTLE_CLASSES": ("rest_framework.throttling.ScopedRateThrottle",),
    "DEFAULT_THROTTLE_RATES": {
        # Deliberately tight. Every login attempt becomes an IMAP connection
        # to the cPanel box, and cPHulk counts those. See blueprint section 3.
        "mail_login": config("THROTTLE_LOGIN", default="8/min"),
        "mail_mfa": config("THROTTLE_MFA", default="10/min"),
    },
}

# ---------------------------------------------------------------------------
# Mail-specific
# ---------------------------------------------------------------------------

MAIL_IMAP_HOST = config("MAIL_IMAP_HOST", default="localhost")
MAIL_IMAP_PORT = config("MAIL_IMAP_PORT", default=993, cast=int)
MAIL_IMAP_SSL = config("MAIL_IMAP_SSL", default=True, cast=bool)
MAIL_IMAP_VERIFY_CERT = config("MAIL_IMAP_VERIFY_CERT", default=True, cast=bool)
MAIL_IMAP_TIMEOUT = config("MAIL_IMAP_TIMEOUT", default=15, cast=int)

MAIL_SMTP_HOST = config("MAIL_SMTP_HOST", default=MAIL_IMAP_HOST)
MAIL_SMTP_PORT = config("MAIL_SMTP_PORT", default=587, cast=int)
MAIL_SMTP_STARTTLS = config("MAIL_SMTP_STARTTLS", default=True, cast=bool)

#: Blueprint decision: 8h absolute, 1h idle. The absolute cap never slides.
MAIL_SESSION_ABSOLUTE_SECONDS = config("MAIL_SESSION_ABSOLUTE_SECONDS", default=8 * 3600, cast=int)
MAIL_SESSION_IDLE_SECONDS = config("MAIL_SESSION_IDLE_SECONDS", default=3600, cast=int)
MAIL_MFA_TICKET_SECONDS = config("MAIL_MFA_TICKET_SECONDS", default=180, cast=int)
MAIL_HANDOFF_TICKET_SECONDS = config("MAIL_HANDOFF_TICKET_SECONDS", default=30, cast=int)

MAIL_SESSION_COOKIE = config("MAIL_SESSION_COOKIE", default="__Host-tfm_sid")
MAIL_COOKIE_SECURE = config("MAIL_COOKIE_SECURE", default=True, cast=bool)

#: Both apps must hold the same two keys. 32 bytes exactly for the seal key.
MAIL_SESSION_SEAL_KEY = config("MAIL_SESSION_SEAL_KEY", default="0" * 32)
MAIL_HANDOFF_HMAC_KEY = config("MAIL_HANDOFF_HMAC_KEY", default="dev-handoff-key")

#: Off by default. Behind nginx every request appears to come from the proxy,
#: and a user on mobile data can change address mid-session, so IP binding is
#: opt-in until you have confirmed X-Forwarded-For is trustworthy.
MAIL_HANDOFF_BIND_IP = config("MAIL_HANDOFF_BIND_IP", default=False, cast=bool)

#: Empty means the in-process store, which is for tests only. Production must
#: set this; `check_deploy` refuses to start without it.
MAIL_REDIS_URL = config("MAIL_REDIS_URL", default="")

MAIL_APP_INBOX_PATH = config("MAIL_APP_INBOX_PATH", default="/inbox")
ITC_BASE_URL = config("ITC_BASE_URL", default="https://itcommand.com")
MAIL_PROBE_TOKEN = config("MAIL_PROBE_TOKEN", default="")

#: clamd's socket. A unix path, or host:port. Empty means no scanner, and
#: MAIL_BLOCK_UNSCANNED then decides whether attachments are served at all.
MAIL_CLAMAV_SOCKET = config("MAIL_CLAMAV_SOCKET", default="")

#: What to do when an attachment cannot be scanned. True refuses the download
#: — safe, and it breaks every attachment the day clamd dies. False serves it
#: marked unscanned. Neither is obviously right, so it is a decision rather
#: than a default buried in code.
MAIL_BLOCK_UNSCANNED = config("MAIL_BLOCK_UNSCANNED", default=False, cast=bool)

# ---------------------------------------------------------------------------
# Transport security
# ---------------------------------------------------------------------------
SECURE_HSTS_SECONDS = config("SECURE_HSTS_SECONDS", default=31536000, cast=int)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_SSL_REDIRECT = config("SECURE_SSL_REDIRECT", default=True, cast=bool)
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": config("LOG_LEVEL", default="INFO")},
}

# ---------------------------------------------------------------------------
# Service-to-service boundary (blueprint section 11)
# ---------------------------------------------------------------------------

#: Signing key for internal requests. Distinct from the handoff key so that a
#: leak of one does not compromise the other.
MAIL_INTERNAL_HMAC_KEY = config("MAIL_INTERNAL_HMAC_KEY", default="")
MAIL_INTERNAL_SERVICES = config("MAIL_INTERNAL_SERVICES", default="itcommand", cast=Csv())

#: Whether mail.itcommand.com accepts a direct username/password login.
#: Off by default: with the handoff in place there is one front door, which
#: means one TOTP enrolment and one place to reason about. Turn it on only if
#: you want the mail app usable when IT Command is down.
MAIL_DIRECT_LOGIN_ENABLED = config("MAIL_DIRECT_LOGIN_ENABLED", default=False, cast=bool)
