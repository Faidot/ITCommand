import hashlib
from decimal import Decimal

from django.core.validators import MinValueValidator, RegexValidator
from django.db import models

from core.encryption import decrypt_value, encrypt_value

from .users import User


class CredentialUnreadable(Exception):
    """Stored ciphertext exists but will not decrypt with the current key.

    Distinct from "no key saved", which is the state callers used to see for
    both cases. Telling an operator there is no token when there is one they
    can no longer read sends them to the wrong fix.
    """


class Integration(models.Model):
    """A configured third-party service.

    Credentials are encrypted at rest with the same Fernet key the vault uses,
    and are never returned to the API — callers only learn whether a key is
    present. Add new providers by extending PROVIDER_CHOICES; the settings UI
    renders whatever is registered here.
    """

    #: How long before `key_expires_at` the UI should start warning.
    EXPIRY_WARNING_DAYS = 30
    #: Upper bound on anything written to `last_message`. It is provider text
    #: rendered in the UI, so it is bounded and flattened at the door.
    MESSAGE_LIMIT = 500

    PROVIDER_CHOICES = (
        ("EXCHANGE_RATES", "Currency exchange rates"),
        ("BREX", "Brex corporate cards"),
        ("SLACK", "Slack notifications"),
        ("TEAMS", "Microsoft Teams notifications"),
        ("DISCORD", "Discord notifications"),
        ("WEBHOOK", "Outgoing webhook"),
        ("AWS_DISCOVERY", "AWS (estate discovery)"),
        ("CLOUDFLARE_DISCOVERY", "Cloudflare (estate discovery)"),
    )

    #: Credentials stored ahead of a sync that does not exist yet. Nothing in
    #: this codebase contacts them — `notify.broadcast` only ever reaches
    #: CHAT_PROVIDERS, and IntegrationTestView has no command registered for
    #: these — so saving a key here is inert until discovery is built.
    DISCOVERY_PROVIDERS = ("AWS_DISCOVERY", "CLOUDFLARE_DISCOVERY")

    #: Providers that post a message to a secret URL rather than call an API.
    CHAT_PROVIDERS = ("SLACK", "TEAMS", "DISCORD", "WEBHOOK")

    #: Providers we know how to talk to, with the fields the UI should collect.
    PROVIDER_SPECS = {
        "EXCHANGE_RATES": {
            "label": "Currency exchange rates",
            "description": (
                "Fetches daily rates so mixed-currency spend can be reported as "
                "a single converted total."
            ),
            "needs_api_key": True,
            "default_base_url": "https://api.exchangerate.host/live",
            "help": (
                "Works with exchangerate.host, exchangerate-api.com and any "
                "endpoint returning JSON rates keyed by currency code."
            ),
        },
        "BREX": {
            "label": "Brex corporate cards",
            "description": (
                "Syncs your cards and card charges, so each subscription shows "
                "which card it renews on and what you last paid."
            ),
            "needs_api_key": True,
            "credential_label": "Brex API token",
            "default_base_url": "https://platform.brexapis.com",
            "help": (
                "Brex dashboard \u2192 Developer \u2192 Create token, with read access to "
                "cards and transactions. Paste the token here."
            ),
            "supports_sync": True,
        },
        "SLACK": {
            "label": "Slack notifications",
            "description": "Posts renewal, budget and ticket alerts to a Slack channel.",
            "needs_api_key": True,
            "credential_label": "Incoming webhook URL",
            "default_base_url": "",
            "help": (
                "Slack → Apps → Incoming Webhooks → Add to Workspace, then paste "
                "the https://hooks.slack.com/services/… URL."
            ),
        },
        "TEAMS": {
            "label": "Microsoft Teams notifications",
            "description": "Posts the same alerts to a Teams channel.",
            "needs_api_key": True,
            "credential_label": "Incoming webhook URL",
            "default_base_url": "",
            "help": "Teams channel → Connectors → Incoming Webhook → copy the URL.",
        },
        "DISCORD": {
            "label": "Discord notifications",
            "description": "Posts the same alerts to a Discord channel.",
            "needs_api_key": True,
            "credential_label": "Webhook URL",
            "default_base_url": "",
            "help": "Channel → Edit Channel → Integrations → Webhooks → New Webhook.",
        },
        "WEBHOOK": {
            "label": "Outgoing webhook",
            "description": (
                "POSTs each alert as JSON to any URL — use it with Zapier, n8n, "
                "Power Automate or your own service."
            ),
            "needs_api_key": True,
            "credential_label": "Endpoint URL",
            "default_base_url": "",
            "help": "Receives {event, title, message, url, timestamp} as JSON.",
        },
        "AWS_DISCOVERY": {
            "label": "AWS (estate discovery)",
            "description": (
                "Stores AWS credentials for a future estate discovery sync. "
                "Nothing contacts AWS yet — this is configuration only."
            ),
            "needs_api_key": True,
            "credential_label": "AWS secret access key",
            "default_base_url": "https://ec2.amazonaws.com",
            "help": (
                "An IAM user with read-only access to Route 53 and CloudFront. "
                "Saving a key here does not start a sync; discovery is not built yet."
            ),
            "config_only": True,
        },
        "CLOUDFLARE_DISCOVERY": {
            "label": "Cloudflare (estate discovery)",
            "description": (
                "Stores a Cloudflare API token for a future estate discovery sync. "
                "Nothing contacts Cloudflare yet — this is configuration only."
            ),
            "needs_api_key": True,
            "credential_label": "Cloudflare API token",
            "default_base_url": "https://api.cloudflare.com/client/v4",
            "help": (
                "My Profile → API Tokens → Create Token, with Zone:Read and "
                "DNS:Read. Saving a token here does not start a sync."
            ),
            "config_only": True,
        },
    }

    provider = models.CharField(
        max_length=64, choices=PROVIDER_CHOICES, unique=True, db_index=True
    )
    is_enabled = models.BooleanField(
        default=False, help_text="Unticked integrations are never contacted."
    )
    base_url = models.URLField(blank=True, default="")
    encrypted_api_key = models.TextField(blank=True, default="")
    #: First 8 hex chars of the key's SHA-256. Enough to tell two keys apart in
    #: an audit trail and to confirm the one you hold is the one installed;
    #: far too little to reconstruct the key. Never a substring of the secret.
    key_fingerprint = models.CharField(max_length=16, blank=True, default="")
    key_set_at = models.DateTimeField(null=True, blank=True)
    #: Operator-entered, because no provider here reports its own token expiry.
    #: A date rather than a timestamp: nobody knows the hour a token dies.
    key_expires_at = models.DateField(
        null=True, blank=True,
        help_text="Optional. When this token expires, so it can be rotated before it fails.",
    )
    #: Provider-specific extras (e.g. a plan tier or account id).
    config = models.JSONField(default=dict, blank=True)

    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=16, blank=True, default="")
    last_message = models.TextField(blank=True, default="")

    updated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="updated_integrations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["provider"]

    def __str__(self):
        return self.get_provider_display()

    # --- credentials -------------------------------------------------
    #: `credential_state` values.
    CREDENTIAL_MISSING = "MISSING"
    CREDENTIAL_OK = "OK"
    CREDENTIAL_UNREADABLE = "UNREADABLE"

    @staticmethod
    def fingerprint_for(raw_key):
        """A short, non-reversible label for a key. Empty for an empty key."""
        if not raw_key:
            return ""
        return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:8]

    def set_api_key(self, raw_key):
        """Store a key, or clear it when `raw_key` is empty.

        Clearing wipes the fingerprint and set-at too — leaving them behind
        would claim a key is installed when none is.
        """
        from django.utils import timezone

        if raw_key:
            self.encrypted_api_key = encrypt_value(raw_key)
            self.key_fingerprint = self.fingerprint_for(raw_key)
            self.key_set_at = timezone.now()
        else:
            self.encrypted_api_key = ""
            self.key_fingerprint = ""
            self.key_set_at = None
            self.key_expires_at = None

    def get_api_key(self):
        """The decrypted key.

        Returns "" when none is saved, and raises `CredentialUnreadable` when
        one is saved but will not decrypt — the two used to be the same answer,
        which reported a rotated VAULT_ENCRYPTION_KEY as a missing token.

        Safe to leave raising: page renders read `has_api_key`, which never
        decrypts. Only sync paths call this.
        """
        if not self.encrypted_api_key:
            return ""
        try:
            return decrypt_value(self.encrypted_api_key)
        except Exception as exc:
            raise CredentialUnreadable(
                f"The stored {self.get_provider_display()} credential cannot be "
                "decrypted. VAULT_ENCRYPTION_KEY has changed since it was saved "
                "— paste the credential again to re-encrypt it under the current key."
            ) from exc

    @property
    def has_api_key(self):
        return bool(self.encrypted_api_key)

    @property
    def credential_state(self):
        """MISSING / OK / UNREADABLE, without exposing the key."""
        if not self.encrypted_api_key:
            return self.CREDENTIAL_MISSING
        try:
            decrypt_value(self.encrypted_api_key)
        except Exception:
            return self.CREDENTIAL_UNREADABLE
        return self.CREDENTIAL_OK

    @property
    def key_expires_in_days(self):
        """Days until the operator-entered expiry, or None if none is set.

        Negative once past. The UI warns from `EXPIRY_WARNING_DAYS`.
        """
        if not self.key_expires_at:
            return None
        from django.utils import timezone

        return (self.key_expires_at - timezone.localdate()).days

    @property
    def spec(self):
        return self.PROVIDER_SPECS.get(self.provider, {})

    @classmethod
    def clean_message(cls, message):
        """Flatten and bound provider text before it is stored and rendered."""
        return " ".join(str(message or "").split())[: cls.MESSAGE_LIMIT]

    def mark_result(self, status, message=""):
        from django.utils import timezone

        self.last_status = status
        self.last_message = self.clean_message(message)
        self.last_sync_at = timezone.now()
        self.save(update_fields=["last_status", "last_message", "last_sync_at", "updated_at"])


