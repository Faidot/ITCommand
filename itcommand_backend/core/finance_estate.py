"""Where subscription spend meets the finance ledger.

Three rules shape this module, and all three exist because writing into a
finance table is the highest-consequence thing this codebase does.

**Nothing is booked without being asked.** Expense creation on renewal is off by
default (`SubscriptionSettings.create_expense_on_renewal`) and, when on, creates
a PENDING expense. Budget consumption counts APPROVED only, so a human still
decides before any number moves.

**Nothing is guessed.** No budget category, no active financial year, or no
exchange rate for a foreign currency means the expense is *skipped with a
reason*, never created with an assumed value. `attempt_renewal_expense` returns
that reason so the caller can surface it.

**Committed is never added to booked.** A subscription that renews yearly is a
commitment; the expense raised when it renews is booked spend. Summing them
double-counts. They are reported as separate figures and the caller is left to
present both — see `budget_impact`.
"""

from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Q, Sum
from django.utils import timezone


TWOPLACES = Decimal("0.01")
ZERO = Decimal("0")


def _money(value):
    return str(Decimal(value or 0).quantize(TWOPLACES, rounding=ROUND_HALF_UP))


def _company_currency():
    from core.app_settings import default_currency

    return default_currency()


# ─────────────────────────── expense attribution ───────────────────────────

#: Why an expense was not raised. Returned rather than raised: a renewal must
#: still succeed when the finance side cannot be completed.
SKIP_DISABLED = "disabled"
SKIP_NO_CATEGORY = "no_budget_category"
SKIP_NO_FINANCIAL_YEAR = "no_active_financial_year"
SKIP_NO_RATE = "no_exchange_rate"
SKIP_ALREADY_BOOKED = "already_booked"

SKIP_REASONS = {
    SKIP_DISABLED: "Expense creation on renewal is switched off in Subscription settings.",
    SKIP_NO_CATEGORY: "This subscription has no budget category, so there is nothing to book it against.",
    SKIP_NO_FINANCIAL_YEAR: "No financial year is active, so there is no period to book into.",
    SKIP_NO_RATE: "No exchange rate for this subscription's currency, so the amount cannot be stated in the company currency.",
    SKIP_ALREADY_BOOKED: "An expense for this renewal already exists.",
}


def renewal_expense_amount(subscription, *, on_date=None):
    """(amount_in_company_currency, currency) or (None, reason).

    A foreign-currency subscription is converted with the same FX path the rest
    of the app uses, which returns None rather than assuming 1:1 when no rate
    exists. Booking a USD 500 renewal as PKR 500 would be worse than not booking
    it at all.
    """
    from core.fx import convert

    company = _company_currency()
    if (subscription.currency or "").upper() == company.upper():
        return Decimal(subscription.cost or 0), company

    converted = convert(
        subscription.cost, subscription.currency, to_currency=company, on_date=on_date
    )
    if converted is None:
        return None, SKIP_NO_RATE
    return converted, company


def attempt_renewal_expense(subscription, renewal, *, actor=None):
    """Raise a PENDING expense for a renewal, or explain why not.

    Returns ``(expense_or_None, reason_or_None)``. Never raises on a finance
    problem — a renewal that succeeded must not be rolled back because the
    ledger side could not be completed.
    """
    from core.models import Expense, FinancialYear, SubscriptionSettings

    settings = SubscriptionSettings.get_solo()
    if not settings.create_expense_on_renewal:
        return None, SKIP_DISABLED
    if not subscription.budget_category_id:
        return None, SKIP_NO_CATEGORY

    financial_year = FinancialYear.objects.filter(is_active=True).first()
    if not financial_year:
        return None, SKIP_NO_FINANCIAL_YEAR

    # One expense per renewal. A repeated auto-renew run must not book twice.
    if Expense.objects.filter(
        linked_subscription=subscription,
        expense_date=renewal.new_expiry,
        financial_year=financial_year,
    ).exists():
        return None, SKIP_ALREADY_BOOKED

    amount, currency_or_reason = renewal_expense_amount(subscription)
    if amount is None:
        return None, currency_or_reason

    expense = Expense.objects.create(
        title=f"{subscription.name} renewal",
        amount=amount,
        expense_date=renewal.new_expiry,
        category=subscription.budget_category,
        financial_year=financial_year,
        paid_to=subscription.vendor.name if subscription.vendor_id else subscription.platform,
        description=(
            f"Auto-raised from a subscription renewal on "
            f"{timezone.localdate():%Y-%m-%d}. Original amount "
            f"{subscription.currency} {subscription.cost}."
        ),
        linked_subscription=subscription,
        # PENDING, always. Budget consumption counts APPROVED only, so this
        # cannot move a budget number until somebody looks at it.
        status="PENDING",
        created_by=actor,
    )
    _log_finance_write(
        action="CREATE",
        obj=expense,
        actor=actor,
        changes={
            "source": "subscription_renewal",
            "subscription_id": subscription.id,
            "renewal_id": renewal.id,
            "amount": str(amount),
            "currency": currency_or_reason,
            "status": "PENDING",
        },
    )
    return expense, None


