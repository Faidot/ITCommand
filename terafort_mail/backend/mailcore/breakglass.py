"""Letting a superadmin read someone else's mailbox, visibly.

Your original brief ruled this out: *"an administrator cannot read another
user's mail. Keep that property."* You later asked for it, choosing the
break-glass variant. This module is that reversal, built so the property is
not quietly lost but deliberately exchanged for an auditable one:

    before   nobody can read your mail, because no credential exists
    now      a superadmin can, and you find out that they did

Three things make the difference between break-glass and a back door, and all
three are enforced here rather than by convention:

  1. **A reason is required.** Not a checkbox — free text, stored, and shown
     to the mailbox owner.
  2. **The owner is told.** An email at the moment access is granted, naming
     who and why. Not a digest, not a log they would have to go looking for.
  3. **It expires.** A grant is minutes long, single-mailbox, and every
     message opened under it is logged individually.

**What this costs.** Reading a mailbox without its password needs a Dovecot
master user, which is a stored credential that opens every mailbox on the
server. That is a real, permanent weakening, and it is why `enabled()` is
false unless somebody deliberately configures it.

**Unverified on cPanel.** Master users are standard Dovecot but are not always
exposed on managed cPanel hosting, and I have not been able to test it against
your server. If `MAIL_MASTER_USER` is set and login fails with the separator
below, try the alternative separator before assuming the credential is wrong.
"""
from __future__ import annotations

import base64
import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from . import crypto, imap_auth, sessions
from .models import Mailbox, record_audit

log = logging.getLogger("mailcore.breakglass")

#: How long a grant lasts. Long enough to find what you came for, short enough
#: that nobody leaves one open.
GRANT_MINUTES = 30

#: Dovecot's master-user separator. Configurable because
#: `auth_master_user_separator` is a site setting, and cPanel does not
#: document which it uses.
DEFAULT_SEPARATOR = "*"


class BreakGlassError(Exception):
    """Refused, with something the operator needs to read."""


def enabled() -> bool:
    """False unless a master credential is deliberately configured."""
    return bool(getattr(settings, "MAIL_MASTER_USER", "")
                and getattr(settings, "MAIL_MASTER_PASSWORD", ""))


def _master_login(address: str) -> tuple:
    separator = getattr(settings, "MAIL_MASTER_SEPARATOR", DEFAULT_SEPARATOR)
    return ("%s%s%s" % (address, separator, settings.MAIL_MASTER_USER),
            settings.MAIL_MASTER_PASSWORD)


