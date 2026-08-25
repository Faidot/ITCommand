# TeraMailer

A full-stack, Gmail-like webmail application built on **Node.js + Express + imapflow + nodemailer** (backend), **React + Tailwind CSS** (webmail frontend), and a separate **React Admin Panel** for runtime configuration.

TeraMailer connects to any standard IMAP/SMTP mail server. Users sign in with their real mailbox credentials; the backend validates them against IMAP, holds one live connection per session, and proxies folder/message operations. Email HTML is sanitised server-side before rendering. An admin panel lets you edit IMAP/SMTP/security settings, test connectivity, watch active sessions, and read logs — all without restarting the server.

```
teramailer/
├── backend/     Express API (IMAP/SMTP, auth, admin)   → port 5000
├── frontend/    Webmail SPA (React + Tailwind)         → port 3000 (dev)
├── admin/       Admin Panel SPA (React + Tailwind)     → port 3001 (dev), served at /admin in prod
├── nginx.conf   Example reverse-proxy config
└── README.md
```

---

## Features

**Webmail**
- IMAP folder tree (Inbox, Starred, Sent, Drafts, Spam, Trash, Archive + custom) with unread badges
- Paginated message list (25/page), read/unread state, star, multi-select bulk actions
- Full message reader with sanitised HTML body rendered in an isolated iframe
- Compose / Reply / Reply-All / Forward with a Tiptap rich-text editor and drag-drop attachments
- Attachment download (streamed from IMAP)
- IMAP `SEARCH` from the top bar
- Real-time new-mail notifications via Server-Sent Events backed by IMAP `IDLE`
- Responsive (mobile sidebar collapses) + light/dark mode

**Admin Panel**
- Separate login (credentials stored as a bcrypt hash in `settings.json`)
- Dashboard: active sessions, IMAP/SMTP connectivity, uptime, recent logins
- Edit IMAP / SMTP / Domain&App / Security settings at runtime
- "Test Connection" / "Send Test Email" buttons
- Active session viewer with force-logout
- Live log viewer (last 500 lines, level filter, auto-refresh)

**Security**
- HTML email sanitised with DOMPurify (server-side) before it ever reaches the browser
- `httpOnly` + `SameSite` session cookies (`secure` in production), Helmet headers
- Rate limiting + per-account lockout on login; CSRF tokens on all state-changing routes
- Passwords are never written to disk — only held in the (server-side) session store and passed through to IMAP/SMTP
- express-validator input validation on all routes

---

## Prerequisites

- **Node.js 18+** (uses modern `imapflow`, `redis`, native `fetch`-era APIs)
- An IMAP + SMTP mail server you can authenticate against
- **Redis** (optional) — for a production-grade session store. Without it the backend
  falls back to an in-memory store (fine for development, lost on restart).

---

## Quick start (development)

Open three terminals.

### 1. Backend
```bash
cd backend
cp .env.example .env          # then edit SESSION_SECRET etc.
npm install
npm run dev                   # http://localhost:5000
```
On first start the backend bootstraps an admin password and logs it:
```
[WARN] Admin password bootstrapped. Username "admin", password "admin123". Change it from the admin Security page.
```
Set `ADMIN_DEFAULT_PASSWORD` in `.env` to choose a different initial password.

Then configure your mail server: log into the admin panel and set IMAP/SMTP host/port,
**or** edit `backend/src/config/settings.json` directly before starting.

### 2. Webmail frontend
```bash
cd frontend
cp .env.example .env          # VITE_API_URL=http://localhost:5000
npm install
npm run dev                   # http://localhost:3000
```

### 3. Admin panel
```bash
cd admin
cp .env.example .env          # VITE_API_URL=http://localhost:5000
npm install
npm run dev                   # http://localhost:3001/admin
```

Sign into the webmail at `http://localhost:3000` with a real mailbox address
(its domain must be in `app.allowedDomains`). Sign into the admin at
`http://localhost:3001/admin` with `admin` / your bootstrap password.

---

## Configuration

Runtime config lives in `backend/src/config/settings.json` and is editable from the
admin panel (changes apply live — the IMAP pool and SMTP transport read it per
operation). Secrets in `.env` are read only at boot.

### `settings.json`
```jsonc
{
  "imap":  { "host": "mail.terafort.com", "port": 993, "tls": true, "timeout": 30000, "maxConnections": 50 },
  "smtp":  { "host": "mail.terafort.com", "port": 587, "secure": false, "requireTLS": true, "fromName": "TeraMailer", "fromAddress": "" },
  "app":   { "name": "TeraMailer", "domain": "terafort.com", "allowedDomains": ["terafort.com"], "logo": "/logo.png", "maxUploadMb": 25 },
  "security": { "sessionTTL": 86400, "maxLoginAttempts": 5, "lockoutDuration": 900, "ipWhitelist": [], "adminUsername": "admin", "adminPassword": "<bcrypt-hash>" }
}
```

