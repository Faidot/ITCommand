"""Aggregation for the Digital Estate views.

Two rules drive the shape of everything here.

**Money is summed in SQL and divided once in Python.** The obvious way to get a
monthly-equivalent total is ``Sum(Case(... cost / 12 ...))`` — one query, done.
It is also wrong on SQLite, which has no exact decimal type and would route the
division through a float. So each group is summed twice — what is billed monthly,
what is billed yearly — and the single ``/12`` happens once per group in Decimal.
The aggregation is still SQL; only the final arithmetic is Python, and it is
O(currencies), not O(rows). It is also strictly more accurate than dividing per
row, because nothing is rounded before being added up.

**A total that omits something never claims to be complete.** Every converted
figure travels with the list of currencies that could not be converted and an
``is_complete`` flag. Callers must render both. See `converted_money`.
"""

from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Case, DecimalField, F, Q, Sum, Value, When
from django.utils import timezone

from core import estate
from core.fx import get_rate, rate_as_of, reporting_currency


TWOPLACES = Decimal("0.01")
ZERO = Decimal("0")

#: Wide enough that a sum of many large costs cannot overflow the expression's
#: declared type before it reaches Python.
MONEY = DecimalField(max_digits=20, decimal_places=2)

MONTHS_PER_YEAR = Decimal("12")

#: Distinct from None, because `rate_as_of()` legitimately returns None when no
#: rates are stored at all. Using None as "not supplied" made every fold re-query.
_UNSET = object()


def _money(value):
    """Serialise a Decimal as a fixed 2dp string.

    A string, not a float: JSON floats cannot represent 0.01 exactly, and this
    is the last point where the value is still trustworthy.
    """
    return str(Decimal(value or 0).quantize(TWOPLACES, rounding=ROUND_HALF_UP))


# ───────────────────────────── active-subscription scope ─────────────────────

def active_q(today=None):
    """SQL equivalent of ``Subscription.effective_status == "ACTIVE"``.

    The model property is Python-only (it compares dates at read time), so it
    cannot be filtered on. This mirrors it exactly: currently-ACTIVE status,
    started, not yet expired. `test_estate_api` asserts the two agree, so a
    change to one that is not made to the other fails a test rather than
    quietly producing two different definitions of "active".
    """
    today = today or timezone.localdate()
    return Q(status="ACTIVE", start_date__lte=today, expiry_date__gte=today)


def active_subscriptions(today=None):
    from core.models import Subscription

    return Subscription.objects.filter(active_q(today))


# ───────────────────────────── money aggregation ─────────────────────────────

_CYCLE_SUMS = {
    "monthly_billed": Sum(
        Case(
            When(billing_cycle="MONTHLY", then=F("cost")),
            default=Value(ZERO),
            output_field=MONEY,
        )
    ),
    "yearly_billed": Sum(
        Case(
            When(billing_cycle="YEARLY", then=F("cost")),
            default=Value(ZERO),
            output_field=MONEY,
        )
    ),
}


def _equivalents(monthly_billed, yearly_billed):
    """(monthly, yearly) equivalents from the two cycle sums, in Decimal."""
    monthly_billed = Decimal(monthly_billed or 0)
    yearly_billed = Decimal(yearly_billed or 0)
    monthly = monthly_billed + (yearly_billed / MONTHS_PER_YEAR)
    yearly = (monthly_billed * MONTHS_PER_YEAR) + yearly_billed
    return monthly, yearly


def spend_by_currency(queryset):
    """[{currency, monthly, yearly, count}] — one SQL GROUP BY, Decimal out.

    `monthly` and `yearly` are unrounded Decimals so callers can convert and
    total them without compounding rounding error. Quantise at serialisation.
    """
    rows = (
        queryset.values("currency")
        .annotate(count=Sum(Value(1)), **_CYCLE_SUMS)
        .order_by("currency")
    )
    out = []
    for row in rows:
        monthly, yearly = _equivalents(row["monthly_billed"], row["yearly_billed"])
        out.append(
            {
                "currency": row["currency"],
                "monthly": monthly,
                "yearly": yearly,
                "count": row["count"] or 0,
            }
        )
    return out


