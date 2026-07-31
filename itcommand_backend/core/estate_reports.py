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


# ───────────────────────────── configured shape ─────────────────────────────

def estate_settings():
    from core.models import EstateSettings

    return EstateSettings.get_solo()


def tracked_layers(settings=None):
    """Service-type codes this organisation tracks, in its configured order.

    `core.estate.SERVICE_TYPES` remains the catalog of what is possible; this
    is what the org opted into.
    """
    return (settings or estate_settings()).tracked_layers()


def tracked_stack_types(settings=None):
    """Tracked codes that actually occupy a stack position.

    The stack diagram and the gap count read this, never `tracked_layers`.
    Only the seven stack roles form the chain a request travels through, so
    only they can be *missing* from it — SaaS, Storage, Monitoring and Other
    have no slot to be absent from.

    This intersection is load-bearing rather than tidy-minded. An
    `EstateSettings` row saved before the Phase 1 rework holds all ten
    pre-rework codes, and without it every property renders three permanent
    amber gaps for Storage, Monitoring and Other — which is exactly how people
    learn to ignore the colour that is supposed to mean "fix this".
    """
    tracked = tracked_layers(settings)
    return [code for code in tracked if code in estate.STACK_TYPE_CODES]


def urgency_for(days_until, settings=None):
    """Renewal tone, using the org's windows rather than the module defaults."""
    settings = settings or estate_settings()
    if days_until is None:
        return "muted"
    if days_until < 0 or days_until <= settings.renewal_urgent_days:
        return "critical"
    if days_until <= settings.renewal_warning_days:
        return "warning"
    return "muted"


# ───────────────────────────── active-service scope ─────────────────────

def active_q(today=None):
    """Services counted as live spend.

    Simpler than the predecessor this replaces. `Subscription` carried
    `start_date` and `expiry_date`, so "active" meant a status *and* a date
    window, and the SQL had to mirror a Python property that compared dates at
    read time. `Service.status` is the single stored answer — a lapsed service
    is EXPIRED, a stopped one CANCELLED — so there is no second definition left
    to drift out of sync.

    AT_RISK is deliberately included: an at-risk service is still being paid
    for. Excluding it would drop its cost out of the monthly total at exactly
    the moment someone is looking at it.

    `today` is accepted and unused so callers can keep passing the date they
    already computed rather than special-casing this one function.
    """
    return Q(status__in=("ACTIVE", "AT_RISK"))


def active_services(today=None):
    from core.models import Service

    return Service.objects.filter(active_q(today))


