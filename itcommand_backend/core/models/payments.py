"""Corporate cards and the charges made on them.

Synced from a spend provider (Brex today) so a subscription can answer the
question people actually ask: *which card does this renew on, and what did we
last pay?*

Charges are stored whether or not they match a subscription. An unmatched
charge is a finding — it may be a service nobody recorded — so it is kept
visible rather than dropped.
"""
import hashlib
import json
from decimal import ROUND_HALF_UP, Decimal

from django.db import models

from .users import User


class BrexObject(models.Model):
    """The raw payload Brex returned for one object, kept verbatim.

    Matching a charge to a service is a guess, and guesses get better. This
    table exists so the guessing can be redone against what Brex actually
    said, months later, without asking Brex again — and without the shape of
    today's typed models deciding what is worth keeping.

    `payload_hash` makes re-syncs cheap: most objects are identical run to
    run, and an unchanged row is not rewritten.
    """

    CARD = "CARD"
    USER = "USER"
    CARD_ACCOUNT = "CARD_ACCOUNT"
    DEPARTMENT = "DEPARTMENT"
    TRANSACTION = "TRANSACTION"
    OBJECT_TYPES = (
        (CARD, "Card"),
        (USER, "User"),
        (CARD_ACCOUNT, "Card account"),
        (DEPARTMENT, "Department"),
        (TRANSACTION, "Card transaction"),
    )

    object_type = models.CharField(max_length=32, choices=OBJECT_TYPES, db_index=True)
    external_id = models.CharField(max_length=128, db_index=True)
    payload = models.JSONField(default=dict)
    #: SHA-256 of the canonical payload. Not security — a change detector.
    payload_hash = models.CharField(max_length=64, db_index=True)

    first_seen_at = models.DateTimeField(auto_now_add=True)
    #: Bumped every sync that saw the object, whether or not it changed, so a
    #: card that quietly disappears from Brex can be spotted by its staleness.
    last_seen_at = models.DateTimeField()
    #: Only moves when the payload actually differs.
    last_changed_at = models.DateTimeField()

    class Meta:
        ordering = ["object_type", "external_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["object_type", "external_id"], name="unique_brex_object"
            ),
        ]
        indexes = [
            models.Index(fields=["object_type", "-last_seen_at"], name="brex_obj_seen_idx"),
        ]

    def __str__(self):
        return f"{self.get_object_type_display()} {self.external_id}"

    @staticmethod
    def hash_payload(payload):
        """Stable hash of a payload, independent of key order.

        `sort_keys` matters: Brex is under no obligation to serialise a JSON
        object the same way twice, and without it every sync would look like
        a change and rewrite every row.
        """
        canonical = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), default=str
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class PaymentCard(models.Model):
    """A corporate card, identified to people by its last four digits."""

    PROVIDER_CHOICES = (
        ("BREX", "Brex"),
        ("MANUAL", "Entered manually"),
    )
    STATUS_CHOICES = (
        ("ACTIVE", "Active"),
        ("LOCKED", "Locked"),
        ("TERMINATED", "Terminated"),
        ("UNKNOWN", "Unknown"),
    )

    FORM_CHOICES = (
        ("PHYSICAL", "Physical"),
        ("VIRTUAL", "Virtual"),
        ("UNKNOWN", "Unknown"),
    )

    provider = models.CharField(max_length=16, choices=PROVIDER_CHOICES, default="BREX")
    external_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    last_four = models.CharField(max_length=4, db_index=True)
    nickname = models.CharField(max_length=160, blank=True, default="")
    holder_name = models.CharField(max_length=160, blank=True, default="")
    holder = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="payment_cards",
        help_text="Matched to a person by email where the provider gives one.",
    )
    #: The provider's own id for the owner, kept because an email match can
    #: fail (a personal address, a changed name) and this cannot.
    external_owner_id = models.CharField(max_length=128, blank=True, default="")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="ACTIVE")
    #: Physical or virtual. Named `form` rather than `type` to stay clear of
    #: the `card_type` people expect to mean Visa/Mastercard.
    form = models.CharField(max_length=16, choices=FORM_CHOICES, default="UNKNOWN")
    #: The spend limit, in the currency the provider states it in. Null means
    #: no limit was reported, which is not the same as a limit of zero.
    limit_amount = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    limit_currency = models.CharField(max_length=3, blank=True, default="")
    limit_interval = models.CharField(
        max_length=32, blank=True, default="",
        help_text="How often the limit resets, as the provider words it.",
    )
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["last_four"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "external_id"],
                condition=~models.Q(external_id=""),
                name="unique_provider_card",
            ),
        ]

    def __str__(self):
        label = self.nickname or self.holder_name or self.get_provider_display()
        return f"{label} •••• {self.last_four}"

    @property
    def display(self):
        return f"•••• {self.last_four}"


