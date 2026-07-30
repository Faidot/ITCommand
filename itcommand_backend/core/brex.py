"""Brex integration: pull cards and card charges, and attach them to services.

Answers the question people actually ask about a service — *which card
does this renew on, and what did we last pay?* — by syncing charges from Brex
and matching each one to a service by its merchant descriptor.

Contract, matching the other integrations here: best-effort, never raises,
returns (result, error).
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.utils import timezone


PROVIDER = "BREX"
DEFAULT_BASE_URL = "https://platform.brexapis.com"
TIMEOUT_SECONDS = 30
#: Brex paginates with a cursor; cap the walk so a huge history cannot hang a sync.
MAX_PAGES = 20
PAGE_SIZE = 100

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

def _get(integration, path, params=None):
    """GET JSON from Brex. Returns (payload, error)."""
    base = (integration.base_url or DEFAULT_BASE_URL).rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    token = integration.get_api_key()
    if not token:
        return None, "No Brex API token saved."

    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "ITCommand/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8", errors="replace")), ""
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return None, "Brex rejected the token (401). Generate a new one and paste it again."
        if exc.code == 403:
            return None, "The token is valid but lacks permission (403). It needs read access to cards and transactions."
        if exc.code == 429:
            return None, "Brex is rate-limiting the request (429). Try again in a few minutes."
        return None, f"Brex returned HTTP {exc.code}: {exc.reason}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return None, f"Could not reach Brex: {exc}"
    except ValueError:
        return None, "Brex did not return JSON — check the base URL."


def _paged(integration, path, params=None):
    """Walk Brex's cursor pagination. Returns (items, error)."""
    items = []
    cursor = None
    for _ in range(MAX_PAGES):
        query = dict(params or {}, limit=PAGE_SIZE)
        if cursor:
            query["cursor"] = cursor
        payload, error = _get(integration, path, query)
        if error:
            return items, error
        batch = (payload or {}).get("items")
        if batch is None and isinstance(payload, list):
            batch = payload
        items.extend(batch or [])
        cursor = (payload or {}).get("next_cursor")
        if not cursor:
            break
    return items, ""


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
# Sync
# --------------------------------------------------------------------------

def sync_cards(integration):
    """Upsert Brex cards. Returns (count, error)."""
    from core.models import PaymentCard, User

    items, error = _paged(integration, "/v2/cards")
    if error and not items:
        return 0, error

    count = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        external_id = str(item.get("id") or "").strip()
        last_four = str(item.get("last_four") or "").strip()[-4:]
        if not external_id or not last_four:
            continue

        owner = item.get("owner") or {}
        holder_name = " ".join(
            part for part in [owner.get("first_name"), owner.get("last_name")] if part
        ) or str(owner.get("name") or "")
        email = (owner.get("email") or "").strip().lower()

        PaymentCard.objects.update_or_create(
            provider=PROVIDER,
            external_id=external_id,
            defaults={
                "last_four": last_four,
                "nickname": str(item.get("card_name") or "")[:160],
                "holder_name": holder_name[:160],
                "holder": User.objects.filter(email__iexact=email).first() if email else None,
                "status": str(item.get("status") or "UNKNOWN").upper()[:16],
                "last_synced_at": timezone.now(),
            },
        )
        count += 1
    return count, error


def sync_transactions(integration, *, since_days=90):
    """Upsert card charges and attach them to estate services.

    Returns (summary, error) where summary counts what happened.
    """
    from core.models import PaymentCard, Service, ServicePayment

    since = (timezone.localdate() - timedelta(days=since_days)).isoformat()
    items, error = _paged(
        integration,
        "/v2/transactions/card/primary",
        {"posted_at_start": since},
    )
    if error and not items:
        return {"charges": 0, "matched": 0, "new": 0}, error

    cards = {card.external_id: card for card in PaymentCard.objects.filter(provider=PROVIDER)}
    services = list(
        Service.objects.exclude(status="CANCELLED").select_related("provider").only(
            "id", "identifier", "billing_descriptor", "provider__name"
        )
    )

    charges = matched = new = 0
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
        service, score = best_match(descriptor, services)

        payment, created = ServicePayment.objects.update_or_create(
            provider=PROVIDER,
            external_id=external_id,
            defaults={
                "merchant": str(descriptor)[:255],
                "description": str(item.get("description") or "")[:255],
                "amount": amount,
                "currency": currency,
                "posted_at": posted,
                "card": card,
                "service": service,
                "match_source": "AUTO" if service else "NONE",
                "match_score": score,
            },
        )
        charges += 1
        new += 1 if created else 0

        if service:
            matched += 1
            # Record which card it renews on, and the descriptor that matched,
            # so the next sync attaches without guessing.
            updates = []
            if card and service.payment_card_id != card.pk:
                service.payment_card = card
                updates.append("payment_card")
            if not service.billing_descriptor and descriptor:
                service.billing_descriptor = str(descriptor)[:160]
                updates.append("billing_descriptor")
            if updates:
                service.save(update_fields=updates + ["updated_at"])

    return {"charges": charges, "matched": matched, "new": new}, error


def _as_date(value):
    from datetime import date, datetime

    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value or "")[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def run_sync(integration, *, since_days=90):
    """Full sync: cards first, then charges. Returns (summary, error)."""
    if not integration.is_enabled:
        return {}, "The Brex integration is switched off."

    card_count, card_error = sync_cards(integration)
    if card_error and not card_count:
        integration.mark_result("ERROR", card_error)
        return {}, card_error

    summary, error = sync_transactions(integration, since_days=since_days)
    summary["cards"] = card_count

    if error and not summary.get("charges"):
        integration.mark_result("ERROR", error)
        return summary, error

    message = (
        f"{card_count} card(s), {summary['charges']} charge(s), "
        f"{summary['matched']} matched to services"
    )
    integration.mark_result("OK", message)
    return summary, ""
