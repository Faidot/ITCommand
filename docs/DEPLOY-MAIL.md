# Terafort Mail — Production Deployment

Everything mail-related, and how to put it live without breaking the login for
people who have never had a mailbox.

This is a companion to [`DEPLOYMENT.md`](../DEPLOYMENT.md), which covers the
IT Command stack itself. Read that first if the platform is not already
running.

---

## 1. What you are deploying

Three things, and only the first is required.

| Piece | What it does | Required? |
|---|---|---|
| **Mailbox management** in IT Command | Create mailboxes, set passwords, change storage, suspend, delete. Talks to cPanel's UAPI. | Yes |
| **TeraMailer** (`mail/`) | The webmail. Node + Express + React, talks IMAP/SMTP. | Only if people will read mail in the browser |
| **terafort_mail** (`terafort_mail/`) | Django. Runs the Dovecot login and TOTP that produce the session Open Mailbox reads. | Only if `MAIL_AUTH_ENABLED=true` |

> **On terafort_mail.** It was originally the mail client and is no longer —
> TeraMailer took that job. What it still does is authentication: the IMAP
> check, the second factor, and the encrypted session that holds the
> credential. That is a seam worth closing eventually; until it is, this
> service has to run for mailbox sign-in to work.

```
  Browser ──► nginx ──┬──► IT Command  (Django + Next)     mailbox management
                      │                                     Settings → Mails
                      ├──► TeraMailer  (Express + React)    reading mail
                      └──► terafort_mail (Django)           login + TOTP
                                    │
                      all three ────┴──► Redis   the shared session store
                                    └──► cPanel  IMAP 993 / SMTP 465 / UAPI 2083
```

---

## 2. Before you start

You will need, on the server or to hand:

- **Redis**, reachable by all three services. Not optional: the handoff works
  by two services reading one session, and two processes cannot share memory.
- **A cPanel API token** — cPanel → Security → Manage API Tokens → Create. It
  only needs the Email module.
- **Three generated secrets** (below). Each must be identical on both sides of
  the pair that uses it, or that path fails closed.
- **The mail domain's IMAP and SMTP details.** For `terafort.org` these are
  `mail.terafort.org`, IMAP **993** with TLS, SMTP **465** implicit TLS.

Generate the secrets once and keep them:

```bash
# 32 bytes EXACTLY — the session seal key is rejected at any other length
python3 -c "import secrets,string;print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(32)))"

# the other three, any length
python3 -c "import secrets;print(secrets.token_urlsafe(48))"   # handoff HMAC
python3 -c "import secrets;print(secrets.token_urlsafe(48))"   # internal HMAC
python3 -c "import secrets;print(secrets.token_urlsafe(48))"   # TeraMailer shared
```

---

## 3. Configuration

### ⚠ Which `.env` is actually read

`python-decouple` walks **up** from `settings.py` and stops at the **first**
`.env` it finds. For the Django backend that is **`itcommand_backend/.env`**,
not the repository root one. The root file is not read at all.

This has already caused two live incidents' worth of confusion. Put mail
settings in `itcommand_backend/.env` and nowhere else.

### `itcommand_backend/.env`

```bash
# ─── mailbox provisioning ─────────────────────────────────────────────────
# Off means: login behaves exactly as it always has. Turn it on only after
# section 5.
MAIL_AUTH_ENABLED=false

# terafort_mail — the login/TOTP service
MAIL_APP_INTERNAL_URL=http://mail-backend:8000
MAIL_SESSION_SEAL_KEY=<the 32-byte one>
MAIL_HANDOFF_HMAC_KEY=<handoff HMAC>
MAIL_INTERNAL_HMAC_KEY=<internal HMAC>
MAIL_INTERNAL_SERVICE_NAME=itcommand
MAIL_REDIS_URL=redis://:PASSWORD@redis:6379/1
MAIL_SESSION_ABSOLUTE_SECONDS=28800
MAIL_SID_COOKIE=itc_mail_sid
MAIL_DEVICE_COOKIE=itc_2fa_device

# Dovecot
MAIL_IMAP_HOST=mail.terafort.org
MAIL_IMAP_PORT=993
MAIL_IMAP_VERIFY_CERT=true

# ─── TeraMailer, the webmail ──────────────────────────────────────────────
# INTERNAL is server-to-server; PUBLIC is where the *browser* posts the
# sign-in ticket. Behind a proxy these differ, and getting them the wrong way
# round means the browser tries to reach an address only the server can see.
TERAMAILER_URL=http://teramailer:5000
TERAMAILER_PUBLIC_URL=https://mail.itcommand.com
TERAMAILER_WEBMAIL_URL=https://mail.itcommand.com
TERAMAILER_SHARED_SECRET=<TeraMailer shared>
TERAMAILER_SERVICE_NAME=itcommand
```