def rate_table(currencies, to_currency=None, on_date=None):
    """Resolve every rate we will need, once.

    `fx.get_rate` queries the database on every call and `fx.rate_as_of` adds
    another. Folding one money block per property therefore cost two queries per
    property — an N+1 that only showed up on the endpoint the property cards use.
    Resolving the distinct currencies up front makes the fold free.

    Returns {CURRENCY: Decimal | None}; None means "no rate", never 1:1.
    """
    base = (to_currency or reporting_currency()).upper()
    codes = {(code or "").upper() for code in currencies if code}
    return {code: get_rate(code, base=base, on_date=on_date) for code in codes}


def converted_money(rows, to_currency=None, on_date=None, rates=None, as_of=_UNSET):
    """Fold per-currency rows into one figure, reporting what was left out.

    `rows` is the output of `spend_by_currency` (or any list of dicts carrying
    `currency`, `monthly`, `yearly`).

    Pass `rates` (from `rate_table`) and `as_of` when folding many blocks in one
    request; without them this resolves rates itself and costs queries.

    The returned dict is deliberately awkward to misuse: there is no bare
    `total` key that reads as authoritative. `is_complete` and `unconvertible`
    sit next to the number, and `coverage` says how many currencies made it in,
    so a caller can render "2 of 3 currencies" without recounting.

    Naming note: the plan calls this block `unconverted`; `core/fx.py` and the
    existing subscriptions dashboard already ship `unconvertible`. The codebase
    wins — one name for one concept beats matching the plan's prose.

    Rounding note: unlike `fx.convert_many`, which quantises each conversion
    before adding, this sums at full precision and quantises once. That is the
    same reasoning as summing `monthly_cost_unrounded`, and can differ from the
    older dashboard by a fraction of a unit on large mixed-currency sets.
    """
    base = (to_currency or reporting_currency()).upper()
    if rates is None:
        rates = rate_table(
            (row["currency"] for row in rows), to_currency=base, on_date=on_date
        )

    monthly_total = ZERO
    yearly_total = ZERO
    missing = {}

    for row in rows:
        code = (row["currency"] or "?").upper()
        rate = rates.get(code)
        if rate is None:
            bucket = missing.setdefault(code, {"monthly": ZERO, "yearly": ZERO})
            bucket["monthly"] += Decimal(row["monthly"] or 0)
            bucket["yearly"] += Decimal(row["yearly"] or 0)
        else:
            monthly_total += Decimal(row["monthly"] or 0) * rate
            yearly_total += Decimal(row["yearly"] or 0) * rate

    # `amount` is the monthly figure, matching what fx.convert_many already
    # ships and what the subscriptions frontend already parses. `yearly_amount`
    # is added so a yearly view does not have to guess.
    unconvertible = [
        {
            "currency": code,
            "amount": _money(totals["monthly"]),
            "yearly_amount": _money(totals["yearly"]),
        }
        for code, totals in sorted(missing.items())
    ]

    present = {(row["currency"] or "?").upper() for row in rows}
    excluded = set(missing)
    return {
        "currency": base,
        "monthly": _money(monthly_total),
        "yearly": _money(yearly_total),
        "unconvertible": unconvertible,
        "is_complete": not unconvertible,
        "coverage": {
            "converted_currencies": len(present - excluded),
            "total_currencies": len(present),
            "excluded_currencies": sorted(excluded),
        },
        "rates_as_of": rate_as_of(base) if as_of is _UNSET else as_of,
    }


def _grouped_converted(queryset, *, group_fields, key_builder, to_currency=None):
    """Group by (something, currency) in SQL, then convert each group.

    Grouping has to include currency — a provider billed in two currencies needs
    both rows before either can be converted — so this is one query with a
    compound GROUP BY, then a fold per group. No per-row Python.
    """
    rows = queryset.values(*group_fields, "currency").annotate(
        count=Sum(Value(1)), **_CYCLE_SUMS
    )

    buckets = defaultdict(list)
    meta = {}
    for row in rows:
        key, info = key_builder(row)
        monthly, yearly = _equivalents(row["monthly_billed"], row["yearly_billed"])
        buckets[key].append(
            {
                "currency": row["currency"],
                "monthly": monthly,
                "yearly": yearly,
                "count": row["count"] or 0,
            }
        )
        meta.setdefault(key, info)

    # One rate lookup per distinct currency for the whole grouping, not one per
    # group. See rate_table().
    base = (to_currency or reporting_currency()).upper()
    rates = rate_table(
        (row["currency"] for group in buckets.values() for row in group),
        to_currency=base,
    )
    as_of = rate_as_of(base)

    out = []
    for key, currency_rows in buckets.items():
        converted = converted_money(
            currency_rows, to_currency=base, rates=rates, as_of=as_of
        )
        out.append(
            {
                **meta[key],
                "spend": converted,
                "by_currency": [
                    {
                        "currency": row["currency"],
                        "monthly": _money(row["monthly"]),
                        "yearly": _money(row["yearly"]),
                        "count": row["count"],
                    }
                    for row in sorted(currency_rows, key=lambda r: r["currency"])
                ],
                "count": sum(row["count"] for row in currency_rows),
            }
        )
    # Biggest spender first, with unconvertible-only groups (0.00) last but
    # still present — a provider we cannot price is not a provider to hide.
    out.sort(key=lambda item: Decimal(item["spend"]["monthly"]), reverse=True)
    return out


