"""Serializers for the Digital Estate.

One rule dominates this module: **a vault secret never appears here.** A
ProviderAccount may point at a VaultCredential, but the link exposes an id and a
title, nothing else. Revealing stays behind the vault's own unlock gate.

That is not quite enough on its own. A credential's *title* is not a secret, but
it does disclose that a credential exists and roughly what it is for — and the
vault deliberately hides PRIVATE credentials from everyone but their creator
(`VaultCredentialViewSet.get_queryset`). Estate readers only need
`subscriptions.view`, which is a wider audience. So the title is masked unless
the reader would have been allowed to see the credential in the vault, and a
credential the reader cannot see cannot be attached either.
"""

from django.db.models import Q
from django.utils.text import slugify
from rest_framework import serializers

from core import estate
from core.models import (
    AccountUser,
    Property,
    EstateSettings,
    ExchangeRate,
    Provider,
    ProviderAccount,
    Server,
    Service,
    VaultCredential,
)


RESTRICTED_LABEL = "Restricted"


def visible_credentials(user):
    """Credentials `user` may see, mirroring the vault's own list scoping."""
    if not user or not user.is_authenticated:
        return VaultCredential.objects.none()
    return VaultCredential.objects.filter(Q(visibility="ORG") | Q(created_by=user))


class ProviderSerializer(serializers.ModelSerializer):
    slug = serializers.SlugField(max_length=60, required=False, allow_blank=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True, default=None)
    account_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Provider
        fields = [
            "id",
            "name",
            "slug",
            "brand_color",
            "console_url",
            "logo_initial",
            "vendor",
            "vendor_name",
            "is_active",
            "notes",
            "account_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate_name(self, value):
        return (value or "").strip()

    def validate(self, attrs):
        # Slug is derived, not demanded. An admin adding "Fly.io" should not have
        # to know what a slug is, but the code that keys off it still needs one.
        slug = (attrs.get("slug") or "").strip()
        if not slug:
            source = attrs.get("name") or getattr(self.instance, "name", "")
            slug = slugify(source)[:60]
        if not slug:
            raise serializers.ValidationError(
                {"slug": "Could not derive a slug from the name; set one explicitly."}
            )
        clash = Provider.objects.filter(slug=slug)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {"slug": f"Another provider already uses the slug '{slug}'."}
            )
        attrs["slug"] = slug
        return attrs


