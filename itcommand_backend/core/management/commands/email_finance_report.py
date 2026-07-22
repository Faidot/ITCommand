"""Email a monthly IT finance summary to admins.

Run monthly via cron:
    python manage.py email_finance_report

Requires EMAIL_* settings to be configured. Local development defaults to the
console backend; production defaults to SMTP.
"""
from datetime import date
from django.core.management.base import BaseCommand, CommandError
from django.core.mail import send_mail
from django.conf import settings
from django.db.models import Sum
from core.models import FinancialYear, Budget, Expense, Income, RecurringBill, User
from core.app_settings import company_name, format_money


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

        org = company_name()
        heading = f"{org} — IT Finance Summary" if org else "IT Finance Summary"
        body = (
            f"{heading} — {today:%B %Y}\n"
            f"{'=' * 40}\n"
            f"Financial year:       {active_fy.name if active_fy else 'n/a'}\n"
            f"Budget allocated:     {format_money(budget)}\n"
            f"Approved spend (YTD): {format_money(spent)}\n"
            f"Remaining budget:     {format_money(budget - spent)}\n\n"
            f"This month income:    {format_money(month_income)}\n"
            f"This month expense:   {format_money(month_expense)}\n"
            f"Net this month:       {format_money(month_income - month_expense)}\n\n"
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
        try:
            sent = send_mail(
                f"IT Finance Summary — {today:%B %Y}",
                body,
                from_email,
                recipients,
                fail_silently=False,
            )
        except Exception as exc:
            raise CommandError(f"Finance report delivery failed: {exc}") from exc

        if sent != 1:
            raise CommandError(
                f"Finance report backend reported {sent} delivered message(s); expected 1."
            )

        self.stdout.write(self.style.SUCCESS(
            f"Finance report delivered to {len(recipients)} recipient(s)."
        ))
        self.stdout.write(body)
