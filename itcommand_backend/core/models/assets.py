from decimal import Decimal
from datetime import date

from django.db import models, transaction
from django.db.models import Q, Sum
from django.utils import timezone

from .users import User
from .vendors import Vendor


class AssetCategory(models.Model):
    """An asset class (e.g. Laptop, Monitor, Keyboard).

    Each category can define its own spec schema (fields that assets of
    that category should capture — e.g. laptops have cpu/ram/storage)
    and behaviour flags (is_serialized, bulk_allowed) that the asset
    form uses to render itself.
    """
    name = models.CharField(max_length=100, unique=True)
    code = models.SlugField(max_length=40, blank=True, default="")
    icon = models.CharField(
        max_length=40, blank=True, default="",
        help_text="Optional lucide-react icon name (e.g. 'Laptop', 'Keyboard')."
    )
    description = models.TextField(blank=True)

    # Behaviour flags
    is_serialized = models.BooleanField(
        default=True,
        help_text="If True, each physical unit gets its own Asset row with a unique serial."
    )
    bulk_allowed = models.BooleanField(
        default=False,
        help_text="If True, the asset form lets users create N rows in one submit."
    )

    # Field schema: list of {key, label, type, required, options?}
    # Types: 'text' | 'number' | 'select' | 'date' | 'bool'
    spec_schema = models.JSONField(
        default=list, blank=True,
        help_text='List of spec field definitions for assets in this category.'
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        verbose_name_plural = 'Asset categories'

    def __str__(self):
        return self.name


class Asset(models.Model):
    ASSET_TYPE_CHOICES = (
        ('HARDWARE', 'Hardware'),
        ('SOFTWARE', 'Software'),
        ('LICENSE', 'License'),
        ('PERIPHERAL', 'Peripheral'),
        ('OTHER', 'Other'),
    )
    STATUS_CHOICES = (
        ('AVAILABLE', 'Available'),
        ('ASSIGNED', 'Assigned'),
        ('UNDER_REPAIR', 'Under Repair'),
        ('RETIRED', 'Retired'),
        ('LOST', 'Lost'),
    )
    CONDITION_CHOICES = (
        ('NEW', 'New'),
        ('GOOD', 'Good'),
        ('FAIR', 'Fair'),
        ('POOR', 'Poor'),
    )
    DEPRECIATION_METHOD_CHOICES = (
        ('STRAIGHT_LINE', 'Straight-line'),
        ('NONE', 'No depreciation'),
    )

    # Generated from primary key on first save (see save()). Editable so users
    # can override if they have an existing tagging scheme.
    asset_tag = models.CharField(max_length=50, unique=True, blank=True)
    name = models.CharField(max_length=255)
    category = models.ForeignKey(
        AssetCategory, on_delete=models.SET_NULL, null=True, blank=True
    )
    asset_type = models.CharField(
        max_length=20, choices=ASSET_TYPE_CHOICES, default='HARDWARE', db_index=True
    )

    brand = models.CharField(max_length=100, blank=True, null=True)
    model = models.CharField(max_length=100, blank=True, null=True)
    # Unique when set. We normalise '' -> None in clean()/save() so multiple
    # rows without a serial don't collide.
    serial_number = models.CharField(
        max_length=255, null=True, blank=True, unique=True
    )

    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default='AVAILABLE', db_index=True
    )
    condition = models.CharField(
        max_length=20, choices=CONDITION_CHOICES, default='GOOD'
    )

    purchase_date = models.DateField(null=True, blank=True)
    # Per-unit purchase price (optional). When set and purchase_price isn't,
    # save() fills purchase_price = unit_price * quantity_total. Useful for
    # bulk rows where the user knows "$15/unit × 50 keyboards".
    unit_price = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    # Total purchase price (legacy single-field). For bulk rows this is the
    # batch total. 14 digits + 2dp = up to 999,999,999,999.99.
    purchase_price = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    vendor = models.ForeignKey(
        Vendor, on_delete=models.SET_NULL, null=True, blank=True, related_name='assets'
    )
    warranty_expiry = models.DateField(null=True, blank=True)

    # --- Depreciation ---
    depreciation_method = models.CharField(
        max_length=20,
        choices=DEPRECIATION_METHOD_CHOICES,
        default='STRAIGHT_LINE',
    )
    useful_life_months = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Useful life in months for depreciation. Typical: hardware 36, peripherals 24, server 60."
    )
    salvage_value = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0.00'),
        help_text="Residual book value at end of useful life."
    )

    # Quantity model: bulk assets (e.g. 5 identical keyboards) live as a
    # single row with quantity_total > 1. Each unit is assigned via an
    # AssetUnitAssignment row; quantity_available is computed from those.
    # For non-bulk assets, quantity_total stays 1 and the legacy
    # assigned_to FK below still represents the single owner.
    quantity_total = models.PositiveIntegerField(default=1)

    assigned_to = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assigned_assets', db_index=True
    )
    assigned_date = models.DateTimeField(null=True, blank=True)

    # Structured location (master settings). Free-text `location` kept for
    # backward compat; new entries should use `location_ref`.
    location_ref = models.ForeignKey(
        'core.Location', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assets'
    )
    location = models.CharField(max_length=255, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)

    # Category-specific specs (validated against the category's spec_schema).
    specs = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_assets'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'asset_type']),
            models.Index(fields=['warranty_expiry']),
        ]

    # ---------- save / clean ----------

    def save(self, *args, **kwargs):
        # Normalise empty serial to NULL so the unique index doesn't collide on ''.
        if self.serial_number == '':
            self.serial_number = None

        # Derive purchase_price from unit_price × quantity_total whenever
        # unit_price is set. unit_price is the source of truth for bulk rows;
        # purchase_price always equals the batch total so depreciation / TCO
        # math stays correct.
        if self.unit_price is not None:
            qty = self.quantity_total or 1
            self.purchase_price = (Decimal(self.unit_price) * Decimal(qty)).quantize(Decimal('0.01'))

        # Race-safe asset_tag: derive from the primary key (which the DB allocates
        # atomically). On first insert we save once to get an id, then patch the
        # tag. Updates pass through normally.
        if not self.asset_tag and self.pk is None:
            with transaction.atomic():
                super().save(*args, **kwargs)
                # Only assign id-derived tag if user didn't set one mid-save.
                if not self.asset_tag:
                    self.asset_tag = f"IT-{self.pk:04d}"
                    # Re-save just the tag.
                    Asset.objects.filter(pk=self.pk).update(asset_tag=self.asset_tag)
            return
        super().save(*args, **kwargs)

    def __str__(self):
        return f"[{self.asset_tag}] {self.name}"

    # ---------- depreciation / book value ----------

    @property
    def monthly_depreciation(self):
        """Linear monthly depreciation, or None when inputs are missing."""
        if self.depreciation_method != 'STRAIGHT_LINE':
            return None
        if not self.purchase_price or not self.useful_life_months:
            return None
        depreciable = Decimal(self.purchase_price) - Decimal(self.salvage_value or 0)
        if depreciable <= 0 or self.useful_life_months <= 0:
            return Decimal('0.00')
        return (depreciable / Decimal(self.useful_life_months)).quantize(Decimal('0.01'))

    @property
    def months_in_service(self):
        if not self.purchase_date:
            return None
        today = timezone.now().date()
        if self.purchase_date > today:
            return 0
        months = (today.year - self.purchase_date.year) * 12 + (today.month - self.purchase_date.month)
        if today.day < self.purchase_date.day:
            months -= 1
        return max(0, months)

    @property
    def accumulated_depreciation(self):
        md = self.monthly_depreciation
        if md is None or self.months_in_service is None:
            return None
        # Don't depreciate past (purchase_price - salvage).
        depreciable = Decimal(self.purchase_price) - Decimal(self.salvage_value or 0)
        accum = md * min(self.months_in_service, self.useful_life_months)
        if accum > depreciable:
            accum = depreciable
        return accum.quantize(Decimal('0.01'))

    @property
    def current_book_value(self):
        """Purchase price minus accumulated depreciation, floored at salvage."""
        if not self.purchase_price:
            return None
        accum = self.accumulated_depreciation
        if accum is None:
            return Decimal(self.purchase_price).quantize(Decimal('0.01'))
        book = Decimal(self.purchase_price) - accum
        salvage = Decimal(self.salvage_value or 0)
        if book < salvage:
            book = salvage
        return book.quantize(Decimal('0.01'))

    @property
    def is_fully_depreciated(self):
        if self.months_in_service is None or not self.useful_life_months:
            return False
        return self.months_in_service >= self.useful_life_months

    # ---------- warranty ----------

    @property
    def days_until_warranty_expiry(self):
        if not self.warranty_expiry:
            return None
        return (self.warranty_expiry - timezone.now().date()).days

    @property
    def warranty_status(self):
        """ACTIVE / EXPIRING_SOON (<=30 days) / EXPIRED / NO_WARRANTY."""
        days = self.days_until_warranty_expiry
        if days is None:
            return 'NO_WARRANTY'
        if days < 0:
            return 'EXPIRED'
        if days <= 30:
            return 'EXPIRING_SOON'
        return 'ACTIVE'

    # ---------- quantity (bulk assets) ----------

    @property
    def quantity_assigned(self):
        """Number of active per-unit assignments."""
        return self.unit_assignments.filter(is_active=True).count()

    @property
    def quantity_available(self):
        """Units in stock that aren't currently assigned."""
        return max(0, (self.quantity_total or 1) - self.quantity_assigned)

    @property
    def is_bulk(self):
        return (self.quantity_total or 1) > 1

    # ---------- total cost of ownership ----------

    @property
    def total_maintenance_cost(self):
        agg = self.maintenance_records.aggregate(total=Sum('cost'))['total']
        return Decimal(agg or 0).quantize(Decimal('0.01'))

    @property
    def total_cost_of_ownership(self):
        """Purchase price + lifetime maintenance/repair cost."""
        base = Decimal(self.purchase_price or 0)
        return (base + self.total_maintenance_cost).quantize(Decimal('0.01'))


