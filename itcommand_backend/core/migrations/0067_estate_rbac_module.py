"""Grant every role the `estate` module by copying its `subscriptions` grants.

The estate views move from `rbac_module = "subscriptions"` to `"estate"` in this
phase. Without this migration that switch would silently change who can reach
them: `normalize_permissions` fills unknown modules with False, so every
non-superadmin would get a 403 on a page they could open yesterday.

Mirroring rather than granting a fresh default is deliberate. It is the only
option that cannot change anyone's access — a role that could edit
subscriptions can edit the estate, a role that could only view can only view,
and a role with no access gets none. Any hand-authored default would be a
guess about intent, applied to whatever roles an admin has since customised.

Reversible: the reverse drops the `estate` key, returning each map to its
previous shape.
"""

from django.db import migrations


ACTIONS = ("view", "add", "edit", "delete")


def grant_estate(apps, schema_editor):
    Role = apps.get_model("core", "Role")
    for role in Role.objects.all():
        perms = role.permissions or {}
        if not isinstance(perms, dict):
            continue
        source = perms.get("subscriptions") or {}
        if not isinstance(source, dict):
            source = {}
        perms["estate"] = {action: bool(source.get(action, False)) for action in ACTIONS}
        role.permissions = perms
        role.save(update_fields=["permissions"])


def revoke_estate(apps, schema_editor):
    Role = apps.get_model("core", "Role")
    for role in Role.objects.all():
        perms = role.permissions or {}
        if isinstance(perms, dict) and "estate" in perms:
            perms.pop("estate")
            role.permissions = perms
            role.save(update_fields=["permissions"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0066_estate_service"),
    ]

    operations = [
        migrations.RunPython(grant_estate, revoke_estate),
    ]
