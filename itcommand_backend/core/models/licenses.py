from .users import User
from .vendors import Vendor
from django.db import models
from django.utils import timezone
from core.encryption import encrypt_value, decrypt_value


class SoftwareProduct(models.Model):
    CATEGORY_CHOICES = (
        ('PRODUCTIVITY', 'Productivity'),
        ('DESIGN', 'Design'),
        ('DEVELOPMENT', 'Development'),
        ('SECURITY', 'Security'),
        ('COMMUNICATION', 'Communication'),
        ('OS', 'Operating System'),
        ('OTHER', 'Other'),
    )

    name = models.CharField(max_length=255)
    vendor = models.CharField(max_length=255)
    website = models.URLField(blank=True, null=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='OTHER')
    description = models.TextField(blank=True)
    logo_url = models.URLField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.vendor})"


class SoftwareLicense(models.Model):
    LICENSE_TYPE_CHOICES = (
        ('PERPETUAL', 'Perpetual'),
        ('SUBSCRIPTION', 'Subscription'),
        ('VOLUME', 'Volume'),
        ('OEM', 'OEM'),
        ('OPEN_SOURCE', 'Open Source'),
        ('TRIAL', 'Trial'),
    )
    BILLING_CYCLE_CHOICES = (
        ('ONE_TIME', 'One-Time'),
        ('MONTHLY', 'Monthly'),
        ('YEARLY', 'Yearly'),
    )

    product = models.ForeignKey(SoftwareProduct, on_delete=models.CASCADE, related_name='licenses')
    vendor = models.ForeignKey(Vendor, on_delete=models.SET_NULL, null=True, blank=True, related_name='software_licenses')
    encrypted_license_key = models.TextField(blank=True)
    license_type = models.CharField(max_length=20, choices=LICENSE_TYPE_CHOICES, default='SUBSCRIPTION')
    seats_total = models.IntegerField(null=True, blank=True, help_text='Total licensed seats. Null = unlimited.')
    purchase_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    billing_cycle = models.CharField(max_length=10, choices=BILLING_CYCLE_CHOICES, null=True, blank=True)
    vendor_contact = models.CharField(max_length=255, blank=True)
    purchase_order_number = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    # Auto-renewal: when True, the auto_renew_licenses runner advances
    # expiry_date by one billing_cycle each time it lapses.
    auto_renew = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_licenses')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.product.name} - {self.license_type}"

    # --- Encryption helpers ---
    def set_license_key(self, raw_key):
        """Encrypt and store the license key."""
        self.encrypted_license_key = encrypt_value(raw_key) if raw_key else ''

    def get_license_key(self):
        """Decrypt and return the license key."""
        return decrypt_value(self.encrypted_license_key) if self.encrypted_license_key else ''

    # --- Computed seat properties ---
    @property
    def seats_used(self):
        return self.assignments.filter(is_active=True).count()

    @property
    def seats_available(self):
        if self.seats_total is None:
            return None  # Unlimited
        return max(self.seats_total - self.seats_used, 0)

    @property
    def seats_usage_pct(self):
        """Percentage of seats used (0-100). Returns 0 if unlimited."""
        if self.seats_total is None or self.seats_total == 0:
            return 0
        return round((self.seats_used / self.seats_total) * 100, 1)

    @property
    def is_expired(self):
        if self.expiry_date is None:
            return False
        return self.expiry_date < timezone.now().date()

    @property
    def days_until_expiry(self):
        if self.expiry_date is None:
            return None
        delta = (self.expiry_date - timezone.now().date()).days
        return delta

    @property
    def annual_cost(self):
        """Normalize cost to yearly."""
        if self.billing_cycle == 'MONTHLY':
            return float(self.cost) * 12
        elif self.billing_cycle == 'YEARLY':
            return float(self.cost)
        elif self.billing_cycle == 'ONE_TIME':
            return float(self.cost)
        return float(self.cost)


class LicenseAssignment(models.Model):
    license = models.ForeignKey(SoftwareLicense, on_delete=models.CASCADE, related_name='assignments')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='license_assignments')
    assigned_date = models.DateTimeField(auto_now_add=True)
    revoked_date = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    assigned_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='license_assignments_made')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-assigned_date']

    def __str__(self):
        return f"{self.user.full_name} → {self.license.product.name} ({'Active' if self.is_active else 'Revoked'})"


class LicenseRenewal(models.Model):
    """One renewal event against a SoftwareLicense.

    Captures the transition from a previous expiry to a new one, plus
    any additional cost paid and seats added. Used to keep an audit
    trail of how an expiry date has moved over time.
    """
    license = models.ForeignKey(
        SoftwareLicense, on_delete=models.CASCADE, related_name='renewals'
    )
    previous_expiry = models.DateField(null=True, blank=True)
    new_expiry = models.DateField()
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    seats_added = models.IntegerField(default=0)
    notes = models.TextField(blank=True, default='')
    renewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='license_renewals_done',
    )
    renewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-renewed_at']

    def __str__(self):
        return f"Renew {self.license.product.name} → {self.new_expiry}"


class LicenseAlert(models.Model):
    ALERT_TYPE_CHOICES = (
        ('EXPIRING_SOON', 'Expiring Soon'),
        ('EXPIRED', 'Expired'),
        ('SEATS_FULL', 'Seats Full'),
        ('SEATS_NEAR_LIMIT', 'Seats Near Limit'),
    )

    license = models.ForeignKey(SoftwareLicense, on_delete=models.CASCADE, related_name='alerts')
    alert_type = models.CharField(max_length=20, choices=ALERT_TYPE_CHOICES)
    message = models.TextField()
    is_resolved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.alert_type}: {self.license.product.name}"
