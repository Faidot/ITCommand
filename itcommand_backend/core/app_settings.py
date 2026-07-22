"""Helpers for reading company-wide display settings.

`AppSettings` is a key/value table. These helpers give the rest of the
backend one place to read the settings that affect presentation, so a
change in Settings reaches emails, exports and reports rather than only
the pages that happen to remember to look it up.
"""
from core.currencies import is_current_iso_4217_code


DEFAULT_CURRENCY = "USD"


def get_setting(key, default=None):
    from core.models import AppSettings

    value = (
        AppSettings.objects.filter(key=key).values_list("value", flat=True).first()
    )
    if value is None or value == "":
        return default
    return value


def default_currency():
    """The company-wide currency code, always a usable ISO 4217 value."""
    currency = str(get_setting("default_currency") or DEFAULT_CURRENCY).strip().upper()
    return currency if is_current_iso_4217_code(currency) else DEFAULT_CURRENCY


def company_name(default=""):
    return str(get_setting("company_name") or default)


def fiscal_year_start_month():
    """Month (1-12) the financial year starts on. Defaults to January."""
    try:
        month = int(get_setting("fiscal_year_start_month") or 1)
    except (TypeError, ValueError):
        return 1
    return month if 1 <= month <= 12 else 1


def format_money(amount, currency=None):
    """Render an amount for emails/plain-text reports: 'USD 1,234.56'."""
    code = (currency or default_currency()).upper()
    try:
        value = float(amount or 0)
    except (TypeError, ValueError):
        value = 0.0
    return f"{code} {value:,.2f}"