class ProviderAccountSerializer(serializers.ModelSerializer):
    provider_name = serializers.CharField(source="provider.name", read_only=True)
    provider_slug = serializers.CharField(source="provider.slug", read_only=True)
    brand_color = serializers.CharField(source="provider.brand_color", read_only=True)
    owner_name = serializers.CharField(
        source="owner.full_name", read_only=True, default=None
    )
    owner_email = serializers.EmailField(
        source="owner.email", read_only=True, default=None
    )
    # ── transitional field mapping ──────────────────────────────────────────
    # The model fields are `account_email` / `auth_type` / `mfa_type` as of
    # Phase 1, but the JSON keys stay `login_email` / `auth_method` /
    # `mfa_method` until Phase 3 rewrites the frontend. Flipping the model and
    # the API in the same commit would break the live Accounts tab for the
    # phases in between, for no gain — both sides move together in Phase 3.
    login_email = serializers.CharField(source="account_email", max_length=255)
    login_kind_label = serializers.CharField(source="get_login_kind_display", read_only=True)
    #: Counts rather than the people themselves. An account list is read far
    #: more often than any one account is opened, and nesting twenty logins per
    #: row would multiply the payload for something the table cannot show.
    #: `/estate/account-users/?account=<id>` returns the list itself.
    people_count = serializers.SerializerMethodField()
    people_without_mfa = serializers.IntegerField(read_only=True)
    privileged_count = serializers.SerializerMethodField()
    auth_method = serializers.ChoiceField(
        source="auth_type", choices=estate.AUTH_TYPES, required=False
    )
    mfa_method = serializers.ChoiceField(
        source="mfa_type", choices=estate.MFA_TYPES, required=False
    )
    auth_method_label = serializers.CharField(
        source="get_auth_type_display", read_only=True
    )
    mfa_method_label = serializers.CharField(
        source="get_mfa_type_display", read_only=True
    )
    mfa_severity = serializers.CharField(read_only=True)
    has_mfa = serializers.BooleanField(read_only=True)
    effective_console_url = serializers.CharField(read_only=True)
    #: Title only, and only when the reader could see it in the vault. Never a secret.
    vault_credential_title = serializers.SerializerMethodField()
    account_workspace_name = serializers.CharField(
        source="account_workspace.name", read_only=True, default=None
    )
    service_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = ProviderAccount
        fields = [
            "id",
            "provider",
            "provider_name",
            "provider_slug",
            "brand_color",
            "login_email",
            "login_kind",
            "login_kind_label",
            "auth_method",
            "auth_method_label",
            "mfa_method",
            "mfa_method_label",
            "mfa_severity",
            "has_mfa",
            "people_count",
            "people_without_mfa",
            "privileged_count",
            "owner",
            "owner_name",
            "owner_email",
            "vault_credential",
            "vault_credential_title",
            "account_workspace",
            "account_workspace_name",
            "console_url",
            "effective_console_url",
            "notes",
            "is_active",
            "service_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_people_count(self, obj):
        # `len` on the prefetched list, not `.count()`, which would fire a
        # query per row and undo the prefetch the viewset sets up.
        return sum(1 for person in obj.people.all() if person.is_active)

    def get_privileged_count(self, obj):
        return sum(
            1 for person in obj.people.all()
            if person.is_active and person.is_privileged
        )

    def get_vault_credential_title(self, obj):
        if not obj.vault_credential_id:
            return None
        request = self.context.get("request")
        user = getattr(request, "user", None)
        credential = obj.vault_credential
        if credential.visibility == "ORG" or (
            user and credential.created_by_id == getattr(user, "id", None)
        ):
            return credential.title
        # The link is still visible so the account does not look unlinked; the
        # label is not, because this reader has no vault sight of it.
        return RESTRICTED_LABEL

    def validate_login_email(self, value):
        return (value or "").strip()

    def validate_vault_credential(self, value):
        """Refuse to attach a credential the requester cannot already see.

        Without this, the field is an oracle: POST ids until one stops erroring
        and you have enumerated private vault rows you were never shown.
        """
        if value is None:
            return value
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not visible_credentials(user).filter(pk=value.pk).exists():
            raise serializers.ValidationError("That vault credential is not available to you.")
        return value

    # No duplicate-login check here on purpose. DRF derives a
    # UniqueTogetherValidator from the model's `unique_login_per_provider`
    # constraint and runs it before `validate()`, so a hand-written check would
    # be unreachable code that looks load-bearing. The trade-off is that the
    # error arrives under `non_field_errors` rather than on `login_email`; that
    # is worth accepting to keep one definition of the rule, anchored to the
    # database constraint where it cannot drift.


class PropertySerializer(serializers.ModelSerializer):
    # Override the model's ChoiceField: kinds are admin-managed under Settings →
    # Lists of values, so the model's frozen `choices` must not be the gate.
    # `validate_kind` below checks against the LOV instead. Same reason
    # UserSerializer overrides `role`.
    kind = serializers.CharField(required=False)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    owner_name = serializers.CharField(
        source="owner.full_name", read_only=True, default=None
    )
    department_name = serializers.CharField(
        source="department.name", read_only=True, default=None
    )
    service_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Property
        fields = [
            "id",
            "name",
            "kind",
            "kind_label",
            "owner",
            "owner_name",
            "department",
            "department_name",
            "notes",
            "is_active",
            "service_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate_name(self, value):
        # Matches the model's own normalisation, so the uniqueness error arrives
        # as a clean 400 from the serializer rather than an IntegrityError.
        name = (value or "").strip().lower()
        if not name:
            raise serializers.ValidationError("A property needs a name.")
        clash = Property.objects.filter(name=name)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f"'{name}' is already tracked.")
        return name

    def validate_kind(self, value):
        """Accept any kind an admin has added under Settings → Lists of values.

        The model keeps its `choices` for the Django admin, but validating
        against them here would reject a kind the org just created — which is
        the whole point of moving this list behind the LOV registry.
        """
        from core.lov import is_valid

        code = (value or "").strip().upper()
        if not code:
            return "OTHER"
        if not is_valid("estate_property_kind", code):
            raise serializers.ValidationError(
                f"'{code}' is not an available property kind. Add it under "
                f"Settings → Lists of values first."
            )
        return code


class ServiceSerializer(serializers.ModelSerializer):
    """One billable thing.

    `vault_credential` is the field to be careful with. It serialises to an id
    and a name and nothing else — never `encrypted_password`, never a decrypted
    value. Revealing stays on the vault's own endpoints behind the unlock gate,
    which is also where the reveal gets audited. Adding a shortcut here would
    put a secret behind `estate.view`, a far wider grant than `vault`.

    The same title-masking rule as `ProviderAccountSerializer` applies: a reader
    who could not see the credential in the vault sees "Restricted", and cannot
    attach one they cannot see.
    """

    service_type_label = serializers.CharField(
        source="get_service_type_display", read_only=True
    )
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    billing_cycle_label = serializers.CharField(
        source="get_billing_cycle_display", read_only=True
    )
    provider_name = serializers.CharField(source="provider.name", read_only=True)
    provider_slug = serializers.CharField(source="provider.slug", read_only=True)
    brand_color = serializers.CharField(source="provider.brand_color", read_only=True)
    account_email = serializers.CharField(
        source="provider_account.account_email", read_only=True
    )
    property_name = serializers.CharField(
        source="property.name", read_only=True, default=None
    )
    #: Id and title only. See the class docstring.
    vault_credential_title = serializers.SerializerMethodField()

    # Derived on the model so the UI never recomputes what "at risk" means.
    is_orphan = serializers.BooleanField(read_only=True)
    is_at_risk = serializers.BooleanField(read_only=True)
    occupies_stack_slot = serializers.BooleanField(read_only=True)
    days_until_renewal = serializers.IntegerField(read_only=True)
    monthly_equivalent = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True, coerce_to_string=True
    )
    yearly_equivalent = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True, coerce_to_string=True
    )

    class Meta:
        model = Service
        fields = [
            "id",
            "service_type",
            "service_type_label",
            "identifier",
            "provider",
            "provider_name",
            "provider_slug",
            "brand_color",
            "provider_account",
            "account_email",
            "property",
            "property_name",
            "status",
            "status_label",
            "renewal_date",
            "days_until_renewal",
            "auto_renew",
            "cost",
            "currency",
            "billing_cycle",
            "billing_cycle_label",
            "monthly_equivalent",
            "yearly_equivalent",
            "console_url",
            "vault_credential",
            "vault_credential_title",
            "notes",
            "is_orphan",
            "is_at_risk",
            "occupies_stack_slot",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_people_count(self, obj):
        # `len` on the prefetched list, not `.count()`, which would fire a
        # query per row and undo the prefetch the viewset sets up.
        return sum(1 for person in obj.people.all() if person.is_active)

    def get_privileged_count(self, obj):
        return sum(
            1 for person in obj.people.all()
            if person.is_active and person.is_privileged
        )

    def get_vault_credential_title(self, obj):
        if not obj.vault_credential_id:
            return None
        request = self.context.get("request")
        user = getattr(request, "user", None)
        credential = obj.vault_credential
        if credential.visibility == "ORG" or (
            user and credential.created_by_id == getattr(user, "id", None)
        ):
            return credential.title
        return RESTRICTED_LABEL

    def validate_vault_credential(self, value):
        """Refuse to attach a credential the requester cannot already see.

        Same oracle argument as on the account serializer: without this, POSTing
        ids until one stops erroring enumerates private vault rows.
        """
        if value is None:
            return value
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not visible_credentials(user).filter(pk=value.pk).exists():
            raise serializers.ValidationError("That vault credential is not available to you.")
        return value

    def validate_identifier(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("A service needs an identifier.")
        return value

    def validate_currency(self, value):
        return (value or "PKR").strip().upper()

    def validate(self, attrs):
        """The account must belong to the provider it is filed under.

        Nothing in the schema prevents pairing an AWS account with a Cloudflare
        provider, and the result would be a row whose provider chip and login
        contradict each other — reported under one provider and reachable only
        through another.
        """
        provider = attrs.get("provider") or getattr(self.instance, "provider", None)
        account = attrs.get("provider_account") or getattr(
            self.instance, "provider_account", None
        )
        if provider and account and account.provider_id != provider.pk:
            raise serializers.ValidationError(
                {
                    "provider_account": (
                        f"That account belongs to {account.provider.name}, not "
                        f"{provider.name}."
                    )
                }
            )
        return attrs


class EstateLayerSerializer(serializers.Serializer):
    """The layer catalog, served so the frontend never hardcodes stack order."""

    layer = serializers.CharField()
    layer_label = serializers.CharField()
    is_required = serializers.BooleanField()


class EstateSettingsSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.CharField(
        source="updated_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = EstateSettings
        fields = [
            "enabled_layers",
            "renewal_warning_days",
            "renewal_urgent_days",
            "timeline_window_days",
            "alert_on_auto_renew_off",
            "alert_on_new_orphan",
            "updated_by",
            "updated_by_name",
            "updated_at",
        ]
        read_only_fields = ["updated_by", "updated_at"]

    def validate_enabled_layers(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Expected a list of layer codes.")
        cleaned, seen = [], set()
        for raw in value:
            code = str(raw or "").strip().upper()
            if not code:
                continue
            if code not in estate.SERVICE_LAYER_CODES:
                raise serializers.ValidationError(f"'{code}' is not a known layer.")
            if code not in seen:
                seen.add(code)
                cleaned.append(code)
        return cleaned

    def validate(self, attrs):
        urgent = attrs.get(
            "renewal_urgent_days", getattr(self.instance, "renewal_urgent_days", None)
        )
        warning = attrs.get(
            "renewal_warning_days", getattr(self.instance, "renewal_warning_days", None)
        )
        if urgent and warning and urgent > warning:
            raise serializers.ValidationError(
                {
                    "renewal_urgent_days": (
                        "The red window cannot be wider than the amber one — nothing "
                        "would ever render amber."
                    )
                }
            )
        return attrs


class ExchangeRateSerializer(serializers.ModelSerializer):
    """A manually-entered rate. `rate` is how many `base_currency` one
    `currency` buys, matching the model's own definition."""

    # Optional at field level so `validate()` can default it to today. Left
    # required, DRF rejects the payload before the default is ever applied.
    as_of = serializers.DateField(required=False)

    class Meta:
        model = ExchangeRate
        fields = ["id", "base_currency", "currency", "rate", "as_of", "source", "created_at"]
        read_only_fields = ["source", "created_at"]
        # The model's unique constraint would otherwise reject the upsert that
        # `perform_create` performs deliberately.
        validators = []

    def validate_base_currency(self, value):
        return (value or "").strip().upper()

    def validate_currency(self, value):
        return (value or "").strip().upper()

    def validate_rate(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError("A rate must be greater than zero.")
        return value

    def validate(self, attrs):
        base = attrs.get("base_currency") or getattr(self.instance, "base_currency", "")
        currency = attrs.get("currency") or getattr(self.instance, "currency", "")
        if base and currency and base == currency:
            raise serializers.ValidationError(
                {"currency": "A currency always converts to itself at 1 — no rate needed."}
            )
        if not attrs.get("as_of") and not getattr(self.instance, "as_of", None):
            from django.utils import timezone

            attrs["as_of"] = timezone.localdate()
        return attrs


class AccountUserSerializer(serializers.ModelSerializer):
    """One person's login inside a provider account.

    Carries the account and provider names so the "what does this person have?"
    view can render a row without a second request per login.
    """

    name = serializers.CharField(read_only=True)
    user_name = serializers.CharField(source="user.full_name", read_only=True, default=None)
    user_email = serializers.EmailField(source="user.email", read_only=True, default=None)
    account_login = serializers.CharField(
        source="provider_account.account_email", read_only=True
    )
    provider = serializers.IntegerField(
        source="provider_account.provider_id", read_only=True
    )
    provider_name = serializers.CharField(
        source="provider_account.provider.name", read_only=True
    )
    brand_color = serializers.CharField(
        source="provider_account.provider.brand_color", read_only=True
    )
    role_label = serializers.CharField(source="get_role_display", read_only=True)
    login_kind_label = serializers.CharField(source="get_login_kind_display", read_only=True)
    mfa_label = serializers.CharField(source="get_mfa_type_display", read_only=True)
    mfa_severity = serializers.CharField(read_only=True)
    is_privileged = serializers.BooleanField(read_only=True)

    class Meta:
        model = AccountUser
        fields = [
            "id",
            "provider_account",
            "account_login",
            "provider",
            "provider_name",
            "brand_color",
            "login",
            "login_kind",
            "login_kind_label",
            "user",
            "user_name",
            "user_email",
            "display_name",
            "name",
            "role",
            "role_label",
            "mfa_type",
            "mfa_label",
            "mfa_severity",
            "is_privileged",
            "last_reviewed",
            "notes",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, attrs):
        # A row that names nobody is a row nobody can act on. One of the three
        # has to say who this is, and `login` alone is enough for a service
        # account — this only rejects the genuinely empty case.
        instance = self.instance
        login = attrs.get("login", getattr(instance, "login", "")) or ""
        if not login.strip():
            raise serializers.ValidationError(
                {"login": "Enter the username or email this person signs in with."}
            )
        return attrs


class ServerSerializer(serializers.ModelSerializer):
    provider_account_login = serializers.CharField(
        source="provider_account.account_email", read_only=True
    )
    provider = serializers.IntegerField(
        source="provider_account.provider_id", read_only=True
    )
    provider_name = serializers.CharField(
        source="provider_account.provider.name", read_only=True
    )
    brand_color = serializers.CharField(
        source="provider_account.provider.brand_color", read_only=True
    )
    property_name = serializers.CharField(source="property.name", read_only=True, default=None)
    service_identifier = serializers.CharField(
        source="service.identifier", read_only=True, default=None
    )
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)
    role_label = serializers.CharField(source="get_server_role_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    environment_label = serializers.CharField(
        source="get_environment_display", read_only=True
    )
    is_live = serializers.BooleanField(read_only=True)
    effective_console_url = serializers.CharField(read_only=True)

    class Meta:
        model = Server
        fields = [
            "id",
            "provider_account",
            "provider_account_login",
            "provider",
            "provider_name",
            "brand_color",
            "service",
            "service_identifier",
            "property",
            "property_name",
            "name",
            "server_role",
            "role_label",
            "environment",
            "environment_label",
            "status",
            "status_label",
            "is_live",
            "public_ip",
            "private_ip",
            "hostname",
            "region",
            "size",
            "operating_system",
            "provisioned_on",
            "expires_on",
            "owner",
            "owner_name",
            "console_url",
            "effective_console_url",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, attrs):
        # The service has to be billed through the same account, or the server
        # ends up attributed to one provider and paid for by another — which
        # makes both the cost report and the "what does this account hold"
        # answer wrong, silently.
        account = attrs.get(
            "provider_account", getattr(self.instance, "provider_account", None)
        )
        service = attrs.get("service", getattr(self.instance, "service", None))
        if service and account and service.provider_account_id != account.id:
            raise serializers.ValidationError({
                "service": (
                    f"'{service.identifier}' is billed through a different account. "
                    "Pick a service on this account, or leave it blank."
                )
            })
        return attrs
