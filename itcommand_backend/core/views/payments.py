"""Cards, card accounts and charges — read-only.

Until now the Brex sync wrote rows that nothing in the product could show:
`PaymentCard` and `ServicePayment` had no serializer, no viewset and no route,
so the only way to see a synced charge was the Django admin. These endpoints
are the reader.

Read-only on purpose. Every row here is owned by the sync, and a hand edit
would survive exactly until the next run. The one thing a person legitimately
wants to change — a charge matched to the wrong service — is a write this
stage does not build; see `ServicePaymentViewSet` for why.

Permissions split on what the data actually is:

* cards and charges answer "which card does this service renew on, and what
  did we pay?", which is the estate's own question -> `estate`;
* account balances are treasury data that has nothing to do with services
  -> `finance`, a narrower grant.
"""
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from core import fx
from core.mixins import AuditLogMixin
from core.models import CardAccount, PaymentCard, Service, ServicePayment
from core.permissions import HasModulePermission
from core.serializers import (
    CardAccountSerializer,
    PaymentCardSerializer,
    ServicePaymentSerializer,
)


class PaymentsPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


def _int_param(params, key, default, *, low, high):
    try:
        return max(low, min(high, int(params.get(key, default))))
    except (TypeError, ValueError):
        return default


class PaymentCardViewSet(viewsets.ReadOnlyModelViewSet):
    """Corporate cards. Never a PAN — only the last four."""

    queryset = PaymentCard.objects.select_related("holder")
    serializer_class = PaymentCardSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "estate"
    pagination_class = PaymentsPagination

    def get_queryset(self):
        qs = super().get_queryset().annotate(
            service_count=Count("estate_services", distinct=True)
        )
        params = self.request.query_params
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(last_four__icontains=search)
                | Q(nickname__icontains=search)
                | Q(holder_name__icontains=search)
            )
        status_filter = (params.get("status") or "").strip().upper()
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs.order_by("last_four", "id")


class CardAccountViewSet(viewsets.ReadOnlyModelViewSet):
    """Card accounts and balances.

    `finance` rather than `estate`: a balance is not a fact about a service,
    and estate viewers should not inherit sight of company cash on the way to
    finding out which card renews a domain.
    """

    queryset = CardAccount.objects.all()
    serializer_class = CardAccountSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "finance"
    pagination_class = PaymentsPagination


