"""Shared fixtures for the test suite.

These lived in `core/test_subscriptions.py` and were imported from there by
five unrelated modules — FX, LOV, network discovery, the calendar feed and
Brex. Deleting the subscriptions module in Phase 5 broke all five at import
time, which is the argument for this file existing: a shared helper does not
belong inside a feature's test module, because the feature can be retired and
the helper cannot.
"""

from django.contrib.auth import get_user_model

from core import rbac
from core.models import Role


User = get_user_model()

PASSWORD = "SharedTestPassword!1"

#: Every action on, for the common "this role can do everything here" case.
ALL = {"view": True, "add": True, "edit": True, "delete": True}


def create_role(slug, *, view=False, add=False, edit=False, delete=False, **modules):
    """A role granting `modules`, or the estate by default.

    The bare `view=`/`add=` form grants the `estate` module, which is what the
    old subscriptions-era helper did for `subscriptions` and what almost every
    caller wants. Pass explicit module maps for anything else::

        create_role("ACCOUNTS", finance=ALL, estate={"view": True})
    """
    permissions = rbac.blank_permissions()
    if any((view, add, edit, delete)) or not modules:
        permissions["estate"] = {
            "view": view,
            "add": add,
            "edit": edit,
            "delete": delete,
        }
    for module, grants in modules.items():
        if grants:
            permissions[module] = dict(grants)
    return Role.objects.create(
        slug=slug,
        name=slug.replace("_", " ").title(),
        permissions=permissions,
    )


def create_user(email, role, **extra):
    return User.objects.create_user(
        email=email,
        password=PASSWORD,
        full_name=email.split("@")[0].title(),
        role=role,
        **extra,
    )
