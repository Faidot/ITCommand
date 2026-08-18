"""Digital Estate taxonomy — the single source of truth for the service stack.

The layer order is not alphabetical and not arbitrary: it is the order a request
travels through the stack. The registrar owns the name, DNS answers for it, the
host serves it, mail routes from it, and so on. Reports, the property "stack
strip" and the gap calculation all render layers in this order.

Keeping the order here — and serving it from the API — is deliberate: the
frontend must never hardcode it, or adding a layer in one place silently
disagrees with the other.
"""

# ─────────────────────────── service types ───────────────────────────

#: The seven stack roles, in the order a request travels through them. A
#: property is expected to have one service in each before it counts as fully
#: configured, so this tuple is simultaneously the stack order and the gap
#: checklist. Nothing else may define either.
STACK_TYPES = (
    ("REGISTRAR", "Registrar"),
    ("DNS", "DNS"),
    ("HOSTING", "Hosting"),
    ("MAIL", "Mail"),
    ("CDN", "CDN"),
    ("TLS", "TLS"),
    ("ANALYTICS", "Analytics"),
)

#: Types that are tracked and billed but hold no stack position. A service of
#: one of these types can still attach to a property — a monitoring plan for a
#: game, say — but its absence is never reported as a gap, because there is no
#: slot for it to be missing from.
#:
#: SAAS is the catch-all for anything outside a property's infrastructure:
#: design tools, an API subscription, a CI plan. STORAGE, MONITORING and OTHER
#: predate this module's rework and are retained so existing rows and any
#: `EstateSettings.enabled_layers` naming them stay valid.
NON_STACK_TYPES = (
    ("SAAS", "SaaS"),
    ("STORAGE", "Storage"),
    ("MONITORING", "Monitoring"),
    ("OTHER", "Other"),
)

#: Every service type. Stack roles first, in stack order, then the rest.
SERVICE_TYPES = STACK_TYPES + NON_STACK_TYPES

SERVICE_TYPE_CODES = tuple(code for code, _ in SERVICE_TYPES)

SERVICE_TYPE_LABELS = dict(SERVICE_TYPES)

#: Codes that occupy a stack position, as a set for membership tests.
STACK_TYPE_CODES = tuple(code for code, _ in STACK_TYPES)

#: code -> stack position, for stable ordering of rows fetched out of order.
#: Non-stack types sort after every stack role.
SERVICE_TYPE_ORDER = {code: index for index, (code, _) in enumerate(SERVICE_TYPES)}


# ───────────────────────── admin-added types ─────────────────────────────
#
# The seven stack roles and the built-in extras above are fixed: gap analysis,
# the stack diagram and the dashboard all branch on those codes. Anything an
# organisation adds beyond them is a *category* — billed and reported, never
# counted as a gap — and lives in the List of Values so it can be added without
# a deploy.
#
# These functions are the single place that merges the two. Read through them
# rather than the tuples above and a custom type works everywhere: model
# validation, the API, the add-service form and the bulk importer.


#: Cached admin additions, keyed by LOV group.
#:
#: Django asks a field for its `choices` once per serialized row, so reading
#: the List of Values table on every call turned a 10-query list endpoint into
#: 1380 queries. This collapses that to one per request.
#:
#: Scoped to the request rather than the process, cleared on `request_started`
#: (see core.signals). That choice does the work of three separate fixes:
#: an edit is visible on the very next request instead of waiting for a TTL;
#: every Gunicorn worker sees it, not just the one that handled the write; and
#: tests cannot leak a cached type past the rollback that removed it, which is
#: exactly what a process-lifetime cache did — one test adding a type made an
#: unrelated later test see twelve layers where the code defines eleven.
_LOV_CACHE: dict = {}
#: Backstop for callers outside the request cycle — management commands, the
#: automation loop — where `request_started` never fires.
_LOV_CACHE_TTL_SECONDS = 30


def clear_type_cache():
    """Drop the cached additions. Called when a List of Values row changes."""
    _LOV_CACHE.clear()


_RESOLVING: set = set()