### `mail/backend/.env` (TeraMailer)

```bash
NODE_ENV=production
PORT=5000
SESSION_SECRET=<a long random string, its own>
REDIS_URL=redis://:PASSWORD@redis:6379/2
COOKIE_SECURE=true
CORS_ORIGINS=https://mail.itcommand.com,https://itcommand.com

# Must equal TERAMAILER_SHARED_SECRET above. Blank refuses every service
# request, which is the safe default — a missing secret must never mean allow.
ITC_SHARED_SECRET=<TeraMailer shared>
ITC_URL=https://itcommand.com
WEBMAIL_URL=https://mail.itcommand.com
```

### `terafort_mail/.env` (login + TOTP)

```bash
DEBUG=false
SECRET_KEY=<its own Django secret>
ALLOWED_HOSTS=mail-backend,localhost

DB_NAME=terafort_mail
DB_USER=tfmail          # NOT a superuser — see section 4
DB_PASSWORD=<...>
DB_HOST=mail-db

MAIL_REDIS_URL=redis://:PASSWORD@redis:6379/1
MAIL_SESSION_SEAL_KEY=<the SAME 32-byte one>
MAIL_HANDOFF_HMAC_KEY=<the SAME handoff HMAC>
MAIL_INTERNAL_HMAC_KEY=<the SAME internal HMAC>
MAIL_INTERNAL_SERVICES=itcommand

MAIL_IMAP_HOST=mail.terafort.org
MAIL_IMAP_PORT=993
MAIL_SMTP_HOST=mail.terafort.org
MAIL_SMTP_PORT=465
MAIL_SMTP_STARTTLS=false          # 465 is implicit TLS

MAIL_COOKIE_SECURE=true
MAIL_DIRECT_LOGIN_ENABLED=false   # one front door: the handoff
MAIL_MASTER_USER=                 # break-glass off; see section 8
```

**The three shared pairs.** Get any of these wrong and the path fails closed —
which is the right direction, but still an outage:

| Secret | Must match between |
|---|---|
| `MAIL_SESSION_SEAL_KEY` | IT Command ↔ terafort_mail |
| `MAIL_INTERNAL_HMAC_KEY` | IT Command ↔ terafort_mail |
| `TERAMAILER_SHARED_SECRET` = `ITC_SHARED_SECRET` | IT Command ↔ TeraMailer |

---

## 4. Database

```bash
# IT Command — adds auth_source, ManagedMailbox, web access
python manage.py migrate

# terafort_mail — its own database
cd terafort_mail/backend && python manage.py migrate
```

**The application role must not be a Postgres superuser.** Row-level security
is bypassed silently by a superuser and by any role with `BYPASSRLS`, which
turns real isolation into schema decoration. `deploy/postgres/01-app-role.sql`
creates the role correctly, and the container entrypoint runs:

```bash
python manage.py check_rls
```

which **fails the boot** if RLS is missing, unforced, or bypassable. Do not
remove it from the entrypoint.

---

## 5. Rollout order

The order matters. Each step is verifiable before the next, and the risky one
is last.

### Step 1 — connect cPanel (no user impact)

Settings → Integrations → cPanel. Fill in the token, hostname, cPanel
username, mail domain. Save, then **Test connection**.

```bash
python manage.py cpanel_check              # read-only, creates nothing
```

Then prove creation actually works, on an address nobody cares about:

```bash
python manage.py cpanel_verify --address itcommand-selftest@terafort.org
python manage.py cpanel_verify --address itcommand-selftest@terafort.org --cleanup
```

> `cpanel_check` only proves authentication and `list_pops`. Mailbox creation
> uses different parameters, and three of them are marked `# VERIFY` in
> `core/cpanel.py` because cPanel renames UAPI arguments between releases.
> `cpanel_verify` is what exercises them for real.

### Step 2 — sync the mailbox list

```bash
python manage.py sync_mailboxes            # read-only against the mail server
```

Mailboxes appears in the sidebar. Create one real user with a mailbox and
confirm the password works in webmail. **Still no impact on anyone's login.**

### Step 3 — start TeraMailer and terafort_mail

Bring both up. Check Settings → **Mails**: it should show live IMAP and SMTP
status rather than setup instructions.

### Step 4 — the one that changes logins

