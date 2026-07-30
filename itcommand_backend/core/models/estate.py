"""Digital Estate models: providers, the accounts we hold with them, and the
properties (domains, apps, sites) those accounts keep running.

The four sit in a line:

    Provider  →  ProviderAccount  →  Service  →  Property
    (catalog)    (a login)           (a paid thing)  (what it serves)

A Service with no Property is an *orphan*: money leaving the company for
something nobody has tied to a thing we own.
"""

import builtins
from decimal import Decimal, ROUND_HALF_UP

from django.core.validators import MinValueValidator, RegexValidator
from django.db import models

from core.estate import (
    AT_RISK_WINDOW_DAYS,
    AUTH_TYPES,
    BILLING_CYCLES,
    MFA_TYPES,
    PROPERTY_KINDS,
    SERVICE_STATUSES,
    SERVICE_TYPE_CODES,
    SERVICE_TYPES,
    STACK_TYPE_CODES,
    TIMELINE_WINDOW_DAYS,
    URGENT_WINDOW_DAYS,
    UNPRICED_CYCLES,
    mfa_severity,
)

from .users import Department, User
from .vault import AccountWorkspace, VaultCredential
from .vendors import Vendor


HEX_COLOR_VALIDATOR = RegexValidator(
    regex=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$",
    message="Brand colour must be a hex value such as #ff9900.",
)


class Provider(models.Model):
    """A service provider we hold accounts with — AWS, Cloudflare, Namecheap.

    Deliberately *not* a Vendor. A Vendor is an accounts-payable entity with a
    tax number, contracts and payment history; a Provider is a technical console
    we sign in to. Cloudflare on a free plan is a Provider and never a Vendor.
    When a provider does also get invoiced, `vendor` links the two so vendor
    spend and estate spend describe the same company.
    """

    name = models.CharField(max_length=120, unique=True)
    slug = models.SlugField(max_length=60, unique=True)
    brand_color = models.CharField(
        max_length=7,
        blank=True,
        default="",
        validators=[HEX_COLOR_VALIDATOR],
        help_text="Hex colour used for this provider's chip and chart segment.",
    )
    #: Where an admin signs in. Inherited by accounts unless they override it.
    console_url = models.URLField(blank=True, default="")
    logo_initial = models.CharField(
        max_length=2,
        blank=True,
        default="",
        help_text="One or two letters shown when there is no logo. Defaults to the first letter of the name.",
    )
    vendor = models.ForeignKey(
        Vendor,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="estate_providers",
        help_text="Link when this provider is also invoiced as a vendor.",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Inactive providers stay on existing accounts but disappear from pickers.",
    )
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.brand_color = (self.brand_color or "").strip()
        self.logo_initial = (self.logo_initial or "").strip()
        if not self.logo_initial and self.name:
            self.logo_initial = self.name.strip()[:1].upper()
        return super().save(*args, **kwargs)


class ProviderAccount(models.Model):
    """One login at a provider — "the AWS root account", "the Namecheap billing
    login". Services are bought *through* an account, so this is where the
    "who can actually get into this, and is it protected" question is answered.

    Kept separate from `AccountWorkspace` on purpose. That model is reached only
    behind the vault master-password unlock (`VaultUnlockedPermission`), which is
    the wrong gate for an estate view that runs on the `subscriptions` module.
    `account_workspace` softly links the two so an existing workspace row does
    not have to be re-keyed, and so the vault view keeps working untouched.
    """

    provider = models.ForeignKey(
        Provider,
        on_delete=models.PROTECT,
        related_name="accounts",
        help_text="Deleting a provider that still has accounts is blocked.",
    )
    #: Not an EmailField: some provider logins are usernames or account numbers.
    account_email = models.CharField(max_length=255)
    auth_type = models.CharField(max_length=16, choices=AUTH_TYPES, default="PASSWORD")
    mfa_type = models.CharField(
        max_length=16,
        choices=MFA_TYPES,
        default="UNKNOWN",
        help_text="'Not recorded' is not the same as 'none' — leave it until someone checks.",
    )
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_provider_accounts",
    )
    vault_credential = models.ForeignKey(
        VaultCredential,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="provider_accounts",
        help_text="The vault entry holding this login. Only its title is ever exposed here.",
    )
    account_workspace = models.ForeignKey(
        AccountWorkspace,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="provider_accounts",
        help_text="Optional link to the pre-existing vault Account Workspace for the same login.",
    )
    #: Overrides Provider.console_url when this account signs in somewhere else
    #: (a tenant-specific console, a reseller panel).
    console_url = models.URLField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["provider__name", "account_email"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "account_email"],
                name="unique_login_per_provider",
            ),
        ]
        indexes = [
            models.Index(fields=["provider", "is_active"], name="estate_acct_prov_idx"),
            # The Accounts table opens sorted by MFA risk and the dashboard
            # counts accounts missing a second factor on every load; both scan
            # this column and nothing else.
            models.Index(fields=["mfa_type"], name="estate_acct_mfa_idx"),
        ]

    def __str__(self):
        return f"{self.account_email} @ {self.provider.name}"

    @property
    def effective_console_url(self):
        """This account's console, falling back to the provider's."""
        return self.console_url or self.provider.console_url

    @property
    def mfa_severity(self):
        """How alarming this account's second factor is: the API decides, not the UI."""
        return mfa_severity(self.mfa_type)

    @property
    def has_mfa(self):
        return self.mfa_type in {"APP", "SECURITY_KEY", "SMS"}

    def count_services(self):
        """Services bought through this account, for a single instance.

        Deliberately a method under a different name, not a `service_count`
        property. List views annotate `service_count` in `get_queryset`, and
        Django assigns annotations onto the instance with `setattr` — a
        getter-only property of the same name makes every annotated query raise.
        The annotation owns the name because it is the version that costs one
        query per page instead of one per row; this is the fallback for a bare
        instance.
        """
        return self.services.count()


