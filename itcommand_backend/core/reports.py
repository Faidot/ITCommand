import openpyxl
from openpyxl.utils import get_column_letter
from django.db.models import Sum, Count, Q
from django.utils import timezone
from datetime import timedelta
from rest_framework.views import APIView
from rest_framework.response import Response
from django.http import HttpResponse
from .models import (
    User, Asset, Expense, FinancialYear, Budget, BudgetCategory, PettyCashTransaction,
    DirectPayment, RecurringBill, AssetHistory
)
from .permissions import IsAdminOrSuperadmin

class FinancialSummaryView(APIView):
    permission_classes = [IsAdminOrSuperadmin]

    def get(self, request):
        today = timezone.now().date()
        active_fy = FinancialYear.objects.filter(is_active=True).first()
        
        # Budget utilization per category
        budget_utilization = []
        if active_fy:
            budgets = Budget.objects.filter(financial_year=active_fy)
            expenses = Expense.objects.filter(financial_year=active_fy)
            for b in budgets:
                spent = expenses.filter(category=b.category).aggregate(Sum('amount'))['amount__sum'] or 0
                allocated = b.allocated_amount
                budget_utilization.append({
                    'category': b.category.name,
                    'allocated': float(allocated),
                    'spent': float(spent),
                    'remaining': float(allocated - spent),
                    'percentage': float((spent / allocated * 100) if allocated > 0 else 0)
                })

        # Monthly expense breakdown (last 12 months)
        monthly_expenses = []
        for i in range(11, -1, -1):
            target_month = today.replace(day=1) - timedelta(days=i*30)
            target_month = target_month.replace(day=1) # approximate
            start_date = target_month
            if target_month.month == 12:
                end_date = target_month.replace(year=target_month.year+1, month=1)
            else:
                end_date = target_month.replace(month=target_month.month+1)
            
            amount = Expense.objects.filter(expense_date__gte=start_date, expense_date__lt=end_date).aggregate(Sum('amount'))['amount__sum'] or 0
            monthly_expenses.append({
                'month': start_date.strftime('%b %Y'),
                'amount': float(amount)
            })

        # Top 5 expense categories
        top_categories = Expense.objects.values('category__name').annotate(total=Sum('amount')).order_by('-total')[:5]
        top_5_categories = [{'name': c['category__name'] or 'Uncategorized', 'value': float(c['total'])} for c in top_categories]

        # Petty cash summary
        pc_topups = PettyCashTransaction.objects.filter(transaction_type='TOPUP').aggregate(Sum('amount'))['amount__sum'] or 0
        pc_expenses = PettyCashTransaction.objects.filter(transaction_type='EXPENSE').aggregate(Sum('amount'))['amount__sum'] or 0
        petty_cash_summary = {
            'balance': float(pc_topups - pc_expenses),
            'total_in': float(pc_topups),
            'total_out': float(pc_expenses)
        }

        # Direct payments total
        direct_payments_total = DirectPayment.objects.aggregate(Sum('amount'))['amount__sum'] or 0

        # Recurring bills monthly commitment
        monthly_commitment = RecurringBill.objects.filter(is_active=True).aggregate(Sum('amount'))['amount__sum'] or 0

        return Response({
            'budget_utilization': budget_utilization,
            'monthly_expenses': monthly_expenses,
            'top_categories': top_5_categories,
            'petty_cash': petty_cash_summary,
            'direct_payments_total': float(direct_payments_total),
            'monthly_commitment': float(monthly_commitment)
        })

class AssetSummaryView(APIView):
    permission_classes = [IsAdminOrSuperadmin]

    def get(self, request):
        today = timezone.now().date()
        
        # Assets by status
        statuses = Asset.objects.values('status').annotate(count=Count('id'))
        assets_by_status = [{'name': s['status'], 'value': s['count']} for s in statuses]

        # Assets by category
        categories = Asset.objects.values('category__name').annotate(count=Count('id'))
        assets_by_category = [{'name': c['category__name'], 'count': c['count']} for c in categories]

        # Recently assigned (last 30 days)
        thirty_days_ago = today - timedelta(days=30)
        recent_assignments = AssetHistory.objects.filter(action='ASSIGNED', timestamp__date__gte=thirty_days_ago).order_by('-timestamp')[:10]
        recently_assigned = [{
            'asset': a.asset.name,
            'tag': a.asset.asset_tag,
            'to_user': a.to_user.get_full_name() if a.to_user else 'Unknown',
            'date': a.timestamp.strftime('%Y-%m-%d')
        } for a in recent_assignments]

        # Expiring warranty (next 60 days)
        sixty_days = today + timedelta(days=60)
        expiring = Asset.objects.filter(warranty_expiry__gte=today, warranty_expiry__lte=sixty_days).order_by('warranty_expiry')
        expiring_warranties = [{
            'name': a.name,
            'tag': a.asset_tag,
            'warranty_date': a.warranty_expiry.strftime('%Y-%m-%d'),
            'days_remaining': (a.warranty_expiry - today).days
        } for a in expiring]

        # Total asset value by category
        value_by_category = Asset.objects.values('category__name').annotate(total=Sum('purchase_price'))
        total_value_by_category = [{'category': v['category__name'], 'value': float(v['total'] or 0)} for v in value_by_category]

        total_assets = Asset.objects.count()
        total_value = Asset.objects.aggregate(Sum('purchase_price'))['purchase_price__sum'] or 0
        assigned_count = Asset.objects.filter(status='ASSIGNED').count()
        assigned_percentage = (assigned_count / total_assets * 100) if total_assets > 0 else 0

        return Response({
            'total_assets': total_assets,
            'total_value': float(total_value),
            'assigned_percentage': float(assigned_percentage),
            'assets_by_status': assets_by_status,
            'assets_by_category': assets_by_category,
            'recently_assigned': recently_assigned,
            'expiring_warranties': expiring_warranties,
            'total_value_by_category': total_value_by_category
        })

