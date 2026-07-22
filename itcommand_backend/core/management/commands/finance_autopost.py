"""Auto-post due recurring finance items.

Run on a schedule (e.g. daily cron):
    python manage.py finance_autopost

Processes only items flagged auto_post=True:
  * RecurringIncome → creates Income entries and advances next_date.
  * RecurringBill   → records a BillPayment (and an Expense when paid from IT)
                      and advances next_due_date.
"""
import calendar
from datetime import date

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from core.models import (
    RecurringIncome, RecurringBill, Income, Expense, BillPayment,
    FinancialYear, Notification, User,
)

FREQ_MONTHS = {'MONTHLY': 1, 'QUARTERLY': 3, 'YEARLY': 12}


def advance_schedule(value: date, frequency: str) -> date:
    """Advance a schedule by calendar months, clamping short months safely."""
    months = FREQ_MONTHS.get(frequency, 1)
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


class Command(BaseCommand):
    help = "Auto-post due recurring income and bills (items flagged auto_post)."

    def handle(self, *args, **options):
        today = timezone.localdate()
        active_fy = FinancialYear.objects.filter(is_active=True).first()
        income_count = 0
        bill_count = 0

        # --- Recurring income ---
        income_ids = RecurringIncome.objects.filter(
            auto_post=True, is_active=True, next_date__lte=today,
        ).values_list('id', flat=True)
        for income_id in income_ids:
            with transaction.atomic():
                ri = RecurringIncome.objects.select_for_update().get(pk=income_id)
                guard = 0
                while ri.next_date <= today and guard < 60:
                    Income.objects.create(
                        title=ri.title, source=ri.source, amount=ri.amount, income_date=ri.next_date,
                        category=ri.category, financial_year=ri.financial_year or active_fy,
                        payment_method=ri.payment_method or 'BANK_TRANSFER',
                        description=f"Auto-posted from scheduled income '{ri.title}'.",
                        recurring=ri,
                    )
                    ri.next_date = advance_schedule(ri.next_date, ri.frequency)
                    income_count += 1
                    guard += 1
                ri.save(update_fields=['next_date'])

        # --- Recurring bills ---
        bill_ids = RecurringBill.objects.filter(
            auto_post=True, is_active=True, next_due_date__lte=today,
        ).values_list('id', flat=True)
        for bill_id in bill_ids:
            with transaction.atomic():
                bill = RecurringBill.objects.select_for_update().get(pk=bill_id)
                guard = 0
                while bill.next_due_date <= today and guard < 60:
                    expense = None
                    if bill.auto_pay_from == 'IT':
                        method = bill.payment_method if bill.payment_method in dict(Expense.PAYMENT_METHOD_CHOICES) else 'BANK_TRANSFER'
                        expense = Expense.objects.create(
                            title=f"Bill payment: {bill.title}", amount=bill.amount, expense_date=bill.next_due_date,
                            category=bill.category, financial_year=active_fy, payment_method=method,
                            paid_to=bill.title, description=f"Auto-posted from recurring bill '{bill.title}'.",
                            status='APPROVED',
                        )
                    BillPayment.objects.create(
                        recurring_bill=bill, amount_paid=bill.amount, paid_date=bill.next_due_date,
                        paid_from=bill.auto_pay_from, category=bill.category, expense=expense,
                        reference='auto-post',
                    )
                    bill.next_due_date = advance_schedule(bill.next_due_date, bill.frequency)
                    bill_count += 1
                    guard += 1
                bill.save(update_fields=['next_due_date'])

        if income_count or bill_count:
            for u in User.objects.filter(role__in=['MANAGER', 'ADMIN', 'SUPERADMIN'], is_active=True):
                Notification.objects.create(
                    user=u, notification_type='BUDGET',
                    message=f"Auto-post: {income_count} income and {bill_count} bill payment(s) recorded.",
                    link='/finance/recurring-bills',
                )

        self.stdout.write(self.style.SUCCESS(f"Auto-posted {income_count} income and {bill_count} bill payment(s)."))