def _log_finance_write(*, action, obj, actor, changes):
    """Audit a finance write made outside a request.

    `AuditLogMixin` needs a viewset and a request; renewals also run from the
    automation container, where there is neither. Every write this module makes
    still lands in the same table.
    """
    from core.models import AuditLog

    AuditLog.objects.create(
        user=actor,
        action=action,
        model_name=obj.__class__.__name__,
        object_id=str(obj.pk),
        changes=changes,
        ip_address=None,
    )


# ─────────────────────────── recurring bill link ───────────────────────────

def build_recurring_bill(subscription, *, actor=None):
    """Create a RecurringBill from a subscription, once, explicitly.

    Returns ``(bill, created)``. Refuses to duplicate: a subscription already
    linked to an active bill returns that one.

    This is the whole of the "generate or soft link" decision. Auto-generating
    was rejected because RecurringBill has no currency column — see the field's
    own comment on the model.
    """
    from core.models import RecurringBill

    existing = RecurringBill.objects.filter(
        linked_subscription=subscription, is_active=True
    ).first()
    if existing:
        return existing, False

    amount, currency = renewal_expense_amount(subscription)
    if amount is None:
        # currency holds the skip reason here.
        raise ValueError(SKIP_REASONS[currency])

    bill = RecurringBill.objects.create(
        title=f"{subscription.name} ({subscription.platform})",
        vendor=subscription.vendor,
        amount=amount,
        frequency="MONTHLY" if subscription.billing_cycle == "MONTHLY" else "YEARLY",
        next_due_date=subscription.expiry_date,
        category=subscription.budget_category,
        notes=(
            f"Raised from subscription #{subscription.id}. Original amount "
            f"{subscription.currency} {subscription.cost} per "
            f"{subscription.billing_cycle.lower()}."
        ),
        is_active=True,
        # Never auto-post a generated bill: that would book money on a schedule
        # nobody reviewed.
        auto_post=False,
        linked_subscription=subscription,
        created_by=actor,
    )
    _log_finance_write(
        action="CREATE",
        obj=bill,
        actor=actor,
        changes={
            "source": "subscription",
            "subscription_id": subscription.id,
            "amount": str(amount),
            "currency": currency,
        },
    )
    return bill, True


# ─────────────────────────── budget aggregation ───────────────────────────

def subscription_commitment_by_category(*, financial_year=None):
    """{category_id: Decimal annual commitment} in the company currency.

    Only subscriptions that convert are included; the rest are reported by
    `unconvertible_commitment` so a partial figure is never presented as whole.
    """
    from core.estate_reports import active_subscriptions
    from core.fx import get_rate

    company = _company_currency()
    rows = (
        active_subscriptions()
        .filter(budget_category__isnull=False)
        .values("budget_category_id", "currency", "billing_cycle")
        .annotate(total=Sum("cost"))
    )

    rates = {}
    totals = {}
    unconvertible = {}
    for row in rows:
        currency = (row["currency"] or "").upper()
        if currency not in rates:
            rates[currency] = get_rate(currency, base=company)
        rate = rates[currency]
        annual = Decimal(row["total"] or 0)
        if row["billing_cycle"] == "MONTHLY":
            annual *= Decimal("12")

        if rate is None:
            unconvertible[currency] = unconvertible.get(currency, ZERO) + annual
            continue
        key = row["budget_category_id"]
        totals[key] = totals.get(key, ZERO) + (annual * rate)

    return totals, unconvertible, company


