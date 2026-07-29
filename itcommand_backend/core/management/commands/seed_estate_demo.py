"""Fill the Digital Estate with a believable demo estate. Development only.

Everything here is fictional. The domains use `.example` and the logins
`@example.invalid` — both reserved by RFC 6761 precisely so they can never
resolve to anything real. No Terafort domain, account or credential appears in
this file, and none should ever be added to it: this command is run on
developer machines and demo environments, and a real login in a seed script is
a real login in everyone's shell history.

The dataset is shaped to make every state on the screens visible at once:

* a property with a complete stack, and several with genuine gaps
* renewals landing in the red (<7d), amber (<30d) and neutral bands
* two services that will not auto-renew and renew soon, so they are at-risk
* two orphans — services attached to no property
* all eight service types and all four billing cycles
* accounts with no MFA, SMS MFA, and unrecorded MFA, so the Accounts table
  shows a red, an amber and a muted badge together

Idempotent: every row is matched with `get_or_create`, so re-running changes
nothing. `--clear` removes only what this command created.

Usage:
    python manage.py seed_estate_demo
    python manage.py seed_estate_demo --clear
    python manage.py seed_estate_demo --force      # outside DEBUG
"""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings as django_settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.models import Property, Provider, ProviderAccount, Service


#: Written into `notes` on every row this command creates, and the only thing
#: `--clear` matches on. A marker beats a name list because a demo row someone
#: has renamed is still removable; it is weaker than a dedicated column, but a
#: column on three production models to support a dev-only command is a worse
#: trade. Documented here because `--clear` will miss a row whose notes have
#: been rewritten by hand.
DEMO_MARKER = "[seed_estate_demo]"


def note(text):
    return f"{DEMO_MARKER} {text}"


#: (slug, login, auth, mfa). The MFA spread is deliberate — NONE and SMS must
#: both be present or the Accounts table cannot show its red and amber badges.
ACCOUNTS = (
    ("namecheap", "domains@example.invalid", "PASSWORD", "NONE"),
    ("cloudflare", "dns-admin@example.invalid", "SSO", "APP"),
    ("aws", "aws-root@example.invalid", "IAM", "SECURITY_KEY"),
    ("google", "workspace-admin@example.invalid", "SSO", "SMS"),
    ("hostinger", "hosting@example.invalid", "PASSWORD", "UNKNOWN"),
    ("vercel", "deploys@example.invalid", "SSO", "APP"),
)

#: (name, kind)
PROPERTIES = (
    ("pixelforge-arena.example", "MOBILE_GAME"),
    ("stellar-drift.example", "MOBILE_GAME"),
    ("quillbox.example", "APP"),
    ("getquillbox.example", "MARKETING"),
    ("northwind-labs.example", "CORPORATE"),
    ("northwind-studio.example", "STUDIO"),
    ("infra-northwind.example", "INFRA"),
    ("oldbrand-parked.example", "PARKED"),
)

#: (property | None, type, identifier, account slug, cost, cycle, days-until-renewal, auto_renew)
#:
#: `days` of None means no renewal date at all, which is a real state for a
#: usage-billed service and must not be mistaken for "renews today".
SERVICES = (
    # ── A complete stack, so "no gaps" is visible next to the properties
    #    that do have them.
    ("pixelforge-arena.example", "REGISTRAR", "pixelforge-arena.example", "namecheap", "4200.00", "YEARLY", 250, True),
    ("pixelforge-arena.example", "DNS", "zone: pixelforge-arena.example", "cloudflare", "0.00", "FREE", None, True),
    ("pixelforge-arena.example", "HOSTING", "ecs-prod · ap-south-1", "aws", "38000.00", "MONTHLY", 18, True),
    ("pixelforge-arena.example", "MAIL", "workspace · 12 seats", "google", "9800.00", "MONTHLY", 45, True),
    ("pixelforge-arena.example", "CDN", "cdn: pixelforge-arena.example", "cloudflare", "6500.00", "MONTHLY", 60, True),
    ("pixelforge-arena.example", "TLS", "wildcard *.pixelforge-arena.example", "cloudflare", "0.00", "FREE", 200, True),
    ("pixelforge-arena.example", "ANALYTICS", "ga4 · pixelforge", "google", "0.00", "USAGE", None, True),

    # ── Missing CDN and TLS: a genuine stack gap on a live property.
    #    Its registrar renews in 5 days with auto-renew off — at-risk, red.
    ("stellar-drift.example", "REGISTRAR", "stellar-drift.example", "namecheap", "4200.00", "YEARLY", 5, False),
    ("stellar-drift.example", "DNS", "zone: stellar-drift.example", "cloudflare", "0.00", "FREE", None, True),
    ("stellar-drift.example", "HOSTING", "vps-04 · singapore", "hostinger", "12000.00", "MONTHLY", 25, True),
    ("stellar-drift.example", "MAIL", "workspace · 5 seats", "google", "4900.00", "MONTHLY", 90, True),
    ("stellar-drift.example", "ANALYTICS", "ga4 · stellar-drift", "google", "0.00", "FREE", None, True),

    # ── The second at-risk service: renews in 3 days, auto-renew off.
    ("quillbox.example", "REGISTRAR", "quillbox.example", "namecheap", "4200.00", "YEARLY", 3, False),
    ("quillbox.example", "DNS", "zone: quillbox.example", "cloudflare", "0.00", "FREE", None, True),
    ("quillbox.example", "HOSTING", "quillbox-app · iad1", "vercel", "7800.00", "MONTHLY", 12, True),

    ("getquillbox.example", "HOSTING", "quillbox-marketing · iad1", "vercel", "2400.00", "MONTHLY", 40, True),
    ("getquillbox.example", "DNS", "zone: getquillbox.example", "cloudflare", "0.00", "FREE", None, True),

    ("northwind-labs.example", "REGISTRAR", "northwind-labs.example", "namecheap", "5600.00", "YEARLY", 150, True),
    ("northwind-labs.example", "MAIL", "workspace · 30 seats", "google", "14700.00", "MONTHLY", 30, True),

    ("northwind-studio.example", "HOSTING", "studio-site · shared", "hostinger", "3600.00", "MONTHLY", 75, True),

    ("infra-northwind.example", "DNS", "zone: infra-northwind.example", "cloudflare", "2800.00", "MONTHLY", 100, True),

    # ── Renews in 6 days but does auto-renew: red on the timeline, and
    #    deliberately *not* at-risk. The two are different questions.
    ("oldbrand-parked.example", "REGISTRAR", "oldbrand-parked.example", "namecheap", "3200.00", "YEARLY", 6, True),

    # ── SaaS attached to a property. It holds no stack position, so it never
    #    closes a gap and never appears in the diagram — it belongs to the
    #    "other services" panel underneath, which would otherwise be empty on
    #    every demo property and look broken rather than simply unused.
    ("pixelforge-arena.example", "SAAS", "crash reporting · pro", "aws", "5400.00", "MONTHLY", 33, True),
    ("quillbox.example", "SAAS", "email delivery · 50k/mo", "google", "3100.00", "MONTHLY", 70, True),

    # ── Orphans: real money attached to nothing we own.
    (None, "SAAS", "design suite · 8 seats", "aws", "21000.00", "MONTHLY", 55, True),
    (None, "SAAS", "issue tracker · team plan", "google", "8400.00", "MONTHLY", 22, True),
)