### Backend `.env`
| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5000` | HTTP port |
| `NODE_ENV` | `development` | `production` enables secure cookies + static serving |
| `SESSION_SECRET` | — | **set a long random value** (`openssl rand -hex 32`) |
| `REDIS_URL` | `redis://localhost:6379` | optional; falls back to in-memory if unreachable |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3001` | allowed browser origins (credentials) |
| `ADMIN_DEFAULT_PASSWORD` | `admin123` | used only to bootstrap the admin hash on first run |
| `COOKIE_SECURE` | `false` | force `true` behind HTTPS in prod (auto-true when `NODE_ENV=production`) |
| `MAX_UPLOAD_MB` | `25` | also configurable via admin Domain settings |

### Frontend / Admin `.env`
| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:5000` | backend base URL |

---

## Production build & deploy

Build the two SPAs, then run the backend in production mode — it serves the
webmail at `/` and the admin panel at `/admin` from their `dist/` folders.

```bash
# Build frontends
cd frontend && npm install && npm run build      # -> frontend/dist
cd ../admin  && npm install && npm run build      # -> admin/dist  (Vite base '/admin/')

# Run backend in production
cd ../backend
npm install --omit=dev
NODE_ENV=production COOKIE_SECURE=true npm start   # serves API + both SPAs on :5000
```

For production also point `VITE_API_URL` at your public origin **before building**
(e.g. `https://mail.terafort.com`), or leave it same-origin if everything is served
by the backend behind one domain.

Put the whole thing behind nginx for TLS termination — see [`nginx.conf`](nginx.conf).

### Recommended: run with a process manager
```bash
npm install -g pm2
cd backend && NODE_ENV=production COOKIE_SECURE=true pm2 start src/app.js --name teramailer
pm2 save && pm2 startup
```

---

## API overview

All endpoints are under `/api`. State-changing requests require the `x-csrf-token`
header (token issued at login / `GET /api/auth/me`). Cookies are sent with
`withCredentials`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Validate via IMAP, create session |
| POST | `/api/auth/logout` | Close IMAP connection, destroy session |
| GET | `/api/auth/me` | Current user + CSRF token |
| GET | `/api/folders` | Folder tree with unread/total counts |
| GET | `/api/messages` | Paginated list (`?folder=&page=&limit=&search=`) |
| GET | `/api/messages/:uid` | Full message (parsed + sanitised) |
| GET | `/api/messages/:uid/attachments/:part` | Stream attachment |
| GET | `/api/messages/events` | SSE stream (IMAP IDLE) |
| POST | `/api/messages/move` · `/delete` · `/flag` | Mutations |
| POST | `/api/send` · `/send/reply` · `/send/forward` | Send mail (multipart) |
| GET/POST | `/api/admin/*` | Admin config, tests, sessions, logs (admin session) |

---

## Architecture notes

- **One IMAP connection per session** (`imapClient.js`), stored in a `Map` keyed by
  session id, created lazily and reconnected on demand. Mailbox operations run inside
  `getMailboxLock` so they're serialised per connection.
- **IDLE → SSE**: imapflow auto-idles on the selected mailbox and emits `exists`/`expunge`
  events, which `idleService.js` fans out to the browser over SSE.
- **Session store**: Redis if reachable, else in-memory. Active-session metadata for the
  admin panel is tracked in a store-agnostic `sessionRegistry`.
- **HTML safety**: bodies are parsed with `mailparser`, inline `cid:` images are rewritten
  to the attachment endpoint, and the result is sanitised with DOMPurify and rendered in a
  sandboxed iframe.

---

## Troubleshooting

- **Login fails / "mail server unreachable"** — verify IMAP host/port/TLS in the admin
  panel (use *Test Connection*) and that the email domain is in `allowedDomains`.
- **Cookie not set in dev** — keep `COOKIE_SECURE=false` over plain http; the cookie is
  `SameSite=Lax` in development, `Strict` in production.
- **CORS errors** — add your frontend origin(s) to `CORS_ORIGINS`.
- **No real-time updates** — SSE needs the cookie; ensure the frontend origin is allowed and
  that no proxy buffers `text/event-stream` (see `nginx.conf` — `proxy_buffering off`).
- **Redis warnings** — harmless in dev; the server falls back to the in-memory store.

---

## License

MIT — provided as a production-quality starting point. Review the security model against
your own threat model before deploying publicly.
