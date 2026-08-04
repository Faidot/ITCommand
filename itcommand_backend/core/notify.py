"""Send an alert to every enabled chat/webhook integration.

Each provider wants a different JSON body but they are all "POST to a secret
URL", so one dispatcher covers Slack, Teams, Discord and generic webhooks.

Delivery is best-effort by design: a Slack outage must never break saving a
subscription. Failures are recorded on the integration row and surfaced in
Settings rather than raised.
"""
import json
import urllib.error
import urllib.request

from django.utils import timezone


TIMEOUT_SECONDS = 10


def _payload_for(provider, *, title, message="", url=""):
    body = f"*{title}*\n{message}" if message else title
    if url:
        body += f"\n{url}"

    if provider == "SLACK":
        return {"text": body}
    if provider == "DISCORD":
        return {"content": body[:1900]}
    if provider == "TEAMS":
        # Legacy MessageCard: still accepted by Incoming Webhook connectors.
        return {
            "@type": "MessageCard",
            "@context": "https://schema.org/extensions",
            "summary": title,
            "themeColor": "0076D7",
            "title": title,
            "text": message + (f"\n\n[Open]({url})" if url else ""),
        }
    # Generic webhook: structured rather than prettified.
    return {
        "event": title,
        "title": title,
        "message": message,
        "url": url,
        "timestamp": timezone.now().isoformat(),
    }


def send_to_provider(integration, *, title, message="", url=""):
    """POST one alert. Returns (ok, detail); never raises."""
    from core.models.integrations import CredentialUnreadable

    try:
        endpoint = integration.get_api_key() or integration.base_url
    except CredentialUnreadable as exc:
        return False, str(exc)
    if not endpoint:
        return False, "No webhook URL configured."

    payload = _payload_for(integration.provider, title=title, message=message, url=url)
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "ITCommand/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            code = response.getcode()
            if 200 <= code < 300:
                return True, f"Delivered ({code})."
            return False, f"Provider returned HTTP {code}."
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}: {exc.reason}"
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return False, f"{type(exc).__name__}: {exc}"


def broadcast(title, message="", url="", providers=None):
    """Send to every enabled chat integration. Returns {provider: (ok, detail)}."""
    from core.models import Integration

    queryset = Integration.objects.filter(
        provider__in=providers or Integration.CHAT_PROVIDERS, is_enabled=True
    )
    results = {}
    for integration in queryset:
        ok, detail = send_to_provider(
            integration, title=title, message=message, url=url
        )
        integration.mark_result("OK" if ok else "ERROR", detail)
        results[integration.provider] = (ok, detail)
    return results
