"""Seed the Digital Estate provider catalog.

Providers only. No accounts, no properties, no services — those describe a
specific organisation's estate and must be entered, not invented, or the gap
and orphan counts become fiction.

Safe to re-run: matched on slug, and an existing row is left alone unless
--refresh is given, so a brand colour or console URL edited in Settings is
never overwritten by accident.

Usage:
    python manage.py seed_estate
    python manage.py seed_estate --refresh
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Provider


#: (slug, name, brand_color, console_url, logo_initial)
PROVIDERS = (
    ("aws", "AWS", "#ff9900", "https://console.aws.amazon.com", "A"),
    ("cloudflare", "Cloudflare", "#f6821f", "https://dash.cloudflare.com", "C"),
    ("google", "Google", "#5a95f5", "https://admin.google.com", "G"),
    ("namecheap", "Namecheap", "#ff6c2c", "https://ap.www.namecheap.com", "N"),
    ("godaddy", "GoDaddy", "#1bb8ba", "https://dcc.godaddy.com", "GD"),
    ("hostinger", "Hostinger", "#8b6df0", "https://hpanel.hostinger.com", "H"),
    ("digitalocean", "DigitalOcean", "#0080ff", "https://cloud.digitalocean.com", "DO"),
    ("vercel", "Vercel", "#000000", "https://vercel.com/dashboard", "V"),
    ("firebase", "Firebase", "#ffca28", "https://console.firebase.google.com", "F"),
    ("sentry", "Sentry", "#362d59", "https://sentry.io", "S"),
)

#: Fields --refresh is allowed to overwrite. `is_active` is excluded on purpose:
#: a provider someone deliberately switched off must stay off.
REFRESHABLE = ("name", "brand_color", "console_url", "logo_initial")


class Command(BaseCommand):
    help = "Seed the Digital Estate provider catalog (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--refresh",
            action="store_true",
            help="Overwrite name, colour, console URL and initial on existing providers.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        refresh = options["refresh"]
        created = updated = skipped = 0

        for slug, name, color, console_url, initial in PROVIDERS:
            defaults = {
                "name": name,
                "brand_color": color,
                "console_url": console_url,
                "logo_initial": initial,
            }
            provider, was_created = Provider.objects.get_or_create(
                slug=slug, defaults=defaults
            )
            if was_created:
                created += 1
                continue

            if not refresh:
                skipped += 1
                continue

            changed = [
                field
                for field in REFRESHABLE
                if getattr(provider, field) != defaults[field]
            ]
            if changed:
                for field in changed:
                    setattr(provider, field, defaults[field])
                provider.save(update_fields=[*changed, "updated_at"])
                updated += 1
            else:
                skipped += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Provider catalog seeded — {created} added, {updated} updated, "
                f"{skipped} left as-is ({len(PROVIDERS)} in catalog)."
            )
        )
        if skipped and not refresh:
            self.stdout.write(
                "  Existing providers were left untouched. Re-run with --refresh "
                "to reset their colour and console URL to the defaults."
            )
