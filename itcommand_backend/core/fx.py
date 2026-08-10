"""Currency conversion for mixed-currency reporting.

The rule that matters: **a missing rate never becomes 1:1**. `convert()`
returns None when it cannot convert, and callers report those amounts
separately rather than folding a wrong number into a total. Silently treating
1 USD as 1 PKR would be worse than showing nothing.
"""
from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone


TWOPLACES = Decimal("0.01")


def reporting_currency():
    """The currency headline totals are expressed in."""
    from core.app_settings import default_currency

    return default_currency()


def get_rate(currency, base=None, on_date=None):
    """Rate converting 1 `currency` into `base`, or None if unknown.

    Uses the most recent rate on or before `on_date`, so a report for last
    month is not rewritten by today's rate.
    """
    rate, _as_of = rate_with_date(currency, base=base, on_date=on_date)
    return rate


def rate_with_date(currency, base=None, on_date=None):
    """`get_rate`, plus the `as_of` of the row it actually used.

    Returns (rate, as_of), both None when there is no rate. `as_of` matters
    to anything that stores a converted figure: the rate used may be days
    older than the date asked for, and "converted at a six-day-old rate" is
    something a reader should be able to see rather than infer.

    `as_of` is None for a same-currency conversion — no row was consulted.
    """
    from core.models import ExchangeRate

    base = (base or reporting_currency()).upper()
    currency = (currency or "").upper()
    if not currency:
        return None, None
    if currency == base:
        return Decimal("1"), None

    on_date = on_date or timezone.localdate()

    direct = (
        ExchangeRate.objects.filter(
            base_currency=base, currency=currency, as_of__lte=on_date
        )
        .order_by("-as_of")
        .values_list("rate", "as_of")
        .first()
    )
    if direct and direct[0]:
        return Decimal(direct[0]), direct[1]

    # A rate stored the other way round is just as good.
    inverse = (
        ExchangeRate.objects.filter(
            base_currency=currency, currency=base, as_of__lte=on_date
        )
        .order_by("-as_of")
        .values_list("rate", "as_of")
        .first()
    )
    if inverse and inverse[0] and Decimal(inverse[0]) > 0:
        return Decimal("1") / Decimal(inverse[0]), inverse[1]

    # Cross rate via a shared base (e.g. EUR->USD and PKR->USD gives EUR->PKR).
    shared = (
        ExchangeRate.objects.filter(currency__in=[currency, base], as_of__lte=on_date)
        .order_by("-as_of")
        .values_list("base_currency", flat=True)
        .first()
    )
    if shared:
        to_shared = (
            ExchangeRate.objects.filter(
                base_currency=shared, currency=currency, as_of__lte=on_date
            )
            .order_by("-as_of")
            .values_list("rate", "as_of")
            .first()
        )
        base_to_shared = (
            ExchangeRate.objects.filter(
                base_currency=shared, currency=base, as_of__lte=on_date
            )
            .order_by("-as_of")
            .values_list("rate", "as_of")
            .first()
        )
        if to_shared and base_to_shared and to_shared[0] and Decimal(base_to_shared[0]) > 0:
            # Two rows go into a cross rate. The older one bounds how current
            # the result is, so that is the date worth recording.
            return (
                Decimal(to_shared[0]) / Decimal(base_to_shared[0]),
                min(to_shared[1], base_to_shared[1]),
            )

    return None, None


def convert(amount, from_currency, to_currency=None, on_date=None):
    """Convert an amount, or return None when no rate is available."""
    if amount is None:
        return None
    rate = get_rate(from_currency, base=to_currency, on_date=on_date)
    if rate is None:
        return None
    return (Decimal(amount) * rate).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def convert_many(items, to_currency=None, on_date=None):
    """Total a list of (amount, currency) pairs.

    Returns ``(total, currency, unconvertible)`` where `unconvertible` is a
    list of ``{"currency", "amount"}`` for anything with no rate — so the UI
    can say plainly what is missing instead of under-reporting in silence.
    """
    base = (to_currency or reporting_currency()).upper()
    total = Decimal("0")
    missing = {}

    for amount, currency in items:
        if amount is None:
            continue
        converted = convert(amount, currency, to_currency=base, on_date=on_date)
        if converted is None:
            code = (currency or "?").upper()
            missing[code] = missing.get(code, Decimal("0")) + Decimal(amount)
        else:
            total += converted

    unconvertible = [
        {"currency": code, "amount": str(value.quantize(TWOPLACES, rounding=ROUND_HALF_UP))}
        for code, value in sorted(missing.items())
    ]
    return total.quantize(TWOPLACES, rounding=ROUND_HALF_UP), base, unconvertible


def rate_as_of(base=None):
    """Date of the newest rate held, for an 'as at' label in the UI."""
    from core.models import ExchangeRate

    base = (base or reporting_currency()).upper()
    return (
        ExchangeRate.objects.filter(base_currency=base)
        .order_by("-as_of")
        .values_list("as_of", flat=True)
        .first()
    )


def missing_rate_currencies(currencies, base=None, on_date=None):
    """Which of `currencies` cannot currently be converted into `base`."""
    base = (base or reporting_currency()).upper()
    return sorted(
        {
            (code or "").upper()
            for code in currencies
            if code and get_rate(code, base=base, on_date=on_date) is None
        }
    )
