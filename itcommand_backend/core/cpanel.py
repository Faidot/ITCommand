"""cPanel UAPI client — mailbox lifecycle only.

IT Command owns mailbox creation, suspension and quotas; the mail app never
touches any of it. This module is that ownership, and it is deliberately
narrow: it can make a mailbox, suspend one, and read the list. It cannot
create cPanel accounts, change DNS, or reach anything outside email.

Two things to know before reading further.

**Passwords pass through here and are never kept.** `create_mailbox` takes a
password, hands it to cPanel, and forgets it. It is not logged, not returned
in an exception message, and not written anywhere. The `_redact` helper exists
because a stack trace from urllib will happily include a request body.

**Some parameter names are version-dependent.** cPanel has renamed UAPI
arguments between releases, and I have not been able to test against your
host. Anything marked `# VERIFY` below is my best reading of the current docs
rather than something observed working. `manage.py cpanel_check` exercises
each call read-only and will tell you which ones your server actually accepts.
"""
from __future__ import annotations

import json
import logging
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("core.cpanel")

#: cPanel's authenticated API port. 2082 is the plaintext twin; we never use it.
DEFAULT_PORT = 2083

#: Default mailbox size in MB. cPanel treats 0 as unlimited, which we do not
#: pass by accident — see `create_mailbox`.
DEFAULT_QUOTA_MB = 5120

REQUEST_TIMEOUT = 20


class CpanelError(Exception):
    """Base for everything this module raises."""


class CpanelNotConfigured(CpanelError):
    """No enabled cPanel integration with a usable token."""


class CpanelUnavailable(CpanelError):
    """The host could not be reached, or answered with something unparseable.

    Kept apart from `CpanelRejected` for the same reason IMAP does it: an
    outage reported as a rejection sends an operator looking for a permissions
    problem that does not exist.
    """


class CpanelRejected(CpanelError):
    """cPanel understood the request and refused it."""

    def __init__(self, message, *, errors=None):
        super().__init__(message)
        self.errors = errors or []


class MailboxExists(CpanelRejected):
    """That address is already a mailbox.

    Its own class because creating a user whose mailbox already exists is a
    normal thing to do — it means "link this one", not "something broke".
    """


def _redact(text: str, *secrets_: str) -> str:
    """Keep credentials out of log lines and exception messages."""
    out = str(text)
    for secret in secrets_:
        if secret:
            out = out.replace(secret, "***")
    return out


