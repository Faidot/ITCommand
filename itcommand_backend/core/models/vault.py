from .users import User, Department
from django.db import models
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.contrib.auth.hashers import make_password, check_password
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from datetime import timedelta
from core.encryption import encrypt_value, decrypt_value
import hashlib
import secrets


class VaultMasterPassword(models.Model):
    """Org-wide master password gating the Vault section.

    Only SUPERADMIN can set/rotate this. Users with vault access (Manager+)
    must enter it to unlock the vault for the session.
    Stored hashed (PBKDF2) — never stored or transmitted in plain text.
    Singleton: only one row should exist (id=1).
    """
    password_hash = models.CharField(max_length=255)
    set_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='set_vault_passwords')
    set_at = models.DateTimeField(auto_now=True)
    rotation_count = models.PositiveIntegerField(default=0)
    session_ttl_minutes = models.PositiveIntegerField(default=30)

    def set_password(self, raw_password: str):
        self.password_hash = make_password(raw_password)
        self.rotation_count = (self.rotation_count or 0) + 1

    def check_password(self, raw_password: str) -> bool:
        return check_password(raw_password, self.password_hash)

    @classmethod
    def get_singleton(cls):
        return cls.objects.filter(pk=1).first()

    def __str__(self):
        return f"VaultMasterPassword (rot={self.rotation_count})"


class VaultUnlockSession(models.Model):
    """Short-lived unlock session granted to a user after successful master
    password entry. Token is sent back as X-Vault-Token header on subsequent
    requests. Sliding expiry refreshes on each use.
    """
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='vault_sessions')
    token = models.CharField(max_length=64, unique=True, db_index=True)
    issued_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    last_used_at = models.DateTimeField(auto_now=True)
    revoked = models.BooleanField(default=False)
    ip_address = models.GenericIPAddressField(blank=True, null=True)

    @staticmethod
    def digest_token(raw_token: str) -> str:
        return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()

    @classmethod
    def issue(cls, user, ttl_minutes: int = 30, ip: str | None = None):
        raw_token = secrets.token_urlsafe(36)
        session = cls.objects.create(
            user=user,
            token=cls.digest_token(raw_token),
            expires_at=timezone.now() + timedelta(minutes=ttl_minutes),
            ip_address=ip or None,
        )
        # Return the secret once without ever persisting it in plaintext.
        session.token = raw_token
        return session

    def is_valid(self) -> bool:
        return (not self.revoked) and self.expires_at > timezone.now()

    def slide(self, ttl_minutes: int = 30):
        self.expires_at = timezone.now() + timedelta(minutes=ttl_minutes)
        self.save(update_fields=['expires_at', 'last_used_at'])

    def __str__(self):
        return f"VaultSession({self.user_id}, exp={self.expires_at:%Y-%m-%d %H:%M})"


