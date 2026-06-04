from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate
from django.utils import timezone
from datetime import timedelta
import random
import string
from core.models import *
from core.serializers import *
from core.encryption import decrypt_value
from core.mixins import AuditLogMixin
from core.permissions import IsSuperadmin, IsAdminOrSuperadmin, IsManagerOrHigher, ReadOnlyViewerOrHigher, VaultAccessPermission, UserManagementPermission
from rest_framework.pagination import PageNumberPagination


class FinancialYearViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = FinancialYear.objects.all().order_by('-start_date')
    serializer_class = FinancialYearSerializer
    permission_classes = [ReadOnlyViewerOrHigher]

class BudgetCategoryViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = BudgetCategory.objects.all()
    serializer_class = BudgetCategorySerializer
    permission_classes = [ReadOnlyViewerOrHigher]

class BudgetViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Budget.objects.all()
    serializer_class = BudgetSerializer
    permission_classes = [ReadOnlyViewerOrHigher]

    def get_queryset(self):
        queryset = super().get_queryset()
        fy = self.request.query_params.get('financial_year', None)
        if fy:
            queryset = queryset.filter(financial_year_id=fy)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

class ExpenseViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Expense.objects.all().order_by('-expense_date', '-created_at')
    serializer_class = ExpenseSerializer
    permission_classes = [ReadOnlyViewerOrHigher]

    def get_queryset(self):
        queryset = super().get_queryset()
        category = self.request.query_params.get('category', None)
        if category:
            queryset = queryset.filter(category_id=category)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

class PettyCashTransactionViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = PettyCashTransaction.objects.all().order_by('-date', '-created_at')
    serializer_class = PettyCashTransactionSerializer
    permission_classes = [ReadOnlyViewerOrHigher]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

class DirectPaymentViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = DirectPayment.objects.all().order_by('-payment_date', '-created_at')
    serializer_class = DirectPaymentSerializer
    permission_classes = [ReadOnlyViewerOrHigher]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

class RecurringBillViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = RecurringBill.objects.all().order_by('next_due_date')
    serializer_class = RecurringBillSerializer
    permission_classes = [ReadOnlyViewerOrHigher]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

class BillPaymentViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = BillPayment.objects.all().order_by('-paid_date')
    serializer_class = BillPaymentSerializer
    permission_classes = [ReadOnlyViewerOrHigher]

    def perform_create(self, serializer):
        payment = serializer.save(created_by=self.request.user)
        # Update next due date of recurring bill
        bill = payment.recurring_bill
        if bill.frequency == 'MONTHLY':
            bill.next_due_date = bill.next_due_date + timedelta(days=30)
        elif bill.frequency == 'QUARTERLY':
            bill.next_due_date = bill.next_due_date + timedelta(days=90)
        elif bill.frequency == 'YEARLY':
            bill.next_due_date = bill.next_due_date + timedelta(days=365)
        bill.save()
