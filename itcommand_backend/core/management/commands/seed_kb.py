from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

from core.models.kb import KBCategory, KBTag, KBArticle

User = get_user_model()


CATEGORIES = [
    {'name': 'Getting Started', 'icon_name': 'book-open', 'order': 1},
    {'name': 'Hardware Troubleshooting', 'icon_name': 'hard-drive', 'order': 2},
    {'name': 'Software & Accounts', 'icon_name': 'monitor-smartphone', 'order': 3},
    {'name': 'Network & Connectivity', 'icon_name': 'wifi', 'order': 4},
    {'name': 'Security & Policies', 'icon_name': 'shield-check', 'order': 5},
    {'name': 'How-To Guides', 'icon_name': 'lightbulb', 'order': 6},
    {'name': 'SOPs', 'icon_name': 'file-text', 'order': 7},
]

# (title, category_name, [tags], visibility, is_pinned, view_count, html_content)
ARTICLES = [
    (
        "Welcome to the IT Knowledge Base",
        "Getting Started", ["welcome", "overview"], "ALL_STAFF", True, 142,
        """
        <h2>Welcome aboard 👋</h2>
        <p>This knowledge base is your first stop for guides, policies, and troubleshooting
        steps maintained by the IT team. Use the search bar at the top to find articles fast.</p>
        <h3>How it's organised</h3>
        <ul>
          <li><strong>Getting Started</strong> — orientation and the basics.</li>
          <li><strong>Hardware &amp; Software</strong> — fix common device and app problems.</li>
          <li><strong>Network &amp; Security</strong> — connectivity and staying safe.</li>
          <li><strong>SOPs</strong> — internal procedures for the IT team.</li>
        </ul>
        <h3>Can't find an answer?</h3>
        <p>Raise a ticket from the Helpdesk and we'll point you to the right article — or write one.</p>
        """,
    ),
    (
        "How to Reset Your Password",
        "Software & Accounts", ["password", "accounts", "self-service"], "ALL_STAFF", True, 318,
        """
        <h2>Reset your account password</h2>
        <ol>
          <li>Go to the sign-in page and click <strong>Forgot password</strong>.</li>
          <li>Enter your work email and submit.</li>
          <li>Open the reset link from the email (check Spam if it's not there within 5 minutes).</li>
          <li>Choose a strong password: at least 12 characters with a mix of upper/lowercase, a digit, and a symbol.</li>
        </ol>
        <h3>Tips for a strong password</h3>
        <ul>
          <li>Never reuse a password from a personal account.</li>
          <li>Use the password generator in the Vault to create one instantly.</li>
          <li>Turn on multi-factor authentication where available.</li>
        </ul>
        <p>Still locked out after resetting? Raise a Helpdesk ticket and we'll verify your identity and unlock the account.</p>
        """,
    ),
    (
        "Connecting to Office Wi-Fi & VPN",
        "Network & Connectivity", ["wifi", "vpn", "remote"], "ALL_STAFF", False, 96,
        """
        <h2>Get online in the office</h2>
        <p>Connect to the <strong>Corp-Secure</strong> network using your work email and password.
        The guest network is for visitors only and cannot reach internal systems.</p>
        <h3>Working remotely</h3>
        <ol>
          <li>Open the VPN client and sign in with your work credentials.</li>
          <li>Approve the MFA prompt on your phone.</li>
          <li>Once connected, internal dashboards and shared drives will be reachable.</li>
        </ol>
        <h3>Common issues</h3>
        <ul>
          <li><strong>Can't authenticate:</strong> confirm your password hasn't expired.</li>
          <li><strong>Connected but no internal access:</strong> ensure the VPN shows "Connected", then retry.</li>
        </ul>
        """,
    ),
    (
        "Troubleshooting a Laptop That Won't Power On",
        "Hardware Troubleshooting", ["laptop", "hardware", "power"], "ALL_STAFF", False, 74,
        """
        <h2>Laptop won't turn on?</h2>
        <p>Work through these steps before raising a ticket — most no-power cases are fixed here.</p>
        <ol>
          <li>Plug in the charger and confirm the charging light comes on. Try a different outlet.</li>
          <li>Hold the power button for <strong>15 seconds</strong> to force a hard reset, then power on.</li>
          <li>Disconnect all peripherals (docks, USB drives) and try again.</li>
          <li>If the screen stays black but you hear fans, try an external monitor to rule out a display fault.</li>
        </ol>
        <p>If none of this works, raise a Helpdesk ticket with the asset tag from the bottom of the device and a note of what you've already tried.</p>
        """,
    ),
    (
        "Acceptable Use & Security Policy",
        "Security & Policies", ["policy", "security", "compliance"], "ALL_STAFF", False, 51,
        """
        <h2>Acceptable use at a glance</h2>
        <p>Company devices and accounts are provided for work. Keep them secure and use them responsibly.</p>
        <h3>Do</h3>
        <ul>
          <li>Lock your screen when you step away.</li>
          <li>Report lost devices or suspected phishing immediately.</li>
          <li>Store credentials in the Vault — never in plain text files or spreadsheets.</li>
        </ul>
        <h3>Don't</h3>
        <ul>
          <li>Share your password with anyone, including IT.</li>
          <li>Install unapproved software on company devices.</li>
          <li>Forward confidential data to personal accounts.</li>
        </ul>
        <p>Suspect a security incident? Report it through the Helpdesk with the highest priority.</p>
        """,
    ),
    (
        "Set Up the IT Command Browser Extension",
        "How-To Guides", ["vault", "extension", "passwords"], "ALL_STAFF", False, 63,
        """
        <h2>Auto-fill vault passwords in your browser</h2>
        <p>The IT Command extension fills your saved credentials on sites you have access to.</p>
        <ol>
          <li>Open <strong>Settings → Browser Extension</strong> and download the extension.</li>
          <li>In Chrome or Edge, go to the extensions page and turn on <strong>Developer mode</strong>.</li>
          <li>Choose <strong>Load unpacked</strong> and select the unzipped folder.</li>
          <li>Pin the extension, sign in, and unlock the vault with the master password.</li>
        </ol>
        <h3>Using it</h3>
        <p>When you visit a site with a saved credential, the extension offers to fill it. With a single
        match it fills automatically — it never submits the form for you. Open the popup any time to pick
        a credential manually or copy a password.</p>
        """,
    ),
    (
        "IT Onboarding Checklist for a New Employee",
        "SOPs", ["onboarding", "sop", "checklist"], "IT_ONLY", False, 38,
        """
        <h2>New starter — IT setup</h2>
        <p><em>Internal SOP for the IT team. Complete before the employee's first day.</em></p>
        <h3>Accounts</h3>
        <ul>
          <li>Create the email/SSO account and assign the correct role.</li>
          <li>Add to the relevant groups and distribution lists.</li>
          <li>Enrol multi-factor authentication.</li>
        </ul>
        <h3>Hardware</h3>
        <ul>
          <li>Image and assign a laptop; record the asset tag in the Asset module.</li>
          <li>Prepare peripherals (dock, monitor, headset) and a seat assignment.</li>
        </ul>
        <h3>Access</h3>
        <ul>
          <li>Grant least-privilege access to the tools the role needs.</li>
          <li>Share the Getting Started article and the Acceptable Use policy.</li>
        </ul>
        """,
    ),
]