class CpanelClient:
    """One cPanel account, one domain, mailboxes within it."""

    def __init__(self, *, host: str, username: str, token: str, domain: str,
                 port: int = DEFAULT_PORT, verify_cert: bool = True,
                 quota_mb: int = DEFAULT_QUOTA_MB):
        if not (host and username and token and domain):
            raise CpanelNotConfigured(
                "cPanel needs a host, username, API token and domain before it "
                "can be called.")
        self.host = host.strip().rstrip("/")
        self.username = username.strip()
        self.token = token.strip()
        self.domain = domain.strip().lower()
        self.port = int(port)
        self.verify_cert = verify_cert
        self.quota_mb = int(quota_mb)

    # -- construction ------------------------------------------------------

    @classmethod
    def from_integration(cls, *, require_enabled: bool = True) -> "CpanelClient":
        """Build from the saved Integration row, or say why we cannot.

        `require_enabled=False` is for the connection test: you want to prove
        the credentials work *before* switching the integration on, not after.
        Every real call path leaves it True, so a disabled integration is
        never contacted by accident.

        Credentials live in the same encrypted Integration table as every
        other provider, so rotating VAULT_ENCRYPTION_KEY reports the same
        clear error here as it does for Brex.
        """
        from core.models.integrations import CredentialUnreadable, Integration

        row = Integration.objects.filter(provider="CPANEL").first()
        if row is None:
            raise CpanelNotConfigured(
                "The cPanel integration has not been set up yet. "
                "Settings → Integrations → cPanel.")
        if require_enabled and not row.is_enabled:
            raise CpanelNotConfigured(
                "The cPanel integration is saved but not enabled. "
                "Settings → Integrations → cPanel → Enable.")
        try:
            token = row.get_api_key()
        except CredentialUnreadable as exc:
            raise CpanelNotConfigured(str(exc)) from exc
        if not token:
            raise CpanelNotConfigured("No cPanel API token is saved.")

        cfg = row.config or {}
        return cls(
            host=cfg.get("host", "") or row.base_url,
            username=cfg.get("cpanel_username", ""),
            token=token,
            domain=cfg.get("domain", ""),
            port=cfg.get("port", DEFAULT_PORT),
            verify_cert=cfg.get("verify_cert", True),
            quota_mb=cfg.get("default_quota_mb", DEFAULT_QUOTA_MB),
        )

    # -- transport ---------------------------------------------------------

    def _url(self, module: str, function: str) -> str:
        base = self.host
        if not base.startswith("http"):
            base = "https://%s:%d" % (base, self.port)
        return "%s/execute/%s/%s" % (base.rstrip("/"), module, function)

    def _call(self, module: str, function: str, **params) -> dict:
        """One UAPI call. Returns `data`; raises on anything else.

        UAPI answers 200 OK even for failures, with the outcome in the body:

            {"status": 1, "errors": null, "data": {...}, "warnings": null}

        So a 200 proves nothing on its own and `status` has to be checked.
        """
        payload = {k: v for k, v in params.items() if v is not None}
        body = urllib.parse.urlencode(payload).encode("utf-8")
        password = payload.get("password", "")

        request = urllib.request.Request(
            self._url(module, function),
            data=body,
            method="POST",
            headers={
                # cPanel API tokens use this exact scheme. Not Bearer.
                "Authorization": "cpanel %s:%s" % (self.username, self.token),
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
        )

        ctx = ssl.create_default_context()
        if not self.verify_cert:
            # A cPanel box on a self-signed cert. Loud, because this is a real
            # downgrade on a channel that carries mailbox passwords.
            log.warning("cPanel TLS verification is DISABLED for %s", self.host)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT,
                                        context=ctx) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            detail = _redact(exc.read()[:400].decode("utf-8", "replace"),
                             self.token, password)
            if exc.code in (401, 403):
                raise CpanelRejected(
                    "cPanel refused the API token (HTTP %d). Check the token and "
                    "that it belongs to user %r." % (exc.code, self.username)) from exc
            raise CpanelUnavailable(
                "cPanel returned HTTP %d: %s" % (exc.code, detail)) from exc
        except (urllib.error.URLError, socket.timeout, ssl.SSLError, OSError) as exc:
            raise CpanelUnavailable(
                "Could not reach cPanel at %s: %s"
                % (self.host, _redact(exc, self.token, password))) from exc

        try:
            parsed = json.loads(raw or b"{}")
        except ValueError as exc:
            # Almost always an HTML login page, which means the token was not
            # accepted and cPanel redirected instead of answering.
            raise CpanelUnavailable(
                "cPanel did not return JSON. This usually means the API token "
                "was rejected and a login page was served instead.") from exc

        if not parsed.get("status"):
            errors = parsed.get("errors") or []
            message = _redact("; ".join(str(e) for e in errors) or "cPanel refused the request",
                              self.token, password)
            if "already exists" in message.lower():
                raise MailboxExists(message, errors=errors)
            raise CpanelRejected(message, errors=errors)

        return parsed.get("data") or {}

    # -- mailboxes ---------------------------------------------------------

    def list_mailboxes(self, *, with_disk: bool = True) -> list[dict]:
        """Every mailbox on the account. Read-only, and safe to call often.

        Prefers `list_pops_with_disk`, which also reports quota and usage. Not
        every cPanel build has it, so a refusal falls back to plain
        `list_pops` -- we lose the disk figures, not the list.
        """
        data = None
        if with_disk:
            try:
                data = self._call("Email", "list_pops_with_disk")
            except CpanelRejected:
                log.info("list_pops_with_disk unavailable; falling back to list_pops")
        if data is None:
            data = self._call("Email", "list_pops")
        # list_pops returns a list; older builds wrap it. Handle both rather
        # than assume, because getting this wrong looks like "no mailboxes".
        if isinstance(data, dict):
            data = data.get("pops") or data.get("result") or []
        return [row for row in data if isinstance(row, dict)]

    #: A mailbox quota above this is treated as a unit mix-up rather than a
    #: real limit. 8 TB for one mailbox is not a configuration anyone means,
    #: and it is exactly what a bytes-read-as-megabytes value looks like.
    IMPLAUSIBLE_MB = 8 * 1024 * 1024

    @staticmethod
    def parse_mailbox_row(row: dict) -> dict:
        """Normalise one list_pops row into fields we can store.

        The trap here, which caught me: cPanel reports the disk figures
        **twice**. `diskquota` and `diskused` are megabytes; `_diskquota` and
        `_diskused` are the same numbers in bytes. Preferring the
        underscore-prefixed pair looks like the more precise choice and is
        wrong by a factor of 1048576 -- and the results are plausible enough
        to ship, because a 250 MB mailbox simply reads as 256000 GB.

        So: megabytes first, bytes only as a fallback, and a final sanity check
        for anything that still looks like the wrong unit.

        `None` for a quota means unlimited, which is distinct from 0 -- 0 would
        mean no space at all.
        """
        address = (row.get("email") or row.get("login") or "").strip().lower()

        def _num(value):
            if value is None:
                return None
            text = str(value).strip().lower()
            if text in ("", "unlimited", "0.00 unlimited", "none", "null"):
                return None
            try:
                return float(text)
            except (TypeError, ValueError):
                return None

        def _megabytes(mb_key, bytes_key):
            """Megabytes from whichever field the build actually provides."""
            mb = _num(row.get(mb_key))
            if mb is None:
                raw_bytes = _num(row.get(bytes_key))
                mb = None if raw_bytes is None else raw_bytes / (1024 * 1024)
            if mb is None:
                return None
            # Last line of defence. If a future cPanel swaps the units again,
            # this converts rather than storing a number three orders of
            # magnitude out and letting the console render nonsense.
            if mb > CpanelClient.IMPLAUSIBLE_MB:
                log.warning(
                    "%s reported %s as %.0f MB, which is implausible for a "
                    "mailbox -- treating it as bytes", address, mb_key, mb)
                mb = mb / (1024 * 1024)
            return int(round(mb))

        return {
            "address": address,
            "quota_mb": _megabytes("diskquota", "_diskquota"),
            "disk_used_mb": _megabytes("diskused", "_diskused") or 0,
            # cPanel reports suspension under several keys depending on build.
            "suspended_login": bool(
                row.get("suspended_login")
                or row.get("suspended")
                or row.get("login_suspended")
            ),
        }

    def mailbox_addresses(self) -> set[str]:
        """Just the addresses, lowercased, for matching against users."""
        out = set()
        for row in self.list_mailboxes():
            address = row.get("email") or row.get("login") or ""
            if "@" in address:
                out.add(address.strip().lower())
        return out

    def create_mailbox(self, address: str, password: str,
                       quota_mb: int | None = None) -> dict:
        """Create a mailbox. The password is used and then forgotten.

        Raises `MailboxExists` when the address is already there, which the
        caller should treat as "link it" rather than as a failure.
        """
        local, _, domain = address.partition("@")
        if not local or not domain:
            raise CpanelRejected("%r is not a full email address" % address)
        if domain.lower() != self.domain:
            # A typo here would create a mailbox on a domain nobody is watching.
            raise CpanelRejected(
                "This integration manages %s, but the address is on %s."
                % (self.domain, domain))

        quota = self.quota_mb if quota_mb is None else int(quota_mb)
        if quota <= 0:
            # cPanel reads 0 as unlimited. Reaching that by accident — an empty
            # form field, an int() of "" — fills a disk quietly, so it has to
            # be asked for rather than fallen into.
            raise CpanelRejected(
                "Refusing a quota of %s. Pass a positive size in MB; cPanel "
                "treats 0 as unlimited and that must be deliberate." % quota)

        return self._call(
            "Email", "add_pop",
            email=local,            # VERIFY: local part only on current cPanel
            password=password,
            quota=quota,
            domain=domain,
            skip_update_db=1,       # VERIFY: skips a slow rebuild we do not need
        )

    def change_password(self, address: str, password: str) -> dict:
        """Set a mailbox password.

        This is the single credential: changing it here changes what opens IT
        Command too, because IT Command asks Dovecot rather than checking a
        hash of its own. That is the point of the design, and it is why this
        call has no IT Command-side counterpart to keep in step.
        """
        local, _, domain = address.partition("@")
        if not local or not domain:
            raise CpanelRejected("%r is not a full email address" % address)
        return self._call("Email", "passwd_pop",
                          email=local,          # VERIFY: local part on current cPanel
                          password=password,
                          domain=domain)

    def suspend_mailbox(self, address: str) -> dict:
        """Block IMAP and webmail login. Every message is left intact.

        This is what offboarding does. It is fully reversible, which is why it
        is the default rather than deletion.
        """
        return self._call("Email", "suspend_login", email=address)  # VERIFY: full address

    def unsuspend_mailbox(self, address: str) -> dict:
        return self._call("Email", "unsuspend_login", email=address)

    def set_quota(self, address: str, quota_mb: int) -> dict:
        local, _, domain = address.partition("@")
        return self._call("Email", "edit_pop_quota",
                          email=local, domain=domain, quota=int(quota_mb))

    def delete_mailbox(self, address: str, *, i_understand_this_deletes_mail: bool = False) -> dict:
        """Destroy a mailbox and everything in it. Not reachable from the API.

        No view calls this. It exists for a deliberate operator action, and the
        keyword argument is there so it cannot be invoked by autocomplete or by
        a future caller who thought it meant "suspend".
        """
        if not i_understand_this_deletes_mail:
            raise CpanelRejected(
                "delete_mailbox permanently destroys every message in %s and "
                "cannot be undone. Suspend instead, or pass "
                "i_understand_this_deletes_mail=True." % address)
        local, _, domain = address.partition("@")
        log.warning("DELETING cPanel mailbox %s — this is not reversible", address)
        return self._call("Email", "delete_pop", email=local, domain=domain)

    # -- diagnostics -------------------------------------------------------

    def check(self) -> dict:
        """Read-only probe: prove the token works and report what we can see.

        Creates nothing. This is what `manage.py cpanel_check` runs.
        """
        mailboxes = self.list_mailboxes()
        return {
            "host": self.host,
            "port": self.port,
            "cpanel_user": self.username,
            "domain": self.domain,
            "reachable": True,
            "mailbox_count": len(mailboxes),
            "default_quota_mb": self.quota_mb,
            "sample": sorted(list(self.mailbox_addresses()))[:5],
        }
