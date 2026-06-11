"""Email a monthly IT finance summary to admins.

Run monthly via cron:
    python manage.py email_finance_report

Requires EMAIL_* settings to be configured (SMTP). With Django's default
console backend the report is printed to stdout instead of sent.
"""
from datetime import date
from django.core.management.base import BaseCommand
from django.core.mail import send_mail
from django.conf import settings
from django.db.models import Sum
from core.models import FinancialYear, Budget, Expense, Income, RecurringBill, User


class Command(BaseCommand):
    help = "Email a monthly finance summary to admins/superadmins."

    def handle(self, *args, **options):
        today = date.today()
        m_start = date(today.year, today.month, 1)
        active_fy = FinancialYear.objects.filter(is_active=True).first()

        def s(qs, f='amount'):
            return float(qs.aggregate(x=Sum(f))['x'] or 0)

        budget = s(Budget.objects.filter(financial_year=active_fy), 'allocated_amount') if active_fy else 0
        spent = s(Expense.objects.filter(financial_year=active_fy, status='APPROVED')) if active_fy else 0
        month_income = s(Income.objects.filter(income_date__gte=m_start))
        month_expense = s(Expense.objects.filter(status='APPROVED', expense_date__gte=m_start))
        pending = Expense.objects.filter(status='PENDING').count()
        upcoming = RecurringBill.objects.filter(is_active=True, next_due_date__gte=today).count()

        body = (
            f"IT Finance Summary — {today:%B %Y}\n"
            f"{'=' * 40}\n"
            f"Financial year:       {active_fy.name if active_fy else 'n/a'}\n"
            f"Budget allocated:     ${budget:,.2f}\n"
            f"Approved spend (YTD): ${spent:,.2f}\n"
            f"Remaining budget:     ${budget - spent:,.2f}\n\n"
            f"This month income:    ${month_income:,.2f}\n"
            f"This month expense:   ${month_expense:,.2f}\n"
            f"Net this month:       ${month_income - month_expense:,.2f}\n\n"
            f"Pending approvals:    {pending}\n"
            f"Upcoming bills:       {upcoming}\n"
        )

        recipients = list(User.objects.filter(role__in=['ADMIN', 'SUPERADMIN'], is_active=True)
                          .exclude(email='').values_list('email', flat=True))
        if not recipients:
            self.stdout.write(self.style.WARNING("No admin recipients with an email address."))
            self.stdout.write(body)
            return

        from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', 'it-finance@localhost')
        send_mail(f"IT Finance Summary — {today:%B %Y}", body, from_email, recipients, fail_silently=True)
        self.stdout.write(self.style.SUCCESS(f"Finance report sent to {len(recipients)} recipient(s)."))
        self.stdout.write(body)
