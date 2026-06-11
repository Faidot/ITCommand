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
    # When true, approving an expense that would exceed this category's
    # remaining budget is blocked (hard limit) rather than just warned.
    enforce_budget = models.BooleanField(default=False)

    def __str__(self):
        return self.name

class IncomeSource(models.Model):
    """A managed list of funding/income sources, editable in Settings and used
    as a dropdown on Income (and as the fund source on Expenses)."""
    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

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
        ('CASH', 'Cash'),
        ('CHEQUE', 'Cheque'),
        ('ONLINE', 'Online / UPI'),
        ('OTHER', 'Other'),
    )

    STATUS_CHOICES = (
        ('PENDING', 'Pending Approval'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    )

    title = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    expense_date = models.DateField()
    category = models.ForeignKey(BudgetCategory, on_delete=models.SET_NULL, null=True, related_name='expenses')
    financial_year = models.ForeignKey(FinancialYear, on_delete=models.SET_NULL, null=True, related_name='expenses')
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='BANK_TRANSFER')
    paid_to = models.CharField(max_length=255)
    source = models.ForeignKey(IncomeSource, on_delete=models.SET_NULL, null=True, blank=True, related_name='expenses')
    receipt_number = models.CharField(max_length=100, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    bill = models.ForeignKey('Bill', on_delete=models.SET_NULL, null=True, blank=True, related_name='expenses')
    # Optional links to costs originating in other modules
    linked_asset = models.ForeignKey('Asset', on_delete=models.SET_NULL, null=True, blank=True, related_name='expenses')
    linked_license = models.ForeignKey('SoftwareLicense', on_delete=models.SET_NULL, null=True, blank=True, related_name='expenses')
    linked_purchase_request = models.ForeignKey('PurchaseRequest', on_delete=models.SET_NULL, null=True, blank=True, related_name='expenses')
    # Approval workflow — only APPROVED expenses count against the IT budget
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='PENDING')
    approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='approved_expenses')
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, null=True)
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
    # Auto-post: a scheduled job records the payment when due
    auto_post = models.BooleanField(default=False)
    auto_pay_from = models.CharField(max_length=10, choices=(('COMPANY', 'Company'), ('IT', 'IT Budget')), default='COMPANY')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.title} - {self.vendor}"

class BillPayment(models.Model):
    PAID_FROM_CHOICES = (
        ('COMPANY', 'Company Accounts (direct)'),
        ('IT', 'IT Budget'),
    )
    recurring_bill = models.ForeignKey(RecurringBill, on_delete=models.CASCADE, related_name='payments')
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2)
    paid_date = models.DateField()
    paid_from = models.CharField(max_length=10, choices=PAID_FROM_CHOICES, default='IT')
    # Only used when paid_from == 'IT'
    category = models.ForeignKey(BudgetCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name='bill_payments')
    source = models.ForeignKey(IncomeSource, on_delete=models.SET_NULL, null=True, blank=True, related_name='bill_payments')
    expense = models.ForeignKey('Expense', on_delete=models.SET_NULL, null=True, blank=True, related_name='bill_payments')
    reference = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Payment for {self.recurring_bill.title} on {self.paid_date}"

class Income(models.Model):
    """Money coming in. The income counterpart to Expense; supports an
    optional receipt/document via the shared Bill container."""
    PAYMENT_METHOD_CHOICES = (
        ('BANK_TRANSFER', 'Bank Transfer'),
        ('CASH', 'Cash'),
        ('CARD', 'Card'),
        ('CHEQUE', 'Cheque'),
        ('OTHER', 'Other'),
    )

    title = models.CharField(max_length=255)
    source = models.ForeignKey(IncomeSource, on_delete=models.SET_NULL, null=True, blank=True, related_name='incomes')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    income_date = models.DateField()
    category = models.ForeignKey(BudgetCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name='incomes')
    financial_year = models.ForeignKey(FinancialYear, on_delete=models.SET_NULL, null=True, blank=True, related_name='incomes')
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default='BANK_TRANSFER')
    reference = models.CharField(max_length=100, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    bill = models.ForeignKey('Bill', on_delete=models.SET_NULL, null=True, blank=True, related_name='incomes')
    recurring = models.ForeignKey('RecurringIncome', on_delete=models.SET_NULL, null=True, blank=True, related_name='received')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-income_date', '-created_at']

    def __str__(self):
        return f"{self.title} - ${self.amount}"

class ExpenseApprovalLog(models.Model):
    """Audit trail of an expense's approval lifecycle."""
    ACTION_CHOICES = (
        ('SUBMITTED', 'Submitted'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
    )
    expense = models.ForeignKey('Expense', on_delete=models.CASCADE, related_name='approval_logs')
    action = models.CharField(max_length=10, choices=ACTION_CHOICES)
    by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    note = models.TextField(blank=True)
    at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['at']

    def __str__(self):
        return f"{self.action} on expense {self.expense_id}"

class RecurringIncome(models.Model):
    """Scheduled, predictable inflows (e.g. monthly department recharge). The
    income counterpart to RecurringBill; 'receiving' it creates an Income."""
    FREQUENCY_CHOICES = (
        ('MONTHLY', 'Monthly'),
        ('QUARTERLY', 'Quarterly'),
        ('YEARLY', 'Yearly'),
    )
    title = models.CharField(max_length=255)
    source = models.ForeignKey(IncomeSource, on_delete=models.SET_NULL, null=True, blank=True, related_name='recurring_incomes')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default='MONTHLY')
    next_date = models.DateField()
    category = models.ForeignKey(BudgetCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name='recurring_incomes')
    financial_year = models.ForeignKey(FinancialYear, on_delete=models.SET_NULL, null=True, blank=True, related_name='recurring_incomes')
    payment_method = models.CharField(max_length=20, default='BANK_TRANSFER')
    notes = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    auto_post = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['next_date']

    def __str__(self):
        return f"{self.title} ({self.frequency})"

class Bill(models.Model):
    """An uploaded bill/invoice document. One uploaded bill can back multiple
    expense entries (one-bill-multi-entry); the expenses link to it via
    Expense.bill."""
    document = models.FileField(upload_to='bills/%Y/%m/', null=True, blank=True)
    bill_number = models.CharField(max_length=100, blank=True)
    bill_date = models.DateField(null=True, blank=True)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='uploaded_bills')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return self.bill_number or f"Bill #{self.pk}"

# --- SETTINGS & AUDIT MODELS ---
