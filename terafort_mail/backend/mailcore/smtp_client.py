"""Submitting mail to Exim, on behalf of a live session.

Same rule as IMAP: the credential comes from the session. `for_session` is the
only entry point, so there is no call site that could send as somebody else.

Two things Exim will not do for us, and which this module therefore must:

* **File a copy in Sent.** SMTP submission delivers to the recipient and
  forgets. Every self-hosted webmail that skips the IMAP APPEND afterwards has
  the same bug report: "my sent mail has vanished". See `outbox.file_in_sent`.
* **Stop us forging the sender.** Exim will happily accept a From header that
  is not the authenticated user on many configurations. We refuse it here.
"""
from __future__ import annotations

import logging
import smtplib
import socket
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from django.conf import settings

log = logging.getLogger("mailcore.smtp")


class SmtpUnavailable(Exception):
    """Could not reach the submission server, or it dropped the connection."""


class SmtpRejected(Exception):
    """The server understood and refused: bad recipient, size, policy."""


def build_message(*, sender: str, sender_name: str, to: list, subject: str,
                  text: str, html: str = "", cc: list = None, bcc: list = None,
                  in_reply_to: str = "", references: list = None) -> EmailMessage:
    """Assemble the MIME message.

    Always multipart/alternative when HTML is present: a text/html-only
    message is what spam filters expect from spam, and it is unreadable in
    anything that will not render HTML.
    """
    msg = EmailMessage()
    msg["From"] = "%s <%s>" % (sender_name, sender) if sender_name else sender
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject or "(no subject)"
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=sender.split("@")[-1])

    # Threading headers. Without these a reply starts a new conversation in
    # the recipient's client, which is the most visible way a mail client can
    # look amateurish.
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        chain = list(references or [])
        if in_reply_to not in chain:
            chain.append(in_reply_to)
        msg["References"] = " ".join(chain)

    msg.set_content(text or "")
    if html:
        msg.add_alternative(html, subtype="html")
    return msg


def _connect():
    host = settings.MAIL_SMTP_HOST
    port = int(settings.MAIL_SMTP_PORT)
    timeout = int(getattr(settings, "MAIL_IMAP_TIMEOUT", 15))
    ctx = ssl.create_default_context()
    if not getattr(settings, "MAIL_IMAP_VERIFY_CERT", True):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    try:
        if settings.MAIL_SMTP_STARTTLS:
            conn = smtplib.SMTP(host, port, timeout=timeout)
            conn.starttls(context=ctx)
        else:
            # Port 465: TLS from the first byte, no STARTTLS negotiation.
            conn = smtplib.SMTP_SSL(host, port, timeout=timeout, context=ctx)
        return conn
    except (OSError, socket.timeout, ssl.SSLError, smtplib.SMTPException) as exc:
        raise SmtpUnavailable("cannot reach submission server %s:%s" % (host, port)) from exc


def send(session, msg: EmailMessage, *, recipients: list = None) -> str:
    """Submit a message and return its Message-ID.

    The From header must be the session's own mailbox. Exim on many cPanel
    configurations will accept a forged From from an authenticated user, so
    refusing it is our job, not the server's.
    """
    sender = session.mailbox_address
    from_header = msg.get("From", "")
    if sender.lower() not in from_header.lower():
        raise SmtpRejected(
            "The From header must be your own address. Refusing to send %r as %r."
            % (from_header, sender))

    envelope_to = recipients or _all_recipients(msg)
    if not envelope_to:
        raise SmtpRejected("There is nobody to send this to.")

    conn = _connect()
    try:
        conn.login(sender, session.credential)
        conn.send_message(msg, from_addr=sender, to_addrs=envelope_to)
    except smtplib.SMTPAuthenticationError as exc:
        raise SmtpRejected("The mail server rejected your credentials.") from exc
    except smtplib.SMTPRecipientsRefused as exc:
        bad = ", ".join(exc.recipients)
        raise SmtpRejected("These addresses were refused: %s" % bad) from exc
    except smtplib.SMTPResponseException as exc:
        raise SmtpRejected("The mail server refused it: %s" % exc.smtp_error) from exc
    except (OSError, socket.timeout, ssl.SSLError, smtplib.SMTPException) as exc:
        raise SmtpUnavailable("the connection dropped mid-send") from exc
    finally:
        try:
            conn.quit()
        except Exception:  # noqa: BLE001
            pass

    return msg["Message-ID"]


def _all_recipients(msg: EmailMessage) -> list:
    """To, Cc and Bcc, flattened.

    Bcc is read from the header and then removed before submission — leaving
    it on is how blind copies stop being blind.
    """
    out = []
    for header in ("To", "Cc", "Bcc"):
        raw = msg.get(header)
        if raw:
            out.extend(a.strip() for a in str(raw).split(",") if a.strip())
    if msg.get("Bcc"):
        del msg["Bcc"]
    return [_bare(a) for a in out if a]


def _bare(address: str) -> str:
    if "<" in address and ">" in address:
        return address[address.index("<") + 1:address.index(">")].strip()
    return address.strip()