def spend_by_provider(queryset, to_currency=None):
    def key_builder(row):
        provider_id = row["provider_account__provider__id"]
        return provider_id, {
            "provider_id": provider_id,
            "provider_name": row["provider_account__provider__name"] or "Unassigned",
            "provider_slug": row["provider_account__provider__slug"] or "",
            "brand_color": row["provider_account__provider__brand_color"] or "",
        }

    return _grouped_converted(
        queryset,
        group_fields=(
            "provider_account__provider__id",
            "provider_account__provider__name",
            "provider_account__provider__slug",
            "provider_account__provider__brand_color",
        ),
        key_builder=key_builder,
        to_currency=to_currency,
    )


def spend_by_property(queryset, to_currency=None):
    """{property_id: converted_money} for every property with spend, in one query.

    Exists so the property-card list does not issue one spend query per row.
    Properties with no active spend are simply absent; the caller supplies a
    zero block for those rather than paying for an outer join.
    """
    rows = queryset.filter(digital_property__isnull=False).values(
        "digital_property_id", "currency"
    ).annotate(count=Sum(Value(1)), **_CYCLE_SUMS)

    buckets = defaultdict(list)
    for row in rows:
        monthly, yearly = _equivalents(row["monthly_billed"], row["yearly_billed"])
        buckets[row["digital_property_id"]].append(
            {
                "currency": row["currency"],
                "monthly": monthly,
                "yearly": yearly,
                "count": row["count"] or 0,
            }
        )

    base = (to_currency or reporting_currency()).upper()
    rates = rate_table(
        (row["currency"] for group in buckets.values() for row in group),
        to_currency=base,
    )
    as_of = rate_as_of(base)
    return {
        property_id: converted_money(
            currency_rows, to_currency=base, rates=rates, as_of=as_of
        )
        for property_id, currency_rows in buckets.items()
    }


def zero_money(to_currency=None, as_of=_UNSET):
    """A complete, honest zero — used for properties with no active spend.

    Complete rather than incomplete: nothing was excluded, so `is_complete` is
    true. A zero that claims to be partial would put an amber warning on every
    property nobody has attached a service to yet.
    """
    return converted_money([], to_currency=to_currency, rates={}, as_of=as_of)


def spend_by_layer(queryset, to_currency=None):
    def key_builder(row):
        layer = row["service_layer"]
        return layer, {
            "layer": layer,
            "layer_label": estate.layer_label(layer) if layer else "Unassigned",
        }

    rows = _grouped_converted(
        queryset,
        group_fields=("service_layer",),
        key_builder=key_builder,
        to_currency=to_currency,
    )
    # Layers read in stack order, not by size — the strip is a stack, and a
    # reader expects registrar first whatever it costs.
    rows.sort(key=lambda item: estate.sort_key(item["layer"]))
    return rows


# ───────────────────────────── renewal timeline ─────────────────────────────

