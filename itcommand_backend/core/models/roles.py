from django.db import models

from core import rbac


class Role(models.Model):
    """A named role with a per-module permission map.

    The ``slug`` is the stable identifier stored on ``User.role`` (e.g.
    ``ADMIN``, ``HR``). System roles (``is_system=True``) cannot be deleted
    and their slug cannot change, but their permissions can still be tuned —
    except SUPERADMIN, which is always treated as all-access.
    """

    name = models.CharField(max_length=60, unique=True)
    slug = models.SlugField(max_length=40, unique=True)
    description = models.TextField(blank=True, default="")
    is_system = models.BooleanField(default=False)
    permissions = models.JSONField(default=rbac.blank_permissions)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_system", "name"]

    def __str__(self):
        return self.name

    @property
    def is_superadmin(self):
        return self.slug == "SUPERADMIN"

    def effective_permissions(self):
        """SUPERADMIN always resolves to full access regardless of what is
        stored; everyone else uses their normalized stored map."""
        if self.is_superadmin:
            return rbac.full_permissions()
        return rbac.normalize_permissions(self.permissions)

    def can(self, module, action):
        return bool(self.effective_permissions().get(module, {}).get(action, False))
