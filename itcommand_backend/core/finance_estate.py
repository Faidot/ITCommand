"""Where the Digital Estate meets the finance ledger.

Three read-only slices, all feeding the Cost Overview:

* **budget impact** — allocated vs booked vs committed, per budget category
* **vendor spend** — annual commitment per vendor
* **property / type spend** — the estate's own two axes

Two rules survive from the module this replaces.

**Nothing is guessed.** A service whose currency has no exchange rate is
reported in an `unconvertible` block rather than converted at 1:1 or dropped, so
a partial figure never reads as a whole one.

**Committed is never added to booked.** A service that renews yearly is a
commitment; the expense raised when it renews is booked spend. Summing them
double-counts. Both are reported and the caller presents both — see
`budget_impact`.

Phase 5 removed the write path. `renewal_expense_amount`,
`attempt_renewal_expense` and `build_recurring_bill` booked an Expense and
raised a RecurringBill when a `Subscription` auto-renewed. They were called only
from the subscription viewset and the `auto_renew_subscriptions` command, both
deleted with that module. `Service` has no renewal record to hang them off, and
inventing one to preserve an unreachable write path into the finance tables is
the wrong trade — those writes are the highest-consequence thing this codebase
does. `EstateSettings.create_expense_on_renewal` is retained, defaulted off, for
whenever that pipeline is rebuilt against `Service`.
"""

from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Sum


TWOPLACES = Decimal("0.01")
ZERO = Decimal("0")

MONTHS_PER_YEAR = Decimal("12")

#: Cycles whose `cost` is not a recurring, predictable charge. Their annual
#: commitment is zero — a usage bill is real spend but not a commitment, and
#: inventing one would put fiction into a budget comparison.
UNPRICED_CYCLES = ("USAGE", "FREE")


def _money(value):
    return str(Decimal(value or 0).quantize(TWOPLACES, rounding=ROUND_HALF_UP))


def _company_currency():
    from core.app_settings import default_currency

    return default_currency()


def _annualise(total, billing_cycle):
    """Yearly commitment for a summed cost on one billing cycle."""
    amount = Decimal(total or 0)
    if billing_cycle in UNPRICED_CYCLES:
        return ZERO
    if billing_cycle == "MONTHLY":
        return amount * MONTHS_PER_YEAR
    return amount


def _annual_by(field):
    """{id: annual commitment}, plus what could not be converted.

    One GROUP BY over (field, currency, cycle) and one rate lookup per distinct
    currency — not one per row, and not one per group.
    """
    from core.estate_reports import active_services
    from core.fx import get_rate

    company = _company_currency()
    rows = (
        active_services()
        .filter(**{f"{field}__isnull": False})
        .values(f"{field}_id", "currency", "billing_cycle")
        .annotate(total=Sum("cost"))
    )

    rates, totals, unconvertible = {}, {}, {}
    for row in rows:
        currency = (row["currency"] or "").upper()
        if currency not in rates:
            rates[currency] = get_rate(currency, base=company)
        annual = _annualise(row["total"], row["billing_cycle"])
        if annual == ZERO:
            continue
        if rates[currency] is None:
            unconvertible[currency] = unconvertible.get(currency, ZERO) + annual
            continue
        key = row[f"{field}_id"]
        totals[key] = totals.get(key, ZERO) + (annual * rates[currency])

    return totals, unconvertible, company


def service_commitment_by_category(*, financial_year=None):
    """{category_id: Decimal annual commitment} in the company currency."""
    return _annual_by("budget_category")


def budget_impact(*, financial_year=None):
    """Allocated, booked and committed per budget category — kept apart.

    `booked` is APPROVED expenses, which is what the existing budget screens
    already count. `committed` is the annualised cost of active services in that
    category. They are *not* added together: a renewal that raised an expense
    would then be counted twice. Presenting both is the point — the gap between
    them is next year's exposure.
    """
    from core.models import Budget, BudgetCategory, Expense, FinancialYear

    financial_year = (
        financial_year or FinancialYear.objects.filter(is_active=True).first()
    )
    committed, unconvertible, company = service_commitment_by_category(
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
                # `subscription_commitment` is kept as a key so the Cost
                # Overview page keeps rendering through this commit; the number
                # behind it is estate service spend. Both names are emitted.
                "subscription_commitment": _money(commitment),
                "service_commitment": _money(commitment),
                "remaining_after_booked": _money(allocated - booked),
                # What is left once this year's renewals are also honoured.
                # Can be negative; that is the useful part.
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
            "service_commitment": _money(sum(committed.values(), ZERO)),
        },
        "unconvertible": [
            {"currency": code, "annual_amount": _money(amount)}
            for code, amount in sorted(unconvertible.items())
        ],
        "is_complete": not unconvertible,
    }


def service_spend_by_vendor():
    """Annual estate commitment per vendor, in the company currency."""
    from core.models import Vendor

    totals, unconvertible, company = _annual_by("vendor")
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


def service_spend_by_property_and_type(*, to_currency=None):
    """Estate spend sliced the two ways the Cost Overview cares about.

    Reuses `estate_reports` so the money arithmetic is the one already tested —
    summed in SQL, divided once, and carrying its own `unconvertible` block.
    """
    from core import estate_reports
    from core.models import Property

    active = estate_reports.active_services()
    currency = to_currency or _company_currency()

    property_spend = estate_reports.spend_by_property(active, to_currency=currency)
    names = dict(
        Property.objects.filter(id__in=property_spend).values_list("id", "name")
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

    orphan_rows = estate_reports.spend_by_currency(active.filter(property__isnull=True))
    orphan_spend = estate_reports.converted_money(orphan_rows, to_currency=currency)

    return {
        "currency": currency,
        "by_property": by_property,
        "by_layer": estate_reports.spend_by_layer(active, to_currency=currency),
        "orphaned": orphan_spend,
    }


# ── Names the finance views still import. Kept as aliases in this commit so the
#    Cost Overview keeps working; the views move to the new names next.
subscription_commitment_by_category = service_commitment_by_category
subscription_spend_by_vendor = service_spend_by_vendor
subscription_spend_by_property_and_layer = service_spend_by_property_and_type