def renewal_timeline(queryset, *, days=None, today=None):
    """Active subscriptions renewing inside the window, soonest first.

    Returns flat rows. Lane packing is the frontend's job — it depends on
    rendered label width, which the server cannot know.
    """
    days = estate.TIMELINE_WINDOW_DAYS if days is None else days
    today = today or timezone.localdate()
    horizon = today + timezone.timedelta(days=days)

    rows = (
        queryset.filter(expiry_date__gte=today, expiry_date__lte=horizon)
        .select_related(
            "provider_account", "provider_account__provider", "digital_property"
        )
        .order_by("expiry_date", "name")
    )

    out = []
    for subscription in rows:
        days_until = (subscription.expiry_date - today).days
        provider = getattr(subscription.provider_account, "provider", None)
        out.append(
            {
                "id": subscription.id,
                "name": subscription.name,
                "identifier": subscription.identifier or subscription.name,
                "service_layer": subscription.service_layer,
                "service_layer_label": estate.layer_label(subscription.service_layer),
                "expiry_date": subscription.expiry_date,
                "days_until": days_until,
                "urgency": estate.renewal_urgency(days_until),
                "auto_renew": subscription.auto_renew,
                "is_at_risk": subscription.is_at_risk,
                "cost": _money(subscription.cost),
                "currency": subscription.currency,
                "provider_name": provider.name if provider else None,
                "brand_color": provider.brand_color if provider else "",
                "digital_property_id": subscription.digital_property_id,
                "digital_property_name": (
                    subscription.digital_property.name
                    if subscription.digital_property_id
                    else None
                ),
                "window_days": days,
            }
        )
    return out


# ───────────────────────────── stacks and gaps ─────────────────────────────

def _service_row(subscription):
    provider = getattr(subscription.provider_account, "provider", None)
    return {
        "id": subscription.id,
        "name": subscription.name,
        "identifier": subscription.identifier or "",
        "cost": _money(subscription.cost),
        "currency": subscription.currency,
        "billing_cycle": subscription.billing_cycle,
        "monthly_cost": _money(subscription.monthly_cost),
        "expiry_date": subscription.expiry_date,
        "days_until_expiry": subscription.days_until_expiry,
        "urgency": estate.renewal_urgency(subscription.days_until_expiry),
        "auto_renew": subscription.auto_renew,
        "is_at_risk": subscription.is_at_risk,
        "provider_account_id": subscription.provider_account_id,
        "provider_name": provider.name if provider else None,
        "brand_color": provider.brand_color if provider else "",
        "account_login": (
            subscription.provider_account.login_email
            if subscription.provider_account_id
            else None
        ),
    }


def property_stack(digital_property, *, today=None):
    """Every layer for one property, present or missing.

    Missing layers are returned as explicit rows rather than omitted: a gap you
    cannot see is a gap nobody fills. `is_gap` is true only for a *required*
    layer with nothing in it — Storage and Monitoring being empty is normal, and
    flagging them would train people to ignore the flag.

    Multiple services on one layer are all returned. Silently showing the first
    would hide a duplicate registrar, which is exactly the kind of thing this
    module exists to surface.
    """
    today = today or timezone.localdate()
    subscriptions = (
        digital_property.subscriptions.filter(active_q(today))
        .select_related("provider_account", "provider_account__provider")
        .order_by("service_layer", "name")
    )

    by_layer = defaultdict(list)
    for subscription in subscriptions:
        by_layer[subscription.service_layer].append(_service_row(subscription))

    layers = []
    for code, label in estate.SERVICE_LAYERS:
        services = by_layer.get(code, [])
        required = code in estate.REQUIRED_LAYERS
        layers.append(
            {
                "layer": code,
                "layer_label": label,
                "is_required": required,
                "configured": bool(services),
                "is_gap": required and not services,
                "service_count": len(services),
                "services": services,
            }
        )

    unassigned = by_layer.get(None, [])
    return {
        "layers": layers,
        "gap_count": sum(1 for row in layers if row["is_gap"]),
        "missing_layers": [row["layer"] for row in layers if row["is_gap"]],
        # Services on this property that nobody has placed in the stack. They
        # are real spend, so they must not vanish between the layer rows.
        "unassigned_services": unassigned,
        "unassigned_count": len(unassigned),
    }


def stack_coverage(*, today=None):
    """{property_id: {"present": set(layers), "count": n}} in one query.

    Used by the overview and gaps endpoints so neither has to walk properties
    one at a time asking "what do you have".
    """
    today = today or timezone.localdate()
    rows = (
        active_subscriptions(today)
        .filter(digital_property__isnull=False)
        .values("digital_property_id", "service_layer")
        .annotate(count=Sum(Value(1)))
    )
    coverage = defaultdict(lambda: {"present": set(), "count": 0})
    for row in rows:
        entry = coverage[row["digital_property_id"]]
        entry["count"] += row["count"] or 0
        if row["service_layer"]:
            entry["present"].add(row["service_layer"])
    return coverage