def legacy_active_subscriptions(today=None):
    """Active `Subscription` rows, for the pre-rework finance linkage only.

    `core.finance_estate` groups spend by `budget_category` and `vendor`, which
    live on `Subscription` and have no counterpart on `Service` — the estate
    spec does not carry finance links. Rather than add speculative fields to the
    new model or break a working module, that code keeps reading the old table
    until Phase 5 retires both it and this function.

    Nothing in the estate API path may call this.
    """
    from core.models import Subscription

    today = today or timezone.localdate()
    return Subscription.objects.filter(
        Q(status="ACTIVE", start_date__lte=today, expiry_date__gte=today)
    )


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
        provider_id = row["provider__id"]
        return provider_id, {
            "provider_id": provider_id,
            "provider_name": row["provider__name"] or "Unassigned",
            "provider_slug": row["provider__slug"] or "",
            "brand_color": row["provider__brand_color"] or "",
        }

    return _grouped_converted(
        queryset,
        group_fields=(
            "provider__id",
            "provider__name",
            "provider__slug",
            "provider__brand_color",
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
    rows = queryset.filter(property__isnull=False).values(
        "property_id", "currency"
    ).annotate(count=Sum(Value(1)), **_CYCLE_SUMS)

    buckets = defaultdict(list)
    for row in rows:
        monthly, yearly = _equivalents(row["monthly_billed"], row["yearly_billed"])
        buckets[row["property_id"]].append(
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
        layer = row["service_type"]
        return layer, {
            "layer": layer,
            "layer_label": estate.service_type_label(layer) if layer else "Unassigned",
        }

    rows = _grouped_converted(
        queryset,
        group_fields=("service_type",),
        key_builder=key_builder,
        to_currency=to_currency,
    )
    # Layers read in stack order, not by size — the strip is a stack, and a
    # reader expects registrar first whatever it costs.
    rows.sort(key=lambda item: estate.sort_key(item["layer"]))
    return rows


# ───────────────────────────── renewal timeline ─────────────────────────────

def _at_risk(service, days_until, settings):
    """Settings-aware at-risk, agreeing with `Service.is_at_risk`.

    The model property uses the module default window; the org may have
    configured a different one. Both answer True for a manually-flagged
    AT_RISK service, so a human's judgement is never overridden by arithmetic
    in one place and honoured in the other.
    """
    if service.status == "AT_RISK":
        return True
    if service.auto_renew or service.status != "ACTIVE":
        return False
    if days_until is None:
        return False
    return 0 <= days_until <= settings.renewal_warning_days


def renewal_timeline(queryset, *, days=None, today=None, settings=None):
    """Active services renewing inside the window, soonest first.

    One query over the whole window. The frontend slices it for its 30/60/90
    views — separate per-window endpoints would be three round trips returning
    overlapping subsets of the same rows.

    Returns flat rows. Lane packing is the frontend's job: it depends on
    rendered label width, which the server cannot know.
    """
    settings = settings or estate_settings()
    days = settings.timeline_window_days if days is None else days
    today = today or timezone.localdate()
    horizon = today + timezone.timedelta(days=days)

    rows = (
        queryset.filter(renewal_date__gte=today, renewal_date__lte=horizon)
        .select_related("provider", "provider_account", "property")
        .order_by("renewal_date", "identifier")
    )

    out = []
    for service in rows:
        days_until = (service.renewal_date - today).days
        provider = service.provider
        out.append(
            {
                "id": service.id,
                # `identifier` is the display name; there is no second `name`
                # field to keep truthful. Both keys are emitted because the
                # dashboard contract names one and the stack rows the other.
                "name": service.identifier,
                "identifier": service.identifier,
                "service_type": service.service_type,
                "service_type_label": estate.service_type_label(service.service_type),
                "provider_slug": provider.slug if provider else "",
                "renewal_date": service.renewal_date,
                "days_until": days_until,
                "urgency": urgency_for(days_until, settings),
                "auto_renew": service.auto_renew,
                "is_at_risk": _at_risk(service, days_until, settings),
                "cost": _money(service.cost),
                "currency": service.currency,
                "provider_name": provider.name if provider else None,
                "brand_color": provider.brand_color if provider else "",
                "property_id": service.property_id,
                "property": service.property.name if service.property_id else None,
                "property_name": service.property.name if service.property_id else None,
                "window_days": days,
            }
        )
    return out


# ───────────────────────────── stacks and gaps ─────────────────────────────

def _service_row(service, settings=None):
    settings = settings or estate_settings()
    provider = service.provider
    days_until = service.days_until_renewal
    return {
        "id": service.id,
        "name": service.identifier,
        "identifier": service.identifier,
        "service_type": service.service_type,
        "service_type_label": estate.service_type_label(service.service_type),
        "cost": _money(service.cost),
        "currency": service.currency,
        "billing_cycle": service.billing_cycle,
        "monthly_cost": _money(service.monthly_equivalent),
        "renewal_date": service.renewal_date,
        "days_until_expiry": days_until,
        "urgency": urgency_for(days_until, settings),
        "auto_renew": service.auto_renew,
        "is_at_risk": _at_risk(service, days_until, settings),
        "status": service.status,
        "provider_account_id": service.provider_account_id,
        "provider_name": provider.name if provider else None,
        "provider_slug": provider.slug if provider else "",
        "brand_color": provider.brand_color if provider else "",
        "account_login": (
            service.provider_account.account_email
            if service.provider_account_id
            else None
        ),
        "console_url": service.console_url or (provider.console_url if provider else ""),
        # Id and title only — never a secret. See ServiceSerializer.
        "vault_credential_id": service.vault_credential_id,
    }


def property_stack(prop, *, today=None, settings=None):
    """Every stack role for one property, present or missing.

    Missing roles are returned as explicit rows rather than omitted: a gap you
    cannot see is a gap nobody fills. `is_gap` is true only for a *tracked*
    role with nothing in it — SaaS, Storage and Monitoring being empty is
    normal, and flagging them would train people to ignore the flag.

    Multiple services on one role are all returned. Silently showing the first
    would hide a duplicate registrar, which is exactly the kind of thing this
    module exists to surface.
    """
    today = today or timezone.localdate()
    settings = settings or estate_settings()
    tracked = tracked_stack_types(settings)
    services = (
        prop.services.filter(active_q(today))
        .select_related("provider", "provider_account")
        .order_by("service_type", "identifier")
    )

    by_layer = defaultdict(list)
    for service in services:
        by_layer[service.service_type].append(_service_row(service, settings))

    # The diagram is the tracked stack roles, in configured order, and nothing
    # else. A role with no live service is still rendered — as an empty slot —
    # because a gap you cannot see is a gap nobody fills.
    layers = []
    for code in tracked:
        services = by_layer.get(code, [])
        layers.append(
            {
                "layer": code,
                "layer_label": estate.service_type_label(code),
                "is_required": True,
                "is_tracked": True,
                "configured": bool(services),
                "is_gap": not services,
                "service_count": len(services),
                "services": services,
            }
        )

    # Everything attached to this property that holds no stack position: SaaS,
    # and anything whose role the org has switched off in Settings. Listed
    # separately below the diagram rather than as extra nodes in it — they are
    # real spend, so they must not vanish, but they are not part of the chain a
    # request travels through and drawing them there would misrepresent it.
    off_stack = [
        row
        for code, rows in by_layer.items()
        if code not in tracked
        for row in rows
    ]
    off_stack.sort(key=lambda row: (estate.sort_key(row["service_type"]), row["name"]))

    return {
        "layers": layers,
        "gap_count": sum(1 for row in layers if row["is_gap"]),
        "missing_layers": [row["layer"] for row in layers if row["is_gap"]],
        # Key kept as `unassigned_*` for the existing frontend; the meaning is
        # now "attached here but outside the stack" rather than "no layer set",
        # which `Service.service_type` no longer allows.
        "unassigned_services": off_stack,
        "unassigned_count": len(off_stack),
        "off_stack_services": off_stack,
    }


def stack_coverage(*, today=None):
    """{property_id: {"present": set(layers), "count": n}} in one query.

    Used by the overview and gaps endpoints so neither has to walk properties
    one at a time asking "what do you have".
    """
    today = today or timezone.localdate()
    rows = (
        active_services(today)
        .filter(property__isnull=False)
        .values("property_id", "service_type")
        .annotate(count=Sum(Value(1)))
    )
    coverage = defaultdict(lambda: {"present": set(), "count": 0})
    for row in rows:
        entry = coverage[row["property_id"]]
        entry["count"] += row["count"] or 0
        if row["service_type"]:
            entry["present"].add(row["service_type"])
    return coverage


def estate_gaps(*, today=None, settings=None):
    """Properties missing a tracked layer, and services attached to nothing."""
    from core.models import Property

    today = today or timezone.localdate()
    settings = settings or estate_settings()
    coverage = stack_coverage(today=today)
    required = tracked_stack_types(settings)

    properties = []
    for prop in Property.objects.filter(is_active=True).select_related(
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
                "missing_layer_labels": [estate.service_type_label(code) for code in missing],
                "missing_count": len(missing),
            }
        )
    properties.sort(key=lambda item: (-item["missing_count"], item["name"]))

    orphans = [
        _service_row(service, settings)
        for service in active_services(today)
        .filter(property__isnull=True)
        .select_related("provider", "provider_account")
        .order_by("identifier")
    ]

    return {
        "properties_with_gaps": properties,
        "property_gap_count": len(properties),
        "total_missing_layers": sum(item["missing_count"] for item in properties),
        "orphaned_services": orphans,
        "orphan_count": len(orphans),
        "required_layers": [
            {"layer": code, "layer_label": estate.service_type_label(code)}
            for code in required
        ],
    }


# ───────────────────────────────── overview ─────────────────────────────────

def overview(*, to_currency=None, timeline_days=None, today=None):
    from core.models import Property, ProviderAccount

    today = today or timezone.localdate()
    settings = estate_settings()
    active = active_services(today)

    currency_rows = spend_by_currency(active)
    total = converted_money(currency_rows, to_currency=to_currency)

    gaps = estate_gaps(today=today, settings=settings)

    # The stored flag or the derived condition, matching `Service.is_at_risk`
    # and the `?at_risk=` filter on the services list. Three places asking the
    # same question must not answer it three ways.
    at_risk = list(
        active.filter(
            Q(status="AT_RISK")
            | Q(
                status="ACTIVE",
                auto_renew=False,
                renewal_date__gte=today,
                renewal_date__lte=today
                + timezone.timedelta(days=settings.renewal_warning_days),
            )
        ).select_related("provider", "provider_account", "property")
    )

    accounts = ProviderAccount.objects.filter(is_active=True)
    mfa_counts = defaultdict(int)
    for method in accounts.values_list("mfa_type", flat=True):
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
            active, days=timeline_days, today=today, settings=settings
        ),
        "kpis": {
            "service_count": active.count(),
            "property_count": Property.objects.filter(is_active=True).count(),
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
        "at_risk_services": [_service_row(s, settings) for s in at_risk],
        "orphaned_services": gaps["orphaned_services"],
        "layers": layer_catalog(settings),
        "thresholds": {
            "at_risk_window_days": settings.renewal_warning_days,
            "urgent_window_days": settings.renewal_urgent_days,
            "timeline_window_days": (
                settings.timeline_window_days if timeline_days is None else timeline_days
            ),
        },
        "alerts": {
            "on_auto_renew_off": settings.alert_on_auto_renew_off,
            "on_new_orphan": settings.alert_on_new_orphan,
        },
    }


def currency_status(*, base=None, on_date=None):
    """Every currency actually in use, and whether it converts into `base`.

    "In use" spans estate services and vendor contracts, because both feed money
    figures a user will see. A currency with no rate is reported with what it is
    costing, so the admin fixing it can see what the gap is worth rather than
    just that one exists.
    """
    from core.models import Service, VendorContract

    base = (base or reporting_currency()).upper()

    usage = defaultdict(lambda: {"subscriptions": 0, "contracts": 0})
    for row in (
        Service.objects.filter(active_q())
        .values("currency")
        .annotate(total=Sum(Value(1)))
    ):
        # Key kept as `subscriptions` until Phase 3 moves the Settings screen
        # that reads it; the count behind it is now services.
        usage[(row["currency"] or "").upper()]["subscriptions"] = row["total"] or 0
    for row in (
        VendorContract.objects.exclude(currency="")
        .values("currency")
        .annotate(total=Sum(Value(1)))
    ):
        usage[(row["currency"] or "").upper()]["contracts"] = row["total"] or 0
    usage.pop("", None)

    spend = {
        row["currency"]: row for row in spend_by_currency(active_services())
    }

    rows = []
    for code in sorted(usage):
        rate = get_rate(code, base=base, on_date=on_date)
        monthly = spend.get(code, {}).get("monthly", ZERO)
        rows.append(
            {
                "currency": code,
                "has_rate": rate is not None,
                "rate": str(rate) if rate is not None else None,
                "is_base": code == base,
                "subscription_count": usage[code]["subscriptions"],
                "contract_count": usage[code]["contracts"],
                "monthly_spend": _money(monthly),
            }
        )
    return rows


def dashboard(*, to_currency=None, today=None):
    """Everything the Estate dashboard renders, in one call.

    Deliberately one endpoint rather than five. The KPI row, the timeline and
    both breakdowns are read from the same set of active services; splitting
    them would mean five round trips that can disagree with each other because
    a service changed between the first and the last.

    The payload is the shape the Phase 2 brief specifies. `kpis.unconverted`
    is the important part: when a currency has no rate its spend is listed
    there rather than folded in at 1:1 or silently dropped, so
    `monthly_spend` is never a figure that quietly omits the larger number.
    """
    from core.models import Property, ProviderAccount

    today = today or timezone.localdate()
    settings = estate_settings()
    active = active_services(today)

    currency_rows = spend_by_currency(active)
    total = converted_money(currency_rows, to_currency=to_currency)

    timeline = renewal_timeline(
        active, days=settings.timeline_window_days, today=today, settings=settings
    )
    renewals_30d = sum(
        1 for row in timeline if row["days_until"] <= settings.renewal_warning_days
    )

    by_provider = spend_by_provider(active, to_currency=to_currency)
    # Percentages are of the *converted* total, so they sum to 100 across what
    # could be priced. A provider billed only in an unconvertible currency
    # shows 0.0% next to a non-zero unconverted figure rather than being
    # dropped, which would make the remaining shares look complete.
    total_monthly = Decimal(total["monthly"])
    for row in by_provider:
        monthly = Decimal(row["spend"]["monthly"])
        row["slug"] = row.get("provider_slug") or ""
        row["name"] = row.get("provider_name") or "Unassigned"
        row["monthly"] = row["spend"]["monthly"]
        row["pct"] = (
            str((monthly / total_monthly * 100).quantize(TWOPLACES, rounding=ROUND_HALF_UP))
            if total_monthly > 0
            else "0.00"
        )

    by_category = []
    for row in spend_by_layer(active, to_currency=to_currency):
        by_category.append(
            {
                "service_type": row["layer"],
                "label": row["layer_label"],
                "monthly": row["spend"]["monthly"],
                "count": row["count"],
                "spend": row["spend"],
            }
        )

    orphan_count = active.filter(property__isnull=True).count()
    accounts = ProviderAccount.objects.filter(is_active=True)
    missing_mfa = accounts.filter(mfa_type__in=("NONE", "UNKNOWN")).count()

    return {
        "as_of": today,
        "currency": total["currency"],
        "kpis": {
            "monthly_spend": total["monthly"],
            "yearly_spend": total["yearly"],
            "currency": total["currency"],
            "active_services": active.count(),
            "renewals_30d": renewals_30d,
            "accounts_missing_mfa": missing_mfa,
            "accounts_without_mfa": accounts.filter(mfa_type="NONE").count(),
            "orphan_services": orphan_count,
            "properties": Property.objects.filter(is_active=True).count(),
            # Named `unconverted` because the brief names it that. It carries
            # the same rows as the `unconvertible` block on every money figure.
            "unconverted": [
                {"currency": row["currency"], "monthly": row["amount"]}
                for row in total["unconvertible"]
            ],
            "is_complete": total["is_complete"],
        },
        "total_spend": total,
        "timeline": timeline,
        "by_provider": by_provider,
        "by_category": by_category,
        "thresholds": {
            "at_risk_window_days": settings.renewal_warning_days,
            "urgent_window_days": settings.renewal_urgent_days,
            "timeline_window_days": settings.timeline_window_days,
        },
        "service_types": layer_catalog(settings),
    }


def layer_catalog(settings=None):
    """Tracked layers in configured order, then the rest of the catalog.

    The whole catalog is returned — an untracked layer must still be selectable
    when adding a service — but `is_tracked` says which ones count toward gaps.
    """
    settings = settings or estate_settings()
    tracked = tracked_layers(settings)
    remainder = [code for code in estate.SERVICE_TYPE_CODES if code not in tracked]
    return [
        {
            "layer": code,
            "layer_label": estate.service_type_label(code),
            "is_required": code in tracked,
            "is_tracked": code in tracked,
        }
        for code in [*tracked, *remainder]
    ]
