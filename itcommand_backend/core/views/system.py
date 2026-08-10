from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework_simplejwt.tokens import RefreshToken
from django.conf import settings
from django.contrib.auth import authenticate
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
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

class IntegrationsView(AuditLogMixin, APIView):
    """Configure third-party integrations from Settings.

    API keys are write-only: a caller can set or clear one, but the stored
    value is never returned — only whether a key is present, its fingerprint
    and when it was set.

    Every change is audited. Installing a credential is a privileged act and
    used to leave no trace of who did it; the audit row carries the key's
    fingerprint so one key can be told from another without recording either.
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
            # True when the credential is stored for a feature that does not
            # exist yet, so the UI can say so instead of implying a live sync.
            'config_only': spec.get('config_only', False),
            'credential_label': spec.get('credential_label', 'API key'),
            'default_base_url': spec.get('default_base_url', ''),
            'is_enabled': bool(integration and integration.is_enabled),
            'base_url': (integration.base_url if integration else '') or spec.get('default_base_url', ''),
            'has_api_key': bool(integration and integration.has_api_key),
            # A short SHA-256 prefix, not part of the key. Lets an operator
            # confirm which credential is installed without revealing it.
            'key_fingerprint': integration.key_fingerprint if integration else '',
            'key_set_at': integration.key_set_at if integration else None,
            'key_expires_at': integration.key_expires_at if integration else None,
            'key_expires_in_days': integration.key_expires_in_days if integration else None,
            'expiry_warning_days': Integration.EXPIRY_WARNING_DAYS,
            # MISSING / OK / UNREADABLE — so a rotated VAULT_ENCRYPTION_KEY is
            # reported as itself rather than as an absent credential.
            'credential_state': (
                integration.credential_state if integration
                else Integration.CREDENTIAL_MISSING
            ),
            'last_status': integration.last_status if integration else '',
            'last_message': integration.last_message if integration else '',
            'last_sync_at': integration.last_sync_at if integration else None,
            # Kept when a later run succeeds, so "it works now but it has been
            # flapping" is answerable rather than silently overwritten.
            'last_error': integration.last_error if integration else '',
            'last_error_at': integration.last_error_at if integration else None,
            # Set while a run is waiting for the automation service to pick it
            # up, so the UI can say "queued" instead of looking idle.
            'sync_requested_at': self._pending.get(provider, ''),
        }

    @property
    def _pending(self):
        """{provider: requested_at} for queued runs, fetched once per request."""
        from core import automation_queue

        if not hasattr(self, '_pending_cache'):
            self._pending_cache = {
                provider: automation_queue.pending(command)
                for provider, command in IntegrationTestView.COMMANDS.items()
                if command in IntegrationTestView.QUEUED_COMMANDS
            }
        return self._pending_cache

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

        integration, created = Integration.objects.get_or_create(provider=provider)

        # Captured before mutating, so the audit row can say what changed
        # without ever holding the credential itself.
        was_enabled = integration.is_enabled
        was_base_url = integration.base_url
        previous_fingerprint = integration.key_fingerprint
        changes = {'provider': provider}

        if 'is_enabled' in request.data:
            integration.is_enabled = bool(request.data['is_enabled'])
        if 'base_url' in request.data:
            integration.base_url = (request.data.get('base_url') or '').strip()

        if 'key_expires_at' in request.data:
            raw_expiry = request.data.get('key_expires_at')
            if raw_expiry in (None, ''):
                integration.key_expires_at = None
            else:
                parsed = parse_date(str(raw_expiry))
                if parsed is None:
                    return Response(
                        {'detail': 'key_expires_at must be a date in YYYY-MM-DD form.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                integration.key_expires_at = parsed

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

        # Record the credential change first — it is the one people audit for.
        if integration.key_fingerprint != previous_fingerprint:
            if integration.has_api_key:
                changes['credential'] = 'replaced' if previous_fingerprint else 'set'
                changes['key_fingerprint'] = integration.key_fingerprint
                if previous_fingerprint:
                    changes['previous_key_fingerprint'] = previous_fingerprint
            else:
                changes['credential'] = 'cleared'
                changes['previous_key_fingerprint'] = previous_fingerprint
        if was_enabled != integration.is_enabled:
            changes['is_enabled'] = {'from': was_enabled, 'to': integration.is_enabled}
        if was_base_url != integration.base_url:
            changes['base_url'] = {'from': was_base_url, 'to': integration.base_url}
        if 'key_expires_at' in request.data:
            changes['key_expires_at'] = (
                integration.key_expires_at.isoformat() if integration.key_expires_at else None
            )

        self.log_action('CREATE' if created else 'UPDATE', integration, changes)
        return Response(self._serialize(integration, provider, spec))


class BrexConnectionTestView(AuditLogMixin, APIView):
    """Prove a Brex token is live and report which scopes it was granted.

    Separate from `IntegrationTestView`, which runs a full sync. This only
    reads one record per endpoint, so it answers "is this token any good?"
    in about a second instead of pulling ninety days of charges.

    A key may be supplied in the body to test it *before* saving — otherwise
    there is no way to check a token without first committing it. A key sent
    this way is used in memory and never written.
    """

    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]

    def post(self, request):
        from core import brex

        # get_or_create, matching IntegrationsView.put, so that using a
        # credential always has something to hang an audit row on.
        integration, _ = Integration.objects.get_or_create(provider=brex.PROVIDER)

        candidate = str(request.data.get('api_key') or '').strip()
        base_url = str(request.data.get('base_url') or '').strip()

        if candidate or base_url:
            # A throwaway copy, so an unsaved key cannot reach the database.
            probe = Integration(
                provider=brex.PROVIDER,
                base_url=base_url or integration.base_url,
                encrypted_api_key=integration.encrypted_api_key,
            )
            if candidate:
                probe.set_api_key(candidate)
        else:
            probe = integration

        result = brex.test_connection(probe)

        self.log_action('TEST', integration, {
            'provider': brex.PROVIDER,
            'status': result['status'],
            'latency_ms': result['latency_ms'],
            # Which key was tested, never the key itself.
            'key_fingerprint': probe.key_fingerprint,
            'unsaved_key': bool(candidate),
            'granted_scopes': [s['scope'] for s in result['scopes'] if s['ok']],
            'missing_scopes': [s['scope'] for s in result['scopes'] if not s['ok']],
        })

        # The test itself succeeded even when the answer is "this token is no
        # good", so the HTTP status stays 200 and the payload carries the verdict.
        return Response(result)


class IntegrationTestView(APIView):
    """Run an integration once, on demand, and report what happened."""

    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]

    COMMANDS = {'EXCHANGE_RATES': 'fetch_exchange_rates', 'BREX': 'sync_brex'}
    #: Commands too slow to run inside a request. Everything else is a single
    #: call and finishes well inside a normal response.
    QUEUED_COMMANDS = {'sync_brex'}

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

        # A full sync pages through months of data. Running it inside this
        # request would hold a Gunicorn worker for minutes — with three
        # workers, a couple of clicks takes most of the site down. Hand it to
        # the automation runner and answer immediately.
        if command in self.QUEUED_COMMANDS:
            from core import automation_queue

            requested = automation_queue.request_run(
                command, requested_by=request.user.email
            )
            return Response({
                'ok': True,
                'queued': True,
                'requested_at': requested,
                'poll_seconds': settings.AUTOMATION_POLL_SECONDS,
                'output': (
                    'Sync queued. The automation service picks it up within '
                    f'{settings.AUTOMATION_POLL_SECONDS} seconds; this page '
                    'will update when it finishes.'
                ),
            })

        out, err = StringIO(), StringIO()
        try:
            call_command(command, stdout=out, stderr=err)
        except Exception as exc:  # a provider error must not 500 the page
            return Response(
                {
                    'ok': False,
                    'output': Integration.clean_message(f'{type(exc).__name__}: {exc}'),
                },
                status=status.HTTP_200_OK,
            )
        problem = err.getvalue().strip()
        # A partial run wrote real rows and reported why it is incomplete, so
        # it is neither a green tick nor a failure. Pass the status through and
        # let the UI say so.
        last_status = Integration.objects.filter(
            provider=provider
        ).values_list('last_status', flat=True).first() or ''
        return Response({
            'ok': not problem,
            'status': last_status,
            'output': Integration.clean_message(
                problem or out.getvalue().strip() or 'Completed.'
            ),
        })


def _materialize_group(group):
    """Ensure a group's built-in values exist as editable DB rows, so the admin
    manager can relabel / reorder / hide them. No-op once rows exist."""
    from core.lov import GROUPS, seed_values

    spec = GROUPS.get(group)
    if not spec or ListOfValues.objects.filter(group=group).exists():
        return
    for order, (code, label) in enumerate(seed_values(group)):
        normalized = code.upper() if spec.normalize_code else code
        ListOfValues.objects.get_or_create(
            group=group, code=normalized,
            defaults={'label': label, 'sort_order': order,
                      'is_active': True, 'is_system': not spec.extendable},
        )


class ListOfValuesView(APIView):
    """Admin-managed dropdown values, for populating selects in the UI.

    GET  /api/lov/                 -> every group's effective values
    GET  /api/lov/?group=currency  -> one group
    GET  /api/lov/?group=X&manage=1-> superadmin: raw editable rows + group meta
    POST /api/lov/  {group, code, label, sort_order} -> superadmin: add a value
    """

    def get_permissions(self):
        # Reading powers dropdowns for everyone; writing is superadmin-only.
        if self.request.method == 'GET' and not self.request.query_params.get('manage'):
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsSuperadmin()]

    def get(self, request):
        from core.lov import GROUPS, get_values

        requested = (request.query_params.get('group') or '').strip()

        # Management view: raw rows for one group (or a group listing).
        if request.query_params.get('manage'):
            if not requested:
                return Response({
                    'groups': [
                        {'key': key, 'label': spec.label,
                         'extendable': spec.extendable, 'help_text': spec.help_text}
                        for key, spec in GROUPS.items()
                    ]
                })
            if requested not in GROUPS:
                return Response({'detail': f"Unknown group '{requested}'."}, status=status.HTTP_400_BAD_REQUEST)
            _materialize_group(requested)
            spec = GROUPS[requested]
            rows = ListOfValues.objects.filter(group=requested).order_by('sort_order', 'label')
            return Response({
                'group': requested, 'label': spec.label,
                'extendable': spec.extendable, 'help_text': spec.help_text,
                'values': [{
                    'id': r.id, 'code': r.code, 'label': r.label,
                    'sort_order': r.sort_order, 'is_active': r.is_active,
                    'is_system': r.is_system,
                } for r in rows],
            })

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

    def post(self, request):
        from django.core.exceptions import ValidationError

        group = (request.data.get('group') or '').strip()
        row = ListOfValues(
            group=group,
            code=(request.data.get('code') or '').strip(),
            label=(request.data.get('label') or '').strip(),
            sort_order=request.data.get('sort_order') or 0,
            is_active=True,
        )
        try:
            row.full_clean()
            row.save()
        except ValidationError as exc:
            return Response({'detail': '; '.join(sum(exc.message_dict.values(), []))},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response({'id': row.id, 'code': row.code, 'label': row.label,
                         'sort_order': row.sort_order, 'is_active': row.is_active,
                         'is_system': row.is_system}, status=status.HTTP_201_CREATED)


class ListOfValuesItemView(APIView):
    """Update or remove a single admin-managed value (superadmin only)."""

    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]

    def patch(self, request, pk):
        from django.core.exceptions import ValidationError

        row = ListOfValues.objects.filter(pk=pk).first()
        if not row:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        for field in ('label', 'sort_order', 'is_active', 'code'):
            if field in request.data:
                setattr(row, field, request.data[field])
        try:
            row.full_clean()
            row.save()
        except ValidationError as exc:
            return Response({'detail': '; '.join(sum(exc.message_dict.values(), []))},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response({'id': row.id, 'code': row.code, 'label': row.label,
                         'sort_order': row.sort_order, 'is_active': row.is_active,
                         'is_system': row.is_system})

    def delete(self, request, pk):
        row = ListOfValues.objects.filter(pk=pk).first()
        if not row:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if row.is_system:
            return Response(
                {'detail': 'This value is referenced by application logic — hide it instead of deleting.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SettingsView(APIView):
    """Company-wide display settings.

    Everyone signed in may READ these — currency and company name drive how
    money and headers render on every page — but only a superadmin may write.
    Internal bookkeeping rows (automation run markers) are never exposed.
    """

    # Keys any authenticated user may read. Anything else is superadmin-only,
    # so adding an internal key later does not leak it by default.
    PUBLIC_KEYS = ('company_name', 'company_short_code', 'default_currency', 'fiscal_year_start_month')
    DEFAULTS = {
        'company_name': '',
        'company_short_code': 'IT',
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
