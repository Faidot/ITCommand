"""Fetch currency exchange rates from the configured integration.

Configure the provider under Settings -> Integrations (or in Django admin),
then run:

    python manage.py fetch_exchange_rates
    python manage.py fetch_exchange_rates --dry-run

Scheduled daily by the automation runner. Safe to re-run: rates are stored
per day, so a second run on the same date updates rather than duplicates.
"""
import json
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.app_settings import default_currency
from core.lov import get_values
from core.models import ExchangeRate, Integration
from core.models.integrations import CredentialUnreadable


PROVIDER = "EXCHANGE_RATES"
TIMEOUT_SECONDS = 20


def _extract_rates(payload):
    """Pull a {code: rate} mapping out of the common provider shapes."""
    if not isinstance(payload, dict):
        return {}
    for key in ("rates", "quotes", "conversion_rates", "data"):
        candidate = payload.get(key)
        if isinstance(candidate, dict) and candidate:
            return candidate
    return {}


def _normalise_code(raw, base):
    """Providers use either 'EUR' or the 'USDEUR' pair form."""
    code = str(raw).upper()
    if len(code) == 6 and code.startswith(base.upper()):
        return code[3:]
    return code


class Command(BaseCommand):
    help = "Fetch exchange rates from the configured currency integration."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Fetch but do not save.")
        parser.add_argument("--base", help="Override the reporting currency.")

    def handle(self, *args, **options):
        integration = Integration.objects.filter(provider=PROVIDER).first()
        if not integration or not integration.is_enabled:
            self.stdout.write(
                "Currency integration is not enabled — skipping. "
                "Configure it under Settings → Integrations."
            )
            return

        base = (options.get("base") or default_currency()).upper()
        wanted = {code for code, _ in get_values("currency")} - {base}
        if not wanted:
            self.stdout.write("No other currencies configured — nothing to fetch.")
            return

        url = integration.base_url or Integration.PROVIDER_SPECS[PROVIDER]["default_base_url"]
        params = {"base": base, "source": base, "symbols": ",".join(sorted(wanted))}
        try:
            api_key = integration.get_api_key()
        except CredentialUnreadable as exc:
            integration.mark_result("ERROR", str(exc))
            raise CommandError(str(exc)) from exc
        if api_key:
            # Providers disagree on the parameter name; sending both is harmless
            # and avoids a per-provider adapter for what is one query string.
            params["access_key"] = api_key
            params["apikey"] = api_key
        request_url = f"{url}{'&' if '?' in url else '?'}{urllib.parse.urlencode(params)}"

        try:
            request = urllib.request.Request(
                request_url, headers={"User-Agent": "ITCommand/1.0"}
            )
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            message = f"{type(exc).__name__}: {exc}"
            integration.mark_result("ERROR", message)
            raise CommandError(f"Rate fetch failed — {message}") from exc

        if payload.get("success") is False or payload.get("error"):
            message = json.dumps(payload.get("error") or payload)[:500]
            integration.mark_result("ERROR", message)
            raise CommandError(f"Provider rejected the request — {message}")

        rates = _extract_rates(payload)
        if not rates:
            integration.mark_result("ERROR", "Response contained no rates.")
            raise CommandError("Response contained no rates.")

        today = timezone.localdate()
        saved = skipped = 0
        for raw_code, raw_rate in rates.items():
            code = _normalise_code(raw_code, base)
            if code == base or code not in wanted:
                continue
            try:
                value = Decimal(str(raw_rate))
            except (InvalidOperation, TypeError):
                skipped += 1
                continue
            if value <= 0:
                skipped += 1
                continue
            # Providers quote "1 base = N foreign"; we store "1 foreign = N base".
            stored = Decimal("1") / value
            if options["dry_run"]:
                self.stdout.write(f"  would store 1 {code} = {stored:.6f} {base}")
                saved += 1
                continue
            ExchangeRate.objects.update_or_create(
                base_currency=base,
                currency=code,
                as_of=today,
                defaults={"rate": stored, "source": "API"},
            )
            saved += 1

        summary = f"{saved} rate(s) for base {base}" + (f", {skipped} skipped" if skipped else "")
        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS(f"Dry run — {summary}"))
            return
        integration.mark_result("OK", summary)
        self.stdout.write(self.style.SUCCESS(f"Updated {summary}."))