Pick **one** pilot user, flip them to mailbox authentication, then:

```bash
MAIL_AUTH_ENABLED=true
```

Restart the backend. That user now signs in with their **cPanel mailbox
password**, enrols an authenticator once, and gets Open Mailbox in the sidebar.

Only when that works, backfill the rest:

```bash
python manage.py link_mailboxes            # dry run — changes nothing
python manage.py link_mailboxes --apply
```

> **`--apply` locks people out until they know their mailbox password.**
> Linked users authenticate against Dovecot from that moment and their old IT
> Command password stops working. Tell people before you run it, not after.

---

## 6. Rollback

**The mail work rolls back with one variable:**

```bash
MAIL_AUTH_ENABLED=false
```

Restart. `LoginView` takes exactly the path it always has, and the mail routes
return 404. This is asserted by `core.test_mail_bridge.FlagOffTests`, not just
claimed.

What survives a rollback, deliberately:

- **Password hashes are not deleted** when a user is switched to mailbox
  authentication. They sit dormant on the row, so flipping the flag back
  restores the old login for everyone.
- **Mailboxes on cPanel are untouched.** Nothing about turning the feature off
  removes mail.

To roll a *user* back: set `auth_source` to `LOCAL` and issue a password reset.

The one thing that does not roll back is a **purge** — that destroys mail
permanently and only a superadmin can reach it, after the mailbox has been
marked for deletion and its grace period has elapsed.

---

## 7. Scheduled jobs

```bash
# hourly — read-only against the mail server, safe to run often
python manage.py sync_mailboxes

# daily — THE ONLY DESTRUCTIVE JOB. Dry run without --apply.
python manage.py purge_due_mailboxes
python manage.py purge_due_mailboxes --apply
```

Review the dry-run output before automating the second one. Every mailbox it
touches was explicitly marked by a named person, suspended at that moment, and
left recoverable for the full 30 days.

---

## 8. Deliberately off

Two things ship disabled. Both are decisions, not oversights.

**Break-glass** (`MAIL_MASTER_USER`) lets a superadmin read another person's
mailbox. It needs a Dovecot **master user** — one credential that opens every
mailbox on the server — which is a permanent weakening of the property your
brief called non-negotiable. Managed cPanel often does not expose master users
at all. The alternative that needs no server configuration is **reset-and-enter**
in the mailbox console: it resets the password and opens the mailbox, which
locks the owner out until you hand them the new one. Either way the owner is
emailed and every message read is logged individually.

**Attachment scanning** (`MAIL_CLAMAV_SOCKET`) is blank, so attachments are
served marked unscanned. `MAIL_BLOCK_UNSCANNED` chooses between refusing every
download the day clamd dies and serving files unscanned — both defensible, so
it is a setting rather than a default buried in code. ClamAV wants roughly
1 GB resident for its signature database; size the host before enabling it.

---

## 9. Verifying a deploy

```bash
redis-cli ping                                          # PONG
python manage.py cpanel_check                           # cPanel reachable
python manage.py check_rls                              # RLS enforced
curl -fsS https://mail.itcommand.com/api/health         # TeraMailer alive
```

In the browser, as a mailbox user: sign in → enrol once → **Open Mailbox** →
land in the inbox with no second password prompt. As superadmin: Settings →
**Mails** shows live IMAP/SMTP status.

If Open Mailbox says the session expired, check that `itc_mail_sid` is present
in the browser's cookies. If it is missing, the frontend is not sending
credentials — see `withCredentials` in `itcommand_frontend/src/lib/api.ts` and
`CORS_ALLOW_CREDENTIALS` in settings. Both are required, and behind a single
origin in production neither should be an issue.

---

## 10. Known limits

Written down rather than discovered.

- **`terafort_mail` must run** for mailbox login, even though it is no longer
  the mail client. Two backends sharing one job is a seam worth closing.
- **The mail server advertises no `CONDSTORE`, `QRESYNC`, `SPECIAL-USE` or
  `MOVE`.** Fallbacks exist for all four, so nothing breaks — but sync polls
  rather than updating incrementally, and the Sent folder is found by name.
  That reading was taken *before* login and Dovecot often advertises more
  afterwards, so it may be pessimistic.
- **Three cPanel UAPI calls are unverified** against a live server and marked
  `# VERIFY` in `core/cpanel.py`. `cpanel_verify` exercises the important one.
- **External mailboxes** (Gmail and similar) are not supported.
- **No background sync while a user is signed out.** Accepted by design: no
  credential is stored, so there is nothing to sync with.
