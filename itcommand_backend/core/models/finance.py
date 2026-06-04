from .assets import AssetCategory
from .users import User, Department
from .vendors import Vendor
from django.db import models
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from core.encryption import encrypt_value, decrypt_value


class FinancialYear(models.Model):
    name = models.CharField(max_length=50) # e.g. "FY 2024-25"
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=False)

    def __str__(self):
        return self.name

class BudgetCategory(models.Model):
    name = models.CharField(max_length=100) # e.g. Hardware, Software
    description = models.TextField(blank=True, null=True)

    def __str__(self):
        return self.name

class Budget(models.Model):
    financial_year = models.ForeignKey(FinancialYear, on_delete=models.CASCADE, related_name='budgets')
    category = models.ForeignKey(BudgetCategory, on_delete=models.CASCADE, related_name='budgets')
    allocated_amount = models.DecimalField(max_digits=12, decimal_places=2)
    notes = models.TextField(blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('financial_year', 'category')

    def __str__(self):
        return f"{self.category.name} ({self.financial_year.name})"

class Expense(models.Model):
    PAYMENT_METHOD_CHOICES = (
        ('PETTY_CASH', 'Petty Cash'),
        ('BANK_TRANSFER', 'Bank Transfer'),
        ('CARD', 'Card'),
        ('CHEQUE', 'Cheque'),
        ('OTHER', 'Other'),
    )

    title = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    expense_date = models.DateField()
    category = models.ForeignKey(BudgetCategory, on_delete=models.SET_NULL, null=True, related_name='expenses')
    financial_year = models.ForeignKey(FinancialYear, on_delete=models.SET_NULL, null=True, related_name='expenses')
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='BANK_TRANSFER')
    paid_to = models.CharField(max_length=255)
    receipt_number = models.CharField(max_length=100, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} - ${self.amount}"

class PettyCashTransaction(models.Model):
    TRANSACTION_TYPE_CHOICES = (
        ('TOPUP', 'Top-Up'),
        ('EXPENSE', 'Expense'),
    )

    transaction_type = models.CharField(max_length=10, choices=TRANSACTION_TYPE_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    description = models.TextField()
    date = models.DateField()
    reference = models.CharField(max_length=100, blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.transaction_type} - ${self.amount}"

class DirectPayment(models.Model):
    PAYMENT_METHOD_CHOICES = (
        ('BANK_TRANSFER', 'Bank Transfer'),
        ('CHEQUE', 'Cheque'),
        ('CARD', 'Card'),
        ('OTHER', 'Other'),
    )
    title = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_date = models.DateField()
    paid_to = models.CharField(max_length=255)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='BANK_TRANSFER')
    bank_reference = models.CharField(max_length=100, blank=True, null=True)
    account_name = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} to {self.paid_to}"

class RecurringBill(models.Model):
    FREQUENCY_CHOICES = (
        ('MONTHLY', 'Monthly'),
        ('QUARTERLY', 'Quarterly'),
        ('YEARLY', 'Yearly'),
    )
    title = models.CharField(max_length=255)
    vendor = models.ForeignKey(Vendor, on_delete=models.SET_NULL, null=True, blank=True, related_name='recurring_bills')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default='MONTHLY')
    next_due_date = models.DateField()
    category = models.ForeignKey(BudgetCategory, on_delete=models.SET_NULL, null=True)
    payment_method = models.CharField(max_length=50, blank=True)
    notes = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} - {self.vendor}"

class BillPayment(models.Model):
    recurring_bill = models.ForeignKey(RecurringBill, on_delete=models.CASCADE, related_name='payments')
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2)
    paid_date = models.DateField()
    reference = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Payment for {self.recurring_bill.title} on {self.paid_date}"

# --- SETTINGS & AUDIT MODELS ---
