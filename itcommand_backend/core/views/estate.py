"""Digital Estate API.

Everything here runs on `rbac_module = "subscriptions"` — the estate is a view
onto subscription spend, not a new permission domain. That was the deciding
argument for not reusing `AccountWorkspace`, which is reachable only behind the
vault master-password unlock.

Aggregation lives in `core.estate_reports`; these views are thin on purpose so
the money logic can be tested without going through HTTP.
"""

from django.db.models import Count, ProtectedError, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from core import estate, estate_reports
from core.mixins import AuditLogMixin
from core.models import DigitalProperty, Provider, ProviderAccount
from core.permissions import HasModulePermission
from core.serializers import (
    DigitalPropertySerializer,
    EstateLayerSerializer,
    ProviderAccountSerializer,
    ProviderSerializer,
)


class EstatePagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


def _bool_param(params, key):
    return str(params.get(key, "")).strip().lower() in {"1", "true", "yes"}


def _reporting_currency(request):
    """Optional ?currency= override, else the org reporting currency."""
    requested = (request.query_params.get("currency") or "").strip().upper()
    return requested if len(requested) == 3 and requested.isalpha() else None


# ───────────────────────────────── catalog CRUD ─────────────────────────────

class ProviderViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """The provider catalog. Seeded by `manage.py seed_estate`, admin-editable."""

    serializer_class = ProviderSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "subscriptions"
    pagination_class = EstatePagination

    def get_queryset(self):
        queryset = (
            Provider.objects.select_related("vendor")
            .annotate(account_count=Count("accounts", distinct=True))
            .order_by("name")
        )
        params = self.request.query_params
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(slug__icontains=search)
            )
        if "is_active" in params:
            queryset = queryset.filter(is_active=_bool_param(params, "is_active"))
        return queryset

    def destroy(self, request, *args, **kwargs):
        """A provider with accounts is PROTECTed. Say why, don't 500.

        Mirrors the 409 pattern RoleViewSet already uses for a role still in use.
        """
        provider = self.get_object()
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            in_use = provider.accounts.count()
            return Response(
                {
                    "detail": (
                        f'Cannot delete "{provider.name}": {in_use} account(s) still '
                        f"reference it. Move or delete those accounts first, or mark "
                        f"the provider inactive to hide it from pickers."
                    ),
                    "account_count": in_use,
                },
                status=status.HTTP_409_CONFLICT,
            )

    @action(detail=False, methods=["get"])
    def layers(self, request):
        """The service-layer catalog, in stack order."""
        return Response(EstateLayerSerializer.catalog())


class ProviderAccountViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """Logins we hold at providers.

    The MFA columns are the point: an account with no second factor holding
    production infrastructure is the most useful thing this endpoint surfaces,
    so `mfa_severity` is computed server-side and travels with every row.
    """

    serializer_class = ProviderAccountSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "subscriptions"
    pagination_class = EstatePagination

    def get_queryset(self):
        queryset = (
            ProviderAccount.objects.select_related(
                "provider", "owner", "vault_credential", "account_workspace"
            )
            .annotate(service_count=Count("subscriptions", distinct=True))
            .order_by("provider__name", "login_email")
        )
        params = self.request.query_params
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(login_email__icontains=search)
                | Q(provider__name__icontains=search)
                | Q(notes__icontains=search)
            )
        provider = params.get("provider")
        if provider:
            queryset = queryset.filter(provider_id=provider)
        owner = params.get("owner")
        if owner:
            queryset = queryset.filter(owner_id=owner)
        for field in ("auth_method", "mfa_method"):
            value = (params.get(field) or "").strip().upper()
            if value:
                queryset = queryset.filter(**{field: value})
        if "is_active" in params:
            queryset = queryset.filter(is_active=_bool_param(params, "is_active"))
        # The headline filter for this table.
        if _bool_param(params, "missing_mfa"):
            queryset = queryset.filter(mfa_method__in=["NONE", "UNKNOWN"])
        if _bool_param(params, "unowned"):
            queryset = queryset.filter(owner__isnull=True)
        return queryset

    @action(detail=False, methods=["get"], url_path="mfa-summary")
    def mfa_summary(self, request):
        """Counts per MFA method, with the severity the UI must colour by."""
        counts = dict(
            ProviderAccount.objects.filter(is_active=True)
            .values_list("mfa_method")
            .annotate(total=Count("id"))
        )
        return Response(
            {
                "methods": [
                    {
                        "mfa_method": code,
                        "label": label,
                        "severity": estate.mfa_severity(code),
                        "count": counts.get(code, 0),
                    }
                    for code, label in estate.MFA_METHODS
                ],
                "total": sum(counts.values()),
                "unprotected": counts.get("NONE", 0),
                "unverified": counts.get("UNKNOWN", 0),
            }
        )


class DigitalPropertyViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """Domains, apps and sites we own."""

    serializer_class = DigitalPropertySerializer
    permission_classes = [HasModulePermission]
    rbac_module = "subscriptions"
    pagination_class = EstatePagination

    def get_queryset(self):
        queryset = (
            DigitalProperty.objects.select_related("owner", "department")
            .annotate(service_count=Count("subscriptions", distinct=True))
            .order_by("name")
        )
        params = self.request.query_params
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(notes__icontains=search)
            )
        kind = (params.get("kind") or "").strip().upper()
        if kind:
            queryset = queryset.filter(kind=kind)
        owner = params.get("owner")
        if owner:
            queryset = queryset.filter(owner_id=owner)
        department = params.get("department")
        if department:
            queryset = queryset.filter(department_id=department)
        if "is_active" in params:
            queryset = queryset.filter(is_active=_bool_param(params, "is_active"))
        return queryset

    def destroy(self, request, *args, **kwargs):
        """Deleting a property orphans its services rather than deleting them.

        That is the intended SET_NULL behaviour — losing the money record because
        someone tidied up a domain would be far worse — but the caller is told
        how many services just became orphans, because that number moves a KPI.
        """
        prop = self.get_object()
        orphaned = prop.subscriptions.count()
        response = super().destroy(request, *args, **kwargs)
        if orphaned:
            return Response(
                {
                    "detail": (
                        f"Property deleted. {orphaned} service(s) are now orphaned "
                        f"and need reassigning."
                    ),
                    "orphaned_count": orphaned,
                },
                status=status.HTTP_200_OK,
            )
        return response

    @action(detail=True, methods=["get"])
    def stack(self, request, pk=None):
        """Every layer for this property — bound service, or an explicit gap."""
        prop = self.get_object()
        payload = estate_reports.property_stack(prop)
        return Response(
            {
                "property": DigitalPropertySerializer(
                    prop, context=self.get_serializer_context()
                ).data,
                **payload,
            }
        )

    @action(detail=False, methods=["get"])
    def stacks(self, request):
        """Every active property with its layer strip and converted spend.

        Not in the Phase 2 brief, but Phase 3's property cards are the
        centrepiece of the Estate tab and need one row per property with its
        chips already resolved. Without this the frontend would issue one
        `stack/` call per property.
        """
        today = timezone.localdate()
        currency = _reporting_currency(request)
        active = estate_reports.active_subscriptions(today)
        # Three queries total, whatever the property count: layer coverage,
        # spend, and the property list itself. Not one spend query per card.
        coverage = estate_reports.stack_coverage(today=today)
        spend_by_property = estate_reports.spend_by_property(
            active, to_currency=currency
        )
        # Reuse an already-resolved `rates_as_of` so the zero block costs nothing.
        # Only pass it when there is one to reuse — `zero_money` distinguishes
        # "not supplied" from "no rates stored", which are different facts.
        any_spend = next(iter(spend_by_property.values()), None)
        zero = (
            estate_reports.zero_money(
                to_currency=currency, as_of=any_spend["rates_as_of"]
            )
            if any_spend
            else estate_reports.zero_money(to_currency=currency)
        )

        rows = []
        for prop in self.get_queryset().filter(is_active=True):
            present = coverage.get(prop.id, {"present": set(), "count": 0})["present"]
            spend = spend_by_property.get(prop.id, zero)
            layers = [
                {
                    "layer": code,
                    "layer_label": label,
                    "is_required": code in estate.REQUIRED_LAYERS,
                    "configured": code in present,
                    "is_gap": code in estate.REQUIRED_LAYERS and code not in present,
                }
                for code, label in estate.SERVICE_LAYERS
            ]
            rows.append(
                {
                    "id": prop.id,
                    "name": prop.name,
                    "kind": prop.kind,
                    "kind_label": prop.get_kind_display(),
                    "owner_id": prop.owner_id,
                    "owner_name": prop.owner.full_name if prop.owner_id else None,
                    "service_count": prop.service_count,
                    "spend": spend,
                    "layers": layers,
                    "gap_count": sum(1 for row in layers if row["is_gap"]),
                }
            )
        return Response({"count": len(rows), "results": rows})


# ─────────────────────────── read-only aggregations ───────────────────────────

class EstateOverviewView(APIView):
    """KPIs, spend by provider and layer, and the renewal timeline.

    Every money figure is a `converted_money` block: the converted subset, the
    currencies that had no rate, and `is_complete`. A caller that renders only
    the number is rendering a partial total — the block is shaped so that is
    obvious rather than easy.
    """

    permission_classes = [HasModulePermission]
    rbac_module = "subscriptions"

    def get(self, request):
        try:
            days = int(request.query_params.get("days", estate.TIMELINE_WINDOW_DAYS))
        except (TypeError, ValueError):
            days = estate.TIMELINE_WINDOW_DAYS
        days = max(1, min(days, 365))
        return Response(
            estate_reports.overview(
                to_currency=_reporting_currency(request), timeline_days=days
            )
        )


class EstateGapsView(APIView):
    """Properties missing a required layer, and services attached to nothing."""

    permission_classes = [HasModulePermission]
    rbac_module = "subscriptions"

    def get(self, request):
        return Response(estate_reports.estate_gaps())
