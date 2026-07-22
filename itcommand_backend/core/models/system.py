from django.db import models

from .users import User


class AppSettings(models.Model):
    key = models.CharField(max_length=100, unique=True)
    value = models.TextField(blank=True, null=True)
    description = models.TextField(blank=True, null=True)

    def __str__(self):
        return self.key


class ListOfValues(models.Model):
    """An admin-managed dropdown value ("list of values").

    Two kinds of group exist, and the difference matters:

    * **Open groups** (e.g. currencies) are pure value lists. Add, rename,
      reorder or retire entries freely — nothing in the code branches on the
      individual codes.
    * **System groups** (e.g. statuses) have codes the application logic
      depends on: ``status='APPROVED'`` appears in dozens of places. You may
      relabel, reorder and hide those entries, but you cannot invent new codes
      or edit existing ones, because no code path would understand them.

    ``core.lov`` owns the group registry and enforces the rule in ``clean()``.
    """

    group = models.CharField(max_length=64, db_index=True)
    code = models.CharField(max_length=64)
    label = models.CharField(max_length=160)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(
        default=True, help_text="Unticked values stay in existing records but disappear from dropdowns."
    )
    is_system = models.BooleanField(
        default=False,
        editable=False,
        help_text="Application logic depends on this code; it cannot be renamed or removed.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "list of values entry"
        verbose_name_plural = "lists of values"
        ordering = ["group", "sort_order", "label"]
        constraints = [
            models.UniqueConstraint(fields=["group", "code"], name="unique_lov_group_code"),
        ]

    def __str__(self):
        return f"{self.group}: {self.label}"

    def clean(self):
        from django.core.exceptions import ValidationError

        from core.lov import GROUPS

        errors = {}
        group = (self.group or "").strip()
        if group not in GROUPS:
            errors["group"] = (
                f"Unknown group. Choose one of: {', '.join(sorted(GROUPS))}."
            )
        else:
            spec = GROUPS[group]
            code = (self.code or "").strip()
            if spec.normalize_code:
                code = code.upper()
            if self._state.adding and not spec.extendable:
                errors["code"] = (
                    f"'{spec.label}' is a system list — its values are wired into "
                    f"application logic, so new entries cannot be added here. You "
                    f"can still rename, reorder or hide the existing ones."
                )
            if not self._state.adding and self.is_system:
                original = type(self).objects.filter(pk=self.pk).values("code").first()
                if original and original["code"] != code:
                    errors["code"] = (
                        "This code is referenced by application logic and cannot be "
                        "changed. Edit the label instead."
                    )
            if spec.validate:
                message = spec.validate(code)
                if message:
                    errors["code"] = message
            self.code = code
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.group = (self.group or "").strip()
        self.code = (self.code or "").strip()
        from core.lov import GROUPS

        spec = GROUPS.get(self.group)
        if spec and spec.normalize_code:
            self.code = self.code.upper()
        if not self.label:
            self.label = self.code
        return super().save(*args, **kwargs)


class Location(models.Model):
    """A physical or logical location where an asset can sit.

    Examples: "HQ Floor 3 Storage", "Server Room A", "Mumbai Branch",
    "IT Repair Shelf". Free-form enough to cover most needs; richer
    structure (Office → Floor → Seat) lives in the seating module.
    """
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=40, blank=True, default="")
    address = models.TextField(blank=True, default="")
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

class AuditLog(models.Model):
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    action = models.CharField(max_length=50) # CREATE, UPDATE, DELETE
    model_name = models.CharField(max_length=100)
    object_id = models.CharField(max_length=100)
    changes = models.JSONField(blank=True, null=True)
    ip_address = models.GenericIPAddressField(blank=True, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.action} on {self.model_name} by {self.user}"

class Notification(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    message = models.TextField()
    notification_type = models.CharField(max_length=50) # SYSTEM, WARRANTY, BILL, BUDGET
    is_read = models.BooleanField(default=False)
    link = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.notification_type} for {self.user}"
