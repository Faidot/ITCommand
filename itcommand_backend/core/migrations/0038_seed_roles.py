from django.db import migrations

from core import rbac


def seed_roles(apps, schema_editor):
    Role = apps.get_model("core", "Role")
    for slug, name, desc, is_system, builder in rbac.DEFAULT_ROLES:
        # Set default permissions only on first creation so a re-run never
        # clobbers an admin's later customisations.
        _, created = Role.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "description": desc,
                "is_system": is_system,
            },
        )
        if created:
            role = Role.objects.get(slug=slug)
            role.permissions = builder()
            role.save(update_fields=["permissions"])


def unseed_roles(apps, schema_editor):
    Role = apps.get_model("core", "Role")
    slugs = [r[0] for r in rbac.DEFAULT_ROLES]
    Role.objects.filter(slug__in=slugs).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0037_role"),
    ]

    operations = [
        migrations.RunPython(seed_roles, unseed_roles),
    ]