class AssetMaintenance(models.Model):
    """A single maintenance / repair / service event against an asset.

    Used to track repair history and compute total cost of ownership.
    """
    EVENT_TYPE_CHOICES = (
        ('REPAIR', 'Repair'),
        ('UPGRADE', 'Upgrade'),
        ('SERVICE', 'Routine Service'),
        ('REPLACEMENT', 'Part Replacement'),
        ('OTHER', 'Other'),
    )

    asset = models.ForeignKey(
        Asset, on_delete=models.CASCADE, related_name='maintenance_records'
    )
    event_type = models.CharField(
        max_length=20, choices=EVENT_TYPE_CHOICES, default='REPAIR'
    )
    description = models.TextField()
    cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal('0.00')
    )
    vendor = models.ForeignKey(
        Vendor, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='maintenance_events'
    )
    performed_on = models.DateField(default=timezone.localdate)
    downtime_days = models.PositiveIntegerField(default=0)
    # Number of units this repair covered. Always 1 for non-bulk assets;
    # for a bulk row (quantity_total > 1) the form lets admin record e.g.
    # "5 of the 20 keyboards needed new switches".
    affected_quantity = models.PositiveIntegerField(default=1)

    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_maintenance_records'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-performed_on', '-id']

    def __str__(self):
        return f"{self.get_event_type_display()} on {self.asset.asset_tag} ({self.performed_on})"