class Command(BaseCommand):
    help = 'Seed Knowledge Base categories, tags, and example articles (idempotent).'

    def handle(self, *args, **kwargs):
        # Categories
        cats = {}
        for c in CATEGORIES:
            obj, _ = KBCategory.objects.get_or_create(
                name=c['name'],
                defaults={'icon_name': c['icon_name'], 'order': c['order']},
            )
            cats[c['name']] = obj

        # Author for the example articles: prefer an admin, fall back to any user.
        author = (User.objects.filter(role__in=['SUPERADMIN', 'ADMIN']).first()
                  or User.objects.first())

        created_articles = 0
        for title, cat_name, tag_names, visibility, pinned, views, content in ARTICLES:
            article, created = KBArticle.objects.get_or_create(
                title=title,
                defaults={
                    'category': cats.get(cat_name),
                    'content': content.strip(),
                    'status': 'PUBLISHED',
                    'visibility': visibility,
                    'is_pinned': pinned,
                    'view_count': views,
                    'author': author,
                    'last_edited_by': author,
                },
            )
            if created:
                created_articles += 1
                tags = []
                for name in tag_names:
                    tag, _ = KBTag.objects.get_or_create(name=name)
                    tags.append(tag)
                article.tags.set(tags)

        self.stdout.write(self.style.SUCCESS(
            f'KB seed complete: {len(cats)} categories, '
            f'{KBTag.objects.count()} tags total, '
            f'{created_articles} new example article(s) created '
            f'({KBArticle.objects.count()} articles total).'
        ))
