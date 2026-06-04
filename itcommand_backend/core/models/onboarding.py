from django.db import models
from .users import User, Department

class ChecklistTemplate(models.Model):
    PROCESS_TYPES = [
        ('ONBOARDING', 'Onboarding'),
        ('OFFBOARDING', 'Offboarding'),
    ]

    name = models.CharField(max_length=255)
    process_type = models.CharField(max_length=20, choices=PROCESS_TYPES)
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_templates')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.get_process_type_display()})"

class ChecklistTemplateItem(models.Model):
    CATEGORIES = [
        ('ACCOUNTS', 'Accounts'),
        ('HARDWARE', 'Hardware'),
        ('SOFTWARE', 'Software'),
        ('ACCESS', 'Access'),
        ('SECURITY', 'Security'),
        ('ADMIN', 'Admin'),
        ('COMMUNICATION', 'Communication'),
        ('OTHER', 'Other'),
    ]
    ROLES = [
        ('IT', 'IT'),
        ('HR', 'HR'),
        ('MANAGER', 'Manager'),
        ('ADMIN', 'Admin'),
    ]

    template = models.ForeignKey(ChecklistTemplate, on_delete=models.CASCADE, related_name='items')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=CATEGORIES)
    assigned_role = models.CharField(max_length=20, choices=ROLES)
    order = models.IntegerField(default=0)
    estimated_hours = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ['order']

    def __str__(self):
        return self.title

class OnboardingRecord(models.Model):
    STATUS_CHOICES = [
        ('NOT_STARTED', 'Not Started'),
        ('IN_PROGRESS', 'In Progress'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]

    employee = models.ForeignKey(User, on_delete=models.CASCADE, related_name='onboarding_records')
    process_type = models.CharField(max_length=20, choices=ChecklistTemplate.PROCESS_TYPES)
    template = models.ForeignKey(ChecklistTemplate, on_delete=models.SET_NULL, null=True)
    start_date = models.DateField(null=True, blank=True)
    target_completion_date = models.DateField(null=True, blank=True)
    actual_completion_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='NOT_STARTED')
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='started_onboardings')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.employee.full_name} - {self.get_process_type_display()}"
    
    @property
    def progress_stats(self):
        total = self.tasks.count()
        completed = self.tasks.filter(status__in=['DONE', 'SKIPPED']).count()
        return {
            'total': total,
            'completed': completed,
            'percentage': round((completed / total * 100) if total > 0 else 0, 1)
        }

class OnboardingTask(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('IN_PROGRESS', 'In Progress'),
        ('DONE', 'Done'),
        ('SKIPPED', 'Skipped'),
    ]

    record = models.ForeignKey(OnboardingRecord, on_delete=models.CASCADE, related_name='tasks')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=ChecklistTemplateItem.CATEGORIES)
    assigned_role = models.CharField(max_length=20, choices=ChecklistTemplateItem.ROLES)
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_onboarding_tasks')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    due_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='completed_onboarding_tasks')
    notes = models.TextField(blank=True)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return self.title
