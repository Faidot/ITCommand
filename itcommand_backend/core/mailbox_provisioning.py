"""Creating a person and their mailbox as one act.

The design decision this file exists to express: **one generated password
becomes both the IT Command account and the cPanel mailbox**, and IT Command
never stores it. That is the "one credential" model arriving at the moment of
creation rather than being retrofitted.

Concretely, when a mailbox is provisioned for a user:

  * a password is generated, handed to cPanel, and returned to the caller once
  * the user's `auth_source` becomes MAILBOX, so Dovecot is their authority
  * `set_unusable_password()` is called, so no Django hash exists to fall back
    to -- there is no second way into that account

Nothing here writes the password to the database, a log, or an audit row.
"""
from __future__ import annotations

import logging
import secrets
import string

from django.db import transaction

from core import cpanel
from core.models.users import User

log = logging.getLogger("core.mailbox_provisioning")

#: Long enough that it is not worth attacking, short enough to read aloud once
#: over a desk. The character set omits the glyphs people mistype from a
#: screen -- no l, I, 1, O, 0 -- because this password gets typed by hand.
PASSWORD_LENGTH = 20
_ALPHABET = (
    "".join(c for c in string.ascii_letters + string.digits if c not in "lI1O0")
    + "!@#$%^&*-_=+"
)


def cpanel_is_configured() -> bool:
    """Whether there is an enabled cPanel integration with a usable token.

    Lets callers tell "not set up" from "set up and broken". The first is the
    ordinary state of a deployment that has not turned this on yet and should
    be silent; the second is something an operator needs to see.
    """
    try:
        cpanel.CpanelClient.from_integration()
        return True
    except cpanel.CpanelNotConfigured:
        return False


class ProvisioningError(Exception):
    """Something went wrong that the operator needs to read."""


def generate_password(length: int = PASSWORD_LENGTH) -> str:
    """A password we hand over once and then forget.

    Loops until the result has all four character classes rather than forcing
    them at fixed positions -- a fixed layout is a pattern an attacker can use
    to shrink the search space.
    """
    while True:
        candidate = "".join(secrets.choice(_ALPHABET) for _ in range(length))
        if (any(c.islower() for c in candidate)
                and any(c.isupper() for c in candidate)
                and any(c.isdigit() for c in candidate)
                and any(not c.isalnum() for c in candidate)):
            return candidate


def provision_mailbox(user: User, *, password: str | None = None,
                      quota_mb: int | None = None,
                      client: cpanel.CpanelClient | None = None) -> dict:
    """Create the cPanel mailbox for `user` and switch them to mailbox auth.

    Returns ``{"password": str | None, "created": bool, "linked": bool}``.
    `password` is present only when we created the mailbox -- when the address
    already existed we did not set one, and saying otherwise would be a lie the
    operator would try to hand to someone.

    Raises `ProvisioningError` with something an operator can act on.
    """
    # Building the client can fail on its own -- no integration row, no token,
    # an unreadable one after a key rotation. That has to become a
    # ProvisioningError like every other failure here, or it escapes as a 500
    # and the caller cannot tell "cPanel is not set up" from "cPanel is broken".
    try:
        client = client or cpanel.CpanelClient.from_integration()
    except cpanel.CpanelNotConfigured as exc:
        raise ProvisioningError(str(exc)) from exc

    address = user.email.strip().lower()
    password = password or generate_password()

    try:
        client.create_mailbox(address, password, quota_mb=quota_mb)
        created, linked = True, False
    except cpanel.MailboxExists:
        # Normal, not exceptional: the mailbox was made in cPanel before the
        # user was made here. Adopt it. We must NOT return a password -- we did
        # not set one, and the real one is unchanged.
        log.info("mailbox %s already existed; linking rather than creating", address)
        created, linked = False, True
        password = None
    except cpanel.CpanelUnavailable as exc:
        raise ProvisioningError(
            "cPanel could not be reached, so no mailbox was created. The user "
            "account was not changed. %s" % exc) from exc
    except cpanel.CpanelRejected as exc:
        raise ProvisioningError("cPanel refused to create %s: %s" % (address, exc)) from exc

    # Only now do we change the user. If cPanel had failed we would have left
    # a user who believes Dovecot knows them, and no way for them to sign in.
    with transaction.atomic():
        user.auth_source = User.AUTH_MAILBOX
        # No local hash for a mailbox-backed account. This is the line that
        # makes "one credential" true rather than aspirational.
        user.set_unusable_password()
        user.save(update_fields=["auth_source", "password"])

    return {"password": password, "created": created, "linked": linked}


def suspend_mailbox_for(user: User, *, client: cpanel.CpanelClient | None = None) -> bool:
    """Block mailbox login when a user is deactivated. Keeps every message.

    Returns True if cPanel accepted it. Never raises into the deactivation
    path: failing to suspend a mailbox must not stop you from removing
    someone's platform access, but it must be visible.
    """
    if not user.uses_mailbox_auth:
        return False
    try:
        (client or cpanel.CpanelClient.from_integration()).suspend_mailbox(
            user.email.strip().lower())
        return True
    except cpanel.CpanelError as exc:
        log.error("could not suspend mailbox for %s: %s", user.email, exc)
        return False


def unsuspend_mailbox_for(user: User, *, client: cpanel.CpanelClient | None = None) -> bool:
    if not user.uses_mailbox_auth:
        return False
    try:
        (client or cpanel.CpanelClient.from_integration()).unsuspend_mailbox(
            user.email.strip().lower())
        return True
    except cpanel.CpanelError as exc:
        log.error("could not unsuspend mailbox for %s: %s", user.email, exc)
        return False


def link_existing_mailboxes(*, dry_run: bool = True,
                            client: cpanel.CpanelClient | None = None) -> dict:
    """Match users to mailboxes cPanel already has. Creates nothing.

    The backfill for accounts that predate this feature. It only ever moves a
    user from LOCAL to MAILBOX when an address genuinely exists on the server,
    and it never touches a user who has no matching mailbox.
    """
    client = client or cpanel.CpanelClient.from_integration()
    existing = client.mailbox_addresses()

    matched, unmatched = [], []
    for user in User.objects.filter(auth_source=User.AUTH_LOCAL, is_active=True):
        if user.email.strip().lower() in existing:
            matched.append(user)
        else:
            unmatched.append(user.email)

    if not dry_run and matched:
        with transaction.atomic():
            for user in matched:
                user.auth_source = User.AUTH_MAILBOX
                user.set_unusable_password()
                user.save(update_fields=["auth_source", "password"])

    return {
        "mailboxes_on_server": len(existing),
        "linked": [u.email for u in matched],
        "no_mailbox": unmatched,
        "dry_run": dry_run,
    }
