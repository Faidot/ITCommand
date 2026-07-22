from rest_framework import serializers

from core.currencies import ISO_4217_CODES
from core.models import (
    Subscription,
    SubscriptionAssignment,
    SubscriptionRenewal,
    SubscriptionSettings,
)


def _validate_currency(value, *, instance_value=None, label="Currency"):
    normalized = value.strip().upper()
    if normalized in ISO_4217_CODES:
        return normalized

    # Existing rows may predate strict ISO validation.  Let clients submit an
    # unchanged legacy value on a full update, but never accept it for a new
    # record or as a currency change.
    existing = str(instance_value or "").strip().upper()
    if existing and normalized == existing:
        return normalized
    raise serializers.ValidationError(
        f"{label} must be a current ISO 4217 code (for example, USD)."
    )


class SubscriptionAssignmentSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    user_email = serializers.CharField(source="user.email", read_only=True)
    user_avatar = serializers.ImageField(source="user.avatar", read_only=True)
    user_department = serializers.CharField(
        source="user.department.name", read_only=True, default=None
    )
    assigned_by_name = serializers.CharField(
        source="assigned_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = SubscriptionAssignment
        fields = [
            "id",
            "subscription",
            "user",
            "user_name",
            "user_email",
            "user_avatar",
            "user_department",
            "assigned_date",
            "revoked_date",
            "is_active",
            "notes",
            "assigned_by",
            "assigned_by_name",
            "created_at",
        ]
        read_only_fields = ["assigned_by"]


class SubscriptionRenewalSerializer(serializers.ModelSerializer):
    renewed_by_name = serializers.CharField(
        source="renewed_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = SubscriptionRenewal
        fields = [
            "id",
            "subscription",
            "previous_expiry",
            "new_expiry",
            "cost",
            "seats_added",
            "notes",
            "renewed_by",
            "renewed_by_name",
            "renewed_at",
        ]
        read_only_fields = ["renewed_by", "renewed_at"]


class SubscriptionSerializer(serializers.ModelSerializer):
    # Override the model field so normalization happens before the model's
    # uppercase-only validator is applied.
    currency = serializers.CharField(max_length=3)
    department_name = serializers.CharField(
        source="department.name", read_only=True, default=None
    )
    owner_name = serializers.CharField(source="owner.full_name", read_only=True, default=None)
    owner_email = serializers.EmailField(source="owner.email", read_only=True, default=None)
    admin_name = serializers.CharField(source="admin.full_name", read_only=True, default=None)
    admin_email = serializers.EmailField(source="admin.email", read_only=True, default=None)
    created_by_name = serializers.CharField(
        source="created_by.full_name", read_only=True, default=None
    )
    vendor_name = serializers.CharField(source="vendor.name", read_only=True, default=None)
    vendor_contract_title = serializers.CharField(
        source="vendor_contract.title", read_only=True, default=None
    )
    vendor_contract_number = serializers.CharField(
        source="vendor_contract.contract_number", read_only=True, default=None
    )
    budget_category_name = serializers.CharField(
        source="budget_category.name", read_only=True, default=None
    )
    vault_credential_title = serializers.CharField(
        source="vault_credential.title", read_only=True, default=None
    )
    linked_license_name = serializers.CharField(
        source="linked_license.product.name", read_only=True, default=None
    )
    payment_card_display = serializers.SerializerMethodField()
    effective_status = serializers.CharField(read_only=True)
    days_until_expiry = serializers.IntegerField(read_only=True)
    seats_used = serializers.IntegerField(read_only=True)
    seats_available = serializers.IntegerField(read_only=True, allow_null=True)
    seats_usage_pct = serializers.FloatField(read_only=True)
    monthly_cost = serializers.DecimalField(
        max_digits=16, decimal_places=2, read_only=True
    )
    annual_cost = serializers.DecimalField(
        max_digits=16, decimal_places=2, read_only=True
    )

    class Meta:
        model = Subscription
        fields = [
            "id",
            "name",
            "platform",
            "plan_type",
            "category",
            "cost",
            "currency",
            "billing_cycle",
            "start_date",
            "expiry_date",
            "purpose",
            "team",
            "department",
            "department_name",
            "owner",
            "owner_name",
            "owner_email",
            "admin",
            "admin_name",
            "admin_email",
            "vendor",
            "vendor_name",
            "vendor_contract",
            "vendor_contract_title",
            "vendor_contract_number",
            "budget_category",
            "budget_category_name",
            "vault_credential",
            "vault_credential_title",
            "linked_license",
            "linked_license_name",
            "payment_card",
            "payment_card_display",
            "billing_descriptor",
            "url",
            "status",
            "effective_status",
            "auto_renew",
            "renewal_reminder_enabled",
            "renewal_reminder_days",
            "cancellation_deadline",
            "cancellation_reminder_enabled",
            "cancellation_reminder_days",
            "seats_total",
            "seats_used",
            "seats_available",
            "seats_usage_pct",
            "notes",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "days_until_expiry",
            "monthly_cost",
            "annual_cost",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "created_at",
            "updated_at",
            "effective_status",
            "days_until_expiry",
            "monthly_cost",
            "annual_cost",
            "seats_used",
            "seats_available",
            "seats_usage_pct",
        ]

    def get_payment_card_display(self, obj):
        """'•••• 4242 (Ops card)' — how people actually refer to a card."""
        card = obj.payment_card
        if not card:
            return None
        label = card.nickname or card.holder_name
        return f"{card.display}{f' ({label})' if label else ''}"

    def validate_seats_total(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Seats cannot be negative.")
        return value

    def validate_currency(self, value):
        return _validate_currency(
            value,
            instance_value=getattr(self.instance, "currency", None),
        )

    def validate(self, attrs):
        instance = self.instance
        start_date = attrs.get("start_date", getattr(instance, "start_date", None))
        expiry_date = attrs.get("expiry_date", getattr(instance, "expiry_date", None))
        cancellation_deadline = attrs.get(
            "cancellation_deadline", getattr(instance, "cancellation_deadline", None)
        )
        vendor = attrs.get("vendor", getattr(instance, "vendor", None))
        vendor_contract = attrs.get(
            "vendor_contract", getattr(instance, "vendor_contract", None)
        )

        errors = {}
        if start_date and expiry_date and expiry_date < start_date:
            errors["expiry_date"] = "Expiry date cannot be before the start date."
        if cancellation_deadline:
            if start_date and cancellation_deadline < start_date:
                errors["cancellation_deadline"] = (
                    "Cancellation deadline cannot be before the start date."
                )
            elif expiry_date and cancellation_deadline > expiry_date:
                errors["cancellation_deadline"] = (
                    "Cancellation deadline cannot be after the expiry date."
                )
        if vendor_contract and vendor and vendor_contract.vendor_id != vendor.pk:
            errors["vendor_contract"] = (
                "Contract does not belong to the selected vendor."
            )
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def create(self, validated_data):
        settings = SubscriptionSettings.get_solo()
        validated_data.setdefault(
            "renewal_reminder_days", settings.default_renewal_reminder_days
        )
        validated_data.setdefault(
            "cancellation_reminder_days",
            settings.default_cancellation_reminder_days,
        )
        return super().create(validated_data)


class SubscriptionDetailSerializer(SubscriptionSerializer):
    """Retrieve payload: a strict superset of the list payload.

    Subclassing keeps that guarantee structural — the list page and its
    dashboard both depend on the full field set, so detail must never drop
    a field the list has.
    """

    assignments = serializers.SerializerMethodField()
    renewals = serializers.SerializerMethodField()
    expenses = serializers.SerializerMethodField()
    payments = serializers.SerializerMethodField()

    class Meta(SubscriptionSerializer.Meta):
        fields = SubscriptionSerializer.Meta.fields + [
            "assignments",
            "renewals",
            "expenses",
            "payments",
        ]

    # These read `.all()` with no further filtering or ordering so the view's
    # Prefetch cache is used; re-ordering here would silently re-query.
    def get_assignments(self, obj):
        return SubscriptionAssignmentSerializer(obj.assignments.all(), many=True).data

    def get_renewals(self, obj):
        return SubscriptionRenewalSerializer(obj.renewals.all(), many=True).data

    def get_payments(self, obj):
        return [
            {
                "id": payment.pk,
                "merchant": payment.merchant,
                "amount": str(payment.amount),
                "currency": payment.currency,
                "posted_at": payment.posted_at,
                "card": payment.card.display if payment.card else None,
                "card_label": (payment.card.nickname or payment.card.holder_name) if payment.card else "",
                "match_source": payment.match_source,
            }
            for payment in list(obj.payments.all())[:24]
        ]

    def get_expenses(self, obj):
        return [
            {
                "id": expense.pk,
                "title": expense.title,
                "amount": str(expense.amount),
                "expense_date": expense.expense_date,
                "status": expense.status,
            }
            for expense in obj.expenses.all()
        ]


class SubscriptionSettingsSerializer(serializers.ModelSerializer):
    budget_currency = serializers.CharField(max_length=3)
    updated_by_name = serializers.CharField(
        source="updated_by.full_name", read_only=True, default=None
    )

    class Meta:
        model = SubscriptionSettings
        fields = [
            "id",
            "notifications_enabled",
            "notify_owners",
            "default_renewal_reminder_days",
            "default_cancellation_reminder_days",
            "budget_currency",
            "monthly_budget_threshold",
            "yearly_budget_threshold",
            "updated_by",
            "updated_by_name",
            "updated_at",
        ]
        read_only_fields = ["id", "updated_by", "updated_by_name", "updated_at"]

    def validate_budget_currency(self, value):
        return _validate_currency(
            value,
            instance_value=getattr(self.instance, "budget_currency", None),
            label="Budget currency",
        )
