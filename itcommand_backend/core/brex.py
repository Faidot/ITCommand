"""Brex integration: pull cards and card charges, and attach them to services.

Answers the question people actually ask about a service — *which card
does this renew on, and what did we last pay?* — by syncing charges from Brex
and matching each one to a service by its merchant descriptor.

Two layers, deliberately:

* `_request` raises a typed `BrexError` and retries what is worth retrying.
  Callers that need to tell a revoked token from a missing scope use it.
* `_get` / `_paged` / `run_sync` keep the best-effort `(result, error)`
  contract the other integrations here use, so a provider outage never
  raises into the automation loop.
"""
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime

from django.db import transaction
from django.utils import timezone

from core import fx


PROVIDER = "BREX"
DEFAULT_BASE_URL = "https://platform.brexapis.com"
TIMEOUT_SECONDS = 30
#: A person is waiting on the connection test, so it fails faster than a sync.
PROBE_TIMEOUT_SECONDS = 10
#: Brex paginates with a cursor; cap the walk so a huge history cannot hang a sync.
MAX_PAGES = 20
PAGE_SIZE = 100

#: Total attempts per request, including the first. 4 gives 1s + 2s + 4s of
#: waiting before giving up — long enough to ride out a brief rate limit,
#: short enough that a daily sync does not sit for minutes on a dead API.
MAX_ATTEMPTS = 4
BACKOFF_BASE_SECONDS = 1.0
MAX_BACKOFF_SECONDS = 30.0
#: Brex can ask for a long wait; honour it, but not unboundedly.
MAX_RETRY_AFTER_SECONDS = 60.0
#: Wall-clock ceiling on one paginated walk. Without it, twenty pages each
#: retrying through a rate limit could hold the automation loop for an hour.
WALK_BUDGET_SECONDS = 300.0


# --------------------------------------------------------------------------
# Typed errors
# --------------------------------------------------------------------------

class BrexError(Exception):
    """Something went wrong talking to Brex.

    `str(exc)` is operator-facing and safe to store and display: it never
    contains the token, which travels only in a request header.
    """

    #: Whether trying the same request again could plausibly succeed.
    retryable = False
    #: Short machine-readable label, used by the connection test.
    code = "error"


class BrexNotConfigured(BrexError):
    """No token saved, or one saved that will not decrypt."""

    code = "not_configured"


class BrexAuthError(BrexError):
    """401 — the token is wrong, revoked or expired."""

    code = "auth"


class BrexScopeError(BrexError):
    """403 — the token is valid but was not granted this scope.

    Distinct from 401 because the fix is different: a scope is chosen when
    the token is created, so it cannot be granted after the fact. The token
    has to be regenerated.
    """

    code = "scope"


class BrexRateLimited(BrexError):
    """429 — too many requests."""

    retryable = True
    code = "rate_limited"

    def __init__(self, message, retry_after=None):
        super().__init__(message)
        self.retry_after = retry_after


class BrexServerError(BrexError):
    """5xx — Brex's problem, and usually temporary."""

    retryable = True
    code = "server"


class BrexUnavailable(BrexError):
    """The request never completed: DNS, connection, timeout."""

    retryable = True
    code = "unavailable"


class BrexBadResponse(BrexError):
    """A response arrived but was not the JSON we expect."""

    code = "bad_response"

#: Currencies without minor units — dividing these by 100 would be wrong.
ZERO_DECIMAL_CURRENCIES = {"JPY", "KRW", "VND", "CLP", "ISK", "PYG", "UGX", "RWF", "XOF", "XAF"}

#: Noise card processors add around the real merchant name.
_DESCRIPTOR_NOISE = re.compile(
    r"\b(recurring|subscription|subscr|payment|purchase|autopay|renewal|monthly|annual|"
    r"inc|llc|ltd|corp|com|www|http|https|usd|eur|gbp)\b",
    re.IGNORECASE,
)
_NON_ALNUM = re.compile(r"[^a-z0-9 ]+")


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

