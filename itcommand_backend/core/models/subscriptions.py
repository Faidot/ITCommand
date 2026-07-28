from decimal import Decimal, ROUND_HALF_UP

from django.core.validators import MinValueValidator, RegexValidator
from django.db import models
from django.utils import timezone

from core.currencies import is_current_iso_4217_code
# `core.estate` is the taxonomy (layer order, thresholds); `.estate` below is
# the models module. Same name, different layers — imported explicitly so the
# distinction stays visible at the call site.
from core.estate import SERVICE_LAYERS, is_at_risk as estate_is_at_risk

from .estate import DigitalProperty, ProviderAccount
from .finance import BudgetCategory
from .licenses import SoftwareLicense
from .users import Department, User
from .vault import VaultCredential
from .vendors import Vendor, VendorContract


MONEY_ZERO = Decimal("0.00")


class Subscription(models.Model):
    """A recurring software or platform subscription owned by the company."""

    CATEGORY_CHOICES = (
        ("CLOUD", "Cloud"),
        ("AI", "AI tools"),
        ("SAAS", "SaaS"),
        ("PRODUCTIVITY", "Productivity"),
        ("COMMUNICATION", "Communication"),
        ("DESIGN", "Design"),
        ("DEVELOPMENT", "Development"),
        ("SECURITY", "Security"),
        ("FINANCE", "Finance"),
        ("HR", "Human resources"),
        ("OTHER", "Other"),
    )
    BILLING_CYCLE_CHOICES = (
        ("MONTHLY", "Monthly"),
        ("YEARLY", "Yearly"),
    )
    STATUS_CHOICES = (
        ("ACTIVE", "Active"),
        ("PAUSED", "Paused"),
        ("CANCELLED", "Cancelled"),
    )

    name = models.CharField(max_length=160)
    platform = models.CharField(max_length=160)
    plan_type = models.CharField(max_length=120, blank=True, default="")
    category = models.CharField(
        max_length=24, choices=CATEGORY_CHOICES, default="OTHER", db_index=True
    )
    cost = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(MONEY_ZERO)],
    )
    currency = models.CharField(
        max_length=3,
        default="USD",
        validators=[
            RegexValidator(
                regex=r"^[A-Z]{3}$",
                message="Currency must be a three-letter ISO code (for example, USD).",
            )
        ],
    )
    billing_cycle = models.CharField(
        max_length=12, choices=BILLING_CYCLE_CHOICES, db_index=True
    )
    start_date = models.DateField()
    expiry_date = models.DateField(db_index=True)
    purpose = models.TextField(blank=True, default="")
    team = models.CharField(max_length=160, blank=True, default="")
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscriptions",
    )
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_subscriptions",
    )
    admin = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="administered_subscriptions",
    )
    # Optional links into the rest of the system.  `platform` stays the human
    # label for services that will never have a Vendor record of their own.
    vendor = models.ForeignKey(
        Vendor,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscriptions",
    )
    vendor_contract = models.ForeignKey(
        VendorContract,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscriptions",
    )
    budget_category = models.ForeignKey(
        BudgetCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscriptions",
    )
    vault_credential = models.ForeignKey(
        VaultCredential,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscriptions",
    )
    linked_license = models.ForeignKey(
        SoftwareLicense,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="linked_subscriptions",
    )
    # --- Digital Estate ---
    # All four are optional: a subscription that predates the estate module, or
    # one that genuinely serves no property, stays valid.
    provider_account = models.ForeignKey(
        ProviderAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscriptions",
        help_text="The provider login this service is bought through.",
    )
    digital_property = models.ForeignKey(
        DigitalProperty,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscriptions",
        help_text="What this service keeps running. Empty means orphaned.",
    )
    service_layer = models.CharField(
        max_length=16,
        choices=SERVICE_LAYERS,
        null=True,
        blank=True,
        help_text="Where this sits in the stack: registrar, DNS, hosting, …",
    )
    identifier = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text='What this service actually points at — "zone: example.com", "ecs-prod · ap-south-1".',
    )
    url = models.URLField(blank=True, default="")
    status = models.CharField(
        max_length=12, choices=STATUS_CHOICES, default="ACTIVE", db_index=True
    )
    auto_renew = models.BooleanField(default=False)
    renewal_reminder_enabled = models.BooleanField(default=True)
    renewal_reminder_days = models.PositiveSmallIntegerField(
        default=30, validators=[MinValueValidator(0)]
    )
    cancellation_deadline = models.DateField(null=True, blank=True, db_index=True)
    cancellation_reminder_enabled = models.BooleanField(default=False)
    cancellation_reminder_days = models.PositiveSmallIntegerField(
        default=7, validators=[MinValueValidator(0)]
    )
    seats_total = models.IntegerField(
        null=True, blank=True, help_text="Total licensed seats. Null = unlimited."
    )
    payment_card = models.ForeignKey(
        "PaymentCard",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscriptions",
        help_text="The card this renews on. Set automatically when charges are synced.",
    )
    #: Merchant descriptor as it appears on the card statement. Matching writes
    #: this back so future charges attach without guessing again.
    billing_descriptor = models.CharField(max_length=255, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_subscriptions",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["expiry_date", "name"]
        indexes = [
            models.Index(fields=["status", "expiry_date"], name="sub_status_exp_idx"),
            models.Index(fields=["currency", "category"], name="sub_currency_cat_idx"),
            # Digital Estate. Note the plan's fourth index, (status, expiry_date),
            # is already covered by sub_status_exp_idx above.
            models.Index(
                fields=["digital_property", "service_layer"], name="sub_prop_layer_idx"
            ),
            models.Index(
                fields=["provider_account", "status"], name="sub_acct_status_idx"
            ),
            # (auto_renew, expiry_date) — the plan says renewal_date, which does
            # not exist on this model; expiry_date is the renewal boundary.
            models.Index(
                fields=["auto_renew", "expiry_date"], name="sub_autorenew_exp_idx"
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(cost__gte=0), name="subscription_cost_nonnegative"
            ),
            models.CheckConstraint(
                condition=models.Q(expiry_date__gte=models.F("start_date")),
                name="subscription_dates_ordered",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(cancellation_deadline__isnull=True)
                    | (
                        models.Q(cancellation_deadline__gte=models.F("start_date"))
                        & models.Q(cancellation_deadline__lte=models.F("expiry_date"))
                    )
                ),
                name="subscription_cancellation_date_ordered",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.plan_type or self.platform})"

    def clean(self):
        from django.core.exceptions import ValidationError

        errors = {}
        if self.start_date and self.expiry_date and self.expiry_date < self.start_date:
            errors["expiry_date"] = "Expiry date cannot be before the start date."
        if self.cancellation_deadline:
            if self.start_date and self.cancellation_deadline < self.start_date:
                errors["cancellation_deadline"] = (
                    "Cancellation deadline cannot be before the start date."
                )
            if self.expiry_date and self.cancellation_deadline > self.expiry_date:
                errors["cancellation_deadline"] = (
                    "Cancellation deadline cannot be after the expiry date."
                )
        if (
            self.vendor_contract_id
            and self.vendor_id
            and self.vendor_contract.vendor_id != self.vendor_id
        ):
            errors["vendor_contract"] = (
                "Contract does not belong to the selected vendor."
            )
        if errors:
            raise ValidationError(errors)

    @property
    def effective_status(self):
        if self.status in {"PAUSED", "CANCELLED"}:
            return self.status
        today = timezone.localdate()
        if self.start_date and self.start_date > today:
            return "SCHEDULED"
        if self.expiry_date and self.expiry_date < today:
            return "EXPIRED"
        return "ACTIVE"

    def save(self, *args, **kwargs):
        # `service_layer` is nullable so "no layer set" is distinct from a real
        # layer. Forms and JSON both like to send "", which would give us two
        # different empty values in one column; collapse it to NULL on the way in.
        if not self.service_layer:
            self.service_layer = None
        return super().save(*args, **kwargs)

    @property
    def days_until_expiry(self):
        if not self.expiry_date:
            return None
        return (self.expiry_date - timezone.localdate()).days

    # --- Digital Estate ---

    @property
    def is_orphan(self):
        """Billed, but tied to nothing we own.

        Reads the FK id rather than the object so this stays free on a list page
        that has not select_related'd the property.
        """
        return self.digital_property_id is None

    @property
    def is_at_risk(self):
        """Will not auto-renew, and expires soon enough for that to matter.

        Uses the default window. The API layer re-evaluates with the org's
        configured window via the same predicate, so the two cannot drift —
        see `core.estate.is_at_risk`.
        """
        return estate_is_at_risk(
            auto_renew=self.auto_renew,
            effective_status=self.effective_status,
            days_until_expiry=self.days_until_expiry,
        )

    @property
    def monthly_cost_unrounded(self):
        return self.cost if self.billing_cycle == "MONTHLY" else self.cost / Decimal("12")

    @property
    def annual_cost_unrounded(self):
        return self.cost * Decimal("12") if self.billing_cycle == "MONTHLY" else self.cost

    @property
    def monthly_cost(self):
        return self.monthly_cost_unrounded.quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

    @property
    def annual_cost(self):
        return self.annual_cost_unrounded.quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

    # --- Computed seat properties ---
    @property
    def seats_used(self):
        # Views annotate `_seats_used` so list pages don't fire one COUNT per
        # row; fall back to a live count when the annotation is absent.
        annotated = getattr(self, "_seats_used", None)
        if annotated is not None:
            return annotated
        return self.assignments.filter(is_active=True).count()

    @property
    def seats_available(self):
        if self.seats_total is None:
            return None  # Unlimited
        return max(self.seats_total - self.seats_used, 0)

    @property
    def seats_usage_pct(self):
        """Percentage of seats used (0-100). Returns 0 if unlimited."""
        if self.seats_total is None or self.seats_total == 0:
            return 0
        return round((self.seats_used / self.seats_total) * 100, 1)


