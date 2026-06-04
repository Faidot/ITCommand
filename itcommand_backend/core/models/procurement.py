from django.db import models
from django.conf import settings
from django.utils import timezone
from .users import Department
from .vendors import Vendor
from .finance import BudgetCategory
import datetime


class PRPriority(models.TextChoices):
    LOW = 'LOW', 'Low'
    NORMAL = 'NORMAL', 'Normal'
    URGENT = 'URGENT', 'Urgent'
    CRITICAL = 'CRITICAL', 'Critical'


class PRStatus(models.TextChoices):
    DRAFT = 'DRAFT', 'Draft'
    SUBMITTED = 'SUBMITTED', 'Submitted'
    UNDER_REVIEW = 'UNDER_REVIEW', 'Under Review'
    APPROVED = 'APPROVED', 'Approved'
    REJECTED = 'REJECTED', 'Rejected'
    ORDERED = 'ORDERED', 'Ordered'
    PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED', 'Partially Received'
    RECEIVED = 'RECEIVED', 'Received'
    CANCELLED = 'CANCELLED', 'Cancelled'


class PRItemCategory(models.TextChoices):
    HARDWARE = 'HARDWARE', 'Hardware'
    SOFTWARE = 'SOFTWARE', 'Software'
    PERIPHERAL = 'PERIPHERAL', 'Peripheral'
    SERVICE = 'SERVICE', 'Service'
    CONSUMABLE = 'CONSUMABLE', 'Consumable'
    OTHER = 'OTHER', 'Other'


class PRItemStatus(models.TextChoices):
    PENDING = 'PENDING', 'Pending'
    ORDERED = 'ORDERED', 'Ordered'
    PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED', 'Partially Received'
    RECEIVED = 'RECEIVED', 'Received'


class PRApprovalAction(models.TextChoices):
    SUBMITTED = 'SUBMITTED', 'Submitted'
    APPROVED = 'APPROVED', 'Approved'
    REJECTED = 'REJECTED', 'Rejected'
    REVISION_REQUESTED = 'REVISION_REQUESTED', 'Revision Requested'
    ORDERED = 'ORDERED', 'Ordered'
    RECEIVED = 'RECEIVED', 'Received'
    CANCELLED = 'CANCELLED', 'Cancelled'


class PRDocumentType(models.TextChoices):
    QUOTATION = 'QUOTATION', 'Quotation'
    INVOICE = 'INVOICE', 'Invoice'
    DELIVERY_NOTE = 'DELIVERY_NOTE', 'Delivery Note'
    PO = 'PO', 'Purchase Order'
    OTHER = 'OTHER', 'Other'


class PurchaseRequest(models.Model):
    pr_number = models.CharField(max_length=50, unique=True, blank=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='purchase_requests'
    )
    department = models.ForeignKey(
        Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='purchase_requests'
    )

    priority = models.CharField(max_length=20, choices=PRPriority.choices, default=PRPriority.NORMAL)
    status = models.CharField(max_length=30, choices=PRStatus.choices, default=PRStatus.DRAFT)

    justification = models.TextField(blank=True, null=True)
    preferred_vendor = models.ForeignKey(
        Vendor, on_delete=models.SET_NULL, null=True, blank=True, related_name='purchase_requests'
    )
    required_by_date = models.DateField(null=True, blank=True)
    budget_category = models.ForeignKey(
        BudgetCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name='purchase_requests'
    )

    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='approved_prs'
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, null=True)

    total_estimated_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_actual_cost = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.pr_number:
            year = timezone.now().year
            last_pr = PurchaseRequest.objects.filter(
                pr_number__startswith=f'PR-{year}-'
            ).order_by('-id').first()
            if last_pr:
                try:
                    last_num = int(last_pr.pr_number.split('-')[2])
                    self.pr_number = f"PR-{year}-{last_num + 1:03d}"
                except (ValueError, IndexError):
                    self.pr_number = f"PR-{year}-{PurchaseRequest.objects.count() + 1:03d}"
            else:
                self.pr_number = f"PR-{year}-001"
        super().save(*args, **kwargs)

    def recalculate_total(self):
        """Recalculate estimated and actual costs from items."""
        from django.db.models import Sum, F
        items = self.items.all()
        est = items.aggregate(
            total=Sum(F('quantity') * F('estimated_unit_price'))
        )['total'] or 0
        self.total_estimated_cost = est

        actual = items.exclude(actual_unit_price__isnull=True).aggregate(
            total=Sum(F('quantity') * F('actual_unit_price'))
        )['total']
        self.total_actual_cost = actual
        self.save(update_fields=['total_estimated_cost', 'total_actual_cost'])

    def __str__(self):
        return f"{self.pr_number} - {self.title}"

    class Meta:
        ordering = ['-created_at']


class PurchaseRequestItem(models.Model):
    pr = models.ForeignKey(PurchaseRequest, on_delete=models.CASCADE, related_name='items')
    item_name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    quantity = models.PositiveIntegerField(default=1)
    unit = models.CharField(max_length=50, default='pcs')
    estimated_unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    actual_unit_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    category = models.CharField(max_length=20, choices=PRItemCategory.choices, default=PRItemCategory.OTHER)
    received_quantity = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=30, choices=PRItemStatus.choices, default=PRItemStatus.PENDING)

    @property
    def estimated_total(self):
        return self.quantity * self.estimated_unit_price

    @property
    def actual_total(self):
        if self.actual_unit_price:
            return self.quantity * self.actual_unit_price
        return None

    def __str__(self):
        return f"{self.item_name} x{self.quantity} ({self.pr.pr_number})"

    class Meta:
        ordering = ['id']


class PRApprovalLog(models.Model):
    pr = models.ForeignKey(PurchaseRequest, on_delete=models.CASCADE, related_name='approval_logs')
    action = models.CharField(max_length=30, choices=PRApprovalAction.choices)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    comment = models.TextField(blank=True, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.pr.pr_number} - {self.action} by {self.actor}"

    class Meta:
        ordering = ['-timestamp']


class PRDocument(models.Model):
    pr = models.ForeignKey(PurchaseRequest, on_delete=models.CASCADE, related_name='documents')
    document = models.FileField(upload_to='procurement/')
    document_type = models.CharField(max_length=30, choices=PRDocumentType.choices, default=PRDocumentType.OTHER)
    title = models.CharField(max_length=255, blank=True, null=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.document_type} for {self.pr.pr_number}"

    class Meta:
        ordering = ['-uploaded_at']