def _lov_extras(group, builtin_codes):
    """Codes an admin added to `group`, minus anything already built in."""
    import time

    # Re-entry means something this function calls has looped back into it —
    # a List of Values seed reading the model field whose choices come from
    # this group, say. Returning the built-ins breaks the cycle at its first
    # turn instead of recursing until Python gives up, which previously
    # surfaced as a mysterious query-per-row rather than as an error.
    if group in _RESOLVING:
        return ()

    cached = _LOV_CACHE.get(group)
    if cached and (time.monotonic() - cached[0]) < _LOV_CACHE_TTL_SECONDS:
        return cached[1]

    _RESOLVING.add(group)
    try:
        from core.lov import get_values

        rows = get_values(group)
    except Exception:
        # A missing table during migrate, or a group renamed out from under
        # us. Built-ins alone are always a usable answer, and this must never
        # be the reason a page fails to render.
        return ()
    finally:
        _RESOLVING.discard(group)

    extras = tuple(
        (code, label) for code, label in rows if code and code not in builtin_codes
    )
    _LOV_CACHE[group] = (time.monotonic(), extras)
    return extras


def service_type_choices():
    """Every selectable service type: built-ins first, then admin additions.

    Passed to the model field as a callable, so Django re-evaluates it rather
    than freezing the list at import. A type added in Settings is immediately
    valid on save without a migration or a restart.
    """
    return list(SERVICE_TYPES) + list(_lov_extras("subscription_category", SERVICE_TYPE_CODES))


def service_type_codes():
    return tuple(code for code, _ in service_type_choices())


def property_kind_choices():
    return list(PROPERTY_KINDS) + list(
        _lov_extras("estate_property_kind", tuple(c for c, _ in PROPERTY_KINDS))
    )


def property_kind_codes():
    return tuple(code for code, _ in property_kind_choices())


def service_type_label(code):
    """Human label for a service type, falling back to the code itself."""
    if code in SERVICE_TYPE_LABELS:
        return SERVICE_TYPE_LABELS[code]
    for candidate, label in _lov_extras("subscription_category", SERVICE_TYPE_CODES):
        if candidate == code:
            return label
    return code or ""


def is_stack_type(code):
    """Does this type occupy a position in a property's stack?

    The gap calculation asks this and nothing else. A type that answers False
    is billed and reported but never counted as missing.
    """
    return code in STACK_TYPE_CODES


def sort_key(code):
    """Sort helper putting unknown codes last rather than first."""
    return SERVICE_TYPE_ORDER.get(code, len(SERVICE_TYPES))


# ─────────────────────────── service lifecycle ───────────────────────────

#: Where a service is in its life. AT_RISK is stored, not only derived: a
#: service can be flagged by hand ahead of the renewal window that
#: `is_at_risk` would catch on its own.
SERVICE_STATUSES = (
    ("ACTIVE", "Active"),
    ("AT_RISK", "At risk"),
    ("EXPIRED", "Expired"),
    ("CANCELLED", "Cancelled"),
)

#: How often the money leaves. USAGE and FREE both normalise to a zero monthly
#: equivalent — usage-based spend is real but not knowable from a fixed figure,
#: and inventing one would put fiction into the total.
BILLING_CYCLES = (
    ("MONTHLY", "Monthly"),
    ("YEARLY", "Yearly"),
    ("USAGE", "Usage-based"),
    ("FREE", "Free"),
)

#: Cycles whose `cost` does not describe a recurring, predictable charge.
UNPRICED_CYCLES = ("USAGE", "FREE")


# ──────────────────── deprecated layer aliases (removed in Phase 5) ────────────────────
#
# The pre-rework module called this taxonomy "service layers" and split it
# across four names. `Subscription`, `estate_reports` and the estate
# serializers still import them. They are aliases over the tuples above rather
# than second definitions, so the two cannot drift while both exist.

SERVICE_LAYERS = SERVICE_TYPES
SERVICE_LAYER_CODES = SERVICE_TYPE_CODES
SERVICE_LAYER_LABELS = SERVICE_TYPE_LABELS
SERVICE_LAYER_ORDER = SERVICE_TYPE_ORDER
REQUIRED_LAYERS = STACK_TYPE_CODES


