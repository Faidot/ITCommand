"""Drop the Licenses and Subscriptions modules.

The one-way migration. Everything before this was additive or a rename; this
deletes eleven tables and the role permissions that guarded them.

Ordering is children first. `DeleteModel` will not remove a table another table
still has a foreign key into, so `Subscription` cannot go before its
assignments, renewals and alert log, and `SoftwareProduct` cannot go before
`SoftwareLicense`.

⚠️ **Reversibility, stated honestly.** Reversing this restores the *schema* —
Django regenerates the tables from the operations below — and the RBAC reverse
restores each role's `licenses` and `subscriptions` grants from its `estate`
grants, which is the exact inverse of what 0067 did. It does **not** restore a
single row of data: `DeleteModel` has no way to. Data recovery comes from the
snapshot and the JSON dump taken before this ran, not from `migrate` going
backwards. Anyone reading this as "safe to undo" would be wrong in the way that
matters.

Pre-flight, both stored outside the repo:

    cp db.sqlite3 ~/it-command-backups/db-pre-0069-$(date +%F).sqlite3
    python manage.py dumpdata core.Subscription core.SoftwareLicense … \\
        --indent 2 > ~/it-command-backups/legacy-subscriptions-$(date +%F).json
"""

from django.db import migrations


ACTIONS = ("view", "add", "edit", "delete")

#: Deleted last-to-first: anything holding a foreign key goes before its target.
DOOMED = [
    "SubscriptionAlertLog",
    "SubscriptionAssignment",
    "SubscriptionRenewal",
    "SubscriptionCategoryBudget",
    "SubscriptionSettings",
    "Subscription",
    "LicenseAlert",
    "LicenseAssignment",
    "LicenseRenewal",
    "SoftwareLicense",
    "SoftwareProduct",
]


def drop_retired_modules(apps, schema_editor):
    """Remove the `licenses` and `subscriptions` keys from every role."""
    Role = apps.get_model("core", "Role")
    for role in Role.objects.all():
        perms = role.permissions or {}
        if not isinstance(perms, dict):
            continue
        changed = False
        for key in ("licenses", "subscriptions"):
            if key in perms:
                perms.pop(key)
                changed = True
        if changed:
            role.permissions = perms
            role.save(update_fields=["permissions"])


def restore_retired_modules(apps, schema_editor):
    """Put both keys back, mirroring each role's `estate` grants.

    The exact inverse of migration 0067, which seeded `estate` from
    `subscriptions` in the first place. A role that can edit the estate could
    edit subscriptions; a role with no estate access gets none back.
    """
    Role = apps.get_model("core", "Role")
    for role in Role.objects.all():
        perms = role.permissions or {}
        if not isinstance(perms, dict):
            continue
        source = perms.get("estate") or {}
        if not isinstance(source, dict):
            source = {}
        grants = {action: bool(source.get(action, False)) for action in ACTIONS}
        perms["licenses"] = dict(grants)
        perms["subscriptions"] = dict(grants)
        role.permissions = perms
        role.save(update_fields=["permissions"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0068_estate_finance_links_and_service_payment"),
    ]

    operations = [
        migrations.RunPython(drop_retired_modules, restore_retired_modules),
        *[migrations.DeleteModel(name=name) for name in DOOMED],
    ]
