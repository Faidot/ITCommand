from .users import UserSerializer
from rest_framework import serializers
from django.contrib.auth import get_user_model
from core.models import *
from core.encryption import encrypt_value

User = get_user_model()


class FinancialYearSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinancialYear
        fields = '__all__'

class BudgetCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = BudgetCategory
        fields = '__all__'

class IncomeSourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = IncomeSource
        fields = '__all__'

class RecurringIncomeSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    source_name = serializers.CharField(source='source.name', read_only=True)

    class Meta:
        model = RecurringIncome
        fields = '__all__'
        read_only_fields = ['created_by']

class BudgetSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    financial_year_name = serializers.CharField(source='financial_year.name', read_only=True)
    
    class Meta:
        model = Budget
        fields = '__all__'
        read_only_fields = ['created_by']

class ExpenseApprovalLogSerializer(serializers.ModelSerializer):
    by_name = serializers.CharField(source='by.full_name', read_only=True)

    class Meta:
        model = ExpenseApprovalLog
        fields = ['id', 'action', 'by', 'by_name', 'note', 'at']

class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    financial_year_name = serializers.CharField(source='financial_year.name', read_only=True)
    bill_number = serializers.CharField(source='bill.bill_number', read_only=True)
    source_name = serializers.CharField(source='source.name', read_only=True)
    linked_asset_name = serializers.CharField(source='linked_asset.name', read_only=True)
    linked_license_name = serializers.CharField(source='linked_license.product.name', read_only=True)
    linked_pr_number = serializers.CharField(source='linked_purchase_request.pr_number', read_only=True)
    approved_by_name = serializers.CharField(source='approved_by.full_name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    approval_logs = ExpenseApprovalLogSerializer(many=True, read_only=True)
    bill_document_url = serializers.SerializerMethodField()

    class Meta:
        model = Expense
        fields = '__all__'
        read_only_fields = ['created_by', 'status', 'approved_by', 'approved_at']

    def get_bill_document_url(self, obj):
        if not obj.bill or not obj.bill.document:
            return None
        request = self.context.get('request')
        url = obj.bill.document.url
        return request.build_absolute_uri(url) if request else url

class IncomeSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    financial_year_name = serializers.CharField(source='financial_year.name', read_only=True)
    bill_number = serializers.CharField(source='bill.bill_number', read_only=True)
    source_name = serializers.CharField(source='source.name', read_only=True)
    bill_document_url = serializers.SerializerMethodField()

    class Meta:
        model = Income
        fields = '__all__'
        read_only_fields = ['created_by']

    def get_bill_document_url(self, obj):
        if not obj.bill or not obj.bill.document:
            return None
        request = self.context.get('request')
        url = obj.bill.document.url
        return request.build_absolute_uri(url) if request else url

class PettyCashTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PettyCashTransaction
        fields = '__all__'
        read_only_fields = ['created_by']

class DirectPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = DirectPayment
        fields = '__all__'
        read_only_fields = ['created_by']

class RecurringBillSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    
    class Meta:
        model = RecurringBill
        fields = '__all__'
        read_only_fields = ['created_by']

class BillPaymentSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    source_name = serializers.CharField(source='source.name', read_only=True)
    paid_from_display = serializers.CharField(source='get_paid_from_display', read_only=True)

    class Meta:
        model = BillPayment
        fields = '__all__'
        read_only_fields = ['created_by', 'expense']

class BillSerializer(serializers.ModelSerializer):
    document_url = serializers.SerializerMethodField()
    expense_count = serializers.SerializerMethodField()

    class Meta:
        model = Bill
        fields = '__all__'
        read_only_fields = ['uploaded_by', 'uploaded_at']

    def get_document_url(self, obj):
        if not obj.document:
            return None
        request = self.context.get('request')
        url = obj.document.url
        return request.build_absolute_uri(url) if request else url

    def get_expense_count(self, obj):
        return obj.expenses.count()