class CalendarFeedToken(models.Model):
    """A private calendar-feed URL belonging to one person.

    The token *is* the credential, so the feed URL must be treated like a
    password. It is regenerable, which instantly invalidates the old URL if it
    leaks. The feed itself only ever contains what that user is allowed to see.
    """

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="calendar_feed"
    )
    token = models.CharField(max_length=64, unique=True, db_index=True)
    is_enabled = models.BooleanField(default=True)
    #: Which record types the user wants on their calendar.
    include = models.JSONField(default=list, blank=True)
    last_accessed_at = models.DateTimeField(null=True, blank=True)
    access_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    #: Everything the feed can carry, and the module each needs `view` on.
    SOURCES = (
        ("subscriptions", "Subscription renewals & cancellation deadlines", "subscriptions"),
        ("licenses", "Licence expiry", "licenses"),
        ("contracts", "Vendor contract end dates", "vendors"),
        ("warranties", "Asset warranty expiry", "assets"),
        ("bills", "Recurring bill due dates", "finance"),
        ("onboarding", "Onboarding task due dates", "onboarding"),
        ("tickets", "Ticket due dates", "helpdesk"),
    )
    DEFAULT_SOURCES = [key for key, _, _ in SOURCES]

    def __str__(self):
        return f"Calendar feed for {self.user.email}"

    @staticmethod
    def new_token():
        import secrets

        return secrets.token_urlsafe(32)

    def rotate(self):
        self.token = self.new_token()
        self.save(update_fields=["token", "updated_at"])
        return self.token

    def selected_sources(self):
        chosen = [s for s in (self.include or []) if s in self.DEFAULT_SOURCES]
        return chosen or self.DEFAULT_SOURCES

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = self.new_token()
        return super().save(*args, **kwargs)


