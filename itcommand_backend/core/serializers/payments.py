"""Cards, card accounts and the charges made on them.

All read-only. These rows are written by the Brex sync, and a person editing
them by hand would only be overwriting what the next sync restores — so the
API does not offer the option.

Money follows the estate convention: `Decimal` throughout, serialised as a
fixed 2dp *string*, because a JSON float cannot represent 0.01 exactly and
totals built from floats drift.
"""
from rest_framework import serializers

from core.models import CardAccount, PaymentCard, ServicePayment


class PaymentCardSerializer(serializers.ModelSerializer):
    """A corporate card, identified to people by its last four digits.

    Never carries a PAN. `cards.pan` is not a scope this integration asks for
    and no field here could hold one.
    """

    display = serializers.CharField(read_only=True)
    holder_email = serializers.EmailField(source="holder.email", read_only=True, default="")
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    form_label = serializers.CharField(source="get_form_display", read_only=True)
    limit_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True, coerce_to_string=True
    )
    service_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = PaymentCard
        fields = [
            "id", "provider", "display", "last_four", "nickname",
            "holder", "holder_name", "holder_email",
            "status", "status_label", "form", "form_label",
            "limit_amount", "limit_currency", "limit_interval",
            "service_count", "last_synced_at",
        ]
        read_only_fields = fields


class CardAccountSerializer(serializers.ModelSerializer):
    """A card account and its balance.

    Balances are treasury data rather than service spend, which is why the
    viewset gates this on `finance` and not `estate`.
    """

    current_balance = serializers.DecimalField(
        max_digits=16, decimal_places=2, read_only=True, coerce_to_string=True
    )
    available_balance = serializers.DecimalField(
        max_digits=16, decimal_places=2, read_only=True, coerce_to_string=True
    )

    class Meta:
        model = CardAccount
        fields = [
            "id", "provider", "external_id", "name", "status", "currency",
            "current_balance", "available_balance", "last_synced_at",
        ]
        read_only_fields = fields


class ServicePaymentSerializer(serializers.ModelSerializer):
    """One charge, whether or not it matched a service.

    An unmatched charge is the interesting row: it may be a service nobody
    recorded. It is kept and surfaced rather than dropped, which is why
    `service` being null is a normal state here and not an error.
    """

    amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True, coerce_to_string=True
    )
    card_display = serializers.CharField(source="card.display", read_only=True, default="")
    card_last_four = serializers.CharField(source="card.last_four", read_only=True, default="")
    service_name = serializers.CharField(
        source="service.identifier", read_only=True, default=None
    )
    provider_name = serializers.CharField(
        source="service.provider.name", read_only=True, default=None
    )
    match_source_label = serializers.CharField(
        source="get_match_source_display", read_only=True
    )
    #: Frozen at sync time. Null when no rate existed for that currency on
    #: that date — never 1:1, so a null here means "not counted", not "zero".
    base_amount = serializers.DecimalField(
        max_digits=16, decimal_places=2, read_only=True, coerce_to_string=True
    )
    fx_rate = serializers.DecimalField(
        max_digits=20, decimal_places=10, read_only=True, coerce_to_string=True
    )
    is_converted = serializers.BooleanField(read_only=True)

    class Meta:
        model = ServicePayment
        fields = [
            "id", "provider", "merchant", "description",
            "amount", "currency", "posted_at",
            "card", "card_display", "card_last_four",
            "service", "service_name", "provider_name",
            "match_source", "match_source_label", "match_score",
            "base_amount", "base_currency", "fx_rate", "fx_rate_date",
            "is_converted",
        ]
        read_only_fields = fields
