from decimal import Decimal

from django.core.validators import MinValueValidator, RegexValidator
from django.db import models

from core.encryption import decrypt_value, encrypt_value

from .users import User


class Integration(models.Model):
    """A configured third-party service.

    Credentials are encrypted at rest with the same Fernet key the vault uses,
    and are never returned to the API — callers only learn whether a key is
    present. Add new providers by extending PROVIDER_CHOICES; the settings UI
    renders whatever is registered here.
    """

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
    def set_api_key(self, raw_key):
        self.encrypted_api_key = encrypt_value(raw_key) if raw_key else ""

    def get_api_key(self):
        if not self.encrypted_api_key:
            return ""
        try:
            return decrypt_value(self.encrypted_api_key)
        except Exception:
            # A rotated/absent Fernet key must not crash a page render.
            return ""

    @property
    def has_api_key(self):
        return bool(self.encrypted_api_key)

    @property
    def spec(self):
        return self.PROVIDER_SPECS.get(self.provider, {})

    def mark_result(self, status, message=""):
        from django.utils import timezone

        self.last_status = status
        self.last_message = (message or "")[:2000]
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