class AccountWorkspace(models.Model):
    PLATFORM_CHOICES = (
        ('GITHUB', 'GitHub'),
        ('GOOGLE_WORKSPACE', 'Google Workspace'),
        ('AZURE_AD', 'Azure AD'),
        ('SLACK', 'Slack'),
        ('JIRA', 'Jira'),
        ('FIGMA', 'Figma'),
        ('AWS', 'AWS'),
        ('NOTION', 'Notion'),
        ('LINEAR', 'Linear'),
        ('CLOUDFLARE', 'Cloudflare'),
        ('OTHER', 'Other'),
    )

    STATUS_CHOICES = (
        ('ACTIVE', 'Active'),
        ('TRIAL', 'Trial'),
        ('PAUSED', 'Paused'),
        ('CANCELLED', 'Cancelled'),
    )

    BILLING_CYCLE_CHOICES = (
        ('MONTHLY', 'Monthly'),
        ('QUARTERLY', 'Quarterly'),
        ('ANNUAL', 'Annual'),
        ('CUSTOM', 'Custom / One-off'),
    )

    name = models.CharField(max_length=255)
    platform = models.CharField(max_length=30, choices=PLATFORM_CHOICES, default='OTHER')
    login_email = models.CharField(max_length=255)
    account_url = models.URLField(blank=True, null=True)

    owner_name = models.CharField(max_length=255)
    subscription_plan = models.CharField(max_length=100, blank=True)
    renewal_date = models.DateField(null=True, blank=True)
    monthly_cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # Productivity / billing fields
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='ACTIVE')
    billing_cycle = models.CharField(max_length=10, choices=BILLING_CYCLE_CHOICES, default='MONTHLY')
    seats = models.PositiveIntegerField(null=True, blank=True)
    billing_email = models.EmailField(blank=True)
    support_url = models.URLField(blank=True, null=True)
    auto_renew = models.BooleanField(default=True)
    last_renewed_at = models.DateField(null=True, blank=True)

    notes = models.TextField(blank=True, null=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_workspaces')
    created_at = models.DateTimeField(auto_now_add=True)

    @property
    def annual_cost(self):
        if not self.monthly_cost:
            return None
        m = float(self.monthly_cost)
        if self.billing_cycle == 'MONTHLY':
            return round(m * 12, 2)
        if self.billing_cycle == 'QUARTERLY':
            return round(m * 4, 2)
        if self.billing_cycle == 'ANNUAL':
            return round(m, 2)
        return round(m, 2)

    def advance_renewal(self):
        """Advance renewal_date by one billing cycle from today (or current renewal)."""
        from datetime import date
        import calendar

        def add_months(d, months):
            year = d.year + (d.month - 1 + months) // 12
            month = (d.month - 1 + months) % 12 + 1
            day = min(d.day, calendar.monthrange(year, month)[1])
            return d.replace(year=year, month=month, day=day)

        base = self.renewal_date or date.today()
        if base < date.today():
            base = date.today()
        if self.billing_cycle == 'MONTHLY':
            self.renewal_date = add_months(base, 1)
        elif self.billing_cycle == 'QUARTERLY':
            self.renewal_date = add_months(base, 3)
        elif self.billing_cycle == 'ANNUAL':
            self.renewal_date = add_months(base, 12)
        else:
            self.renewal_date = add_months(base, 12)
        self.last_renewed_at = date.today()

    def __str__(self):
        return f"{self.name} - {self.platform}"


class VaultUserKey(models.Model):
    """Per-user RSA keypair used for end-to-end private credential sharing.

    The public key is plaintext (anyone may seal a secret to this user). The
    private key is encrypted at rest with a key derived from the user's personal
    vault password — the server never stores that password or the decrypted key.
    Created the first time the user sets their personal vault password.
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='vault_key')
    public_key_pem = models.TextField()
    encrypted_private_key = models.TextField()
    kdf_salt = models.CharField(max_length=64)
    # Hash of the personal password, only to give a clean "wrong password" error
    # before attempting an (expensive) private-key decrypt. Never the key itself.
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def set_personal_password_hash(self, raw_password: str):
        self.password_hash = make_password(raw_password)

    def check_personal_password(self, raw_password: str) -> bool:
        return check_password(raw_password, self.password_hash)

    def __str__(self):
        return f"VaultUserKey({self.user_id})"


class VaultCredential(models.Model):
    CATEGORY_CHOICES = (
        ('GITHUB', 'GitHub'),
        ('GOOGLE', 'Google'),
        ('AWS', 'AWS'),
        ('AZURE', 'Azure'),
        ('DATABASE', 'Database'),
        ('SERVER', 'Server'),
        ('SOCIAL', 'Social'),
        ('EMAIL', 'Email'),
        ('SSH', 'SSH Key'),
        ('API', 'API Key'),
        ('WIFI', 'Wi-Fi'),
        ('OTHER', 'Other'),
    )

    VISIBILITY_CHOICES = (
        ('ORG', 'Organization'),      # visible + revealable by all vault users (legacy default)
        ('PRIVATE', 'Private'),       # visible only to creator; secret reachable only via E2E shares
    )

    title = models.CharField(max_length=255)
    username = models.CharField(max_length=255)
    encrypted_password = models.TextField()
    url = models.URLField(blank=True, null=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='OTHER')
    workspace_tag = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True, null=True)

    # Link this credential to a managed Account Workspace (platform).
    workspace = models.ForeignKey(
        AccountWorkspace, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='credentials',
    )
    tags = models.JSONField(default=list, blank=True)

    # Optional encrypted extras
    encrypted_totp_secret = models.TextField(blank=True, default='')
    encrypted_recovery_codes = models.TextField(blank=True, default='')  # JSON list, encrypted
    encrypted_custom_fields = models.TextField(blank=True, default='')   # JSON dict, encrypted

    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_credentials')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_shared = models.BooleanField(default=False)
    visibility = models.CharField(max_length=10, choices=VISIBILITY_CHOICES, default='ORG')
    last_revealed_at = models.DateTimeField(null=True, blank=True)
    last_revealed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='revealed_credentials')
    reveal_count = models.PositiveIntegerField(default=0)
    rotation_due_at = models.DateField(null=True, blank=True, help_text="Optional reminder to rotate this credential")
    is_favorite = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.title} ({self.username})"


class VaultShare(models.Model):
    """An end-to-end encrypted share of a credential to one specific recipient.

    `sealed_secret` is the credential's secret payload (password + extras) sealed
    to the recipient's RSA public key — only the recipient, with their personal
    vault password, can open it. One row per (credential, recipient).
    """
    credential = models.ForeignKey(VaultCredential, on_delete=models.CASCADE, related_name='shares')
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='vault_shares_received')
    shared_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='vault_shares_sent')
    sealed_secret = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_revealed_at = models.DateTimeField(null=True, blank=True)
    reveal_count = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = ('credential', 'recipient')

    def __str__(self):
        return f"Share(cred={self.credential_id} -> user={self.recipient_id})"


# --- FINANCE MODELS ---