class ExchangeRate(models.Model):
    """How much one unit of `currency` is worth in `base_currency`.

    Rates are stored per day so historic reports stay stable rather than
    silently changing when a new rate arrives.
    """

    SOURCE_CHOICES = (
        ("MANUAL", "Entered manually"),
        ("API", "Fetched from provider"),
    )

    _CODE_VALIDATOR = RegexValidator(
        regex=r"^[A-Z]{3}$",
        message="Currency must be a three-letter ISO code (for example, USD).",
    )

    base_currency = models.CharField(max_length=3, validators=[_CODE_VALIDATOR], db_index=True)
    currency = models.CharField(max_length=3, validators=[_CODE_VALIDATOR], db_index=True)
    #: 1 `currency` == `rate` × `base_currency`.
    rate = models.DecimalField(
        max_digits=20,
        decimal_places=10,
        validators=[MinValueValidator(Decimal("0.0000000001"))],
    )
    as_of = models.DateField(db_index=True)
    source = models.CharField(max_length=8, choices=SOURCE_CHOICES, default="MANUAL")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-as_of", "currency"]
        constraints = [
            models.UniqueConstraint(
                fields=["base_currency", "currency", "as_of"],
                name="unique_rate_per_day",
            ),
            models.CheckConstraint(
                condition=models.Q(rate__gt=0), name="exchange_rate_positive"
            ),
        ]
        indexes = [
            models.Index(fields=["base_currency", "currency", "-as_of"], name="fx_lookup_idx"),
        ]

    def __str__(self):
        return f"1 {self.currency} = {self.rate} {self.base_currency} ({self.as_of})"

    def save(self, *args, **kwargs):
        self.base_currency = (self.base_currency or "").strip().upper()
        self.currency = (self.currency or "").strip().upper()
        return super().save(*args, **kwargs)