def layer_label(code):
    """Deprecated alias for `service_type_label`."""
    return service_type_label(code)


# ─────────────────────────── property kinds ───────────────────────────

#: What a digital property *is*. Phase 4 moves this behind the ListOfValues
#: registry so an admin can extend it; until then the codes live here so both
#: the model and the API read the same tuple.
PROPERTY_KINDS = (
    ("MOBILE_GAME", "Mobile game"),
    ("APP", "App"),
    ("MARKETING", "Marketing site"),
    ("CORPORATE", "Corporate site"),
    ("STUDIO", "Studio site"),
    ("INFRA", "Infrastructure domain"),
    ("PARKED", "Parked"),
    ("OTHER", "Other"),
)


# ─────────────────────── provider account security ───────────────────────

#: How someone signs in to a provider account.
AUTH_TYPES = (
    ("PASSWORD", "Password"),
    ("SSO", "Single sign-on"),
    ("API_KEY", "API key"),
    ("IAM", "IAM / identity centre"),
    ("OTHER", "Other"),
)

#: Second factor on the account. UNKNOWN is the honest default — an account
#: nobody has checked is not the same as an account known to have none, and
#: collapsing the two would either invent reassurance or invent an alarm.
MFA_TYPES = (
    ("SECURITY_KEY", "Security key"),
    ("APP", "Authenticator app"),
    ("SMS", "SMS"),
    ("NONE", "None"),
    ("UNKNOWN", "Not recorded"),
)

#: Risk tone per MFA type, so the API — not the UI — decides what is alarming.
#: An account with no second factor holding production infrastructure is the
#: single most useful thing the Accounts view surfaces; it must never render
#: as neutral.
MFA_SEVERITY = {
    "NONE": "critical",
    "SMS": "warning",
    "APP": "ok",
    "SECURITY_KEY": "ok",
    "UNKNOWN": "muted",
}


def mfa_severity(code):
    return MFA_SEVERITY.get(code, "muted")


# ──────────────────── deprecated auth aliases (removed in Phase 5) ────────────────────
#
# `KEY` became `SECURITY_KEY` so the code reads the same as the label the
# Accounts table shows. Migration 0066 rewrites stored rows; this mapping is
# what it uses, and what any fixture loaded from a pre-rework dump needs.

AUTH_METHODS = AUTH_TYPES
MFA_METHODS = MFA_TYPES

#: Old code -> new code, for the data migration and for reading legacy dumps.
LEGACY_MFA_CODES = {"KEY": "SECURITY_KEY"}


# ─────────────────────────────── thresholds ───────────────────────────────

#: A subscription that will not auto-renew and expires inside this window is
#: "at risk" — nobody has told the provider to keep it, and it is close enough
#: to matter. Phase 4 turns this into a configurable Master Setting; it lives
#: here as one constant so that change is a single edit.
AT_RISK_WINDOW_DAYS = 30

#: How far ahead the renewal timeline looks.
TIMELINE_WINDOW_DAYS = 90

#: A renewal inside this window is urgent, not merely upcoming.
URGENT_WINDOW_DAYS = 7


def is_at_risk(*, auto_renew, effective_status, days_until_expiry, window_days=None):
    """Will not renew itself, and expires soon enough for that to matter.

    A pure function so the model property and the settings-aware API layer share
    one definition. `Subscription.is_at_risk` calls it with the default window;
    `estate_reports` calls it with whatever the organisation configured. Two
    copies of this rule would eventually disagree, and the KPI would stop
    matching the row it counted.
    """
    if auto_renew or effective_status != "ACTIVE":
        return False
    if days_until_expiry is None:
        return False
    window = AT_RISK_WINDOW_DAYS if window_days is None else window_days
    return 0 <= days_until_expiry <= window


def renewal_urgency(days_until):
    """Tone for a renewal that lands in `days_until` days.

    Returned by the API rather than derived in the UI, for the same reason as
    `mfa_severity`: two places computing "is this alarming" drift apart, and the
    one that drifts is always the one a user is looking at.
    """
    if days_until is None:
        return "muted"
    if days_until < 0:
        return "critical"
    if days_until <= URGENT_WINDOW_DAYS:
        return "critical"
    if days_until <= AT_RISK_WINDOW_DAYS:
        return "warning"
    return "muted"


