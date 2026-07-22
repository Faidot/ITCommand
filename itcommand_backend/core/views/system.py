from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate
from django.db.models import Sum
from django.utils import timezone
from datetime import date, timedelta
import random
import string
from core.models import *
from core.serializers import *
from core.encryption import decrypt_value
from core.mixins import AuditLogMixin
from core.permissions import IsSuperadmin, IsAdminOrSuperadmin, IsManagerOrHigher, ReadOnlyViewerOrHigher, VaultAccessPermission, UserManagementPermission, HasModulePermission
from rest_framework.pagination import PageNumberPagination


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request):
        try:
            refresh_token = request.data.get("refresh")
            if not refresh_token:
                return Response({"detail": "Refresh token is required."}, status=status.HTTP_400_BAD_REQUEST)
            token = RefreshToken(refresh_token)
            token.blacklist()
            return Response(status=status.HTTP_205_RESET_CONTENT)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

class FinanceDashboardView(APIView):
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'

    def get(self, request):
        active_fy = FinancialYear.objects.filter(is_active=True).first()
        
        total_budget = 0
        total_spent = 0
        remaining_budget = 0
        spent_by_category = []
        
        if active_fy:
            budgets = Budget.objects.filter(financial_year=active_fy)
            total_budget = budgets.aggregate(Sum('allocated_amount'))['allocated_amount__sum'] or 0

            # Only APPROVED expenses count toward spend.
            expenses = Expense.objects.filter(financial_year=active_fy, status='APPROVED')
            total_spent = expenses.aggregate(Sum('amount'))['amount__sum'] or 0

            remaining_budget = float(total_budget) - float(total_spent)
            
            for b in budgets:
                cat_spent = expenses.filter(category=b.category).aggregate(Sum('amount'))['amount__sum'] or 0
                spent_by_category.append({
                    'category_id': b.category.id,
                    'category_name': b.category.name,
                    'allocated': float(b.allocated_amount),
                    'spent': float(cat_spent),
                    'remaining': float(b.allocated_amount) - float(cat_spent)
                })

        # Petty cash balance
        topups = PettyCashTransaction.objects.filter(transaction_type='TOPUP').aggregate(Sum('amount'))['amount__sum'] or 0
        pc_expenses = PettyCashTransaction.objects.filter(transaction_type='EXPENSE').aggregate(Sum('amount'))['amount__sum'] or 0
        petty_cash_balance = float(topups) - float(pc_expenses)
        
        # Upcoming bills (next 30 days)
        today = date.today()
        thirty_days = today + timedelta(days=30)
        upcoming_bills_qs = RecurringBill.objects.filter(is_active=True, next_due_date__gte=today, next_due_date__lte=thirty_days).order_by('next_due_date')
        upcoming_bills = RecurringBillSerializer(upcoming_bills_qs, many=True).data

        # Recent expenses (last 10)
        recent_expenses_qs = Expense.objects.all().order_by('-expense_date', '-created_at')[:10]
        recent_expenses = ExpenseSerializer(recent_expenses_qs, many=True).data

        # Pending approvals
        pending_count = Expense.objects.filter(status='PENDING').count()
        pending_amount = float(Expense.objects.filter(status='PENDING').aggregate(Sum('amount'))['amount__sum'] or 0)

        # Income vs expense trend (configurable length + optional category drilldown)
        try:
            n_months = max(1, min(24, int(request.query_params.get('months', 6))))
        except (TypeError, ValueError):
            n_months = 6
        drill_cat = request.query_params.get('category') or None
        monthly_trend = []
        cursor = date(today.year, today.month, 1)
        months = []
        for _ in range(n_months):
            months.append(cursor)
            if cursor.month == 1:
                cursor = date(cursor.year - 1, 12, 1)
            else:
                cursor = date(cursor.year, cursor.month - 1, 1)
        for m in reversed(months):
            nxt = date(m.year + 1, 1, 1) if m.month == 12 else date(m.year, m.month + 1, 1)
            inc_q = Income.objects.filter(income_date__gte=m, income_date__lt=nxt)
            exp_q = Expense.objects.filter(status='APPROVED', expense_date__gte=m, expense_date__lt=nxt)
            if drill_cat:
                inc_q = inc_q.filter(category_id=drill_cat)
                exp_q = exp_q.filter(category_id=drill_cat)
            inc = float(inc_q.aggregate(Sum('amount'))['amount__sum'] or 0)
            exp = float(exp_q.aggregate(Sum('amount'))['amount__sum'] or 0)
            monthly_trend.append({'month': m.strftime('%b %Y'), 'income': inc, 'expense': exp, 'net': inc - exp})

        total_income_year = float(
            (Income.objects.filter(financial_year=active_fy) if active_fy else Income.objects.all())
            .aggregate(Sum('amount'))['amount__sum'] or 0)

        return Response({
            'total_budget': float(total_budget),
            'total_spent': float(total_spent),
            'remaining_budget': remaining_budget,
            'total_income': total_income_year,
            'net_cash_flow': total_income_year - float(total_spent),
            'spent_by_category': spent_by_category,
            'petty_cash_balance': petty_cash_balance,
            'pending_approvals_count': pending_count,
            'pending_approvals_amount': pending_amount,
            'monthly_trend': monthly_trend,
            'upcoming_bills': upcoming_bills,
            'recent_expenses': recent_expenses,
        })