class ExportFinancialView(APIView):
    permission_classes = [IsAdminOrSuperadmin]

    def get(self, request):
        expenses = Expense.objects.all().order_by('-expense_date')
        
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Expenses"

        headers = ['Date', 'Title', 'Category', 'Financial Year', 'Payment Method', 'Paid To', 'Receipt Number', 'Amount']
        ws.append(headers)

        for e in expenses:
            ws.append([
                e.expense_date.strftime('%Y-%m-%d') if e.expense_date else '',
                e.title,
                e.category.name if e.category else '',
                e.financial_year.name if e.financial_year else '',
                e.payment_method,
                e.paid_to,
                e.receipt_number,
                float(e.amount)
            ])

        response = HttpResponse(content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response['Content-Disposition'] = 'attachment; filename=financial_export.xlsx'
        wb.save(response)
        return response

class ExportAssetsView(APIView):
    permission_classes = [IsAdminOrSuperadmin]

    def get(self, request):
        assets = Asset.objects.all().order_by('asset_tag')
        
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Assets"

        headers = ['Asset Tag', 'Name', 'Category', 'Type', 'Brand', 'Model', 'Status', 'Condition', 'Purchase Price', 'Warranty Expiry', 'Assigned To', 'Location']
        ws.append(headers)

        for a in assets:
            ws.append([
                a.asset_tag,
                a.name,
                a.category.name if a.category else '',
                a.asset_type,
                a.brand,
                a.model,
                a.status,
                a.condition,
                float(a.purchase_price) if a.purchase_price else 0,
                a.warranty_expiry.strftime('%Y-%m-%d') if a.warranty_expiry else '',
                a.assigned_to.email if a.assigned_to else '',
                a.location
            ])

        response = HttpResponse(content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response['Content-Disposition'] = 'attachment; filename=assets_export.xlsx'
        wb.save(response)
        return response

class MainDashboardView(APIView):
    permission_classes = [IsAdminOrSuperadmin]

    def get(self, request):
        today = timezone.now().date()
        
        total_users = User.objects.count()
        total_assets = Asset.objects.count()
        
        active_fy = FinancialYear.objects.filter(is_active=True).first()
        budget_used_pct = 0
        if active_fy:
            total_budget = Budget.objects.filter(financial_year=active_fy).aggregate(Sum('allocated_amount'))['allocated_amount__sum'] or 0
            total_spent = Expense.objects.filter(financial_year=active_fy).aggregate(Sum('amount'))['amount__sum'] or 0
            if total_budget > 0:
                budget_used_pct = (total_spent / total_budget) * 100

        seven_days = today + timedelta(days=7)
        upcoming_bills_count = RecurringBill.objects.filter(is_active=True, next_due_date__gte=today, next_due_date__lte=seven_days).count()

        monthly_expenses = []
        for i in range(5, -1, -1):
            target_month = today.replace(day=1) - timedelta(days=i*30)
            target_month = target_month.replace(day=1)
            start_date = target_month
            if target_month.month == 12:
                end_date = target_month.replace(year=target_month.year+1, month=1)
            else:
                end_date = target_month.replace(month=target_month.month+1)
            
            amount = Expense.objects.filter(expense_date__gte=start_date, expense_date__lt=end_date).aggregate(Sum('amount'))['amount__sum'] or 0
            monthly_expenses.append({
                'month': start_date.strftime('%b'),
                'amount': float(amount)
            })

        recent_activity = []
        expenses = Expense.objects.all().order_by('-created_at')[:10]
        for e in expenses:
            recent_activity.append({
                'type': 'EXPENSE',
                'title': f"Expense: {e.title}",
                'amount': float(e.amount),
                'date': e.created_at
            })
            
        assignments = AssetHistory.objects.filter(action='ASSIGNED').order_by('-timestamp')[:5]
        for a in assignments:
            recent_activity.append({
                'type': 'ASSET',
                'title': f"Asset Assigned: {a.asset.name} to {a.to_user.get_full_name() if a.to_user else 'Unknown'}",
                'amount': None,
                'date': a.timestamp
            })
            
        recent_activity.sort(key=lambda x: x['date'], reverse=True)
        # Format dates
        for r in recent_activity:
            r['date'] = r['date'].strftime('%Y-%m-%d %H:%M')

        return Response({
            'total_users': total_users,
            'total_assets': total_assets,
            'budget_used_pct': float(budget_used_pct),
            'upcoming_bills_count': upcoming_bills_count,
            'monthly_expenses': monthly_expenses,
            'recent_activity': recent_activity[:10]
        })
