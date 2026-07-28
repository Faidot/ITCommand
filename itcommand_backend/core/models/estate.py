"""Digital Estate models: providers, the accounts we hold with them, and the
properties (domains, apps, sites) those accounts keep running.

The three sit in a line:

    Provider  →  ProviderAccount  →  Subscription  →  DigitalProperty
    (catalog)    (a login)           (a paid service)  (what it serves)

A Subscription with no DigitalProperty is an *orphan*: money leaving the
company for something nobody has tied to a thing we own.
"""

from django.core.validators import RegexValidator
from django.db import models

from core.estate import AUTH_METHODS, MFA_METHODS, PROPERTY_KINDS, mfa_severity

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
    login_email = models.CharField(max_length=255)
    auth_method = models.CharField(max_length=16, choices=AUTH_METHODS, default="PASSWORD")
    mfa_method = models.CharField(
        max_length=16,
        choices=MFA_METHODS,
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
        ordering = ["provider__name", "login_email"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "login_email"],
                name="unique_login_per_provider",
            ),
        ]
        indexes = [
            models.Index(fields=["provider", "is_active"], name="estate_acct_prov_idx"),
        ]

    def __str__(self):
        return f"{self.login_email} @ {self.provider.name}"

    @property
    def effective_console_url(self):
        """This account's console, falling back to the provider's."""
        return self.console_url or self.provider.console_url

    @property
    def mfa_severity(self):
        """How alarming this account's second factor is: the API decides, not the UI."""
        return mfa_severity(self.mfa_method)

    @property
    def has_mfa(self):
        return self.mfa_method in {"APP", "KEY", "SMS"}


class DigitalProperty(models.Model):
    """Something the company owns and expects to keep working: a domain, an app,
    a marketing site.

    Services attach to a property one per layer. A property missing a layer has a
    *stack gap*; a service attached to no property is an *orphan*. Those two
    numbers are the point of the whole module — they are the questions nobody can
    answer from a spreadsheet.
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
        related_name="owned_digital_properties",
    )
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="digital_properties",
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
        verbose_name_plural = "digital properties"
        indexes = [
            models.Index(fields=["is_active", "kind"], name="estate_prop_active_idx"),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.name = (self.name or "").strip().lower()
        return super().save(*args, **kwargs)
