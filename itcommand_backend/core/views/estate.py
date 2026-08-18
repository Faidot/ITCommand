"""Digital Estate API.

Everything here runs on `rbac_module = "estate"` — the estate is a view
onto subscription spend, not a new permission domain. That was the deciding
argument for not reusing `AccountWorkspace`, which is reachable only behind the
vault master-password unlock.

Aggregation lives in `core.estate_reports`; these views are thin on purpose so
the money logic can be tested without going through HTTP.
"""

from datetime import timedelta

from django.db.models import Count, ProtectedError, Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from core import estate, estate_reports, fx
from core.mixins import AuditLogMixin
from core.models import (
    AccountUser,
    Property,
    EstateSettings,
    ExchangeRate,
    Provider,
    ProviderAccount,
    Server,
    Service,
)
from core.permissions import HasModulePermission, IsSuperadmin
from core.serializers import (
    AccountUserSerializer,
    PropertySerializer,
    EstateSettingsSerializer,
    ExchangeRateSerializer,
    ProviderAccountSerializer,
    ProviderSerializer,
    ServerSerializer,
    ServiceSerializer,
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
    """The provider catalog. Seeded by `manage.py seed_providers`, admin-editable."""

    serializer_class = ProviderSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "estate"
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
        """The service-layer catalog, in the org's configured stack order."""
        return Response(estate_reports.layer_catalog())


class ProviderAccountViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """Logins we hold at providers.

    The MFA columns are the point: an account with no second factor holding
    production infrastructure is the most useful thing this endpoint surfaces,
    so `mfa_severity` is computed server-side and travels with every row.
    """

    serializer_class = ProviderAccountSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "estate"
    pagination_class = EstatePagination

    def get_queryset(self):
        queryset = (
            ProviderAccount.objects.select_related(
                "provider", "owner", "vault_credential", "account_workspace"
            )
            # `mfa_severity` and `has_mfa` now read the account's people, so
            # without this every row on the list costs its own query — the
            # exact N+1 the query-count tests exist to catch.
            .prefetch_related("people__user")
            .annotate(service_count=Count("services", distinct=True))
            .order_by("provider__name", "account_email")
        )
        params = self.request.query_params
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(account_email__icontains=search)
                | Q(provider__name__icontains=search)
                | Q(notes__icontains=search)
            )
        provider = params.get("provider")
        if provider:
            queryset = queryset.filter(provider_id=provider)
        owner = params.get("owner")
        if owner:
            queryset = queryset.filter(owner_id=owner)
        # Query-param name -> model field. The params keep the pre-Phase-1
        # spelling until Phase 3 moves the frontend; the columns behind them
        # are already `auth_type` / `mfa_type`.
        for param, field in (("auth_method", "auth_type"), ("mfa_method", "mfa_type")):
            value = (params.get(param) or "").strip().upper()
            if value:
                queryset = queryset.filter(**{field: value})
        if "is_active" in params:
            queryset = queryset.filter(is_active=_bool_param(params, "is_active"))
        # The headline filter for this table.
        if _bool_param(params, "missing_mfa"):
            queryset = queryset.filter(mfa_type__in=["NONE", "UNKNOWN"])
        if _bool_param(params, "unowned"):
            queryset = queryset.filter(owner__isnull=True)
        return queryset

    def destroy(self, request, *args, **kwargs):
        """An account with services is PROTECTed. Say why, don't 500.

        Same 409 pattern as deleting a provider that still has accounts. The
        protection is the point — deleting the login would orphan the money
        records that were bought through it — so the answer is a sentence
        telling you what to move first, not a stack trace.
        """
        account = self.get_object()
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            in_use = account.services.count()
            return Response(
                {
                    "detail": (
                        f'Cannot delete "{account.account_email}": {in_use} '
                        f"service(s) are bought through it. Move them to another "
                        f"account first, or mark this one inactive to hide it "
                        f"from pickers."
                    ),
                    "service_count": in_use,
                },
                status=status.HTTP_409_CONFLICT,
            )

    @action(detail=False, methods=["get"], url_path="mfa-summary")
    def mfa_summary(self, request):
        """Counts per MFA method, with the severity the UI must colour by."""
        counts = dict(
            ProviderAccount.objects.filter(is_active=True)
            .values_list("mfa_type")
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
                    for code, label in estate.MFA_TYPES
                ],
                "total": sum(counts.values()),
                "unprotected": counts.get("NONE", 0),
                "unverified": counts.get("UNKNOWN", 0),
            }
        )


class PropertyViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """Domains, apps and sites we own."""

    serializer_class = PropertySerializer
    permission_classes = [HasModulePermission]
    rbac_module = "estate"
    pagination_class = EstatePagination

    def get_queryset(self):
        queryset = (
            Property.objects.select_related("owner", "department")
            .annotate(service_count=Count("services", distinct=True))
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
        orphaned = prop.services.count()
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
                "property": PropertySerializer(
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
        active = estate_reports.active_services(today)
        catalog = estate_reports.layer_catalog()
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
                    **entry,
                    "configured": entry["layer"] in present,
                    "is_gap": entry["is_tracked"] and entry["layer"] not in present,
                }
                for entry in catalog
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


class ServiceViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """The services themselves — the table the money comes from.

    Every list is `select_related` across provider, account and property. Those
    three are rendered on every row (chip, login, property link), so without it
    a 50-row page is 150 extra queries.
    """

    serializer_class = ServiceSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "estate"
    pagination_class = EstatePagination

    def get_queryset(self):
        queryset = Service.objects.select_related(
            "provider", "provider_account", "property", "vault_credential"
        ).order_by("property__name", "service_type", "identifier")

        params = self.request.query_params
        search = (params.get("search") or "").strip()
        if search:
            # Free-text across identifier, provider and account email, which is
            # what the Services table's search box offers.
            queryset = queryset.filter(
                Q(identifier__icontains=search)
                | Q(provider__name__icontains=search)
                | Q(provider_account__account_email__icontains=search)
                | Q(notes__icontains=search)
            )

        for param, field in (
            ("service_type", "service_type"),
            ("status", "status"),
            ("currency", "currency"),
            ("billing_cycle", "billing_cycle"),
        ):
            value = (params.get(param) or "").strip().upper()
            if value:
                queryset = queryset.filter(**{field: value})

        for param, field in (
            ("provider", "provider_id"),
            ("provider_account", "provider_account_id"),
            ("property", "property_id"),
        ):
            value = params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})

        if "auto_renew" in params:
            queryset = queryset.filter(auto_renew=_bool_param(params, "auto_renew"))
        if _bool_param(params, "orphans"):
            queryset = queryset.filter(property__isnull=True)
        if _bool_param(params, "expiring_soon"):
            settings = estate_reports.estate_settings()
            today = timezone.localdate()
            queryset = queryset.filter(
                status="ACTIVE",
                renewal_date__gte=today,
                renewal_date__lte=today
                + timedelta(days=settings.renewal_warning_days),
            )
        if _bool_param(params, "at_risk"):
            # The stored flag *or* the derived condition, mirroring
            # `Service.is_at_risk` so the filter and the badge cannot disagree.
            settings = estate_reports.estate_settings()
            today = timezone.localdate()
            queryset = queryset.filter(
                Q(status="AT_RISK")
                | Q(
                    status="ACTIVE",
                    auto_renew=False,
                    renewal_date__gte=today,
                    renewal_date__lte=today
                    + timedelta(days=settings.renewal_warning_days),
                )
            )
        return queryset

    @action(detail=False, methods=["post"], url_path="bulk-update")
    def bulk_update(self, request):
        """Set one field across many services, one audited write each.

        Deliberately not `qs.update()`. That would be a single statement with no
        per-row audit trail and no `updated_at` bump — and this endpoint exists
        precisely to reassign a batch of orphans, which is exactly the change
        someone will later need to explain.
        """
        ids = request.data.get("ids") or []
        if not isinstance(ids, list) or not ids:
            return Response(
                {"detail": "Provide a non-empty list of service ids."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        allowed = {"property", "status", "auto_renew", "service_type"}
        changes = {k: v for k, v in (request.data.get("changes") or {}).items() if k in allowed}
        if not changes:
            return Response(
                {"detail": f"Provide at least one of: {', '.join(sorted(allowed))}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        updated = 0
        for service in self.get_queryset().filter(pk__in=ids):
            serializer = self.get_serializer(service, data=changes, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            self.log_action("UPDATE", service, serializer.data)
            updated += 1
        return Response({"updated": updated, "requested": len(ids)})


# ─────────────────────────── read-only aggregations ───────────────────────────

class EstateOverviewView(APIView):
    """KPIs, spend by provider and layer, and the renewal timeline.

    Every money figure is a `converted_money` block: the converted subset, the
    currencies that had no rate, and `is_complete`. A caller that renders only
    the number is rendering a partial total — the block is shaped so that is
    obvious rather than easy.
    """

    permission_classes = [HasModulePermission]
    rbac_module = "estate"

    def get(self, request):
        # Left as None unless the caller actually asked, so the configured
        # window in Settings is what applies. Defaulting here would quietly
        # override the setting on every request.
        days = None
        raw = request.query_params.get("days")
        if raw is not None:
            try:
                days = max(1, min(int(raw), 365))
            except (TypeError, ValueError):
                days = None
        return Response(
            estate_reports.overview(
                to_currency=_reporting_currency(request), timeline_days=days
            )
        )


class EstateDashboardView(APIView):
    """Everything the Estate dashboard renders, in one request.

    KPIs, the 90-day timeline and both breakdowns come from the same read of
    active services. Five endpoints would be five round trips that can
    disagree with one another if a service changes between the first and the
    last.
    """

    permission_classes = [HasModulePermission]
    rbac_module = "estate"

    def get(self, request):
        return Response(
            estate_reports.dashboard(to_currency=_reporting_currency(request))
        )


class EstateGapsView(APIView):
    """Properties missing a required layer, and services attached to nothing."""

    permission_classes = [HasModulePermission]
    rbac_module = "estate"

    def get(self, request):
        return Response(estate_reports.estate_gaps())


# ───────────────────────────── settings ─────────────────────────────

class EstateSettingsView(APIView):
    """Which layers this organisation tracks, and when it wants warning.

    Readable by anyone who can see the estate — the layer order drives every
    stack strip, so the tab cannot render without it. Writable by a superadmin
    only, matching the rest of Master Settings.
    """

    def get_permissions(self):
        if self.request.method == "GET":
            return [HasModulePermission()]
        return [permissions.IsAuthenticated(), IsSuperadmin()]

    rbac_module = "estate"

    def _payload(self, settings):
        return {
            **EstateSettingsSerializer(settings).data,
            # The full catalog travels with the settings so the editor can offer
            # layers that are currently switched off.
            "catalog": estate_reports.layer_catalog(settings),
            "all_layers": [
                {"layer": code, "layer_label": label}
                for code, label in estate.SERVICE_LAYERS
            ],
        }

    def get(self, request):
        return Response(self._payload(EstateSettings.get_solo()))

    def put(self, request):
        settings = EstateSettings.get_solo()
        serializer = EstateSettingsSerializer(
            settings, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        settings.refresh_from_db()
        return Response(self._payload(settings))


# ───────────────────────────── exchange rates ─────────────────────────────

class ExchangeRateViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """Manual exchange rates, and a plain answer to "what is missing?".

    This is the other half of the FX fix. The estate and subscription pages tell
    a user that a currency has no rate and to come to Settings; until now there
    was nowhere to go. `status/` lists every currency actually in use, whether it
    converts, and what it is costing — so the gap is closed from the same screen
    that reported it.

    Superadmin-only, matching the Integrations tab it sits beside.
    """

    serializer_class = ExchangeRateSerializer
    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]
    pagination_class = EstatePagination

    def get_queryset(self):
        queryset = ExchangeRate.objects.all().order_by("-as_of", "currency")
        params = self.request.query_params
        currency = (params.get("currency") or "").strip().upper()
        if currency:
            queryset = queryset.filter(currency=currency)
        base = (params.get("base") or "").strip().upper()
        if base:
            queryset = queryset.filter(base_currency=base)
        return queryset

    def perform_create(self, serializer):
        """Upsert rather than duplicate: one rate per (base, currency, day).

        A second POST for the same day is someone correcting a typo, not asking
        for two rates — and the unique constraint would 500 the page.
        """
        data = serializer.validated_data
        instance, _ = ExchangeRate.objects.update_or_create(
            base_currency=data["base_currency"],
            currency=data["currency"],
            as_of=data["as_of"],
            defaults={"rate": data["rate"], "source": "MANUAL"},
        )
        serializer.instance = instance
        self.log_action("CREATE", instance, serializer.data)

    @action(detail=False, methods=["get"])
    def status(self, request):
        """Every currency in use, and whether it can be converted."""
        base = _reporting_currency(request) or fx.reporting_currency()
        rows = estate_reports.currency_status(base=base)
        missing = [row for row in rows if not row["has_rate"]]
        return Response(
            {
                "base_currency": base,
                "rates_as_of": fx.rate_as_of(base),
                "currencies": rows,
                "missing_count": len(missing),
                "missing_currencies": [row["currency"] for row in missing],
                "is_complete": not missing,
            }
        )


class AccountUserViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """The people who can sign in to a provider account.

    Two questions this exists to answer, and both are one request:

    * ``?account=<id>`` — who can get into this AWS account, and which of them
      has no second factor;
    * ``?user=<id>`` — everything one person can sign in to, across every
      provider. That is the offboarding list, and before this model there was
      no way to produce it at all.
    """

    serializer_class = AccountUserSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "estate"
    pagination_class = EstatePagination

    def get_queryset(self):
        queryset = AccountUser.objects.select_related(
            "user", "provider_account", "provider_account__provider"
        ).order_by("provider_account__provider__name", "login")

        params = self.request.query_params
        account = params.get("account")
        if account:
            queryset = queryset.filter(provider_account_id=account)
        user = params.get("user")
        if user:
            queryset = queryset.filter(user_id=user)
        provider = params.get("provider")
        if provider:
            queryset = queryset.filter(provider_account__provider_id=provider)
        role = (params.get("role") or "").strip().upper()
        if role:
            queryset = queryset.filter(role=role)
        mfa = (params.get("mfa") or "").strip().upper()
        if mfa:
            queryset = queryset.filter(mfa_type=mfa)
        if (params.get("no_mfa") or "").lower() in ("1", "true", "yes"):
            queryset = queryset.filter(mfa_type="NONE")
        if (params.get("privileged") or "").lower() in ("1", "true", "yes"):
            queryset = queryset.filter(role__in=estate.PRIVILEGED_ROLES)
        active = params.get("is_active")
        if active is not None and active != "":
            queryset = queryset.filter(is_active=active.lower() in ("1", "true", "yes"))
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(login__icontains=search)
                | Q(display_name__icontains=search)
                | Q(user__full_name__icontains=search)
                | Q(user__email__icontains=search)
                | Q(provider_account__provider__name__icontains=search)
            )
        return queryset

    @action(detail=False, methods=["get"], url_path="for-user/(?P<user_id>[^/.]+)")
    def for_user(self, request, user_id=None):
        """Everything one person can sign in to. The offboarding answer.

        Returns servers they own alongside their logins, because "what does
        this person hold" is one question and answering half of it is how a
        machine gets left running under a leaver's name.
        """
        logins = self.get_queryset().filter(user_id=user_id, is_active=True)
        servers = (
            Server.objects.filter(owner_id=user_id)
            .select_related("provider_account__provider", "property")
            .order_by("name")
        )
        return Response({
            "logins": AccountUserSerializer(logins, many=True, context={"request": request}).data,
            "servers": ServerSerializer(servers, many=True, context={"request": request}).data,
            "login_count": logins.count(),
            "privileged_count": logins.filter(role__in=estate.PRIVILEGED_ROLES).count(),
            "without_mfa": logins.filter(mfa_type="NONE").count(),
            "server_count": servers.count(),
        })


class ServerViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """Machines bought through a provider account."""

    serializer_class = ServerSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "estate"
    pagination_class = EstatePagination

    def get_queryset(self):
        queryset = Server.objects.select_related(
            "provider_account", "provider_account__provider", "property", "service", "owner"
        ).order_by("name")

        params = self.request.query_params
        for param, field in (
            ("account", "provider_account_id"),
            ("property", "property_id"),
            ("service", "service_id"),
            ("owner", "owner_id"),
            ("provider", "provider_account__provider_id"),
        ):
            value = params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        for param, field in (
            ("status", "status"),
            ("environment", "environment"),
            ("role", "server_role"),
        ):
            value = (params.get(param) or "").strip().upper()
            if value:
                queryset = queryset.filter(**{field: value})
        if (params.get("live") or "").lower() in ("1", "true", "yes"):
            queryset = queryset.filter(status__in=estate.LIVE_SERVER_STATUSES)
        if (params.get("orphan") or "").lower() in ("1", "true", "yes"):
            queryset = queryset.filter(property__isnull=True)
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(hostname__icontains=search)
                | Q(public_ip__icontains=search)
                | Q(private_ip__icontains=search)
                | Q(region__icontains=search)
                | Q(notes__icontains=search)
            )
        return queryset

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "Something still refers to this server."},
                status=status.HTTP_409_CONFLICT,
            )

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Counts for the Servers page header, in one request."""
        queryset = self.get_queryset()
        by_environment = list(
            queryset.values("environment").annotate(count=Count("id")).order_by("-count")
        )
        by_role = list(
            queryset.values("server_role").annotate(count=Count("id")).order_by("-count")
        )
        return Response({
            "total": queryset.count(),
            "live": queryset.filter(status__in=estate.LIVE_SERVER_STATUSES).count(),
            "orphans": queryset.filter(property__isnull=True).count(),
            "by_environment": by_environment,
            "by_role": by_role,
        })
