"""Factory reset — put the app back to how it looked before anyone used it.

This deletes every record in every module. It is not undoable and there is no
export step folded into it, so the whole design here is about making the
consequence visible *before* it happens and impossible to reach by accident:

* a preview endpoint returns the exact per-model row counts that are about to
  go, so nobody has to guess what "all data" means for their install;
* the caller must be a superadmin, re-enter their own password, and type a
  fixed phrase — three gates, none of which a mis-click satisfies;
* the whole wipe runs in one transaction, so a failure part-way through leaves
  the database exactly as it was rather than half-emptied.

What survives, and why:

* **Superadmins.** Deleting every user would lock the app permanently — there
  would be nobody left who could sign in to create the first account.
* **Roles**, which are deleted and re-seeded from ``rbac.DEFAULT_ROLES``. They
  are configuration rather than data, and re-seeding restores an edited
  permission map to the shipped defaults, which is what "reset" should mean.
* **One audit record**, written after the wipe. The reset erases the audit
  trail along with everything else; the row written afterwards is the honest
  minimum — who did this, when, from where, and how much it removed.

Everything else, including the vault master password and every stored
credential, integration key and exchange rate, is deleted.
"""
from django.apps import apps
from django.db import transaction

from core import rbac


#: Typed by hand to confirm. Deliberately not "yes" or the company name: it has
#: to be a phrase nobody types for any other reason.
CONFIRM_PHRASE = "DELETE EVERYTHING"

#: The role whose accounts survive the reset.
KEPT_ROLE = "SUPERADMIN"


def _forward_relations(model):
    """The models this one points at through a concrete FK or O2O."""
    targets = []
    for field in model._meta.get_fields():
        if not getattr(field, "concrete", False):
            continue
        if not (field.many_to_one or field.one_to_one):
            continue
        related = field.related_model
        if related is not None and related is not model:
            targets.append(related)
    return targets


def deletion_order(models):
    """Models ordered so each is deleted before anything it points at.

    Not cosmetic: a PROTECTed foreign key refuses to delete its target while a
    referrer still exists, so deleting `Provider` before `Service` fails.

    Cycles — two models pointing at each other — are broken arbitrarily. That
    is safe here because everything is being deleted anyway: whatever a broken
    edge leaves behind is removed by the cascade from the rows that went first,
    or by the model's own turn later in the list.
    """
    known = set(models)
    order = []
    seen = set()

    def visit(model):
        if model in seen:
            return
        seen.add(model)
        for target in _forward_relations(model):
            if target in known:
                visit(target)
        order.append(model)

    for model in models:
        visit(model)
    # Post-order appends a target before its referrer; we want the referrer
    # first, so the finished list is reversed.
    return list(reversed(order))


def _wipeable_models():
    """Every model in `core` except User, which is handled separately."""
    from core.models import User

    return [m for m in apps.get_app_config("core").get_models() if m is not User]


def preview():
    """What a reset would delete right now. Reads only, changes nothing."""
    from core.models import User

    rows = []
    for model in _wipeable_models():
        count = model.objects.count()
        if count:
            rows.append({
                "model": model.__name__,
                "label": model._meta.verbose_name_plural.title(),
                "count": count,
            })
    rows.sort(key=lambda r: (-r["count"], r["label"]))

    kept = User.objects.filter(role=KEPT_ROLE)
    return {
        "records": rows,
        "total_records": sum(r["count"] for r in rows),
        "users_deleted": User.objects.exclude(role=KEPT_ROLE).count(),
        "users_kept": [
            {"id": u.id, "email": u.email, "name": u.get_full_name() or u.email}
            for u in kept.order_by("email")
        ],
        "confirm_phrase": CONFIRM_PHRASE,
    }


def _seed_roles():
    """Recreate the shipped roles, matching migration 0038's source of truth."""
    from core.models import Role

    for slug, name, description, is_system, builder in rbac.DEFAULT_ROLES:
        Role.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "description": description,
                "is_system": is_system,
                "permissions": builder(),
            },
        )


@transaction.atomic
def perform():
    """Delete everything. Returns {model name: rows deleted}.

    Atomic across all 80-odd models: a foreign key this code has not
    anticipated must leave the database untouched, not half-emptied.
    """
    from core.models import User

    deleted = {}

    def record(counts):
        for label, count in counts.items():
            # Django labels these "core.Service"; the module name is noise in a
            # report that is entirely about one app.
            name = label.split(".")[-1]
            deleted[name] = deleted.get(name, 0) + count

    for model in deletion_order(_wipeable_models()):
        _, counts = model.objects.all().delete()
        record(counts)

    # Users last: everything that pointed at them is gone by now, so a PROTECT
    # on `owner` or `created_by` has nothing left to protect.
    _, counts = User.objects.exclude(role=KEPT_ROLE).delete()
    record(counts)

    _seed_roles()
    return {name: count for name, count in sorted(deleted.items()) if count}
