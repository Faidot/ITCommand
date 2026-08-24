"""Talking to TeraMailer — the webmail at /mail.

TeraMailer is a Node service with its own IMAP connections and its own browser
sessions. IT Command needs two things from it:

  1. To hand a signed-in person straight into their inbox, with no second
     password prompt. That is `issue_sso_ticket`.
  2. To read and write its settings, so the admin panel can live in IT
     Command's Settings under IT Command's roles rather than behind a second
     admin password.

Both go over a signed service channel. The signature covers the caller name, a
timestamp and the exact request body, so none can be altered and a captured
request stops working within the skew window.

**IT Command enforces who may do this.** TeraMailer only checks that the
caller really is IT Command; it has no idea what a superadmin is. Every view
that reaches this module must do its own permission check first.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import socket
import time
import urllib.error
import urllib.request

from django.conf import settings

log = logging.getLogger("core.teramailer")

TIMEOUT = 20


class TeraMailerError(Exception):
    """TeraMailer is unreachable, misconfigured, or refused us."""


def configured() -> bool:
    return bool(getattr(settings, "TERAMAILER_URL", "")
                and getattr(settings, "TERAMAILER_SHARED_SECRET", ""))


def _request(method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
    """One signed call. Returns (status, parsed body)."""
    if not configured():
        raise TeraMailerError(
            "TeraMailer is not configured. Set TERAMAILER_URL and "
            "TERAMAILER_SHARED_SECRET, and the same secret as ITC_SHARED_SECRET "
            "in the mail backend's .env.")

    base = settings.TERAMAILER_URL.rstrip("/")
    body = json.dumps(payload or {}).encode("utf-8") if payload is not None else b""
    timestamp = str(time.time())
    caller = getattr(settings, "TERAMAILER_SERVICE_NAME", "itcommand")

    key = settings.TERAMAILER_SHARED_SECRET
    if isinstance(key, str):
        key = key.encode("utf-8")
    signature = hmac.new(
        key, b"%s|%s|%s" % (caller.encode(), timestamp.encode(), body), hashlib.sha256
    ).hexdigest()

    request = urllib.request.Request(
        base + path,
        data=body if payload is not None else None,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-Service": caller,
            "X-Timestamp": timestamp,
            "X-Signature": signature,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read() or b"{}")
        except ValueError:
            return exc.code, {}
    except (urllib.error.URLError, socket.timeout, OSError) as exc:
        raise TeraMailerError("TeraMailer is not reachable: %s" % exc) from exc


# ── signing somebody in ────────────────────────────────────────────────────

def issue_sso_ticket(*, email: str, password: str) -> str:
    """Swap a credential for a single-use ticket the browser can carry.

    The password goes server to server and stops there. What comes back is a
    30-second ticket, which the browser posts onward in a form body — never a
    URL, because a bearer value in a query string is written to history, sent
    in Referer, and captured in access logs on both hosts.
    """
    status, body = _request("POST", "/api/auth/sso/issue",
                            {"email": email, "password": password})
    if status == 403:
        # TeraMailer's own domain allow-list. Worth passing through verbatim:
        # it is an admin decision, not a fault.
        raise TeraMailerError(body.get("error", "That domain is not permitted."))
    if status == 401:
        raise TeraMailerError(
            "The mail server rejected the stored credential. The mailbox "
            "password has probably changed since sign-in.")
    if status != 200 or not body.get("ticket"):
        raise TeraMailerError(body.get("error", "TeraMailer would not issue a ticket."))
    return body["ticket"]


def handoff_url() -> str:
    """Where the browser posts the ticket."""
    return getattr(settings, "TERAMAILER_PUBLIC_URL",
                   getattr(settings, "TERAMAILER_URL", "")).rstrip("/") \
        + "/api/auth/sso/redeem"


# ── settings, for the Mails tab ────────────────────────────────────────────

def get_config() -> dict:
    status, body = _request("GET", "/api/admin/config")
    if status != 200:
        raise TeraMailerError(body.get("error", "Could not read the mail settings."))
    return body


def update_section(section: str, values: dict) -> dict:
    """Write one settings section. TeraMailer decides what each accepts."""
    status, body = _request("POST", "/api/admin/config/%s" % section, values)
    if status != 200:
        raise TeraMailerError(body.get("error", "TeraMailer refused that change."))
    return body


def dashboard() -> dict:
    status, body = _request("GET", "/api/admin/dashboard")
    if status != 200:
        raise TeraMailerError(body.get("error", "Could not read the dashboard."))
    return body


def sessions() -> dict:
    status, body = _request("GET", "/api/admin/sessions")
    if status != 200:
        raise TeraMailerError(body.get("error", "Could not read the sessions."))
    return body


def end_session(session_id: str) -> dict:
    status, body = _request("DELETE", "/api/admin/sessions/%s" % session_id)
    if status != 200:
        raise TeraMailerError(body.get("error", "Could not end that session."))
    return body


def logs() -> dict:
    status, body = _request("GET", "/api/admin/logs")
    if status != 200:
        raise TeraMailerError(body.get("error", "Could not read the logs."))
    return body


def test_imap() -> tuple[bool, str]:
    """Read-only reachability check. Never raises for a failed test — a failed
    test is a result, not an error."""
    try:
        status, body = _request("POST", "/api/admin/test/imap", {})
    except TeraMailerError as exc:
        return False, str(exc)
    return status == 200 and bool(body.get("ok", status == 200)), \
        body.get("message") or body.get("error") or "Connected."


def test_smtp(to: str = "") -> tuple[bool, str]:
    try:
        status, body = _request("POST", "/api/admin/test/smtp", {"to": to} if to else {})
    except TeraMailerError as exc:
        return False, str(exc)
    return status == 200 and bool(body.get("ok", status == 200)), \
        body.get("message") or body.get("error") or "Sent."
