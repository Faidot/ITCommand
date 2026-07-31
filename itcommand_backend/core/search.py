from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import permissions
from django.db.models import Q
from .models import (
    User, Asset, VaultCredential, Expense, RecurringBill,
    Property, ProviderAccount, Service,
)
from .permissions import has_role_permission

class GlobalSearchView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        if len(query) < 2:
            return Response([])

        results = []

        # 1. Users
        if has_role_permission(request.user, 'users', 'view'):
            users = User.objects.filter(
                Q(full_name__icontains=query) | Q(email__icontains=query)
            )[:5]
            for u in users:
                results.append({
                    'id': u.id,
                    'title': u.get_full_name() or u.email,
                    'subtitle': u.email,
                    'category': 'Users',
                    'link': '/users'
                })

        # 2. Assets
        if has_role_permission(request.user, 'assets', 'view'):
            assets = Asset.objects.filter(
                Q(name__icontains=query) | Q(asset_tag__icontains=query)
            )[:5]
            for a in assets:
                results.append({
                    'id': a.id,
                    'title': a.name,
                    'subtitle': a.asset_tag,
                    'category': 'Assets',
                    'link': '/assets'
                })

        # 3. Digital Estate — properties, accounts, services
        #
        # Added here rather than as a second ⌘K palette inside /estate. The
        # top bar already binds ⌘K globally; a second binding meant two
        # dialogs opened on one keypress, and a search that only worked on
        # one route group is a worse answer than one that works everywhere.
        if has_role_permission(request.user, 'estate', 'view'):
            for prop in Property.objects.filter(name__icontains=query)[:5]:
                results.append({
                    'id': prop.id,
                    'title': prop.name,
                    'subtitle': prop.get_kind_display(),
                    'category': 'Properties',
                    'link': f'/estate/properties/{prop.id}',
                })

            accounts = ProviderAccount.objects.filter(
                Q(account_email__icontains=query) | Q(provider__name__icontains=query)
            ).select_related('provider')[:5]
            for account in accounts:
                results.append({
                    'id': account.id,
                    'title': account.account_email,
                    'subtitle': f'{account.provider.name} · {account.get_mfa_type_display()}',
                    'category': 'Provider accounts',
                    'link': f'/estate/accounts?q={account.account_email}',
                })

            services = Service.objects.filter(
                Q(identifier__icontains=query) | Q(provider__name__icontains=query)
            ).select_related('provider', 'property')[:5]
            for service in services:
                results.append({
                    'id': service.id,
                    'title': service.identifier,
                    'subtitle': (
                        f'{service.get_service_type_display()} · '
                        f'{service.property.name if service.property_id else "unattached"}'
                    ),
                    'category': 'Services',
                    'link': f'/estate/services?q={service.identifier}',
                })

        # 4. Vault (Only if user has access)
        if has_role_permission(request.user, 'vault', 'view'):
            vaults = VaultCredential.objects.filter(
                Q(visibility='ORG') | Q(created_by=request.user),
                title__icontains=query,
            )[:5]
            for v in vaults:
                results.append({
                    'id': v.id,
                    'title': v.title,
                    'subtitle': v.username or 'No username',
                    'category': 'Vault',
                    'link': '/vault/passwords'
                })

        # 5. Finance
        if has_role_permission(request.user, 'finance', 'view'):
            expenses = Expense.objects.filter(
                Q(title__icontains=query) | Q(paid_to__icontains=query)
            )[:5]
            for e in expenses:
                results.append({
                    'id': e.id,
                    'title': e.title,
                    'subtitle': f"Paid to {e.paid_to} - ${e.amount}",
                    'category': 'Finance',
                    'link': '/finance/expenses'
                })

            bills = RecurringBill.objects.select_related('vendor').filter(
                Q(title__icontains=query) | Q(vendor__name__icontains=query)
            )[:5]
            for b in bills:
                results.append({
                    'id': b.id,
                    'title': b.title,
                    'subtitle': f"Vendor: {b.vendor.name if b.vendor else '—'} - ${b.amount}",
                    'category': 'Finance',
                    'link': '/finance/bills'
                })

        return Response(results)
