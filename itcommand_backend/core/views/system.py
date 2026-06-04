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
from core.permissions import IsSuperadmin, IsAdminOrSuperadmin, IsManagerOrHigher, ReadOnlyViewerOrHigher, VaultAccessPermission, UserManagementPermission
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
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        active_fy = FinancialYear.objects.filter(is_active=True).first()
        
        total_budget = 0
        total_spent = 0
        remaining_budget = 0
        spent_by_category = []
        
        if active_fy:
            budgets = Budget.objects.filter(financial_year=active_fy)
            total_budget = budgets.aggregate(Sum('allocated_amount'))['allocated_amount__sum'] or 0
            
            expenses = Expense.objects.filter(financial_year=active_fy)
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

        return Response({
            'total_budget': float(total_budget),
            'total_spent': float(total_spent),
            'remaining_budget': remaining_budget,
            'spent_by_category': spent_by_category,
            'petty_cash_balance': petty_cash_balance,
            'upcoming_bills': upcoming_bills,
            'recent_expenses': recent_expenses,
        })

class SettingsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsSuperadmin]

    def get(self, request):
        settings = AppSettings.objects.all()
        return Response({s.key: s.value for s in settings})

    def put(self, request):
        for key, value in request.data.items():
            AppSettings.objects.update_or_create(key=key, defaults={'value': value})
        return Response({"status": "success"})

from rest_framework.pagination import PageNumberPagination

class LocationViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Location.objects.all()
    serializer_class = LocationSerializer
    permission_classes = [ReadOnlyViewerOrHigher]

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAdminOrSuperadmin()]
        return super().get_permissions()

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