class Command(BaseCommand):
    help = "Seed a fictional Digital Estate for development and demos."

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Remove the rows this command created, and nothing else.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Allow the command to run outside DEBUG.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        # Demo data in production is worse than no demo data: it lands in
        # spend totals, gap counts and MFA alerts that someone will act on.
        if not django_settings.DEBUG and not options["force"]:
            raise CommandError(
                "Refusing to seed demo data outside DEBUG. Use --force if you "
                "are certain."
            )

        if options["clear"]:
            self.clear()
            return

        today = timezone.localdate()

        missing = [
            slug
            for slug, *_ in ACCOUNTS
            if not Provider.objects.filter(slug=slug).exists()
        ]
        if missing:
            raise CommandError(
                f"Provider catalog is missing {', '.join(sorted(set(missing)))}. "
                f"Run `manage.py seed_providers` first."
            )

        accounts = {}
        accounts_made = 0
        for slug, login, auth, mfa in ACCOUNTS:
            provider = Provider.objects.get(slug=slug)
            account, created = ProviderAccount.objects.get_or_create(
                provider=provider,
                account_email=login,
                defaults={
                    "auth_type": auth,
                    "mfa_type": mfa,
                    "notes": note("Demo provider account."),
                },
            )
            accounts[slug] = account
            accounts_made += int(created)

        properties = {}
        properties_made = 0
        for name, kind in PROPERTIES:
            prop, created = Property.objects.get_or_create(
                name=name,
                defaults={"kind": kind, "notes": note("Demo property.")},
            )
            properties[name] = prop
            properties_made += int(created)

        services_made = 0
        for prop_name, service_type, identifier, slug, cost, cycle, days, auto in SERVICES:
            account = accounts[slug]
            _, created = Service.objects.get_or_create(
                identifier=identifier,
                provider_account=account,
                defaults={
                    "service_type": service_type,
                    "provider": account.provider,
                    "property": properties[prop_name] if prop_name else None,
                    "cost": Decimal(cost),
                    "currency": "PKR",
                    "billing_cycle": cycle,
                    "renewal_date": None if days is None else today + timedelta(days=days),
                    "auto_renew": auto,
                    "notes": note("Demo service."),
                },
            )
            services_made += int(created)

        self.stdout.write(
            self.style.SUCCESS(
                f"Demo estate seeded — {properties_made} propert"
                f"{'y' if properties_made == 1 else 'ies'}, {accounts_made} account(s), "
                f"{services_made} service(s) added."
            )
        )
        if not (properties_made or accounts_made or services_made):
            self.stdout.write(
                "  Everything already existed; nothing changed. Use --clear to remove it."
            )
        self.stdout.write(
            "  Fictional data only (.example domains, @example.invalid logins)."
        )

    def clear(self):
        """Delete only rows carrying the demo marker.

        Services first: `Provider` and `ProviderAccount` are PROTECTed by the
        services hanging off them, so the reverse order would raise rather than
        cascade — which is the protection working, not a bug to route around.
        """
        services = Service.objects.filter(notes__contains=DEMO_MARKER)
        service_count = services.count()
        services.delete()

        properties = Property.objects.filter(notes__contains=DEMO_MARKER)
        property_count = properties.count()
        properties.delete()

        # An account someone has since attached a real service to is left
        # alone: deleting it would either fail on the PROTECT or take a real
        # record with it, and neither is this command's business.
        removed_accounts = 0
        for account in ProviderAccount.objects.filter(notes__contains=DEMO_MARKER):
            if account.services.exists():
                self.stdout.write(
                    f"  Kept {account.account_email} — it now holds "
                    f"{account.services.count()} non-demo service(s)."
                )
                continue
            account.delete()
            removed_accounts += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Demo estate cleared — {service_count} service(s), "
                f"{property_count} propert{'y' if property_count == 1 else 'ies'}, "
                f"{removed_accounts} account(s) removed."
            )
        )