class ServicePaymentViewSet(AuditLogMixin, viewsets.ReadOnlyModelViewSet):
    """Card charges, matched and unmatched.

    The rows themselves are owned by the sync and cannot be edited — a hand
    edit would survive until the next run. The one exception is the *match*,
    which is a judgement rather than a fact: `link` and `unlink` let a person
    correct what the descriptor matcher got wrong.

    A manual match is durable. `sync_transactions` skips the match fields for
    any charge marked MANUAL, so the nightly run refreshes the amount and the
    card but leaves the human decision alone. Without that, correcting a match
    would last exactly until the next sync re-guessed it.
    """

    queryset = ServicePayment.objects.select_related(
        "card", "service", "service__provider"
    )
    serializer_class = ServicePaymentSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "estate"
    #: Both are corrections to existing data, so they need `edit`, not `add`.
    rbac_action_permissions = {"link": "edit", "unlink": "edit"}
    pagination_class = PaymentsPagination

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params

        service = (params.get("service") or "").strip()
        if service.isdigit():
            qs = qs.filter(service_id=int(service))

        card = (params.get("card") or "").strip()
        if card.isdigit():
            qs = qs.filter(card_id=int(card))

        matched = (params.get("matched") or "").strip().lower()
        if matched in {"0", "false", "no"}:
            qs = qs.filter(service__isnull=True)
        elif matched in {"1", "true", "yes"}:
            qs = qs.filter(service__isnull=False)

        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(merchant__icontains=search) | Q(description__icontains=search)
            )

        days = params.get("days")
        if days is not None:
            window = _int_param(params, "days", 90, low=1, high=1095)
            since = timezone.localdate() - timedelta(days=window)
            qs = qs.filter(posted_at__gte=since)

        return qs.order_by("-posted_at", "-id")

    @action(detail=True, methods=["post"])
    def link(self, request, pk=None):
        """Tie this charge to a service, overriding whatever the matcher said.

        Also teaches the matcher: if the service has no billing descriptor,
        this charge's merchant becomes it, so the *next* charge from the same
        merchant matches on its own instead of needing the same correction
        again. Only when empty — an existing descriptor was set deliberately.
        """
        payment = self.get_object()
        raw = request.data.get("service")
        if raw in (None, ""):
            return Response(
                {"detail": "A service id is required. Use unlink to clear a match."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        service = Service.objects.filter(pk=raw).first()
        if service is None:
            return Response(
                {"detail": "That service does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        previous = payment.service
        with transaction.atomic():
            payment.service = service
            payment.match_source = "MANUAL"
            # A person looked at it. That is not a 0.7 guess.
            payment.match_score = 1.0
            payment.save(update_fields=["service", "match_source", "match_score"])

            taught = False
            if not service.billing_descriptor and payment.merchant:
                service.billing_descriptor = payment.merchant[:160]
                service.save(update_fields=["billing_descriptor", "updated_at"])
                taught = True

        self.log_action("UPDATE", payment, {
            "action": "link",
            "service": service.pk,
            "service_name": service.identifier,
            "previous_service": previous.pk if previous else None,
            "merchant": payment.merchant,
            "billing_descriptor_set": taught,
        })
        return Response(self.get_serializer(payment).data)

    @action(detail=True, methods=["post"])
    def unlink(self, request, pk=None):
        """Detach a charge from its service.

        Left as NONE rather than handed back to the matcher: a person removing
        a match is saying it was wrong, and the matcher would only propose the
        same one again. It stays unmatched until somebody links it.
        """
        payment = self.get_object()
        previous = payment.service
        if previous is None:
            return Response(
                {"detail": "That charge is not linked to a service."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payment.service = None
        payment.match_source = "MANUAL"
        payment.match_score = 0.0
        payment.save(update_fields=["service", "match_source", "match_score"])

        self.log_action("UPDATE", payment, {
            "action": "unlink",
            "previous_service": previous.pk,
            "previous_service_name": previous.identifier,
            "merchant": payment.merchant,
        })
        return Response(self.get_serializer(payment).data)

    @staticmethod
    def _by_currency(queryset):
        rows = (
            queryset.values("currency")
            .annotate(total=Sum("amount"), count=Count("id"))
            .order_by("-total")
        )
        return [
            {
                "currency": row["currency"],
                "total": f"{row['total'] or 0:.2f}",
                "count": row["count"],
            }
            for row in rows
        ]

    def _converted(self, queryset, reporting):
        """The converted total, and what could not be converted.

        Only rows frozen into the *current* reporting currency count. A row
        converted before the currency changed is stale, not usable, and is
        reported as unconverted until `backfill_payment_fx --restate` runs.
        """
        usable = queryset.filter(
            base_amount__isnull=False, base_currency=reporting
        )
        unconvertible = queryset.exclude(
            base_amount__isnull=False, base_currency=reporting
        )
        total = usable.aggregate(total=Sum("base_amount"))["total"] or Decimal("0")
        return {
            "currency": reporting,
            "total": f"{total:.2f}",
            "converted_count": usable.count(),
            # Named to match `estate_reports` and the FX rule the codebase
            # already follows: a missing rate is reported, never folded at 1:1.
            "unconvertible": self._by_currency(unconvertible),
            "is_complete": not unconvertible.exists(),
        }

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """What the estate panel leads with.

        Two views of the same money, on purpose. `totals` is per currency and
        never added across currencies. `converted` is the single figure in the
        reporting currency, and it carries an `unconvertible` block naming
        exactly what it excludes — because a headline that quietly drops the
        charges it could not convert is a wrong number, and one built at 1:1
        is a worse one.
        """
        window = _int_param(request.query_params, "days", 90, low=1, high=1095)
        since = timezone.localdate() - timedelta(days=window)
        charges = ServicePayment.objects.filter(posted_at__gte=since)
        reporting = fx.reporting_currency()

        unmatched = charges.filter(service__isnull=True)
        total_count = charges.count()
        matched_count = total_count - unmatched.count()

        return Response({
            "days": window,
            "since": since,
            "charge_count": total_count,
            "matched_count": matched_count,
            "unmatched_count": total_count - matched_count,
            "totals": self._by_currency(charges),
            "unmatched_totals": self._by_currency(unmatched),
            "converted": self._converted(charges, reporting),
            "unmatched_converted": self._converted(unmatched, reporting),
            "card_count": PaymentCard.objects.count(),
            "last_charge_at": charges.order_by("-posted_at")
            .values_list("posted_at", flat=True)
            .first(),
        })
