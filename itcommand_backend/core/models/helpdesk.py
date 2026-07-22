from .users import User
from .assets import Asset
from django.db import models
from django.utils import timezone
from datetime import timedelta
import uuid


class TicketCategory(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    icon_name = models.CharField(max_length=50, blank=True, default='CircleDot')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'Ticket Categories'
        ordering = ['name']

    def __str__(self):
        return self.name


class SLAPolicy(models.Model):
    PRIORITY_CHOICES = (
        ('LOW', 'Low'),
        ('MEDIUM', 'Medium'),
        ('HIGH', 'High'),
        ('CRITICAL', 'Critical'),
    )

    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, unique=True)
    response_hours = models.IntegerField(help_text='Hours to first response')
    resolution_hours = models.IntegerField(help_text='Hours to resolve')
    description = models.TextField(blank=True)

    class Meta:
        verbose_name = 'SLA Policy'
        verbose_name_plural = 'SLA Policies'
        ordering = ['resolution_hours']

    def __str__(self):
        return f"{self.priority}: respond {self.response_hours}h, resolve {self.resolution_hours}h"


class Ticket(models.Model):
    PRIORITY_CHOICES = (
        ('LOW', 'Low'),
        ('MEDIUM', 'Medium'),
        ('HIGH', 'High'),
        ('CRITICAL', 'Critical'),
    )
    STATUS_CHOICES = (
        ('OPEN', 'Open'),
        ('IN_PROGRESS', 'In Progress'),
        ('PENDING', 'Pending'),
        ('RESOLVED', 'Resolved'),
        ('CLOSED', 'Closed'),
    )

    ticket_number = models.CharField(max_length=20, unique=True, blank=True)
    title = models.CharField(max_length=255)
    description = models.TextField()
    category = models.ForeignKey(TicketCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name='tickets')
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='MEDIUM')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='OPEN')
    requester = models.ForeignKey(User, on_delete=models.CASCADE, related_name='submitted_tickets')
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_tickets')
    asset = models.ForeignKey(Asset, on_delete=models.SET_NULL, null=True, blank=True, related_name='tickets')
    due_date = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        generate_number = self.pk is None and not self.ticket_number
        if generate_number:
            self.ticket_number = f"TMP-{uuid.uuid4().hex[:16]}"

        # Auto-calculate due_date from SLA policy if not already set
        if not self.due_date:
            try:
                sla = SLAPolicy.objects.get(priority=self.priority)
                self.due_date = timezone.now() + timedelta(hours=sla.resolution_hours)
            except SLAPolicy.DoesNotExist:
                pass

        super().save(*args, **kwargs)
        if generate_number:
            self.ticket_number = f"TKT-{self.pk:04d}"
            Ticket.objects.filter(pk=self.pk).update(ticket_number=self.ticket_number)

    @property
    def is_overdue(self):
        if self.status in ('RESOLVED', 'CLOSED'):
            return False
        if self.due_date and timezone.now() > self.due_date:
            return True
        return False

    @property
    def sla_status(self):
        """Returns ON_TRACK, AT_RISK, or BREACHED."""
        if self.status in ('RESOLVED', 'CLOSED'):
            return 'ON_TRACK'
        if not self.due_date:
            return 'ON_TRACK'

        now = timezone.now()
        if now > self.due_date:
            return 'BREACHED'

        total_duration = self.due_date - self.created_at
        remaining = self.due_date - now
        if total_duration.total_seconds() > 0:
            pct_remaining = remaining.total_seconds() / total_duration.total_seconds()
            if pct_remaining < 0.20:
                return 'AT_RISK'
        return 'ON_TRACK'

    @property
    def time_remaining_seconds(self):
        """Seconds remaining until due_date (can be negative if overdue)."""
        if not self.due_date:
            return None
        return (self.due_date - timezone.now()).total_seconds()

    @property
    def sla_progress_pct(self):
        """Percentage of SLA time elapsed (0-100+)."""
        if not self.due_date:
            return 0
        total = (self.due_date - self.created_at).total_seconds()
        if total <= 0:
            return 100
        elapsed = (timezone.now() - self.created_at).total_seconds()
        return min(round((elapsed / total) * 100, 1), 100)

    def __str__(self):
        return f"[{self.ticket_number}] {self.title}"


class TicketComment(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='ticket_comments')
    body = models.TextField()
    is_internal = models.BooleanField(default=False, help_text='Internal IT note, not visible to requester')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"Comment on {self.ticket.ticket_number} by {self.author.email}"


class TicketAttachment(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='ticket_attachments/%Y/%m/')
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='ticket_uploads')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Attachment for {self.ticket.ticket_number}"