class AssetUnitAssignment(models.Model):
    """One physical unit of a bulk asset assigned to a user.

    For bulk assets (quantity_total > 1) we don't denormalise the owner
    on Asset.assigned_to; each active assignment is a row here.
    """
    asset = models.ForeignKey(
        Asset, on_delete=models.CASCADE, related_name='unit_assignments'
    )
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True,
        related_name='asset_unit_assignments'
    )
    assigned_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='asset_units_assigned'
    )
    assigned_date = models.DateTimeField(auto_now_add=True)
    returned_date = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ['-is_active', '-assigned_date']

    def __str__(self):
        return f"{self.user} ← {self.asset.asset_tag} (1 unit)"


class AssetNote(models.Model):
    asset = models.ForeignKey(
        Asset, on_delete=models.CASCADE, related_name='asset_notes'
    )
    note = models.TextField()
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_asset_notes'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Note on {self.asset.asset_tag}"


class AssetHistory(models.Model):
    asset = models.ForeignKey(
        Asset, on_delete=models.CASCADE, related_name='history'
    )
    action = models.CharField(max_length=50)
    from_user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='asset_history_from'
    )
    to_user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='asset_history_to'
    )
    note = models.TextField(blank=True, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"{self.asset.asset_tag} - {self.action} at {self.timestamp}"
