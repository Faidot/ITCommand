# TeraMailer — Mail Setup & Login Guide

This guide explains **how TeraMailer works**, **which email accounts can log in**, and the
**exact mail-server settings** for `terafort.org` (taken from your cPanel "Mail Client Manual
Settings" page). Follow it to log in with a real mailbox such as `it.test@terafort.org`.

---

## 1. How it works (in plain terms)

TeraMailer is **not** its own mail server — it is a web client that talks to your existing
mail server (`mail.terafort.org`, a cPanel box).

```
   Browser (you)                TeraMailer backend                 cPanel mail server
 ┌───────────────┐   HTTPS   ┌────────────────────┐   IMAP/SMTP   ┌───────────────────┐
 │ Webmail (React)│ ───────▶ │ Express + imapflow  │ ───────────▶ │ mail.terafort.org │
 │  :3000         │ ◀─────── │ + nodemailer  :5000 │ ◀─────────── │ 993 (IMAP) /      │
 └───────────────┘           └────────────────────┘               │ 465 (SMTP)        │
                                                                   └───────────────────┘
```

1. You open the webmail and enter your **full email address + mailbox password**.
2. The backend tries to **log in to IMAP** (`mail.terafort.org:993`) with those exact
   credentials. If IMAP accepts them, you're authenticated; if not, login is rejected.
3. While you're logged in, the backend keeps one live IMAP connection for you and uses it to
   list folders, read messages, search, flag, move, and delete.
4. When you send mail, the backend connects to **SMTP** (`mail.terafort.org:465`) and sends
   **as you** (your address is the `From`).
5. Your password is **never written to disk** — it lives only in the server-side session for
   as long as you're logged in, and is passed straight through to IMAP/SMTP.

> There is **no separate user database**. Anyone with a valid `mail.terafort.org` mailbox can
> sign in — subject to the domain restriction below.

---

## 2. Which mailboxes can log in (the domain rule)

The admin decides **which email domains are allowed to log in**. Only addresses whose domain
is in the allow-list can sign in; everyone else is rejected with
*"This email domain is not permitted."*

It is configured here (already set for you):

`backend/src/config/settings.json`
```json
"app": {
  "name": "TeraMailer",
  "domain": "terafort.org",
  "allowedDomains": ["terafort.org"]
}
```

So right now **only `@terafort.org` accounts can log in**, for example:

- ✅ `it.test@terafort.org`
- ✅ `anyone@terafort.org`
- ❌ `someone@gmail.com` → blocked
- ❌ `someone@terafort.com` → blocked (different domain)

**To change the allowed domain(s)** you don't edit files — use the Admin Panel:
**Admin → Domain & App Settings → Allowed Domains** (add/remove domain chips, then Save).
You can allow several domains at once (e.g. `terafort.org` *and* `terafort.com`).

---

## 3. The mail-server settings (from your screenshot)

These are the cPanel "Secure SSL/TLS (Recommended)" values, and they are what TeraMailer is
configured to use:

| Purpose | Server | Port | Encryption | TeraMailer setting |
|---|---|---|---|---|
| **Incoming (IMAP)** | `mail.terafort.org` | **993** | SSL/TLS | `imap.host`, `imap.port=993`, `imap.tls=true` |
| **Outgoing (SMTP)** | `mail.terafort.org` | **465** | SSL/TLS | `smtp.host`, `smtp.port=465`, `smtp.secure=true` |
| Username | the **full email**, e.g. `it.test@terafort.org` | — | — | entered at login |
| Password | the **email account's password** | — | — | entered at login |

> **Why `secure: true` for SMTP?** Port **465** uses *implicit* SSL (TLS from the first byte),
> so nodemailer needs `secure: true`. Port 587 (STARTTLS) would instead use
> `secure: false, requireTLS: true`. Your screenshot uses 465, so we use `secure: true`.

The matching `settings.json` (already applied):
```json
{
  "imap": { "host": "mail.terafort.org", "port": 993, "tls": true, "timeout": 30000, "maxConnections": 50 },
  "smtp": { "host": "mail.terafort.org", "port": 465, "secure": true, "requireTLS": false, "fromName": "TeraMailer", "fromAddress": "" }
}
```

### Not used by TeraMailer
Your screenshot also lists **Calendar & Contacts (CalDAV/CardDAV)** on ports **2080 / 2079**
and **POP3** on **995**. TeraMailer is a webmail client only — it uses **IMAP (993)** for
reading and **SMTP (465)** for sending. The CalDAV/CardDAV and POP3 entries are not needed
here and are safe to ignore.

---

## 4. How to log in (step by step)

### A. Start the apps (development)

Open three terminals:

```bash
# 1) Backend API  → http://localhost:5000
cd backend
cp .env.example .env        # set SESSION_SECRET to a long random value
npm install
npm run dev

# 2) Webmail      → http://localhost:3000
cd frontend
cp .env.example .env        # VITE_API_URL=http://localhost:5000
npm install
npm run dev

# 3) Admin panel  → http://localhost:3001/admin
cd admin
cp .env.example .env        # VITE_API_URL=http://localhost:5000
npm install
npm run dev
```

### B. Log in to the webmail (as a normal user)

1. Open **http://localhost:3000**.
2. **Email address:** your full mailbox, e.g. `it.test@terafort.org`
3. **Password:** that mailbox's password (the same one you'd use in Outlook/Thunderbird).
4. Click **Sign in**.