class SubscriptionAssignment(models.Model):
    """A named user occupying a seat on a subscription."""

    subscription = models.ForeignKey(
        Subscription, on_delete=models.CASCADE, related_name="assignments"
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="subscription_assignments"
    )
    assigned_date = models.DateTimeField(auto_now_add=True)
    revoked_date = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    assigned_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        related_name="subscription_assignments_made",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-assigned_date"]
        constraints = [
            models.UniqueConstraint(
                fields=["subscription", "user"],
                condition=models.Q(is_active=True),
                name="unique_active_subscription_assignment",
            ),
        ]

    def __str__(self):
        state = "Active" if self.is_active else "Revoked"
        return f"{self.user.full_name} → {self.subscription.name} ({state})"


class SubscriptionRenewal(models.Model):
    """One renewal event against a Subscription.

    Captures the transition from a previous expiry to a new one, plus any
    cost paid and seats added, so the history of how an expiry moved stays
    auditable.
    """

    subscription = models.ForeignKey(
        Subscription, on_delete=models.CASCADE, related_name="renewals"
    )
    previous_expiry = models.DateField(null=True, blank=True)
    new_expiry = models.DateField()
    cost = models.DecimalField(max_digits=14, decimal_places=2, default=MONEY_ZERO)
    seats_added = models.IntegerField(default=0)
    notes = models.TextField(blank=True, default="")
    renewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscription_renewals_done",
    )
    renewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-renewed_at"]

    def __str__(self):
        return f"Renew {self.subscription.name} → {self.new_expiry}"


