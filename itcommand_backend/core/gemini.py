"""Google Gemini client, used to turn pasted notes into importable rows.

Same shape as `core.brex`: stdlib urllib, typed errors, bounded retry, and a
best-effort wrapper so a provider outage never raises into a view.

Two rules this module exists to enforce.

**The model proposes; the importer decides.** Nothing here writes to the
database. It returns rows in exactly the shape the master sheet expects, and
those go through `estate_import.validate_records` like any uploaded file — so
a hallucinated provider or an invented billing cycle is rejected by the same
validator that would reject a typo in a spreadsheet.

**It asks rather than guesses.** The prompt requires a question instead of an
invented value whenever a required field is not supported by the text. A wrong
renewal date silently imported is worse than a question on screen.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

PROVIDER = "GEMINI"
DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"
DEFAULT_MODEL = "gemini-2.5-flash"
TIMEOUT_SECONDS = 60
MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 1.0

#: Pasted notes are one screenful of context, not a data dump. The ceiling is
#: about a predictable bill and a bounded request, not capability.
MAX_INPUT_CHARS = 20000


class GeminiError(Exception):
    """`str(exc)` is operator-facing and never contains the key."""

    retryable = False
    code = "error"


class GeminiNotConfigured(GeminiError):
    code = "not_configured"


class GeminiAuthError(GeminiError):
    code = "auth"


class GeminiRateLimited(GeminiError):
    retryable = True
    code = "rate_limited"


class GeminiServerError(GeminiError):
    retryable = True
    code = "server"


class GeminiUnavailable(GeminiError):
    retryable = True
    code = "unavailable"


class GeminiBadResponse(GeminiError):
    code = "bad_response"


def _model(integration):
    return (integration.config or {}).get("model") or DEFAULT_MODEL


def _once(url, key, payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            # Header rather than ?key=, so the credential never lands in an
            # access log, a proxy trace or an exception's URL.
            "x-goog-api-key": key,
            "User-Agent": "ITCommand/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise GeminiAuthError(
                "Google rejected the API key (HTTP "
                f"{exc.code}). Check it in Settings → Integrations, and that the "
                "Generative Language API is enabled for that project."
            ) from exc
        if exc.code == 429:
            raise GeminiRateLimited(
                "Gemini is rate-limiting the request (429). Try again shortly."
            ) from exc
        if exc.code >= 500:
            raise GeminiServerError(
                f"Gemini returned HTTP {exc.code} ({exc.reason}). That is their side."
            ) from exc
        raise GeminiError(f"Gemini returned HTTP {exc.code}: {exc.reason}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", None) or exc
        raise GeminiUnavailable(f"Could not reach Gemini: {reason}") from exc
    except ValueError as exc:
        raise GeminiBadResponse("Gemini did not return JSON.") from exc


def generate_json(integration, prompt, *, sleep=time.sleep):
    """Ask for a JSON object back. Raises GeminiError. Never writes anything."""
    from core.models.integrations import CredentialUnreadable

    try:
        key = integration.get_api_key()
    except CredentialUnreadable as exc:
        raise GeminiNotConfigured(str(exc)) from exc
    if not key:
        raise GeminiNotConfigured("No Gemini API key saved.")

    base = (integration.base_url or DEFAULT_BASE_URL).rstrip("/")
    url = f"{base}/v1beta/models/{_model(integration)}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            # Asking for JSON directly beats parsing prose out of a fenced
            # block, which fails the first time a value contains a backtick.
            "responseMimeType": "application/json",
            # Extraction, not writing. Near-zero temperature so the same notes
            # give the same rows twice.
            "temperature": 0.1,
        },
    }

    attempt = 0
    while True:
        attempt += 1
        try:
            body = _once(url, key, payload)
            break
        except GeminiError as exc:
            if not exc.retryable or attempt >= MAX_ATTEMPTS:
                raise
            sleep(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)))

    try:
        text = body["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        blocked = (body or {}).get("promptFeedback", {}).get("blockReason")
        if blocked:
            raise GeminiBadResponse(
                f"Gemini declined to answer ({blocked}). Rephrase the notes and try again."
            )
        raise GeminiBadResponse("Gemini returned no usable content.")

    try:
        parsed = json.loads(text)
    except ValueError as exc:
        raise GeminiBadResponse(
            "Gemini's answer was not valid JSON, so nothing could be read from it."
        ) from exc
    if not isinstance(parsed, dict):
        raise GeminiBadResponse("Gemini returned something other than an object.")
    return parsed


def check_connection(integration, *, sleep=time.sleep):
    """Prove the key works. Returns a dict the settings UI renders."""
    started = time.monotonic()
    try:
        body = generate_json(
            integration,
            'Reply with exactly {"ok": true} and nothing else.',
            sleep=sleep,
        )
    except GeminiError as exc:
        return {
            "ok": False,
            "code": exc.code,
            "message": str(exc),
            "latency_ms": int((time.monotonic() - started) * 1000),
            "model": _model(integration),
        }
    return {
        "ok": bool(body),
        "code": "ok",
        "message": f"Connected. {_model(integration)} answered.",
        "latency_ms": int((time.monotonic() - started) * 1000),
        "model": _model(integration),
    }