What happens: the backend connects to `mail.terafort.org:993` (IMAP) and verifies the
credentials. On success you land in the Inbox; you can read, search, star, move, delete, and
compose/reply/forward (sent via `mail.terafort.org:465`).

> If you have **another** `@terafort.org` mailbox, you can log in with that one too — same
> steps, no extra setup. Any mailbox on the allowed domain works.

### C. Log in to the Admin Panel

1. Open **http://localhost:3001/admin**
2. **Username:** `admin`
3. **Password:** the bootstrap password printed in the backend log on first start
   (default `admin123` unless you set `ADMIN_DEFAULT_PASSWORD` in `backend/.env`).
4. Go to **Domain & App Settings** to change which domains may log in, or **IMAP/SMTP
   Settings** to change servers/ports. Use the **Test Connection** / **Send Test Email**
   buttons to confirm the mail server is reachable from where the backend runs.

> Change the admin password right away under **Admin → Security Settings → Change password**.

---

## 5. Quick verification

After starting the backend, you can sanity-check from a terminal (replace the password):

```bash
# Domain rule: a non-allowed domain is rejected (expect 403)
curl -i -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"someone@gmail.com","password":"x"}'

# Real login (expect 200 with your user + a csrfToken)
curl -i -c cookies.txt -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"it.test@terafort.org","password":"YOUR_MAILBOX_PASSWORD"}'
```

A `200` means IMAP accepted the credentials. A `401` means wrong password **or** the mail
server wasn't reachable — check IMAP host/port and your network/firewall (cPanel servers
sometimes block IMAP/SMTP from unknown IPs).

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "This email domain is not permitted." | The address isn't on the allow-list. Add its domain in **Admin → Domain & App Settings**. |
| "Invalid credentials or mail server unreachable." | Wrong mailbox password, **or** the backend can't reach `mail.terafort.org:993`. Test with the admin **Test Connection** button. |
| Can't send mail | Confirm SMTP is `mail.terafort.org:465` with `secure: true`. Some hosts require the `From` to match the logged-in mailbox (it does by default here). |
| Admin login fails | Use `admin` + the bootstrap password from the first-run backend log; or reset via `ADMIN_DEFAULT_PASSWORD` and a fresh `adminPassword: ""` in `settings.json`. |
| Cookie/login not sticking in dev | Keep `COOKIE_SECURE=false` over http; the cookie is `SameSite=Lax` in dev, `Strict` in production (HTTPS). |
| Connection works in browser but not from a script | The backend must be able to reach the mail server's ports (993/465). Firewalls/sandboxes may block raw outbound TCP. |

---

## 7. Summary

- **Log in with any `@terafort.org` mailbox** (e.g. `it.test@terafort.org`) using its real
  password — TeraMailer authenticates against `mail.terafort.org` IMAP.
- **The admin controls who can log in** via the allowed-domains list (currently `terafort.org`).
- **Servers/ports are pre-set** to your cPanel SSL/TLS values: IMAP `993`, SMTP `465`.
- Change any of this live from the **Admin Panel** — no redeploy needed.
