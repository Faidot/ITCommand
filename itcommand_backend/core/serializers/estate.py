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
    DigitalProperty,
    Provider,
    ProviderAccount,
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
    auth_method_label = serializers.CharField(
        source="get_auth_method_display", read_only=True
    )
    mfa_method_label = serializers.CharField(
        source="get_mfa_method_display", read_only=True
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
            "auth_method",
            "auth_method_label",
            "mfa_method",
            "mfa_method_label",
            "mfa_severity",
            "has_mfa",
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


class DigitalPropertySerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)
    owner_name = serializers.CharField(
        source="owner.full_name", read_only=True, default=None
    )
    department_name = serializers.CharField(
        source="department.name", read_only=True, default=None
    )
    service_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = DigitalProperty
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
        clash = DigitalProperty.objects.filter(name=name)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f"'{name}' is already tracked.")
        return name


class EstateLayerSerializer(serializers.Serializer):
    """The layer catalog, served so the frontend never hardcodes stack order."""

    layer = serializers.CharField()
    layer_label = serializers.CharField()
    is_required = serializers.BooleanField()

    @staticmethod
    def catalog():
        return [
            {
                "layer": code,
                "layer_label": label,
                "is_required": code in estate.REQUIRED_LAYERS,
            }
            for code, label in estate.SERVICE_LAYERS
        ]
