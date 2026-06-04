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

class BudgetSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    financial_year_name = serializers.CharField(source='financial_year.name', read_only=True)
    
    class Meta:
        model = Budget
        fields = '__all__'
        read_only_fields = ['created_by']

class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    financial_year_name = serializers.CharField(source='financial_year.name', read_only=True)
    
    class Meta:
        model = Expense
        fields = '__all__'
        read_only_fields = ['created_by']

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
    class Meta:
        model = BillPayment
        fields = '__all__'
        read_only_fields = ['created_by']