class Property(models.Model):
    """Something the company owns and expects to keep working: a domain, an app,
    a marketing site.

    Services attach to a property one per stack role. A property missing a role
    has a *stack gap*; a service attached to no property is an *orphan*. Those
    two numbers are the point of the whole module — they are the questions
    nobody can answer from a spreadsheet.
    """

    name = models.CharField(
        max_length=190,
        unique=True,
        help_text="The domain or app identifier, e.g. example.com.",
    )
    kind = models.CharField(
        max_length=24, choices=PROPERTY_KINDS, default="OTHER", db_index=True
    )
    owner = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_properties",
    )
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="properties",
    )
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(
        default=True,
        help_text="Retired properties keep their history but drop out of gap reporting.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "properties"
        indexes = [
            models.Index(fields=["is_active", "kind"], name="estate_prop_active_idx"),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.name = (self.name or "").strip().lower()
        return super().save(*args, **kwargs)

    def configured_types(self):
        """Stack roles this property has at least one live service for.

        Cancelled and expired services do not count as coverage: a domain whose
        registrar lapsed last month has a registrar row and no registrar. That
        distinction is the whole value of the gap number.
        """
        return {
            code
            for code in self.services.exclude(
                status__in=("CANCELLED", "EXPIRED")
            ).values_list("service_type", flat=True)
            if code in STACK_TYPE_CODES
        }

    @property
    def stack_gaps(self):
        """Stack roles with no live service, in stack order.

        Only the seven stack roles can be a gap. A property with no SaaS is not
        missing anything — there is no slot for SaaS to be absent from.
        """
        configured = self.configured_types()
        return [code for code in STACK_TYPE_CODES if code not in configured]

    @property
    def stack_gap_count(self):
        return len(self.stack_gaps)


class Service(models.Model):
    """One billable or managed thing: a domain registration, a DNS zone, a
    hosting plan, a SaaS seat.

    `service_type` carries two jobs deliberately. It is the category a service
    is reported under *and* its position in a property's stack. Splitting those
    into two fields was the previous design's mistake: every write had to keep
    them consistent, and nothing enforced that they were. One field cannot
    disagree with itself.

    A service with no `property` is an *orphan* — money leaving the company for
    something nobody has tied to a thing we own. That is a legitimate state to
    record, not an error to reject: the point is to make it countable.
    """

    service_type = models.CharField(
        max_length=16,
        choices=SERVICE_TYPES,
        db_index=True,
        help_text="Both the category and, for the seven stack roles, the stack position.",
    )
    #: What this service *is*, in the provider's terms: "tapquest.gg",
    #: "ecs-prod · ap-south-1". Doubles as the display name — a separate `name`
    #: would be a second thing to keep truthful.
    identifier = models.CharField(max_length=255)

    provider = models.ForeignKey(
        Provider,
        on_delete=models.PROTECT,
        related_name="services",
        help_text="Deleting a provider that still has services is blocked.",
    )
    provider_account = models.ForeignKey(
        ProviderAccount,
        on_delete=models.PROTECT,
        related_name="services",
        help_text="The login this service is bought through.",
    )
    property = models.ForeignKey(
        Property,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="services",
        help_text="What this service keeps running. Null means orphaned.",
    )

    status = models.CharField(
        max_length=16, choices=SERVICE_STATUSES, default="ACTIVE", db_index=True
    )
    renewal_date = models.DateField(null=True, blank=True)
    auto_renew = models.BooleanField(
        default=True,
        help_text="Off plus a near renewal date is what makes a service at-risk.",
    )

    #: Money is Decimal from here to serialisation. `max_digits=12` holds a
    #: PKR annual figure without rounding, which a float would not.
    cost = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )
    currency = models.CharField(max_length=3, default="PKR")
    billing_cycle = models.CharField(
        max_length=16, choices=BILLING_CYCLES, default="MONTHLY"
    )

    console_url = models.URLField(blank=True, default="")
    #: What this charge looks like on a card statement. Brex reconciliation
    #: treats a recorded descriptor as authoritative — matching on the
    #: provider name alone is a guess, and a wrongly attached charge is harder
    #: to notice than an unattached one.
    billing_descriptor = models.CharField(
        max_length=160,
        blank=True,
        default="",
        help_text="How this appears on the card statement, for payment matching.",
    )
    vault_credential = models.ForeignKey(
        VaultCredential,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="estate_services",
        help_text="The vault entry for this service. Only its id and title are ever exposed.",
    )
    #: Which card this renews on. Written back by the Brex sync when a charge
    #: matches, because "which card is this on" is the question the integration
    #: exists to answer.
    payment_card = models.ForeignKey(
        "core.PaymentCard",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="estate_services",
    )

    # ── finance links ───────────────────────────────────────────────────────
    #
    # Not in the estate spec's field list, and added in Phase 5 rather than
    # Phase 1 for a specific reason: `Subscription` carried them, the Cost
    # Overview's budget-impact and vendor-spend panels are built on them, and
    # retiring `Subscription` without them would have deleted a working feature
    # by omission. Both nullable — a service does not have to be budgeted.
    budget_category = models.ForeignKey(
        "core.BudgetCategory",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="estate_services",
        help_text="Rolls this service's cost into the budget view.",
    )
    vendor = models.ForeignKey(
        "core.Vendor",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="estate_services",
        help_text="Link when the provider is also invoiced as a vendor.",
    )

    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["property__name", "service_type", "identifier"]
        indexes = [
            # The property stack diagram: every service for one property,
            # ordered by role.
            models.Index(fields=["property", "service_type"], name="estate_svc_prop_type_idx"),
            # The Accounts table's expand-to-show-services row.
            models.Index(fields=["provider_account", "status"], name="estate_svc_acct_stat_idx"),
            # The at-risk scan: auto-renew off, renewing soon.
            models.Index(fields=["auto_renew", "renewal_date"], name="estate_svc_auto_renew_idx"),
            # The 90-day timeline, which filters on status then orders by date.
            models.Index(fields=["status", "renewal_date"], name="estate_svc_stat_renew_idx"),
        ]

    def __str__(self):
        return f"{self.identifier} ({self.get_service_type_display()})"

    def save(self, *args, **kwargs):
        self.currency = (self.currency or "PKR").strip().upper()
        self.identifier = (self.identifier or "").strip()
        return super().save(*args, **kwargs)

    # ───────────────────────────── derived ─────────────────────────────
    #
    # `@builtins.property`, not `@property`, for the rest of this class: the
    # `property` field above shadows the builtin decorator inside this class
    # body. The field name is fixed by the estate model spec, so the decorator
    # is the thing that gets qualified. Spelling it out also survives someone
    # reordering the field declarations, which a bare `@property` would not.

    @builtins.property
    def is_orphan(self):
        """Attached to nothing we own.

        Reads `property_id` rather than `property` so an un-fetched relation
        does not trigger a query just to learn it is null.
        """
        return self.property_id is None

    @builtins.property
    def occupies_stack_slot(self):
        """Does this service fill a position in its property's stack?"""
        return self.service_type in STACK_TYPE_CODES

    @builtins.property
    def days_until_renewal(self):
        """Whole days until renewal; negative once past. None when undated."""
        if not self.renewal_date:
            return None
        from django.utils import timezone

        return (self.renewal_date - timezone.localdate()).days

    @builtins.property
    def is_at_risk(self):
        """Will not renew itself, and renews soon enough for that to matter.

        A service someone has already flagged AT_RISK by hand answers True
        regardless of its dates — the flag is a human saying "watch this", and
        overriding it with arithmetic would discard the more informed signal.
        """
        if self.status == "AT_RISK":
            return True
        if self.auto_renew or self.status != "ACTIVE":
            return False
        days = self.days_until_renewal
        if days is None:
            return False
        return 0 <= days <= AT_RISK_WINDOW_DAYS

    @builtins.property
    def monthly_equivalent(self):
        """Cost normalised to one month, as `Decimal`.

        YEARLY divides by twelve and quantises to two places at the boundary,
        because a third of a rupee cannot be paid and summing unrounded
        remainders across a hundred services drifts the total.

        USAGE and FREE return zero: usage spend is real but not knowable from a
        fixed figure, and putting a guess into a total labelled "monthly spend"
        is exactly the kind of confident wrong number this module exists to
        stop.
        """
        if self.billing_cycle in UNPRICED_CYCLES:
            return Decimal("0.00")
        amount = self.cost if self.cost is not None else Decimal("0")
        if not isinstance(amount, Decimal):
            amount = Decimal(str(amount))
        if self.billing_cycle == "YEARLY":
            return (amount / Decimal("12")).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
        return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    @builtins.property
    def yearly_equivalent(self):
        """Cost normalised to one year, as `Decimal`.

        Computed from `cost`, not from `monthly_equivalent` — a yearly charge of
        100 divides to a monthly 8.33, and multiplying that back yields 99.96.
        The annual figure a user recognises is the one they were invoiced, so
        the yearly cycle returns its cost untouched.
        """
        if self.billing_cycle in UNPRICED_CYCLES:
            return Decimal("0.00")
        amount = self.cost if self.cost is not None else Decimal("0")
        if not isinstance(amount, Decimal):
            amount = Decimal(str(amount))
        if self.billing_cycle == "YEARLY":
            return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return (amount * Decimal("12")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )


def default_enabled_layers():
    """Callable, not a literal — a mutable default on a JSONField is shared
    state across every row that never overrode it."""
    return list(STACK_TYPE_CODES)


class EstateSettings(models.Model):
    """Which layers this organisation tracks, and when it wants warning.

    `core.estate` says what is *possible* — all ten layers, the default windows.
    This says what this org actually uses. Keeping the two apart means adding a
    layer to the catalog does not silently start reporting gaps for it on every
    existing property.

    Singleton (pk=1), same pattern as SubscriptionSettings.
    """

    #: Ordered list of layer codes. Order is the stack order shown in the UI;
    #: membership is what counts as a gap when empty.
    enabled_layers = models.JSONField(
        default=default_enabled_layers,
        help_text="Ordered layer codes this organisation tracks. Empty means every layer.",
    )
    renewal_warning_days = models.PositiveSmallIntegerField(
        default=AT_RISK_WINDOW_DAYS,
        validators=[MinValueValidator(1)],
        help_text="A renewal inside this many days is amber, and counts as at-risk when auto-renew is off.",
    )
    renewal_urgent_days = models.PositiveSmallIntegerField(
        default=URGENT_WINDOW_DAYS,
        validators=[MinValueValidator(1)],
        help_text="A renewal inside this many days is red.",
    )
    timeline_window_days = models.PositiveSmallIntegerField(
        default=TIMELINE_WINDOW_DAYS,
        validators=[MinValueValidator(7)],
        help_text="How far ahead the renewal timeline looks.",
    )
    alert_on_auto_renew_off = models.BooleanField(
        default=True,
        help_text="Warn when a service approaching renewal will not renew itself.",
    )
    alert_on_new_orphan = models.BooleanField(
        default=True,
        help_text="Warn when a service is billed but tied to no property.",
    )
    #: Moved here from `SubscriptionSettings` in Phase 5, when that model was
    #: retired. Defaults to off: writing to a finance table is
    #: high-blast-radius, and an org that never opted in must not start
    #: creating expenses because a module was renamed.
    create_expense_on_renewal = models.BooleanField(
        default=False,
        help_text="Record an Expense against the budget category when a service renews.",
    )
    updated_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="updated_estate_settings",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "estate settings"

    def __str__(self):
        return "Digital Estate settings"

    @classmethod
    def get_solo(cls):
        """The singleton, unsaved-with-defaults when nobody has configured it.

        Deliberately does not `get_or_create`: this is read on every estate
        request, and a GET that writes a row is both a surprise and a race. The
        instance carries pk=1, so the first PUT inserts it. Same approach as
        `VaultMasterPassword.get_singleton`.
        """
        return cls.objects.filter(pk=1).first() or cls(pk=1)

    def clean(self):
        from django.core.exceptions import ValidationError

        errors = {}
        unknown = [
            code for code in (self.enabled_layers or []) if code not in SERVICE_TYPE_CODES
        ]
        if unknown:
            errors["enabled_layers"] = (
                f"Unknown layer code(s): {', '.join(sorted(unknown))}."
            )
        if self.renewal_urgent_days and self.renewal_warning_days:
            if self.renewal_urgent_days > self.renewal_warning_days:
                errors["renewal_urgent_days"] = (
                    "The red window cannot be wider than the amber one — nothing "
                    "would ever render amber."
                )
        if errors:
            raise ValidationError(errors)

    def tracked_layers(self):
        """Enabled layer codes, de-duplicated and in the configured order.

        Falls back to the whole catalog when the list is empty, so an org that
        clears every layer sees everything rather than nothing — an empty estate
        page is a worse answer than a noisy one.
        """
        seen, ordered = set(), []
        for code in self.enabled_layers or []:
            if code in SERVICE_TYPE_CODES and code not in seen:
                seen.add(code)
                ordered.append(code)
        return ordered or list(SERVICE_TYPE_CODES)