def _retry_after_seconds(headers):
    """Parse a Retry-After header. Seconds or an HTTP date; None if absent."""
    if not headers:
        return None
    raw = headers.get("Retry-After")
    if not raw:
        return None
    try:
        return max(0.0, float(str(raw).strip()))
    except (TypeError, ValueError):
        pass
    try:
        when = parsedate_to_datetime(str(raw))
    except (TypeError, ValueError):
        return None
    if when is None:
        return None
    if timezone.is_naive(when):
        # A Retry-After date without a zone is UTC by RFC 9110. Note this is
        # datetime's utc, not django.utils.timezone's — that one was removed
        # in Django 5.0 and this codebase runs 6.
        when = timezone.make_aware(when, dt_timezone.utc)
    return max(0.0, (when - timezone.now()).total_seconds())


def _backoff_seconds(attempt, retry_after=None):
    """Seconds to wait before attempt number `attempt` + 1.

    Brex naming a delay beats guessing one, so Retry-After wins when present.
    """
    if retry_after is not None:
        return min(retry_after, MAX_RETRY_AFTER_SECONDS)
    return min(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)), MAX_BACKOFF_SECONDS)


def _once(url, token, timeout):
    """One GET. Returns the decoded payload or raises a BrexError."""
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "ITCommand/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise BrexAuthError(
                "Brex rejected the token (401). It is wrong, revoked or expired "
                "— generate a new one and paste it again."
            ) from exc
        if exc.code == 403:
            raise BrexScopeError(
                "Brex accepted the token but refused this call (403). The scope "
                "was not granted when the token was created, and scopes cannot "
                "be added afterwards — regenerate the token with the missing "
                "permission ticked."
            ) from exc
        if exc.code == 429:
            raise BrexRateLimited(
                "Brex is rate-limiting the request (429).",
                retry_after=_retry_after_seconds(getattr(exc, "headers", None)),
            ) from exc
        if exc.code >= 500:
            raise BrexServerError(
                f"Brex returned HTTP {exc.code} ({exc.reason}). That is their "
                "side, and usually temporary."
            ) from exc
        raise BrexError(f"Brex returned HTTP {exc.code}: {exc.reason}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        # `exc` can carry the URL; the token is never in it, but keep the
        # stored text to the reason rather than the whole repr.
        reason = getattr(exc, "reason", None) or exc
        raise BrexUnavailable(f"Could not reach Brex: {reason}") from exc

    try:
        return json.loads(body)
    except ValueError as exc:
        raise BrexBadResponse(
            "Brex did not return JSON — check the API endpoint setting."
        ) from exc


def _request(integration, path, params=None, *, timeout=TIMEOUT_SECONDS,
             max_attempts=MAX_ATTEMPTS, sleep=time.sleep):
    """GET JSON from Brex, retrying what is worth retrying. Raises BrexError.

    The token travels in the Authorization header and is never placed in the
    URL, so nothing here can leak it into a log, a referrer or an error string.
    """
    from core.models.integrations import CredentialUnreadable

    base = (integration.base_url or DEFAULT_BASE_URL).rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    try:
        token = integration.get_api_key()
    except CredentialUnreadable as exc:
        raise BrexNotConfigured(str(exc)) from exc
    if not token:
        raise BrexNotConfigured("No Brex API token saved.")

    attempt = 0
    while True:
        attempt += 1
        try:
            return _once(url, token, timeout)
        except BrexError as exc:
            if not exc.retryable or attempt >= max_attempts:
                raise
            sleep(_backoff_seconds(attempt, getattr(exc, "retry_after", None)))


def _get(integration, path, params=None, **kwargs):
    """`_request` in the best-effort form the sync path uses: (payload, error)."""
    try:
        return _request(integration, path, params, **kwargs), ""
    except BrexError as exc:
        return None, str(exc)


def _paged(integration, path, params=None, *, budget_seconds=WALK_BUDGET_SECONDS):
    """Walk Brex's cursor pagination. Returns (items, error, truncated).

    `truncated` is a reason string, empty when the walk finished. Two ways it
    can stop early, and the caller needs to tell them apart:

    * the MAX_PAGES budget ran out with a cursor still outstanding;
    * the wall-clock budget ran out, which retries make reachable — twenty
      pages each riding out a rate limit could otherwise hold the automation
      loop for the better part of an hour.

    Either way there is more data at Brex than we read, and saying so is the
    point: it used to break out silently and still report success.
    """
    items = []
    cursor = None
    truncated = ""
    started = time.monotonic()
    for _ in range(MAX_PAGES):
        if time.monotonic() - started > budget_seconds:
            truncated = (
                f"the walk ran past its {int(budget_seconds)}s budget, so the "
                "rest was not read — Brex was most likely rate-limiting"
            )
            break
        query = dict(params or {}, limit=PAGE_SIZE)
        if cursor:
            query["cursor"] = cursor
        payload, error = _get(integration, path, query)
        if error:
            return items, error, truncated
        batch = (payload or {}).get("items")
        if batch is None and isinstance(payload, list):
            batch = payload
        items.extend(batch or [])
        cursor = (payload or {}).get("next_cursor")
        if not cursor:
            break
    else:
        # Ran the full page budget and Brex still offered a cursor.
        if cursor:
            truncated = (
                f"the {MAX_PAGES}-page limit was reached "
                f"({MAX_PAGES * PAGE_SIZE} records), so older records were not read"
            )
    return items, "", truncated


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

def money_from_brex(value):
    """Brex sends {'amount': 1999, 'currency': 'USD'} in minor units."""
    if not isinstance(value, dict):
        return Decimal("0.00"), "USD"
    currency = str(value.get("currency") or "USD").upper()[:3]
    try:
        raw = Decimal(str(value.get("amount", 0)))
    except (InvalidOperation, TypeError):
        return Decimal("0.00"), currency
    if currency in ZERO_DECIMAL_CURRENCIES:
        return raw, currency
    return (raw / Decimal("100")).quantize(Decimal("0.01")), currency


def normalise_descriptor(text):
    """Reduce a statement descriptor to comparable words.

    'SQ *CLAUDE.AI SUBSCR 4155551234 CA' -> 'claude ai'
    """
    lowered = str(text or "").lower()
    lowered = _NON_ALNUM.sub(" ", lowered)
    lowered = _DESCRIPTOR_NOISE.sub(" ", lowered)
    # Drop bare numbers and single characters — phone numbers and store codes.
    words = [
        word for word in lowered.split()
        if len(word) > 1 and not word.isdigit()
    ]
    return " ".join(words).strip()


def _tokens(text):
    return {word for word in normalise_descriptor(text).split() if len(word) > 2}


def match_score(descriptor, service):
    """0..1 confidence that `descriptor` is a charge for `service`.

    Deliberately conservative: a weak overlap scores low and the caller leaves
    the charge unmatched rather than attaching it to the wrong service.
    """
    descriptor_tokens = _tokens(descriptor)
    if not descriptor_tokens:
        return 0.0

    # An explicit descriptor recorded on the service is authoritative.
    if service.billing_descriptor:
        if _tokens(service.billing_descriptor) & descriptor_tokens:
            return 1.0

    best = 0.0
    for field, weight in (
        (service.provider.name if service.provider_id else "", 1.0),
        (service.identifier, 0.9),
    ):
        candidate = _tokens(field)
        if not candidate:
            continue
        overlap = candidate & descriptor_tokens
        if not overlap:
            continue
        # Score from both directions and take the stronger. "SQ *CLAUDE.AI"
        # covers only half of "Claude Pro", but *everything* the descriptor
        # says is about that service — which is the real signal.
        covers_service = len(overlap) / len(candidate)
        covers_descriptor = len(overlap) / len(descriptor_tokens)
        score = max(covers_service, covers_descriptor) * weight
        best = max(best, min(score, 0.95))
    return round(best, 3)


#: Below this we leave the charge unmatched rather than guess.
MATCH_THRESHOLD = 0.5


def best_match(descriptor, services):
    """Pick the best-scoring service, or (None, score) when unsure.

    Returns nothing on a tie: if two services score identically, picking one is
    a coin flip, and a wrongly attached charge is harder to notice than an
    unattached one.
    """
    scored = []
    for service in services:
        score = match_score(descriptor, service)
        if score > 0:
            scored.append((score, service))
    if not scored:
        return None, 0.0

    scored.sort(key=lambda pair: pair[0], reverse=True)
    best_score, best = scored[0]
    if best_score < MATCH_THRESHOLD:
        return None, best_score
    if len(scored) > 1 and scored[1][0] == best_score:
        return None, best_score
    return best, best_score


# --------------------------------------------------------------------------
# Connection test
# --------------------------------------------------------------------------

#: The scopes we probe, in the order the UI lists them.
#:
#: `required` marks the two the sync cannot run without. The rest are read by
#: later features or are simply useful to know about, so a token missing them
#: is reported without calling the whole connection broken.
SCOPE_PROBES = (
    ("cards.readonly", "/v2/cards", "Card list", True),
    ("transactions.card.readonly", "/v2/transactions/card/primary", "Card charges", True),
    ("users.readonly", "/v2/users", "Card owners", False),
    ("accounts.card.readonly", "/v2/accounts/card", "Card accounts and balances", False),
    ("departments.readonly", "/v2/departments", "Departments, for cost allocation", False),
    ("expenses.card.readonly", "/v2/expenses/card", "Expense detail", False),
    ("statements.card.readonly", "/v2/accounts/card/primary/statements", "Statements", False),
    ("vendors.readonly", "/v2/vendors", "Vendors", False),
)


def test_connection(integration, *, sleep=time.sleep):
    """Prove the token is live, then probe each scope. Never raises.

    Returns a dict the UI renders directly. Probes use one attempt each and a
    short timeout: somebody is waiting on this, and a retry storm across eight
    endpoints would hold the request open for minutes.
    """
    started = time.monotonic()

    def elapsed_ms():
        return int((time.monotonic() - started) * 1000)

    def probe_kwargs():
        return {"timeout": PROBE_TIMEOUT_SECONDS, "max_attempts": 1, "sleep": sleep}

    # Identity first. If the token itself is bad, probing eight endpoints
    # would produce eight copies of the same failure.
    try:
        me = _request(integration, "/v2/users/me", **probe_kwargs()) or {}
    except BrexNotConfigured as exc:
        return {
            "ok": False, "status": "NOT_CONFIGURED", "code": exc.code,
            "message": str(exc), "latency_ms": elapsed_ms(),
            "identity": None, "scopes": [],
        }
    except BrexAuthError as exc:
        return {
            "ok": False, "status": "AUTH_FAILED", "code": exc.code,
            "message": str(exc), "latency_ms": elapsed_ms(),
            "identity": None, "scopes": [],
        }
    except BrexScopeError as exc:
        # /v2/users/me needs users.readonly. A token without it is still
        # usable for cards and charges, so carry on to the probes.
        me, identity_note = {}, str(exc)
    except BrexError as exc:
        return {
            "ok": False, "status": "UNREACHABLE", "code": exc.code,
            "message": str(exc), "latency_ms": elapsed_ms(),
            "identity": None, "scopes": [],
        }
    else:
        identity_note = ""

    identity = None
    if me:
        identity = {
            "name": " ".join(
                part for part in [me.get("first_name"), me.get("last_name")] if part
            ) or str(me.get("name") or ""),
            "email": str(me.get("email") or ""),
        }

    scopes = []
    for scope, path, label, required in SCOPE_PROBES:
        result = {"scope": scope, "label": label, "required": required}
        try:
            _request(integration, path, {"limit": 1}, **probe_kwargs())
        except BrexScopeError as exc:
            result.update(ok=False, code=exc.code, detail=str(exc))
        except BrexError as exc:
            result.update(ok=False, code=exc.code, detail=str(exc))
        else:
            result.update(ok=True, code="ok", detail="Granted.")
        scopes.append(result)

    missing_required = [s for s in scopes if s["required"] and not s["ok"]]
    missing_optional = [s for s in scopes if not s["required"] and not s["ok"]]

    if missing_required:
        status = "MISSING_SCOPES"
        message = (
            "Connected, but the token cannot do what the sync needs: "
            + ", ".join(s["scope"] for s in missing_required)
            + ". Regenerate the token with those permissions ticked."
        )
        ok = False
    elif missing_optional:
        status = "PARTIAL"
        message = (
            "Connected. The sync will work. Not granted: "
            + ", ".join(s["scope"] for s in missing_optional)
            + "."
        )
        ok = True
    else:
        status = "OK"
        message = "Connected. Every scope the integration uses is granted."
        ok = True

    if identity_note:
        message = f"{message} {identity_note}"

    return {
        "ok": ok, "status": status, "code": "ok" if ok else "scope",
        "message": message, "latency_ms": elapsed_ms(),
        "identity": identity, "scopes": scopes,
    }


# --------------------------------------------------------------------------
# Raw mirroring
# --------------------------------------------------------------------------

def mirror(object_type, items, *, id_key="id"):
    """Store raw payloads, skipping rows whose content has not changed.

    Returns (created, changed, unchanged). Most objects are byte-identical
    between runs, so the common case costs one SELECT and a single bulk
    timestamp UPDATE rather than a write per row.

    Deliberately tolerant: an item Brex sends without an id is skipped rather
    than raising. Mirroring is a best-effort record of what was said, and
    failing the whole sync over one odd row would be the wrong trade.
    """
    from core.models import BrexObject

    now = timezone.now()
    incoming = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        external_id = str(item.get(id_key) or "").strip()
        if external_id:
            incoming[external_id] = item
    if not incoming:
        return 0, 0, 0

    existing = {
        row.external_id: row
        for row in BrexObject.objects.filter(
            object_type=object_type, external_id__in=list(incoming)
        )
    }

    new_rows, changed_rows, unchanged_ids = [], [], []
    for external_id, payload in incoming.items():
        digest = BrexObject.hash_payload(payload)
        row = existing.get(external_id)
        if row is None:
            new_rows.append(BrexObject(
                object_type=object_type, external_id=external_id,
                payload=payload, payload_hash=digest,
                last_seen_at=now, last_changed_at=now,
            ))
        elif row.payload_hash != digest:
            row.payload = payload
            row.payload_hash = digest
            row.last_seen_at = now
            row.last_changed_at = now
            changed_rows.append(row)
        else:
            unchanged_ids.append(external_id)

    if new_rows:
        BrexObject.objects.bulk_create(new_rows, ignore_conflicts=True)
    if changed_rows:
        BrexObject.objects.bulk_update(
            changed_rows, ["payload", "payload_hash", "last_seen_at", "last_changed_at"]
        )
    if unchanged_ids:
        # One narrow UPDATE for every unchanged object, so "we still see it"
        # is recorded without rewriting payloads that did not move.
        BrexObject.objects.filter(
            object_type=object_type, external_id__in=unchanged_ids
        ).update(last_seen_at=now)

    return len(new_rows), len(changed_rows), len(unchanged_ids)


def _money_field(block):
    """(amount, currency) from a Brex money block, or (None, '') if absent."""
    if not isinstance(block, dict) or block.get("amount") is None:
        return None, ""
    amount, currency = money_from_brex(block)
    return amount, currency


# --------------------------------------------------------------------------
# Sync
# --------------------------------------------------------------------------

def sync_users(integration):
    """Mirror Brex users so card owners can be resolved. Returns (count, error, truncated).

    Owner resolution already works from the block embedded in each card; this
    exists so a card whose owner block is thin can still be attributed, and so
    the mapping can be redone later without re-fetching.
    """
    items, error, truncated = _paged(integration, "/v2/users")
    if error and not items:
        return 0, error, truncated
    mirror("USER", items)
    return len(items), error, truncated


def sync_card_accounts(integration):
    """Upsert card accounts and their balances. Returns (count, error, truncated)."""
    from core.models import CardAccount

    items, error, truncated = _paged(integration, "/v2/accounts/card")
    if error and not items:
        return 0, error, truncated

    mirror("CARD_ACCOUNT", items)
    count = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        external_id = str(item.get("id") or "").strip()
        if not external_id:
            continue

        current, currency = _money_field(item.get("current_balance"))
        available, available_currency = _money_field(item.get("available_balance"))

        CardAccount.objects.update_or_create(
            provider=PROVIDER,
            external_id=external_id,
            defaults={
                "name": str(item.get("name") or "")[:160],
                "status": str(item.get("status") or "")[:32],
                "currency": currency or available_currency or "USD",
                "current_balance": current,
                "available_balance": available,
                "last_synced_at": timezone.now(),
            },
        )
        count += 1
    return count, error, truncated


def sync_departments(integration):
    """Mirror departments for cost allocation. Returns (count, error, truncated).

    Mirror only, no typed model. Nothing in the product allocates cost by
    Brex department yet, and a table with no reader is the mistake the
    discovery integrations already made — the raw rows are here for whenever
    something does want them.
    """
    items, error, truncated = _paged(integration, "/v2/departments")
    if error and not items:
        return 0, error, truncated
    mirror("DEPARTMENT", items)
    return len(items), error, truncated


def sync_cards(integration):
    """Upsert Brex cards. Returns (count, error, truncated)."""
    from core.models import PaymentCard, User

    items, error, truncated = _paged(integration, "/v2/cards")
    if error and not items:
        return 0, error, truncated

    mirror("CARD", items)

    # Owners resolved from the mirrored user list where the embedded block is
    # thin. One pass, so a hundred cards is not a hundred queries.
    users_by_id = _mirrored_users()

    count = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        external_id = str(item.get("id") or "").strip()
        last_four = str(item.get("last_four") or "").strip()[-4:]
        if not external_id or not last_four:
            continue

        owner = item.get("owner") or {}
        owner_id = str(owner.get("id") or item.get("owner_user_id") or "").strip()
        if owner_id and owner_id in users_by_id:
            # Prefer the full user record; the embedded block is a summary.
            owner = {**users_by_id[owner_id], **{k: v for k, v in owner.items() if v}}

        holder_name = " ".join(
            part for part in [owner.get("first_name"), owner.get("last_name")] if part
        ) or str(owner.get("name") or "")
        email = (owner.get("email") or "").strip().lower()

        limit_amount, limit_currency = _money_field(
            item.get("spend_controls", {}).get("spend_limit")
            if isinstance(item.get("spend_controls"), dict)
            else item.get("limit")
        )

        PaymentCard.objects.update_or_create(
            provider=PROVIDER,
            external_id=external_id,
            defaults={
                "last_four": last_four,
                "nickname": str(item.get("card_name") or "")[:160],
                "holder_name": holder_name[:160],
                "holder": User.objects.filter(email__iexact=email).first() if email else None,
                "external_owner_id": owner_id[:128],
                "status": str(item.get("status") or "UNKNOWN").upper()[:16],
                "form": _card_form(item),
                "limit_amount": limit_amount,
                "limit_currency": limit_currency[:3],
                "limit_interval": str(
                    (item.get("spend_controls") or {}).get("spend_limit_interval") or ""
                )[:32],
                "last_synced_at": timezone.now(),
            },
        )
        count += 1
    return count, error, truncated


#: Brex words this differently across endpoints; map whatever arrives onto the
#: two states anybody actually cares about.
_PHYSICAL_WORDS = {"PHYSICAL", "PLASTIC", "METAL"}
_VIRTUAL_WORDS = {"VIRTUAL", "DIGITAL"}


def _card_form(item):
    raw = str(item.get("card_type") or item.get("type") or "").strip().upper()
    if raw in _PHYSICAL_WORDS:
        return "PHYSICAL"
    if raw in _VIRTUAL_WORDS:
        return "VIRTUAL"
    return "UNKNOWN"


def _mirrored_users():
    """{brex user id: payload} from the mirror, for owner resolution."""
    from core.models import BrexObject

    return {
        row.external_id: row.payload
        for row in BrexObject.objects.filter(object_type="USER").only(
            "external_id", "payload"
        )
        if isinstance(row.payload, dict)
    }


def sync_transactions(integration, *, since_days=90):
    """Upsert card charges and attach them to estate services.

    Returns (summary, error) where summary counts what happened and carries a
    `truncated` flag when the page budget cut the walk short.
    """
    from core.models import PaymentCard, Service, ServicePayment

    since = (timezone.localdate() - timedelta(days=since_days)).isoformat()
    items, error, truncated = _paged(
        integration,
        "/v2/transactions/card/primary",
        {"posted_at_start": since},
    )
    empty = {
        "charges": 0, "matched": 0, "new": 0, "converted": 0,
        "manual_kept": 0, "truncated": truncated,
    }
    if error and not items:
        return empty, error

    mirror("TRANSACTION", items)

    cards = {card.external_id: card for card in PaymentCard.objects.filter(provider=PROVIDER)}
    services = list(
        Service.objects.exclude(status="CANCELLED").select_related("provider").only(
            "id", "identifier", "billing_descriptor", "provider__name"
        )
    )

    # The currency every charge is converted into, resolved once: it is an
    # AppSettings lookup, and doing it per charge would be a query per row.
    reporting = fx.reporting_currency()

    # Charges a person linked by hand. The sync must not overwrite them: the
    # whole point of a manual match is that somebody looked at a descriptor
    # the matcher got wrong, and re-guessing it every night would undo that
    # decision silently. One query, not one per charge.
    manual_ids = set(
        ServicePayment.objects.filter(
            provider=PROVIDER, match_source="MANUAL"
        ).values_list("external_id", flat=True)
    )

    charges = matched = new = converted = respected = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        external_id = str(item.get("id") or "").strip()
        if not external_id:
            continue

        merchant_block = item.get("merchant") or {}
        descriptor = (
            merchant_block.get("raw_descriptor")
            or item.get("description")
            or merchant_block.get("merchant_name")
            or ""
        )
        amount, currency = money_from_brex(item.get("amount"))
        posted = _as_date(
            item.get("posted_at_date") or item.get("posted_at") or item.get("initiated_at_date")
        )
        if not posted:
            continue

        card = cards.get(str(item.get("card_id") or ""))
        is_manual = external_id in manual_ids
        service, score = (None, 0.0) if is_manual else best_match(descriptor, services)

        # Facts about the charge, which Brex owns and the sync always refreshes.
        defaults = {
            "merchant": str(descriptor)[:255],
            "description": str(item.get("description") or "")[:255],
            "amount": amount,
            "currency": currency,
            "posted_at": posted,
            "card": card,
        }
        # The match is a judgement, and a person's beats ours. Leaving these
        # out of `defaults` is what preserves a manual link across a re-sync.
        if is_manual:
            respected += 1
        else:
            defaults.update({
                "service": service,
                "match_source": "AUTO" if service else "NONE",
                "match_score": score,
            })

        # The charge and the write-back it implies land together or not at all,
        # so a failure mid-loop cannot leave a service pointing at a card whose
        # charge was never stored.
        with transaction.atomic():
            payment, created = ServicePayment.objects.update_or_create(
                provider=PROVIDER,
                external_id=external_id,
                defaults=defaults,
            )

            # Freeze the converted value while we are here. A missing rate
            # leaves it unconverted rather than folded at 1:1; the backfill
            # picks it up once rates arrive.
            if payment.apply_fx(reporting_currency=reporting):
                payment.save(update_fields=[
                    "base_amount", "base_currency", "fx_rate", "fx_rate_date",
                ])
                converted += 1

            if service:
                # Record which card it renews on, and the descriptor that
                # matched, so the next sync attaches without guessing.
                updates = []
                if card and service.payment_card_id != card.pk:
                    service.payment_card = card
                    updates.append("payment_card")
                if not service.billing_descriptor and descriptor:
                    service.billing_descriptor = str(descriptor)[:160]
                    updates.append("billing_descriptor")
                if updates:
                    service.save(update_fields=updates + ["updated_at"])

        charges += 1
        new += 1 if created else 0
        if service or is_manual:
            matched += 1

    return {
        "charges": charges, "matched": matched, "new": new,
        "converted": converted, "manual_kept": respected, "truncated": truncated,
    }, error


def _as_date(value):
    from datetime import date, datetime

    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value or "")[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


#: The reference data pulled before cards, in order. Each is optional: a token
#: without the scope still syncs cards and charges, which is the point of the
#: integration. Missing ones are reported, not fatal.
REFERENCE_STEPS = (
    ("users", sync_users, "users.readonly"),
    ("card_accounts", sync_card_accounts, "accounts.card.readonly"),
    ("departments", sync_departments, "departments.readonly"),
)


def run_sync(integration, *, since_days=90):
    """Full sync: reference data, then cards, then charges. Returns (summary, error).

    A sync that read *some* data and then hit a problem is neither a success
    nor a total failure. It is recorded as PARTIAL with the reason attached,
    because the previous behaviour — keeping the rows and discarding the error
    — reported a token revoked mid-walk as a clean run.

    Order matters: users are mirrored before cards so a card whose embedded
    owner block is thin can still be attributed to a person.
    """
    if not integration.is_enabled:
        return {}, "The Brex integration is switched off."

    problems = []
    summary = {}

    # Reference data first, and never fatally: the two things this integration
    # exists for are cards and charges, and a token that cannot read
    # departments should still deliver those.
    for name, step, scope in REFERENCE_STEPS:
        count, step_error, step_truncated = step(integration)
        summary[name] = count
        if step_error:
            problems.append(f"{name} ({scope}): {step_error}")
        if step_truncated:
            problems.append(f"{name}: {step_truncated}")

    card_count, card_error, cards_truncated = sync_cards(integration)
    if card_error and not card_count:
        integration.mark_result("ERROR", card_error)
        return summary, card_error
    if card_error:
        problems.append(f"cards: {card_error}")
    if cards_truncated:
        problems.append(f"cards: {cards_truncated}")

    charge_summary, error = sync_transactions(integration, since_days=since_days)
    summary.update(charge_summary)
    summary["cards"] = card_count

    if error and not summary.get("charges"):
        integration.mark_result("ERROR", error)
        return summary, error
    if error:
        problems.append(f"charges: {error}")
    if summary.get("truncated"):
        problems.append(
            f"charges: {summary['truncated']} — narrow --days or raise the limit"
        )

    counts = (
        f"{card_count} card(s), {summary['charges']} charge(s), "
        f"{summary['matched']} matched to services, "
        f"{summary.get('card_accounts', 0)} account(s)"
    )
    if problems:
        message = f"Partial sync — {counts}. " + " ".join(problems)
        integration.mark_result("PARTIAL", message)
        summary["problems"] = problems
        return summary, ""

    integration.mark_result("OK", counts)
    return summary, ""