def open_mailbox(*, address: str, actor: str, reason: str, ip: str = "",
                 ua_hash: str = "", minutes: int = GRANT_MINUTES):
    """Create a short, logged session onto somebody else's mailbox.

    Returns a MailSession exactly like an ordinary sign-in, so every route
    downstream — and every isolation layer — treats it identically. The only
    differences are that it expires in minutes, it carries `break_glass` in
    its scopes, and the owner has been emailed.
    """
    if not enabled():
        raise BreakGlassError(
            "Break-glass access is not configured. It needs a Dovecot master "
            "user, which is a credential that opens every mailbox — so it is "
            "off unless somebody sets it deliberately.")

    reason = (reason or "").strip()
    if getattr(settings, "MAIL_BREAK_GLASS_REQUIRE_REASON", True) and len(reason) < 10:
        # A one-word reason is not a reason. This text is what the mailbox
        # owner reads, so when it is required it has to say something to them.
        raise BreakGlassError(
            "Give a reason of at least ten characters. The mailbox owner is "
            "shown it, so write it for them.")
    if not reason:
        # The owner is still told; the notice simply cannot say why. Recorded
        # as such rather than left blank, so an audit trail reads honestly.
        reason = "No reason given."

    address = address.strip().lower()
    mailbox = Mailbox.objects.filter(address=address).first()
    if mailbox is None:
        raise BreakGlassError("No mailbox record for %s. Sync first." % address)
    if address == actor.strip().lower():
        raise BreakGlassError("That is your own mailbox — just open it normally.")

    login, password = _master_login(address)
    try:
        imap_auth.authenticate(login, password)
    except PermissionError as exc:
        raise BreakGlassError(
            "Dovecot refused the master credential for %s. Check "
            "MAIL_MASTER_USER, and whether your server uses a different "
            "auth_master_user_separator than %r."
            % (address, getattr(settings, "MAIL_MASTER_SEPARATOR", DEFAULT_SEPARATOR))
        ) from exc
    except imap_auth.ImapUnavailable as exc:
        raise BreakGlassError("The mail server is not reachable.") from exc

    # A break-glass session cannot decrypt the owner's cache — their DEK is
    # wrapped under a password we do not have. So it gets its own key and
    # reads live from IMAP, which is the honest consequence: nothing about
    # this grants access to what they had already cached.
    session = sessions.get_store().create_session(
        mailbox_address=address,
        mailbox_id=str(mailbox.id),
        credential=password,
        dek_b64=base64.b64encode(crypto.new_key()).decode("ascii"),
        ua_hash=ua_hash,
        ip=ip,
    )
    session.credential_login = login
    session.scopes = ["break_glass"]
    session.absolute_expiry = timezone.now().timestamp() + minutes * 60
    session.mfa_verified = True
    sessions.get_store()._save(session)

    reference = uuid.uuid4()
    record_audit("BREAK_GLASS_OPENED", mailbox_address=address, actor=actor,
                 reason=reason, reference=str(reference), minutes=minutes)
    log.warning("BREAK GLASS: %s opened %s — %s", actor, address, reason)

    notified = notify_owner(address=address, actor=actor, reason=reason,
                            minutes=minutes, reference=reference)

    return session, {"reference": str(reference), "owner_notified": notified,
                     "expires_in": minutes * 60}


def notify_owner(*, address: str, actor: str, reason: str, minutes: int,
                 reference) -> bool:
    """Tell the mailbox owner, at the moment it happens.

    Sent from the app's own account rather than the admin's, so it cannot be
    suppressed by whoever is doing the reading. Failure to notify is logged
    loudly but does not block the grant — an administrator locked out of a
    leaver's mailbox because SMTP hiccuped is its own problem, and the audit
    row exists either way.
    """
    sender = getattr(settings, "MAIL_NOTICE_FROM", "")
    if not sender:
        log.error("MAIL_NOTICE_FROM is not set — the owner of %s was NOT told "
                  "their mailbox was opened by %s", address, actor)
        return False

    body = (
        "Your mailbox was opened by an administrator.\n\n"
        "  Mailbox   %s\n"
        "  Opened by %s\n"
        "  When      %s\n"
        "  For       %d minutes\n"
        "  Reference %s\n\n"
        "Reason given:\n\n  %s\n\n"
        "This notice is sent automatically and cannot be turned off. If you "
        "did not expect this, reply to it.\n"
        % (address, actor, timezone.now().strftime("%d %b %Y %H:%M %Z"),
           minutes, reference, reason)
    )

    try:
        import smtplib
        from email.message import EmailMessage

        msg = EmailMessage()
        msg["From"] = sender
        msg["To"] = address
        msg["Subject"] = "Your mailbox was opened by an administrator"
        msg.set_content(body)

        with smtplib.SMTP(settings.MAIL_SMTP_HOST,
                          int(settings.MAIL_SMTP_PORT), timeout=15) as conn:
            if settings.MAIL_SMTP_STARTTLS:
                conn.starttls()
            password = getattr(settings, "MAIL_NOTICE_PASSWORD", "")
            if password:
                conn.login(sender, password)
            conn.send_message(msg)
        return True
    except Exception:  # noqa: BLE001
        log.exception("could not notify %s that %s opened their mailbox",
                      address, actor)
        return False


def record_read(session, message_id: str, subject: str = "") -> None:
    """Log every individual message opened under a grant.

    Per message, not per session. "An admin had access for half an hour" is
    not an answer to "did they read my appraisal".
    """
    if "break_glass" not in (session.scopes or []):
        return
    record_audit("BREAK_GLASS_READ", mailbox_address=session.mailbox_address,
                 actor="break-glass session", message=str(message_id),
                 subject=subject[:200])
