from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import permissions
from django.db.models import Q
from .models import User, Asset, VaultCredential, Expense, RecurringBill
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

        # 3. Vault (Only if user has access)
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

        # 4. Finance
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
