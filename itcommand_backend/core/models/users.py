from django.db import models
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from core.encryption import encrypt_value, decrypt_value


class Department(models.Model):
    name = models.CharField(max_length=100)
    code = models.SlugField(max_length=40, unique=True, null=True, blank=True)
    description = models.TextField(blank=True)
    head = models.ForeignKey(
        "User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="headed_departments",
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="children",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

class CustomUserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError(_('The Email field must be set'))
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('role', 'SUPERADMIN')

        if extra_fields.get('is_staff') is not True:
            raise ValueError(_('Superuser must have is_staff=True.'))
        if extra_fields.get('is_superuser') is not True:
            raise ValueError(_('Superuser must have is_superuser=True.'))

        return self.create_user(email, password, **extra_fields)

class User(AbstractUser):
    ROLE_CHOICES = (
        ('SUPERADMIN', 'Superadmin'),
        ('ADMIN', 'Admin'),
        ('MANAGER', 'Manager'),
        ('VIEWER', 'Viewer'),
    )

    username = None  # Remove username field
    email = models.EmailField(_('email address'), unique=True)
    full_name = models.CharField(max_length=255)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='VIEWER')
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True)
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)
    designation = models.CharField(max_length=120, null=True, blank=True)
    bio = models.TextField(null=True, blank=True)
    manager = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="direct_reports",
    )
    team_lead = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="team_members",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # ── presence ────────────────────────────────────────────────────────────
    #
    # "Who is using the app right now" without a websocket. JWT sessions are
    # stateless, so there is nothing to count — the only honest signal is when
    # somebody last made a request. That is what these hold, and why the UI
    # says "active in the last 5 minutes" rather than claiming live presence
    # it cannot actually observe.
    last_seen_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_login_at = models.DateTimeField(null=True, blank=True)
    #: Cleared on sign-in, set on sign-out. A session that simply expired
    #: leaves this null, which is the truth: nobody saw them leave.
    last_logout_at = models.DateTimeField(null=True, blank=True)

    #: How stale `last_seen_at` may be before somebody counts as gone.
    ONLINE_WINDOW_SECONDS = 300
    #: Don't write on every request — once a minute per user is enough to
    #: drive a five-minute window, and turns a per-request UPDATE into a rare one.
    SEEN_WRITE_INTERVAL_SECONDS = 60

    def touch_seen(self, force=False):
        """Record that this user is active. Cheap and heavily throttled."""
        from django.utils import timezone

        now = timezone.now()
        if not force and self.last_seen_at:
            age = (now - self.last_seen_at).total_seconds()
            if age < self.SEEN_WRITE_INTERVAL_SECONDS:
                return False

        fields = ['last_seen_at']
        self.last_seen_at = now
        if force:
            self.last_login_at = now
            self.last_logout_at = None
            fields += ['last_login_at', 'last_logout_at']
        # update_fields keeps this off every other column, so a presence ping
        # cannot overwrite a concurrent edit to the same row.
        User.objects.filter(pk=self.pk).update(**{f: getattr(self, f) for f in fields})
        return True

    def mark_signed_out(self):
        from django.utils import timezone

        now = timezone.now()
        self.last_logout_at = now
        User.objects.filter(pk=self.pk).update(last_logout_at=now, last_seen_at=now)

    @property
    def is_online(self):
        from django.utils import timezone

        if not self.last_seen_at:
            return False
        if self.last_logout_at and self.last_logout_at >= self.last_seen_at:
            return False
        return (
            timezone.now() - self.last_seen_at
        ).total_seconds() <= self.ONLINE_WINDOW_SECONDS

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = [] # empty because email is the USERNAME_FIELD

    objects = CustomUserManager()

    def __str__(self):
        return self.email