# ─────────────────────── logins on an account ───────────────────────
#
# A ProviderAccount is one *tenant* — one AWS account, one Google Workspace,
# one Figma team. It is one bill and one console, and services hang off it.
#
# The people who can actually sign in are a separate thing, because there are
# usually several of them and they do not share a second factor. Folding them
# into the account was the old model's mistake: it could say "AWS has MFA"
# while one person on it had none, which is precisely the case worth knowing.

#: What kind of thing the login string is. The column has always been free
#: text — plenty of providers issue usernames or account numbers rather than
#: email addresses — but nothing recorded *which*, so the field was labelled
#: "Account email" and looked broken to anybody typing a username.
LOGIN_KINDS = (
    ("EMAIL", "Email address"),
    ("USERNAME", "Username"),
    ("ACCOUNT_ID", "Account ID / number"),
    ("PHONE", "Phone number"),
)

#: What a person can do on the account. Deliberately coarse: this records
#: authority, not a provider's own permission model, which no two providers
#: agree on and which would go stale the moment anybody edited it upstream.
ACCOUNT_ROLES = (
    ("OWNER", "Owner / root"),
    ("ADMIN", "Administrator"),
    ("BILLING", "Billing only"),
    ("MEMBER", "Member"),
    ("READONLY", "Read only"),
)

#: Roles that can change or destroy things, for the "who has the keys" count.
PRIVILEGED_ROLES = ("OWNER", "ADMIN")

#: How alarming each second factor is, worst first. `mfa_severity` answers the
#: same question for one login; this orders them so an account holding several
#: logins can report the weakest, which is the one that matters.
#:
#: UNKNOWN sits between SMS and APP on purpose. Nobody has checked, so it must
#: not read as safe — but it is not evidence of absence either, and ranking it
#: below NONE would let an unchecked login outrank a login known to have none.
MFA_RISK_ORDER = {
    "NONE": 0,
    "SMS": 1,
    "UNKNOWN": 2,
    "APP": 3,
    "SECURITY_KEY": 4,
}


def worst_mfa(codes):
    """The weakest second factor in `codes`, or None when there are none.

    Used to roll several logins up to the account they sit on. An account is
    only as protected as its softest way in, so this takes the minimum rather
    than a majority or an average — both of which would let one unprotected
    login hide behind four protected ones.
    """
    ranked = [c for c in codes if c]
    if not ranked:
        return None
    return min(ranked, key=lambda code: MFA_RISK_ORDER.get(code, 2))


# ───────────────────────────── servers ─────────────────────────────
#
# A server is bought *through* an account and usually keeps a property
# running, which is why it belongs in the estate rather than in Assets. Assets
# is built around purchase, warranty and handing a thing to a person; none of
# those describe a VM that was created by an API call and may not exist
# tomorrow.

SERVER_STATUSES = (
    ("RUNNING", "Running"),
    ("STOPPED", "Stopped"),
    ("SUSPENDED", "Suspended"),
    ("MAINTENANCE", "Maintenance"),
    ("DECOMMISSIONED", "Decommissioned"),
)

#: Statuses that still cost money and still need patching.
LIVE_SERVER_STATUSES = ("RUNNING", "MAINTENANCE")

#: What the box is for. Reported and grouped, never branched on, so this is
#: safe to extend from Settings the way service types are.
SERVER_ROLES = (
    ("WEB", "Web server"),
    ("APP", "Application server"),
    ("DATABASE", "Database"),
    ("CACHE", "Cache"),
    ("WORKER", "Worker / queue"),
    ("BUILD", "Build / CI"),
    ("STORAGE", "Storage"),
    ("VPN", "VPN / gateway"),
    ("GAME", "Game server"),
    ("OTHER", "Other"),
)

SERVER_ENVIRONMENTS = (
    ("PRODUCTION", "Production"),
    ("STAGING", "Staging"),
    ("DEVELOPMENT", "Development"),
    ("TEST", "Test"),
    ("DR", "Disaster recovery"),
)