class SubscriptionSettings(models.Model):
    """Company-wide defaults and budget alert thresholds for subscriptions."""

    notifications_enabled = models.BooleanField(default=True)
    notify_owners = models.BooleanField(default=True)
    default_renewal_reminder_days = models.PositiveSmallIntegerField(
        default=30, validators=[MinValueValidator(0)]
    )
    default_cancellation_reminder_days = models.PositiveSmallIntegerField(
        default=7, validators=[MinValueValidator(0)]
    )
    budget_currency = models.CharField(
        max_length=3,
        default="USD",
        validators=[
            RegexValidator(
                regex=r"^[A-Z]{3}$",
                message="Budget currency must be a three-letter ISO code.",
            )
        ],
    )
    monthly_budget_threshold = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    yearly_budget_threshold = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="updated_subscription_settings",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "subscription settings"
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(monthly_budget_threshold__isnull=True)
                    | models.Q(monthly_budget_threshold__gt=0)
                ),
                name="subscription_monthly_budget_positive",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(yearly_budget_threshold__isnull=True)
                    | models.Q(yearly_budget_threshold__gt=0)
                ),
                name="subscription_yearly_budget_positive",
            ),
        ]

    def __str__(self):
        return "Subscription settings"

    @classmethod
    def get_solo(cls):
        try:
            return cls.objects.get(pk=1)
        except cls.DoesNotExist:
            from .system import AppSettings

            configured = (
                AppSettings.objects.filter(key="default_currency")
                .values_list("value", flat=True)
                .first()
            )
            currency = (configured or "USD").strip().upper()
            if not is_current_iso_4217_code(currency):
                currency = "USD"
            # ``get_or_create`` retries the unique-primary-key lookup if two
            # first dashboard/settings requests race to initialize the row.
            settings, _ = cls.objects.get_or_create(
                pk=1,
                defaults={"budget_currency": currency},
            )
            return settings


class SubscriptionCategoryBudget(models.Model):
    """A monthly / yearly spend limit for one subscription category.

    Thresholds are held in the company budget currency (SubscriptionSettings
    .budget_currency); the dashboard converts each category's spend into that
    currency before comparing.
    """

    category = models.CharField(
        max_length=24, choices=Subscription.CATEGORY_CHOICES, unique=True, db_index=True
    )
    monthly_threshold = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    yearly_threshold = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category"]

    def __str__(self):
        return f"{self.category} budget"


class SubscriptionAlertLog(models.Model):
    ALERT_TYPE_CHOICES = (
        ("RENEWAL", "Renewal reminder"),
        ("EXPIRY", "Expiry reminder"),
        ("CANCELLATION", "Cancellation reminder"),
        ("MONTHLY_BUDGET", "Monthly budget threshold"),
        ("YEARLY_BUDGET", "Yearly budget threshold"),
    )

    subscription = models.ForeignKey(
        Subscription,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="alert_logs",
    )
    alert_type = models.CharField(max_length=24, choices=ALERT_TYPE_CHOICES)
    recipient = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="subscription_alert_logs",
    )
    dedupe_key = models.CharField(max_length=255, unique=True)
    message = models.TextField()
    scheduled_for = models.DateField(null=True, blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-sent_at"]
        indexes = [
            models.Index(fields=["alert_type", "sent_at"], name="sub_alert_type_idx")
        ]

    def __str__(self):
        return f"{self.alert_type}: {self.dedupe_key}"