def estate_gaps(*, today=None):
    """Properties missing a required layer, and services attached to nothing."""
    from core.models import DigitalProperty

    today = today or timezone.localdate()
    coverage = stack_coverage(today=today)
    required = list(estate.REQUIRED_LAYERS)

    properties = []
    for prop in DigitalProperty.objects.filter(is_active=True).select_related(
        "owner", "department"
    ):
        entry = coverage.get(prop.id, {"present": set(), "count": 0})
        missing = [code for code in required if code not in entry["present"]]
        if not missing:
            continue
        properties.append(
            {
                "id": prop.id,
                "name": prop.name,
                "kind": prop.kind,
                "kind_label": prop.get_kind_display(),
                "owner_id": prop.owner_id,
                "owner_name": prop.owner.full_name if prop.owner_id else None,
                "service_count": entry["count"],
                "missing_layers": missing,
                "missing_layer_labels": [estate.layer_label(code) for code in missing],
                "missing_count": len(missing),
            }
        )
    properties.sort(key=lambda item: (-item["missing_count"], item["name"]))

    orphans = [
        _service_row(subscription) | {"currency": subscription.currency}
        for subscription in active_subscriptions(today)
        .filter(digital_property__isnull=True)
        .select_related("provider_account", "provider_account__provider")
        .order_by("name")
    ]

    return {
        "properties_with_gaps": properties,
        "property_gap_count": len(properties),
        "total_missing_layers": sum(item["missing_count"] for item in properties),
        "orphaned_services": orphans,
        "orphan_count": len(orphans),
        "required_layers": [
            {"layer": code, "layer_label": estate.layer_label(code)}
            for code in required
        ],
    }


# ───────────────────────────────── overview ─────────────────────────────────

def overview(*, to_currency=None, timeline_days=None, today=None):
    from core.models import DigitalProperty, ProviderAccount

    today = today or timezone.localdate()
    active = active_subscriptions(today)

    currency_rows = spend_by_currency(active)
    total = converted_money(currency_rows, to_currency=to_currency)

    gaps = estate_gaps(today=today)

    at_risk = [
        subscription
        for subscription in active.filter(
            auto_renew=False,
            expiry_date__gte=today,
            expiry_date__lte=today + timezone.timedelta(days=estate.AT_RISK_WINDOW_DAYS),
        ).select_related("provider_account__provider", "digital_property")
    ]

    accounts = ProviderAccount.objects.filter(is_active=True)
    mfa_counts = defaultdict(int)
    for method in accounts.values_list("mfa_method", flat=True):
        mfa_counts[method] += 1
    no_mfa = mfa_counts.get("NONE", 0)
    weak_mfa = mfa_counts.get("SMS", 0)
    unknown_mfa = mfa_counts.get("UNKNOWN", 0)

    return {
        "as_of": today,
        "total_spend": total,
        "spend_by_currency": [
            {
                "currency": row["currency"],
                "monthly": _money(row["monthly"]),
                "yearly": _money(row["yearly"]),
                "count": row["count"],
            }
            for row in currency_rows
        ],
        "spend_by_provider": spend_by_provider(active, to_currency=to_currency),
        "spend_by_layer": spend_by_layer(active, to_currency=to_currency),
        "renewal_timeline": renewal_timeline(
            active, days=timeline_days, today=today
        ),
        "kpis": {
            "service_count": active.count(),
            "property_count": DigitalProperty.objects.filter(is_active=True).count(),
            "account_count": accounts.count(),
            "provider_count": accounts.values("provider_id").distinct().count(),
            "orphan_count": gaps["orphan_count"],
            "at_risk_count": len(at_risk),
            "stack_gap_count": gaps["total_missing_layers"],
            "properties_with_gaps": gaps["property_gap_count"],
            "accounts_without_mfa": no_mfa,
            "accounts_with_weak_mfa": weak_mfa,
            "accounts_with_unknown_mfa": unknown_mfa,
        },
        "at_risk_services": [_service_row(s) for s in at_risk],
        "orphaned_services": gaps["orphaned_services"],
        "layers": [
            {
                "layer": code,
                "layer_label": label,
                "is_required": code in estate.REQUIRED_LAYERS,
            }
            for code, label in estate.SERVICE_LAYERS
        ],
        "thresholds": {
            "at_risk_window_days": estate.AT_RISK_WINDOW_DAYS,
            "urgent_window_days": estate.URGENT_WINDOW_DAYS,
            "timeline_window_days": (
                estate.TIMELINE_WINDOW_DAYS if timeline_days is None else timeline_days
            ),
        },
    }
