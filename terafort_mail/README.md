# Terafort Mail

A webmail client over cPanel Dovecot and Exim, built so the mailbox password
is the only credential, it never rests anywhere, and reading someone else's
mail requires four independent things to fail at once.

**Status: Phase 0 + Phase 1 complete.** Authentication, the IT Command
handoff, the isolation harness and the data model are built and tested. The
IMAP read path lands in Phase 2 — there is no mail in the app yet.

---

## Why this lives in the IT Command repo for now

The design calls for a separate repository. It is on a branch here so the
whole change — the new app *and* the IT Command side of the handoff — can be
reviewed as one diff. It is self-contained under `terafort_mail/` and comes
out with one command when you want it separate:

```bash
git subtree split -P terafort_mail -b terafort-mail-standalone
```

## Running the tests

The suite needs no Redis, no Postgres and no network. The session store has an
in-process backend and TOTP is implemented on the standard library, so
everything runs against SQLite:

```bash
cd backend
DJANGO_SETTINGS_MODULE=config.settings_test python manage.py test mailcore
```

91 tests. Two skip on SQLite — the Postgres row-level security tests, which
skip loudly rather than passing silently. **Run the suite against Postgres
before deploying**, or that layer is untested:

```bash
DB_ENGINE=django.db.backends.postgresql DB_NAME=tfmail_test \
  python manage.py test mailcore
```

## Isolation, and how to check it is real

Four independent mechanisms. A leak needs all four to fail together.

| Layer | Mechanism | Where |
|---|---|---|
| 1 | No mailbox identifier is accepted from a client, anywhere | `mailcore/urls.py` |
| 2 | `Message.objects.all()` raises; only `.for_session()` works | `mailcore/managers.py` |
| 3 | Postgres RLS — the database refuses, independently of Django | `migrations/0002` |
| 4 | Bodies sealed per mailbox; another session's key opens nothing | `mailcore/crypto.py` |

The harness in `mailcore/tests/test_isolation.py` enumerates the router and
asserts every route 404s for the wrong mailbox, so an endpoint added later
without isolation fails the build the moment it is registered.

Prove the harness works rather than trusting it — break isolation on purpose
and watch it fail:

```python
# in views.message_view, temporarily:
msg = Message.objects.unscoped().filter(id=message_id).first()
```

```
FAIL: test_bob_gets_404_on_every_one_of_alices_objects
AssertionError: 200 != 404 : GET /api/messages/85dfd2af-… leaked Alice's message_id to Bob
```

Layer 3 is verified at deploy time, not just in tests. `manage.py check_rls`
runs in the container entrypoint and fails the boot if RLS is missing,
unforced, or bypassable by the connecting role. **The app must not connect as
a Postgres superuser** — a superuser bypasses every policy silently, which
turns real protection into schema decoration.

## The handoff

```
browser ──1─→ IT Command          POST /auth/open-mailbox/  (session + CSRF)
              IT Command ──2─→ Redis   SETEX handoff:R · 30s · {sid}
browser ←─3── IT Command          200 { ticket }  ← in the body
browser ──4────────────────────→ mail app   auto-submitted FORM POST
                        mail app ──5─→ Redis   GETDEL handoff:R  (atomic)
browser ←─7── mail app            Set-Cookie __Host-tfm_sid + 303 → /inbox
```

Step 4 is the one that matters. A redirect carrying the ticket in a query
string would write it to browser history, send it onward in `Referer`, and
capture it in the nginx access log on both hosts — three durable copies of a
bearer value. A form body leaves none of those.

The ticket is single-use (`GETDEL`, not get-then-delete), 30 seconds old at
most, HMAC-signed, audience-scoped, and bound to the requesting browser. It
carries no credential: it points at a session record both apps can already
read.

## Key hierarchy

```
mailbox password ──Argon2id(salt)──→ KEK ──unwraps──→ DEK ──AES-256-GCM──→ bodies
   live session only                                    per mailbox
```

A stolen database yields `wrapped_dek` and ciphertext, and neither opens
without a password nobody stored. A stolen database **plus** Redis **during a
live session** yields whoever was signed in at that moment — that is the
honest limit, and it is why Redis runs with `save ""` and `appendonly no`.

When a user changes their password in cPanel, the unwrap fails on their next
login. That is expected and handled: the cache is discarded, a fresh DEK is
generated, and the mailbox re-syncs. The real mail was never at risk because
cPanel holds it — this cache is disposable by design.

## Enabling it in IT Command

Everything is behind one flag, off by default. With `MAIL_AUTH_ENABLED=false`,
`LoginView` takes exactly the path it always has and the two new routes 404.
That is asserted by `core/test_mail_bridge.py::FlagOffTests`.

To roll out:

1. Set the three shared secrets identically in both `.env` files —
   `MAIL_SESSION_SEAL_KEY` (exactly 32 bytes), `MAIL_HANDOFF_HMAC_KEY`,
   `MAIL_INTERNAL_HMAC_KEY`.
2. Flip one pilot user to `auth_source=MAILBOX`.
3. Set `MAIL_AUTH_ENABLED=true`.

**Rollback is setting the flag back to false.** No migration, no data change.
Password hashes stay on the row throughout, dormant — they are not deleted,
and a mailbox user cannot sign in with a stale hash while the flag is on
(asserted by `test_local_password_is_never_consulted_for_a_mailbox_user`).
Removing those hashes is a separate, explicitly flagged migration for later.

## Still unverified against your server

Section 13 of the blueprint. None of these blocks the architecture; several
change the implementation. `GET /api/probe` answers most of them read-only —
it connects, asks `CAPABILITY`, and disconnects, writing nothing and opening
no mailbox. Set `MAIL_PROBE_TOKEN` and send it as `X-Probe-Token`.

- Does Dovecot advertise `CONDSTORE` / `QRESYNC`? Without them incremental
  sync is polling-shaped and much heavier.
- Does it advertise `SPECIAL-USE`, and is Sent at `INBOX.Sent` or `Sent`?
- Actual `mail_max_userip_connections`, and whether it is adjustable on a
  managed cPanel box. We budget three connections per signed-in user.
- cPHulk / fail2ban thresholds for this server's IP. Forty people signing in
  on a Monday morning from one address is exactly the shape brute-force
  protection punishes.
- Submission on 587 STARTTLS or 465 implicit TLS, same credential?

## Layout

```
backend/
  config/            settings, urls, wsgi; settings_test.py runs on SQLite
  mailcore/
    crypto.py        Argon2id, AES-GCM, DEK wrapping
    totp.py          RFC 6238 on the standard library — no dependency
    sessions.py      the session store; Redis and in-process backends
    imap_auth.py     Dovecot login and the capability probe
    handoff.py       mint, redeem, and every way it refuses
    managers.py      the manager that will not build an unscoped queryset
    middleware.py    SET LOCAL app.mailbox_id for RLS
    internal.py      the service-to-service boundary
    models.py        the schema
    tests/           91 tests, isolation harness included
frontend/            Next.js 14 scaffold; Phase 1 landing page only
deploy/              nginx vhost, Postgres app-role bootstrap
```
