"""Digital Estate taxonomy — the single source of truth for the service stack.

The layer order is not alphabetical and not arbitrary: it is the order a request
travels through the stack. The registrar owns the name, DNS answers for it, the
host serves it, mail routes from it, and so on. Reports, the property "stack
strip" and the gap calculation all render layers in this order.

Keeping the order here — and serving it from the API — is deliberate: the
frontend must never hardcode it, or adding a layer in one place silently
disagrees with the other.
"""

# ─────────────────────────── service layers ───────────────────────────

#: Ordered (code, label) pairs. Order == position in the stack.
SERVICE_LAYERS = (
    ("REGISTRAR", "Registrar"),
    ("DNS", "DNS"),
    ("HOSTING", "Hosting"),
    ("MAIL", "Mail"),
    ("CDN", "CDN"),
    ("TLS", "TLS"),
    ("ANALYTICS", "Analytics"),
    ("STORAGE", "Storage"),
    ("MONITORING", "Monitoring"),
    ("OTHER", "Other"),
)

SERVICE_LAYER_CODES = tuple(code for code, _ in SERVICE_LAYERS)

SERVICE_LAYER_LABELS = dict(SERVICE_LAYERS)

#: code -> stack position, for stable ordering of rows fetched out of order.
SERVICE_LAYER_ORDER = {code: index for index, (code, _) in enumerate(SERVICE_LAYERS)}

#: Layers a property is expected to have before it counts as fully configured.
#: OTHER is excluded — it is a catch-all, never a gap. MONITORING and STORAGE
#: are optional in practice, so a missing one is not reported as a hole in the
#: stack; they are tracked but not required.
REQUIRED_LAYERS = (
    "REGISTRAR",
    "DNS",
    "HOSTING",
    "MAIL",
    "CDN",
    "TLS",
    "ANALYTICS",
)


def layer_label(code):
    """Human label for a layer code, falling back to the code itself."""
    return SERVICE_LAYER_LABELS.get(code, code or "")


def sort_key(code):
    """Sort helper putting unknown codes last rather than first."""
    return SERVICE_LAYER_ORDER.get(code, len(SERVICE_LAYERS))


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
AUTH_METHODS = (
    ("PASSWORD", "Password"),
    ("SSO", "Single sign-on"),
    ("API_KEY", "API key"),
    ("IAM", "IAM / identity centre"),
    ("OTHER", "Other"),
)

#: Second factor on the account. UNKNOWN is the honest default — an account
#: nobody has checked is not the same as an account known to have none.
MFA_METHODS = (
    ("APP", "Authenticator app"),
    ("KEY", "Hardware key"),
    ("SMS", "SMS"),
    ("NONE", "None"),
    ("UNKNOWN", "Not recorded"),
)

#: Risk tone per MFA method, so the API — not the UI — decides what is alarming.
#: An account with no second factor holding production infrastructure is the
#: single most useful thing the Accounts view surfaces; it must never render
#: as neutral.
MFA_SEVERITY = {
    "NONE": "critical",
    "SMS": "warning",
    "APP": "ok",
    "KEY": "ok",
    "UNKNOWN": "muted",
}


def mfa_severity(code):
    return MFA_SEVERITY.get(code, "muted")


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
