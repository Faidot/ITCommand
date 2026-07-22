"""Registry for admin-managed dropdown values ("lists of values").

Each group is either **extendable** (a pure value list — add whatever you
need) or not (the codes are wired into application logic, so only the label,
order and visibility may change).

To expose a new dropdown here, add a `GroupSpec` below and re-run
`manage.py seed_lovs`.
"""
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence, Tuple


@dataclass(frozen=True)
class GroupSpec:
    key: str
    label: str
    #: True when new codes are safe to invent from the admin.
    extendable: bool
    #: Where the built-in values come from, seeded on first run.
    seed: Sequence[Tuple[str, str]] = field(default_factory=tuple)
    #: Uppercase codes on save (currencies, status codes).
    normalize_code: bool = True
    #: Optional validator; returns an error message, or None when the code is fine.
    validate: Optional[Callable[[str], Optional[str]]] = None
    help_text: str = ""


#: Built-in currency list. Every other ISO 4217 code stays valid and can be
#: added from the admin; this is only the starting set, and it doubles as the
#: fallback so the dropdown is never empty on a fresh install.
COMMON_CURRENCIES = (
    ("USD", "US Dollar"),
    ("EUR", "Euro"),
    ("GBP", "British Pound"),
    ("PKR", "Pakistani Rupee"),
    ("AED", "UAE Dirham"),
    ("INR", "Indian Rupee"),
    ("SAR", "Saudi Riyal"),
    ("CAD", "Canadian Dollar"),
    ("AUD", "Australian Dollar"),
    ("JPY", "Japanese Yen"),
    ("CNY", "Chinese Yuan"),
)


def _validate_currency_code(code: str) -> Optional[str]:
    if not code or len(code) != 3 or not code.isalpha():
        return "A currency code must be three letters (for example, USD)."
    # Match what the subscription serializer accepts, so a currency added here
    # cannot be selected and then rejected on save.
    from core.currencies import is_current_iso_4217_code

    if not is_current_iso_4217_code(code.upper()):
        return f"'{code.upper()}' is not a current ISO 4217 currency code."
    return None


def _model_choices(dotted_path: str, attribute: str):
    """Read a model's CHOICES tuple lazily, so this module imports cheaply."""

    def loader():
        from django.apps import apps

        app_label, model_name = dotted_path.split(".")
        model = apps.get_model(app_label, model_name)
        return tuple(getattr(model, attribute))

    return loader


#: Lazily-loaded seeds for system groups, so the registry mirrors the models
#: rather than duplicating their choice tuples.
SYSTEM_SEEDS = {
    "subscription_category": _model_choices("core.Subscription", "CATEGORY_CHOICES"),
    "subscription_status": _model_choices("core.Subscription", "STATUS_CHOICES"),
    "subscription_billing_cycle": _model_choices("core.Subscription", "BILLING_CYCLE_CHOICES"),
    "expense_status": _model_choices("core.Expense", "STATUS_CHOICES"),
    "expense_payment_method": _model_choices("core.Expense", "PAYMENT_METHOD_CHOICES"),
    "license_type": _model_choices("core.SoftwareLicense", "LICENSE_TYPE_CHOICES"),
    "vault_category": _model_choices("core.VaultCredential", "CATEGORY_CHOICES"),
}


_GROUP_LIST = [
    GroupSpec(
        key="currency",
        label="Currencies",
        extendable=True,
        seed=COMMON_CURRENCIES,
        normalize_code=True,
        validate=_validate_currency_code,
        help_text=(
            "Currencies offered in Settings and on money fields. Safe to extend — "
            "add any ISO 4217 code your organisation uses."
        ),
    ),
    GroupSpec(
        key="subscription_category",
        label="Subscription categories",
        extendable=True,
        help_text="Categories offered when adding a subscription. Safe to extend.",
    ),
    GroupSpec(
        key="subscription_status",
        label="Subscription statuses",
        extendable=False,
        help_text=(
            "System list. Renewal alerts, dashboards and filters branch on these "
            "codes, so new statuses would not be understood. Relabel or hide only."
        ),
    ),
    GroupSpec(
        key="subscription_billing_cycle",
        label="Subscription billing cycles",
        extendable=False,
        help_text=(
            "System list. Auto-renew advances expiry by month or year based on "
            "these codes."
        ),
    ),
    GroupSpec(
        key="expense_status",
        label="Expense statuses",
        extendable=False,
        help_text="System list. Budget and approval logic branch on these codes.",
    ),
    GroupSpec(
        key="expense_payment_method",
        label="Expense payment methods",
        extendable=True,
        help_text="Safe to extend — payment methods are recorded, not branched on.",
    ),
    GroupSpec(
        key="license_type",
        label="Licence types",
        extendable=False,
        help_text=(
            "System list. Reports treat SUBSCRIPTION-type licences specially."
        ),
    ),
    GroupSpec(
        key="vault_category",
        label="Vault categories",
        extendable=True,
        help_text="Safe to extend — vault categories are labels only.",
    ),
]

GROUPS = {spec.key: spec for spec in _GROUP_LIST}

GROUP_CHOICES = [(spec.key, spec.label) for spec in _GROUP_LIST]


def seed_values(group: str):
    """Built-in values for a group, from the registry or the model's choices."""
    spec = GROUPS.get(group)
    if not spec:
        return ()
    if spec.seed:
        return tuple(spec.seed)
    loader = SYSTEM_SEEDS.get(group)
    return tuple(loader()) if loader else ()


def get_values(group, *, active_only=True):
    """Admin-managed values for a group, falling back to the built-in seed.

    Falling back matters: a fresh install (or a group nobody has customised)
    still returns the application's own choices rather than an empty dropdown.
    """
    from core.models import ListOfValues

    queryset = ListOfValues.objects.filter(group=group)
    if active_only:
        queryset = queryset.filter(is_active=True)
    rows = list(queryset.values_list("code", "label"))
    if rows:
        return rows
    return [list(pair) for pair in seed_values(group)]


def get_choices(group, *, active_only=True):
    """Django-style ((code, label), ...) for a group."""
    return tuple((code, label) for code, label in get_values(group, active_only=active_only))


def is_valid(group, code, *, active_only=True):
    if not code:
        return False
    spec = GROUPS.get(group)
    candidate = code.upper() if spec and spec.normalize_code else code
    return any(candidate == value for value, _ in get_values(group, active_only=active_only))