class IntegrationsView(APIView):
    """Configure third-party integrations from Settings.

    API keys are write-only: a caller can set or clear one, but the stored
    value is never returned — only whether a key is present.
    """

    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]

    def _serialize(self, integration, provider, spec):
        return {
            'provider': provider,
            'label': spec.get('label', provider),
            'description': spec.get('description', ''),
            'help': spec.get('help', ''),
            'needs_api_key': spec.get('needs_api_key', False),
            'supports_sync': spec.get('supports_sync', False),
            'credential_label': spec.get('credential_label', 'API key'),
            'default_base_url': spec.get('default_base_url', ''),
            'is_enabled': bool(integration and integration.is_enabled),
            'base_url': (integration.base_url if integration else '') or spec.get('default_base_url', ''),
            'has_api_key': bool(integration and integration.has_api_key),
            'last_status': integration.last_status if integration else '',
            'last_message': integration.last_message if integration else '',
            'last_sync_at': integration.last_sync_at if integration else None,
        }

    def get(self, request):
        existing = {i.provider: i for i in Integration.objects.all()}
        return Response({
            'integrations': [
                self._serialize(existing.get(provider), provider, spec)
                for provider, spec in Integration.PROVIDER_SPECS.items()
            ]
        })

    def put(self, request):
        provider = (request.data.get('provider') or '').strip()
        spec = Integration.PROVIDER_SPECS.get(provider)
        if not spec:
            return Response(
                {'detail': f"Unknown integration '{provider}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        integration, _ = Integration.objects.get_or_create(provider=provider)
        if 'is_enabled' in request.data:
            integration.is_enabled = bool(request.data['is_enabled'])
        if 'base_url' in request.data:
            integration.base_url = (request.data.get('base_url') or '').strip()
        if request.data.get('clear_api_key'):
            integration.set_api_key('')
        elif request.data.get('api_key'):
            integration.set_api_key(str(request.data['api_key']).strip())

        if integration.is_enabled and spec.get('needs_api_key') and not integration.has_api_key:
            return Response(
                {'detail': 'An API key is required before enabling this integration.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        integration.updated_by = request.user
        integration.save()
        return Response(self._serialize(integration, provider, spec))


class IntegrationTestView(APIView):
    """Run an integration once, on demand, and report what happened."""

    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]

    COMMANDS = {'EXCHANGE_RATES': 'fetch_exchange_rates', 'BREX': 'sync_brex'}

    def post(self, request):
        from io import StringIO

        from django.core.management import call_command

        from core.notify import send_to_provider

        provider = (request.data.get('provider') or '').strip()

        # Chat/webhook providers are tested by actually delivering a message.
        if provider in Integration.CHAT_PROVIDERS:
            integration = Integration.objects.filter(provider=provider).first()
            if not integration:
                return Response(
                    {'ok': False, 'output': 'Save the webhook URL first.'},
                    status=status.HTTP_200_OK,
                )
            ok, detail = send_to_provider(
                integration,
                title='ITCommand test message',
                message='If you can read this, the integration is working.',
            )
            integration.mark_result('OK' if ok else 'ERROR', detail)
            return Response({'ok': ok, 'output': detail})

        command = self.COMMANDS.get(provider)
        if not command:
            return Response(
                {'detail': f"Nothing to run for '{provider}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        out, err = StringIO(), StringIO()
        try:
            call_command(command, stdout=out, stderr=err)
        except Exception as exc:  # a provider error must not 500 the page
            return Response(
                {'ok': False, 'output': f'{type(exc).__name__}: {exc}'},
                status=status.HTTP_200_OK,
            )
        problem = err.getvalue().strip()
        return Response({
            'ok': not problem,
            'output': problem or out.getvalue().strip() or 'Completed.',
        })


class ListOfValuesView(APIView):
    """Admin-managed dropdown values, for populating selects in the UI.

    GET /api/lov/                -> every group
    GET /api/lov/?group=currency -> one group

    Falls back to the application's built-in choices when a group has not
    been customised, so the UI never renders an empty dropdown.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from core.lov import GROUPS, get_values

        requested = (request.query_params.get('group') or '').strip()
        keys = [requested] if requested else list(GROUPS)
        payload = {}
        for key in keys:
            if key not in GROUPS:
                return Response(
                    {'detail': f"Unknown group '{key}'."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            payload[key] = [
                {'value': code, 'label': label} for code, label in get_values(key)
            ]
        if requested:
            return Response({'group': requested, 'values': payload[requested]})
        return Response(payload)


class SettingsView(APIView):
    """Company-wide display settings.

    Everyone signed in may READ these — currency and company name drive how
    money and headers render on every page — but only a superadmin may write.
    Internal bookkeeping rows (automation run markers) are never exposed.
    """

    # Keys any authenticated user may read. Anything else is superadmin-only,
    # so adding an internal key later does not leak it by default.
    PUBLIC_KEYS = ('company_name', 'default_currency', 'fiscal_year_start_month')
    DEFAULTS = {
        'company_name': '',
        'default_currency': 'USD',
        'fiscal_year_start_month': '1',
    }

    def get_permissions(self):
        if self.request.method == 'GET':
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsSuperadmin()]

    def get(self, request):
        stored = {s.key: s.value for s in AppSettings.objects.all()}
        if request.user.role == 'SUPERADMIN':
            payload = {
                key: value for key, value in stored.items()
                if not key.startswith('automation.')
            }
        else:
            payload = {key: stored.get(key) for key in self.PUBLIC_KEYS}
        # Always answer with a usable value so the frontend never has to guess.
        for key, fallback in self.DEFAULTS.items():
            if not payload.get(key):
                payload[key] = fallback
        return Response(payload)

    def put(self, request):
        for key, value in request.data.items():
            if key.startswith('automation.'):
                continue  # internal bookkeeping, not user-editable
            AppSettings.objects.update_or_create(key=key, defaults={'value': value})
        return Response({"status": "success"})

from rest_framework.pagination import PageNumberPagination

class LocationViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Location.objects.all()
    serializer_class = LocationSerializer
    # Locations are configuration data managed under Settings.
    permission_classes = [HasModulePermission]
    rbac_module = 'settings'

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get('search')
        active = self.request.query_params.get('is_active')
        if search:
            qs = qs.filter(name__icontains=search)
        if active is not None:
            qs = qs.filter(is_active=active.lower() == 'true')
        return qs


class AuditLogPagination(PageNumberPagination):
    page_size = 20

class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.all().order_by('-timestamp')
    serializer_class = AuditLogSerializer
    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]
    pagination_class = AuditLogPagination

    def get_queryset(self):
        qs = super().get_queryset()
        user_id = self.request.query_params.get('user', None)
        action = self.request.query_params.get('action', None)
        model = self.request.query_params.get('model', None)
        
        if user_id:
            qs = qs.filter(user_id=user_id)
        if action:
            qs = qs.filter(action=action)
        if model:
            qs = qs.filter(model_name=model)
            
        return qs
