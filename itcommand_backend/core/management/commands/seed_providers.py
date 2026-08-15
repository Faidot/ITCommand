"""Seed the Digital Estate provider catalog.

Providers only. No accounts, no properties, no services — those describe a
specific organisation's estate and must be entered, not invented, or the gap
and orphan counts become fiction.

Safe to re-run: matched on slug, and an existing row is left alone unless
--refresh is given, so a brand colour or console URL edited in Settings is
never overwritten by accident.

Usage:
    python manage.py seed_providers
    python manage.py seed_providers --refresh
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Provider


#: (slug, name, brand_color, console_url, logo_initial)
#:
#: A catalog, not an inventory. Seeding a provider says "this company exists
#: and here is where you sign in", nothing about whether we hold an account
#: with them — accounts, properties and services describe a specific estate and
#: have to be entered rather than invented, or the gap and orphan counts turn
#: into fiction.
#:
#: Brand colours and console URLs are best-effort and are the two things most
#: likely to drift. Both are editable in Settings, and --refresh deliberately
#: leaves `is_active` alone so a provider somebody switched off stays off.
PROVIDERS = (
    # ── Cloud & infrastructure ──────────────────────────────────────────
    ("aws", "AWS", "#ff9900", "https://console.aws.amazon.com", "A"),
    ("gcp", "Google Cloud", "#4285f4", "https://console.cloud.google.com", "GC"),
    ("azure", "Microsoft Azure", "#0078d4", "https://portal.azure.com", "AZ"),
    ("digitalocean", "DigitalOcean", "#0080ff", "https://cloud.digitalocean.com", "DO"),
    ("linode", "Akamai Linode", "#00a95c", "https://cloud.linode.com", "LN"),
    ("vultr", "Vultr", "#007bfc", "https://my.vultr.com", "VU"),
    ("hetzner", "Hetzner", "#d50c2d", "https://console.hetzner.cloud", "HZ"),
    ("oracle-cloud", "Oracle Cloud", "#c74634", "https://cloud.oracle.com", "OC"),
    ("scaleway", "Scaleway", "#4f0599", "https://console.scaleway.com", "SC"),

    # ── Hosting & app platforms ─────────────────────────────────────────
    ("vercel", "Vercel", "#111111", "https://vercel.com/dashboard", "V"),
    ("netlify", "Netlify", "#00c7b7", "https://app.netlify.com", "NL"),
    ("heroku", "Heroku", "#430098", "https://dashboard.heroku.com", "HK"),
    ("render", "Render", "#46e3b7", "https://dashboard.render.com", "RN"),
    ("railway", "Railway", "#7c3aed", "https://railway.app", "RW"),
    ("fly-io", "Fly.io", "#8b5cf6", "https://fly.io/dashboard", "FL"),
    ("hostinger", "Hostinger", "#8b6df0", "https://hpanel.hostinger.com", "H"),
    ("siteground", "SiteGround", "#e05d33", "https://login.siteground.com", "SG"),
    ("kinsta", "Kinsta", "#5333ed", "https://my.kinsta.com", "KS"),
    ("wpengine", "WP Engine", "#0ecad4", "https://my.wpengine.com", "WP"),

    # ── Domains & DNS ───────────────────────────────────────────────────
    ("cloudflare", "Cloudflare", "#f6821f", "https://dash.cloudflare.com", "C"),
    ("namecheap", "Namecheap", "#ff6c2c", "https://ap.www.namecheap.com", "N"),
    ("godaddy", "GoDaddy", "#1bb8ba", "https://dcc.godaddy.com", "GD"),
    ("squarespace", "Squarespace Domains", "#000000", "https://account.squarespace.com", "SQ"),
    ("name-com", "Name.com", "#1f6feb", "https://www.name.com/account", "NC"),
    ("porkbun", "Porkbun", "#ef7724", "https://porkbun.com/account", "PB"),
    ("dnsimple", "DNSimple", "#3b7ea1", "https://dnsimple.com/dashboard", "DS"),

    # ── AI ──────────────────────────────────────────────────────────────
    ("openai", "OpenAI", "#10a37f", "https://platform.openai.com", "OA"),
    ("anthropic", "Anthropic", "#d97757", "https://console.anthropic.com", "AN"),
    ("google-ai", "Google AI Studio", "#4285f4", "https://aistudio.google.com", "AI"),
    ("perplexity", "Perplexity", "#20808d", "https://www.perplexity.ai", "PX"),
    ("midjourney", "Midjourney", "#1a1a1a", "https://www.midjourney.com", "MJ"),
    ("stability-ai", "Stability AI", "#7e22ce", "https://platform.stability.ai", "SA"),
    ("huggingface", "Hugging Face", "#ffd21e", "https://huggingface.co", "HF"),
    ("replicate", "Replicate", "#1a1a1a", "https://replicate.com", "RP"),
    ("elevenlabs", "ElevenLabs", "#1a1a1a", "https://elevenlabs.io", "EL"),
    ("runway", "Runway", "#1a1a1a", "https://app.runwayml.com", "RY"),
    ("github-copilot", "GitHub Copilot", "#24292f", "https://github.com/settings/copilot", "CP"),
    ("cursor", "Cursor", "#1a1a1a", "https://cursor.com", "CS"),
    ("mistral", "Mistral AI", "#fa520f", "https://console.mistral.ai", "MS"),
    ("cohere", "Cohere", "#39594d", "https://dashboard.cohere.com", "CH"),
    ("groq", "Groq", "#f55036", "https://console.groq.com", "GQ"),
    ("openrouter", "OpenRouter", "#6467f2", "https://openrouter.ai", "OR"),
    ("together-ai", "Together AI", "#0f6fff", "https://api.together.ai", "TA"),
    ("synthesia", "Synthesia", "#ff5c35", "https://app.synthesia.io", "SY"),
    ("descript", "Descript", "#2d1e5f", "https://web.descript.com", "DC"),
    ("otter-ai", "Otter.ai", "#1f6feb", "https://otter.ai", "OT"),
    ("jasper", "Jasper", "#ff7a59", "https://app.jasper.ai", "JA"),
    ("deepl", "DeepL", "#0f2b46", "https://www.deepl.com/account", "DL"),

    # ── Design & creative ───────────────────────────────────────────────
    ("figma", "Figma", "#f24e1e", "https://www.figma.com/files", "FG"),
    ("adobe", "Adobe Creative Cloud", "#da1f26", "https://account.adobe.com", "AD"),
    ("canva", "Canva", "#00c4cc", "https://www.canva.com", "CV"),
    ("sketch", "Sketch", "#f7b500", "https://www.sketch.com/workspace", "SK"),
    ("framer", "Framer", "#0055ff", "https://www.framer.com/projects", "FR"),
    ("webflow", "Webflow", "#4353ff", "https://webflow.com/dashboard", "WF"),
    ("envato", "Envato", "#82b541", "https://account.envato.com", "EN"),
    ("shutterstock", "Shutterstock", "#ee2b24", "https://www.shutterstock.com", "SS"),
    ("freepik", "Freepik", "#1273eb", "https://www.freepik.com", "FP"),
    ("flaticon", "Flaticon", "#1273eb", "https://www.flaticon.com", "FT"),
    ("unsplash", "Unsplash", "#1a1a1a", "https://unsplash.com", "US"),
    ("affinity", "Affinity", "#1b72be", "https://store.serif.com", "AY"),

    # ── Productivity & collaboration ────────────────────────────────────
    ("google", "Google Workspace", "#5a95f5", "https://admin.google.com", "G"),
    ("microsoft365", "Microsoft 365", "#d83b01", "https://admin.microsoft.com", "M3"),
    ("slack", "Slack", "#4a154b", "https://slack.com/admin", "SL"),
    ("notion", "Notion", "#1a1a1a", "https://www.notion.so", "NO"),
    ("atlassian", "Atlassian", "#0052cc", "https://admin.atlassian.com", "AT"),
    ("trello", "Trello", "#0079bf", "https://trello.com", "TR"),
    ("asana", "Asana", "#f06a6a", "https://app.asana.com", "AS"),
    ("monday", "monday.com", "#ff3d57", "https://auth.monday.com", "MO"),
    ("clickup", "ClickUp", "#7b68ee", "https://app.clickup.com", "CU"),
    ("linear", "Linear", "#5e6ad2", "https://linear.app", "LI"),
    ("airtable", "Airtable", "#18bfff", "https://airtable.com", "AB"),
    ("miro", "Miro", "#ffd02f", "https://miro.com/app", "MI"),
    ("zoom", "Zoom", "#2d8cff", "https://zoom.us/account", "ZM"),
    ("dropbox", "Dropbox", "#0061ff", "https://www.dropbox.com/account", "DB"),
    ("box", "Box", "#0061d5", "https://app.box.com", "BX"),
    ("calendly", "Calendly", "#006bff", "https://calendly.com/app", "CL"),
    ("loom", "Loom", "#625df5", "https://www.loom.com", "LM"),
    ("zapier", "Zapier", "#ff4f00", "https://zapier.com/app", "ZP"),
    ("make", "Make", "#6d00cc", "https://www.make.com", "MK"),

    # ── Source control & developer tooling ──────────────────────────────
    ("github", "GitHub", "#24292f", "https://github.com/settings", "GH"),
    ("gitlab", "GitLab", "#fc6d26", "https://gitlab.com", "GL"),
    ("bitbucket", "Bitbucket", "#0052cc", "https://bitbucket.org", "BB"),
    ("docker", "Docker Hub", "#2496ed", "https://hub.docker.com", "DK"),
    ("npm", "npm", "#cb3837", "https://www.npmjs.com", "NP"),
    ("jetbrains", "JetBrains", "#1a1a1a", "https://account.jetbrains.com", "JB"),
    ("postman", "Postman", "#ff6c37", "https://www.postman.com", "PM"),
    ("circleci", "CircleCI", "#343434", "https://app.circleci.com", "CC"),

    # ── Monitoring & observability ──────────────────────────────────────
    ("sentry", "Sentry", "#362d59", "https://sentry.io", "S"),
    ("datadog", "Datadog", "#632ca6", "https://app.datadoghq.com", "DD"),
    ("newrelic", "New Relic", "#00ac69", "https://one.newrelic.com", "NR"),
    ("grafana", "Grafana Cloud", "#f46800", "https://grafana.com", "GF"),
    ("pagerduty", "PagerDuty", "#06ac38", "https://app.pagerduty.com", "PD"),
    ("uptimerobot", "UptimeRobot", "#3bd671", "https://dashboard.uptimerobot.com", "UR"),
    ("betterstack", "Better Stack", "#6d28d9", "https://betterstack.com", "BS"),

    # ── Email, support & CRM ────────────────────────────────────────────
    ("sendgrid", "SendGrid", "#1a82e2", "https://app.sendgrid.com", "SD"),
    ("mailgun", "Mailgun", "#f06b66", "https://app.mailgun.com", "MG"),
    ("postmark", "Postmark", "#ffde00", "https://account.postmarkapp.com", "PK"),
    ("mailchimp", "Mailchimp", "#ffe01b", "https://login.mailchimp.com", "MC"),
    ("twilio", "Twilio", "#f22f46", "https://console.twilio.com", "TW"),
    ("zoho", "Zoho", "#e42527", "https://accounts.zoho.com", "ZH"),
    ("intercom", "Intercom", "#1f8ded", "https://app.intercom.com", "IC"),
    ("zendesk", "Zendesk", "#03363d", "https://www.zendesk.com", "ZD"),
    ("hubspot", "HubSpot", "#ff7a59", "https://app.hubspot.com", "HS"),

    # ── Security & identity ─────────────────────────────────────────────
    ("1password", "1Password", "#0572ec", "https://start.1password.com", "1P"),
    ("bitwarden", "Bitwarden", "#175ddc", "https://vault.bitwarden.com", "BW"),
    ("okta", "Okta", "#007dc1", "https://www.okta.com", "OK"),
    ("auth0", "Auth0", "#eb5424", "https://manage.auth0.com", "A0"),

    # ── Analytics ───────────────────────────────────────────────────────
    ("google-analytics", "Google Analytics", "#e37400", "https://analytics.google.com", "GA"),
    ("mixpanel", "Mixpanel", "#7856ff", "https://mixpanel.com", "MP"),
    ("amplitude", "Amplitude", "#1e61f0", "https://analytics.amplitude.com", "AM"),
    ("hotjar", "Hotjar", "#fd3a5c", "https://insights.hotjar.com", "HJ"),
    ("posthog", "PostHog", "#f9bd2b", "https://app.posthog.com", "PH"),

    # ── Data & backend services ─────────────────────────────────────────
    ("firebase", "Firebase", "#ffca28", "https://console.firebase.google.com", "F"),
    ("supabase", "Supabase", "#3ecf8e", "https://supabase.com/dashboard", "SB"),
    ("mongodb", "MongoDB Atlas", "#00ed64", "https://cloud.mongodb.com", "MD"),
    ("planetscale", "PlanetScale", "#1a1a1a", "https://app.planetscale.com", "PC"),
    ("redis", "Redis Cloud", "#ff4438", "https://app.redislabs.com", "RD"),
    ("algolia", "Algolia", "#5468ff", "https://dashboard.algolia.com", "AL"),

    # ── CDN & storage ───────────────────────────────────────────────────
    ("fastly", "Fastly", "#ff282d", "https://manage.fastly.com", "FY"),
    ("akamai", "Akamai", "#009cde", "https://control.akamai.com", "AK"),
    ("bunny", "Bunny.net", "#ff7300", "https://dash.bunny.net", "BN"),
    ("backblaze", "Backblaze", "#e21e29", "https://secure.backblaze.com", "BZ"),

    # ── Mobile, games & app stores ──────────────────────────────────────
    ("apple-developer", "Apple Developer", "#1a1a1a", "https://developer.apple.com/account", "AP"),
    ("google-play", "Google Play Console", "#01875f", "https://play.google.com/console", "GP"),
    ("unity", "Unity", "#1a1a1a", "https://id.unity.com", "UN"),
    ("applovin", "AppLovin", "#0a0a0a", "https://dash.applovin.com", "AV"),
    ("adjust", "Adjust", "#0546ff", "https://dash.adjust.com", "AJ"),
    ("appsflyer", "AppsFlyer", "#00b0b9", "https://hq1.appsflyer.com", "AR"),

    # ── Marketing & social ──────────────────────────────────────────────
    ("meta-business", "Meta Business", "#0866ff", "https://business.facebook.com", "MB"),
    ("google-ads", "Google Ads", "#4285f4", "https://ads.google.com", "GG"),
    ("linkedin", "LinkedIn", "#0a66c2", "https://www.linkedin.com", "IN"),
    ("semrush", "Semrush", "#ff642d", "https://www.semrush.com", "SR"),
    ("ahrefs", "Ahrefs", "#054ada", "https://app.ahrefs.com", "AH"),
    ("buffer", "Buffer", "#168eea", "https://publish.buffer.com", "BF"),

    # ── Payments & finance ──────────────────────────────────────────────
    ("stripe", "Stripe", "#635bff", "https://dashboard.stripe.com", "ST"),
    ("paypal", "PayPal", "#003087", "https://www.paypal.com", "PP"),
    ("brex", "Brex", "#1a1a1a", "https://dashboard.brex.com", "BR"),
    ("wise", "Wise", "#9fe870", "https://wise.com", "WS"),
    ("payoneer", "Payoneer", "#ff4800", "https://myaccount.payoneer.com", "PO"),
    ("quickbooks", "QuickBooks", "#2ca01c", "https://qbo.intuit.com", "QB"),
    ("xero", "Xero", "#13b5ea", "https://go.xero.com", "XR"),
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
