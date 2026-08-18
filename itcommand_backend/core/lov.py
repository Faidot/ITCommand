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


#: Seed for the digital-property kinds group. Imported from the estate taxonomy
#: rather than restated, so the model choices and the dropdown cannot diverge.
def _estate_service_types():
    """Built-in service types, imported rather than restated."""
    from core.estate import SERVICE_TYPES

    return SERVICE_TYPES


def _estate_property_kinds():
    from core.estate import PROPERTY_KINDS

    return tuple(PROPERTY_KINDS)


ESTATE_PROPERTY_KINDS = _estate_property_kinds()


def _estate_server_hostings():
    from core.estate import SERVER_HOSTINGS

    return tuple(SERVER_HOSTINGS)


def _estate_server_roles():
    from core.estate import SERVER_ROLES

    return tuple(SERVER_ROLES)


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


def _field_choices(dotted_path: str, field_name: str):
    """Read a model field's `choices` lazily (works with TextChoices enums)."""

    def loader():
        from django.apps import apps

        app_label, model_name = dotted_path.split(".")
        model = apps.get_model(app_label, model_name)
        return tuple(model._meta.get_field(field_name).choices or ())

    return loader


#: Lazily-loaded seeds for system groups, so the registry mirrors the models
#: rather than duplicating their choice tuples.
SYSTEM_SEEDS = {
    # Keys kept as `subscription_*` so an admin's relabelled or hidden rows
    # survive Phase 5; the choices behind them now come from `Service`.
    # The frozen built-ins, deliberately not the model field. `Service.
    # service_type` now takes its choices *from this group*, so seeding from
    # the field would be circular: get_values falls back to the seed, the seed
    # reads the field, the field reads get_values. That recursion terminated
    # in a RecursionError swallowed by a broad except, which turned a
    # ten-query endpoint into one query per row.
    "subscription_category": lambda: tuple(_estate_service_types()),
    "subscription_status": _field_choices("core.Service", "status"),
    "subscription_billing_cycle": _field_choices("core.Service", "billing_cycle"),
    "expense_status": _model_choices("core.Expense", "STATUS_CHOICES"),
    "expense_payment_method": _model_choices("core.Expense", "PAYMENT_METHOD_CHOICES"),
    "vault_category": _model_choices("core.VaultCredential", "CATEGORY_CHOICES"),
    "onboarding_category": _model_choices("core.ChecklistTemplateItem", "CATEGORIES"),
    "asset_type": _model_choices("core.Asset", "ASSET_TYPE_CHOICES"),
    "asset_status": _model_choices("core.Asset", "STATUS_CHOICES"),
    "asset_condition": _model_choices("core.Asset", "CONDITION_CHOICES"),
    "asset_event_type": _model_choices("core.AssetMaintenance", "EVENT_TYPE_CHOICES"),
    "ticket_priority": _model_choices("core.Ticket", "PRIORITY_CHOICES"),
    "ticket_status": _model_choices("core.Ticket", "STATUS_CHOICES"),
    "procurement_status": _field_choices("core.PurchaseRequest", "status"),
    "procurement_priority": _field_choices("core.PurchaseRequest", "priority"),
    "onboarding_role": _model_choices("core.ChecklistTemplateItem", "ROLES"),
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
        label="Service types",
        extendable=True,
        help_text=(
            "Types offered when adding an estate service. Safe to extend, but "
            "only the seven stack roles count toward a property's gaps."
        ),
    ),
    GroupSpec(
        key="subscription_status",
        label="Service statuses",
        extendable=False,
        help_text=(
            "System list. The dashboard, spend totals and filters branch on these "
            "codes, so new statuses would not be understood. Relabel or hide only."
        ),
    ),
    GroupSpec(
        key="subscription_billing_cycle",
        label="Billing cycles",
        extendable=False,
        help_text=(
            "System list. Monthly-equivalent spend is computed from these codes, "
            "and USAGE and FREE deliberately contribute nothing."
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
        key="vault_category",
        label="Vault categories",
        extendable=True,
        help_text="Safe to extend — vault categories are labels only.",
    ),
    GroupSpec(
        key="onboarding_category",
        label="Onboarding checklist categories",
        extendable=True,
        help_text=(
            "Categories offered for onboarding / offboarding checklist tasks. "
            "Safe to extend — categories group tasks for display, nothing branches "
            "on the individual codes."
        ),
    ),
    GroupSpec(
        key="asset_type",
        label="Asset types",
        extendable=True,
        help_text="Types offered when adding an asset. Safe to extend.",
    ),
    GroupSpec(
        key="asset_status",
        label="Asset statuses",
        extendable=False,
        help_text=(
            "System list. Assignment, availability and dashboards branch on these "
            "codes, so new statuses would not be understood. Relabel, reorder or hide only."
        ),
    ),
    GroupSpec(
        key="asset_condition",
        label="Asset conditions",
        extendable=True,
        help_text="Condition grades offered when adding an asset. Safe to extend.",
    ),
    GroupSpec(
        key="asset_event_type",
        label="Asset maintenance event types",
        extendable=True,
        help_text="Event types for the asset maintenance log. Safe to extend.",
    ),
    GroupSpec(
        key="ticket_priority",
        label="Helpdesk ticket priorities",
        extendable=False,
        help_text="System list. SLA and sorting branch on these codes. Relabel, reorder or hide only.",
    ),
    GroupSpec(
        key="ticket_status",
        label="Helpdesk ticket statuses",
        extendable=False,
        help_text="System list. Ticket workflow branches on these codes. Relabel, reorder or hide only.",
    ),
    GroupSpec(
        key="procurement_status",
        label="Purchase request statuses",
        extendable=False,
        help_text="System list. Approval workflow branches on these codes. Relabel, reorder or hide only.",
    ),
    GroupSpec(
        key="procurement_priority",
        label="Purchase request priorities",
        extendable=False,
        help_text="System list. Relabel, reorder or hide only.",
    ),
    GroupSpec(
        key="onboarding_role",
        label="Onboarding assigned roles",
        extendable=True,
        help_text="Roles a checklist task can be assigned to. Safe to extend.",
    ),
    GroupSpec(
        key="estate_server_hosting",
        label="Server hosting types",
        extendable=True,
        seed=_estate_server_hostings(),
        help_text=(
            "Where a server lives — cloud, on-site, colocation. Safe to "
            "extend: nothing in the code branches on these codes, they only "
            "group and label servers."
        ),
    ),
    GroupSpec(
        key="estate_server_role",
        label="Server roles",
        extendable=True,
        seed=_estate_server_roles(),
        help_text=(
            "What a server is for — web, database, game server. Safe to "
            "extend; reported and grouped, never branched on."
        ),
    ),
    GroupSpec(
        key="estate_property_kind",
        label="Digital property kinds",
        extendable=True,
        seed=ESTATE_PROPERTY_KINDS,
        help_text=(
            "What a digital property is — a game, an app, a marketing site. "
            "Safe to extend: nothing in the code branches on these codes, they "
            "only group and label properties."
        ),
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