def budget_impact(*, financial_year=None):
    """Allocated, booked and committed per budget category — kept apart.

    `booked` is APPROVED expenses, which is what the existing budget screens
    already count. `committed` is the annualised cost of active subscriptions in
    that category. They are *not* added together: a renewal that raised an
    expense would then be counted twice. Presenting both is the point — the gap
    between them is next year's exposure.
    """
    from core.models import Budget, BudgetCategory, Expense, FinancialYear

    financial_year = financial_year or FinancialYear.objects.filter(is_active=True).first()
    committed, unconvertible, company = subscription_commitment_by_category(
        financial_year=financial_year
    )

    allocated_by_category = {}
    booked_by_category = {}
    if financial_year:
        for row in (
            Budget.objects.filter(financial_year=financial_year)
            .values("category_id")
            .annotate(total=Sum("allocated_amount"))
        ):
            allocated_by_category[row["category_id"]] = Decimal(row["total"] or 0)
        for row in (
            Expense.objects.filter(financial_year=financial_year, status="APPROVED")
            .values("category_id")
            .annotate(total=Sum("amount"))
        ):
            booked_by_category[row["category_id"]] = Decimal(row["total"] or 0)

    relevant = set(allocated_by_category) | set(booked_by_category) | set(committed)
    names = dict(
        BudgetCategory.objects.filter(id__in=relevant).values_list("id", "name")
    )

    rows = []
    for category_id in sorted(relevant, key=lambda key: names.get(key, "")):
        allocated = allocated_by_category.get(category_id, ZERO)
        booked = booked_by_category.get(category_id, ZERO)
        commitment = committed.get(category_id, ZERO)
        rows.append(
            {
                "category_id": category_id,
                "category_name": names.get(category_id, "Uncategorised"),
                "allocated": _money(allocated),
                "booked": _money(booked),
                "subscription_commitment": _money(commitment),
                "remaining_after_booked": _money(allocated - booked),
                # What is left once this year's subscription renewals are also
                # honoured. Can be negative; that is the useful part.
                "remaining_after_commitment": _money(allocated - booked - commitment),
                "is_overcommitted": (allocated - booked - commitment) < 0,
            }
        )

    return {
        "currency": company,
        "financial_year": financial_year.name if financial_year else None,
        "categories": rows,
        "totals": {
            "allocated": _money(sum(allocated_by_category.values(), ZERO)),
            "booked": _money(sum(booked_by_category.values(), ZERO)),
            "subscription_commitment": _money(sum(committed.values(), ZERO)),
        },
        "unconvertible": [
            {"currency": code, "annual_amount": _money(amount)}
            for code, amount in sorted(unconvertible.items())
        ],
        "is_complete": not unconvertible,
    }


# ─────────────────────────── vendor + estate slices ───────────────────────────

def subscription_spend_by_vendor():
    """Annual subscription commitment per vendor, in the company currency."""
    from core.estate_reports import active_subscriptions
    from core.fx import get_rate
    from core.models import Vendor

    company = _company_currency()
    rows = (
        active_subscriptions()
        .filter(vendor__isnull=False)
        .values("vendor_id", "currency", "billing_cycle")
        .annotate(total=Sum("cost"))
    )

    rates, totals, unconvertible = {}, {}, {}
    for row in rows:
        currency = (row["currency"] or "").upper()
        if currency not in rates:
            rates[currency] = get_rate(currency, base=company)
        annual = Decimal(row["total"] or 0)
        if row["billing_cycle"] == "MONTHLY":
            annual *= Decimal("12")
        if rates[currency] is None:
            unconvertible[currency] = unconvertible.get(currency, ZERO) + annual
            continue
        totals[row["vendor_id"]] = totals.get(row["vendor_id"], ZERO) + (
            annual * rates[currency]
        )

    names = dict(Vendor.objects.filter(id__in=totals).values_list("id", "name"))
    return {
        "currency": company,
        "vendors": [
            {
                "vendor_id": vendor_id,
                "vendor_name": names.get(vendor_id, "Unknown"),
                "annual_commitment": _money(amount),
            }
            for vendor_id, amount in sorted(
                totals.items(), key=lambda item: item[1], reverse=True
            )
        ],
        "unconvertible": [
            {"currency": code, "annual_amount": _money(amount)}
            for code, amount in sorted(unconvertible.items())
        ],
        "is_complete": not unconvertible,
    }


def subscription_spend_by_property_and_layer(*, to_currency=None):
    """Estate spend sliced the two ways the Cost Overview cares about.

    Reuses `estate_reports` so the money arithmetic is the one already tested —
    summed in SQL, divided once, and carrying its own `unconvertible` block.
    """
    from core import estate_reports

    active = estate_reports.active_subscriptions()
    currency = to_currency or _company_currency()

    property_spend = estate_reports.spend_by_property(active, to_currency=currency)
    from core.models import DigitalProperty

    names = dict(
        DigitalProperty.objects.filter(id__in=property_spend).values_list("id", "name")
    )
    by_property = [
        {
            "property_id": property_id,
            "property_name": names.get(property_id, "Unknown"),
            "spend": block,
        }
        for property_id, block in sorted(
            property_spend.items(),
            key=lambda item: Decimal(item[1]["monthly"]),
            reverse=True,
        )
    ]

    orphan_rows = estate_reports.spend_by_currency(
        active.filter(digital_property__isnull=True)
    )
    orphan_spend = estate_reports.converted_money(orphan_rows, to_currency=currency)

    return {
        "currency": currency,
        "by_property": by_property,
        "by_layer": estate_reports.spend_by_layer(active, to_currency=currency),
        "orphaned": orphan_spend,
    }