class CardAccount(models.Model):
    """A card account and what is in it.

    Separate from `PaymentCard`: an account holds a balance, a card spends
    from one. Several cards can draw on the same account, which is why the
    balance cannot live on the card.
    """

    provider = models.CharField(max_length=16, default="BREX")
    external_id = models.CharField(max_length=128, db_index=True)
    name = models.CharField(max_length=160, blank=True, default="")
    status = models.CharField(max_length=32, blank=True, default="")
    currency = models.CharField(max_length=3, default="USD")
    #: Null rather than zero when the provider did not report one — an
    #: unknown balance and an empty account are different facts.
    current_balance = models.DecimalField(
        max_digits=16, decimal_places=2, null=True, blank=True
    )
    available_balance = models.DecimalField(
        max_digits=16, decimal_places=2, null=True, blank=True
    )
    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "external_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "external_id"], name="unique_provider_card_account"
            ),
        ]

    def __str__(self):
        return self.name or f"{self.provider} account {self.external_id}"


class ServicePayment(models.Model):
    """One charge on a card, optionally tied to an estate service.

    Renamed from `SubscriptionPayment` in Phase 5 along with the module it was
    named after. Model and column renames, so no row moves.

    `match_source` records *how* the link was made, so an automatic guess can
    be told apart from a human decision and corrected without being re-guessed.
    """

    MATCH_CHOICES = (
        ("AUTO", "Matched automatically"),
        # Covers a person linking *and* a person unlinking. Both are decisions
        # the sync must leave alone, so they share a value; "linked by a
        # person" would misdescribe a charge somebody deliberately detached.
        ("MANUAL", "Set by a person"),
        ("NONE", "Not matched"),
    )

    provider = models.CharField(max_length=16, default="BREX")
    external_id = models.CharField(max_length=128, db_index=True)

    merchant = models.CharField(max_length=255, blank=True, default="")
    description = models.CharField(max_length=255, blank=True, default="")
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    currency = models.CharField(max_length=3, default="USD")
    posted_at = models.DateField(db_index=True)

    card = models.ForeignKey(
        PaymentCard, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="payments",
    )
    service = models.ForeignKey(
        "Service", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="payments",
    )
    match_source = models.CharField(max_length=8, choices=MATCH_CHOICES, default="NONE")
    match_score = models.FloatField(default=0.0)

    # ── converted value ──────────────────────────────────────────────────
    #
    # Frozen at sync time rather than computed on read, for three reasons: a
    # report run today and next month must agree, MANUAL rate rows are
    # editable so recomputing could silently restate history, and a rollup
    # over thousands of charges should not do a rate lookup per row.
    #
    # All four are null together. A missing rate leaves them null — it is
    # never folded at 1:1, which is the rule `core.fx` exists to enforce.
    # `backfill_payment_fx` fills them in once the rate arrives.
    base_amount = models.DecimalField(
        max_digits=16, decimal_places=2, null=True, blank=True
    )
    #: What `base_amount` is denominated in. Stored per row because the org
    #: reporting currency can change, and every frozen figure predating that
    #: change is in the old one.
    base_currency = models.CharField(max_length=3, blank=True, default="")
    fx_rate = models.DecimalField(
        max_digits=20, decimal_places=10, null=True, blank=True
    )
    #: The `as_of` of the rate row actually used, which may be older than
    #: `posted_at` — a weekend charge converts at Friday's rate.
    fx_rate_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-posted_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "external_id"], name="unique_provider_payment"
            ),
        ]
        indexes = [
            models.Index(fields=["service", "-posted_at"], name="payment_svc_date_idx"),
            # The backfill's working set: rows still waiting for a rate.
            models.Index(
                fields=["base_amount", "posted_at"], name="payment_unconverted_idx"
            ),
        ]

    def __str__(self):
        return f"{self.merchant} {self.currency} {self.amount} on {self.posted_at}"

    @property
    def is_converted(self):
        return self.base_amount is not None

    def apply_fx(self, *, reporting_currency=None, force=False):
        """Freeze the converted value. Returns True if anything changed.

        A row already converted into the current reporting currency is left
        alone unless `force`, so re-running is cheap and does not restate
        figures that are already correct.

        Conversion is re-derived from `amount` and a rate as of `posted_at` —
        never from a stale `base_amount`, which would compound rounding and
        bake in the old reporting currency.
        """
        from core import fx

        target = (reporting_currency or fx.reporting_currency()).upper()
        if not force and self.base_amount is not None and self.base_currency == target:
            return False

        rate, as_of = fx.rate_with_date(
            self.currency, base=target, on_date=self.posted_at
        )
        if rate is None:
            # Explicitly not 1:1. An unconvertible charge stays unconverted
            # and gets reported as such.
            return False

        self.base_amount = (Decimal(self.amount) * rate).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        self.base_currency = target
        self.fx_rate = rate
        self.fx_rate_date = as_of or self.posted_at
        return True
