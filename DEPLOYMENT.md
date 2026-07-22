# ITCommand — Deployment Guide (Docker)

This guide explains how to run the whole ITCommand platform with Docker and how
to deploy it to another server (e.g. a fresh **Ubuntu** machine).

The entire stack is containerized and orchestrated by a single
[`docker-compose.yml`](docker-compose.yml). A single root [`.env`](.env.example)
file holds all configuration.

---

## 1. Architecture

```
                         ┌─────────────────────────────────────────┐
                         │                 nginx                    │
   Browser  ───────────► │  :80  (the only published port)          │
                         │                                          │
                         │   /api/  /admin/  ──►  backend  (Django)  │
                         │   /static/ /media/ ──►  shared volumes    │
                         │   everything else  ──►  frontend (Next.js)│
                         └───────────────┬──────────────┬───────────┘
                                         │              │
                              ┌──────────▼───┐   ┌──────▼────────┐
                              │  backend     │   │   frontend    │
                              │ Django +     │   │  Next.js      │
                              │ Gunicorn     │   │  (standalone) │
                              │  :8000       │   │   :3000       │
                              └──────┬───────┘   └───────────────┘
                                     │
                              ┌──────▼───────┐
                              │  db (Postgres)│
                              └──────────────┘
```

**Services** (defined in `docker-compose.yml`):

| Service    | Image / build              | Role                                             | Published |
|------------|----------------------------|--------------------------------------------------|-----------|
| `db`       | `postgres:16-alpine`       | PostgreSQL database (data in a named volume)      | no        |
| `backend`  | `itcommand_backend/`       | Django REST API + admin, served by Gunicorn       | no        |
| `automation` | backend image            | Persistent runner for finance, alerts, renewals, email, and ping checks | no |
| `frontend` | `itcommand_frontend/`      | Next.js app (production standalone build)          | no        |
| `nginx`    | `nginx:1.27-alpine`        | Reverse proxy / single entry point + static files | **yes**   |

Only **nginx** is exposed (port `${HTTP_PORT}`, default `80`). The frontend
talks to the API at the relative path `/api`, so the app is **same-origin** —
no CORS issues and the images run on **any** domain or IP **without rebuilding**.

---

## 2. Prerequisites on the target server

A Linux server (Ubuntu 22.04 / 24.04 recommended) with **Docker Engine** and the
**Docker Compose plugin**.

Install on Ubuntu:

```bash
# Docker's official convenience script
curl -fsSL https://get.docker.com | sudo sh

# Allow your user to run docker without sudo (log out/in afterwards)
sudo usermod -aG docker $USER

# Verify
docker --version
docker compose version
```

> The Compose plugin (`docker compose`, two words) is included by the script
> above. If you only have the legacy `docker-compose` (one word), the commands
> below still work — just replace `docker compose` with `docker-compose`.

---

## 3. Deploy to a new server — step by step

### 3.1 Get the code onto the server

```bash
# Option A — clone with git
git clone <your-repo-url> itcommand
cd itcommand

# Option B — copy from your machine with rsync/scp
# rsync -av --exclude node_modules --exclude venv ./IT/  user@server:/home/user/itcommand/
```

### 3.2 Create and edit the environment file

```bash
cp .env.example .env
nano .env        # or vim / your editor of choice
```

Fill in **at least** these values (see the full reference in section 6):

```ini
# A long random string:  python3 -c "import secrets; print(secrets.token_urlsafe(50))"
SECRET_KEY=...

DEBUG=False

# Your server's public IP and/or domain (comma-separated)
ALLOWED_HOSTS=your-server-ip,your-domain.com

# Same value(s) WITH scheme — required for admin login when DEBUG=False
CSRF_TRUSTED_ORIGINS=http://your-server-ip,https://your-domain.com

# A Fernet key:  python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Keep this safe and NEVER change it once vault data exists.
VAULT_ENCRYPTION_KEY=...

# Database
DB_NAME=itcommand
DB_USER=itcommand
DB_PASSWORD=a-strong-password
```

> Don't have Python on the server to generate keys? Generate them on any machine,
> or run them inside a container:
> `docker run --rm python:3.12-slim python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

### 3.3 Build and start everything

```bash
docker compose up -d --build
```

This builds the backend and frontend images, starts PostgreSQL, runs database
**migrations and collectstatic automatically** (via the backend entrypoint),
then starts Gunicorn, the automation runner, Next.js, and nginx. The automation
service waits until the backend is healthy, so migrations finish first.

Check status and logs:

```bash
docker compose ps
docker compose logs -f          # all services; Ctrl-C to stop following
docker compose logs -f backend  # just one service
docker compose logs -f automation
```

### 3.4 Create your first admin user

```bash
docker compose exec backend python manage.py createsuperuser
```

### 3.5 Open the app

- App:        `http://your-server-ip/`
- Django admin: `http://your-server-ip/admin/`

If port 80 is taken, set `HTTP_PORT=8080` in `.env`, re-run
`docker compose up -d`, and use `http://your-server-ip:8080/`.

---

## 4. Day-2 operations

| Task                         | Command                                                            |
|------------------------------|-------------------------------------------------------------------|
| View logs                    | `docker compose logs -f [service]`                                 |
| Stop (keep data)             | `docker compose down`                                              |
| Start again                  | `docker compose up -d`                                             |
| Restart one service          | `docker compose restart backend`                                  |
| Rebuild after code changes   | `docker compose up -d --build`                                     |
| Run a management command     | `docker compose exec backend python manage.py <cmd>`              |
| Open a DB shell              | `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` |
| Run due automation once      | `docker compose exec backend python manage.py run_automation --once` |
| Stop **and delete data**     | `docker compose down -v`  ⚠️ removes the database & media volumes |

### Updating to a new version

```bash
git pull                      # or copy new code over
docker compose up -d --build  # rebuilds changed images, re-runs migrations
```

Migrations run automatically on every backend start, so a rebuild is all you
need.

### Automation runner

The `automation` service stays running and executes the configured daily tasks
once per local calendar day. Subscription reminders run on their own shorter
interval so same-day subscription changes are picked up without rerunning
finance or other daily work. Successful daily/monthly runs are recorded in
`AppSettings`, so restarting the container does not repeat them. Network pings
run on their configured interval and record status transitions in device
history. View its output with `docker compose logs -f automation`.

The monthly finance email is disabled until SMTP is configured. Set
`AUTOMATION_EMAIL_REPORT_ENABLED=True` only after filling the `EMAIL_*` values.
For an immediate diagnostic run:

```bash
docker compose exec backend python manage.py run_automation --once
```

### Database backup & restore

```bash
# Backup to a file on the host
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup_$(date +%F).sql

# Restore from a backup file
cat backup_2026-06-30.sql | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Media uploads live in the `media_volume` Docker volume. To back those up:

```bash
docker run --rm -v it_media_volume:/data -v "$PWD":/backup alpine \
  tar czf /backup/media_backup.tar.gz -C /data .
```

> The volume name is prefixed with the compose project name (the folder name).
> Run `docker volume ls` to see the exact name.

---

## 5. HTTPS (required for production)

The stack serves plain HTTP on the chosen port for local development. Because
logins, JWTs, vault unlock passwords, and revealed secrets cross this connection,
put every production deployment behind TLS. You can either:

1. **Put it behind a reverse proxy you already run** (Caddy, Traefik, or an
   nginx on the host) that terminates TLS and forwards to `HTTP_PORT`. Add the
   bare domain to `ALLOWED_HOSTS` and `https://domain` to
   `CSRF_TRUSTED_ORIGINS`. nginx preserves the trusted proxy's
   `X-Forwarded-Proto` header for Django.

2. **Use a cloud load balancer** that terminates TLS in front of the server.

For a single-box setup, **Caddy** in front is the simplest: it gets and renews
Let's Encrypt certificates automatically and proxies to `localhost:${HTTP_PORT}`.

After HTTPS works end-to-end, enable `SECURE_SSL_REDIRECT`,
`SESSION_COOKIE_SECURE`, and `CSRF_COOKIE_SECURE`. Start HSTS with a short
`SECURE_HSTS_SECONDS`, verify it carefully, then increase it. Keep nginx's host
port firewalled from the public when another proxy is the trusted entry point.

---

## 6. Environment variable reference

All variables live in the root `.env` (see [`.env.example`](.env.example)).

| Variable               | Required | Example / default                  | Purpose                                                        |
|------------------------|----------|------------------------------------|----------------------------------------------------------------|
| `HTTP_PORT`            | no       | `80`                               | Host port nginx publishes.                                     |
| `SECRET_KEY`           | **yes**  | _(random 50+ chars)_               | Django cryptographic signing key.                              |
| `DEBUG`                | **yes**  | `False`                            | Must be `False` in production.                                 |
| `TIME_ZONE`            | no       | `UTC`                              | IANA timezone used by scheduled daily/monthly work.            |
| `ALLOWED_HOSTS`        | **yes**  | `1.2.3.4,itcommand.example.com`    | Hosts/domains Django will serve (comma-separated).             |
| `CSRF_TRUSTED_ORIGINS` | prod     | `https://itcommand.example.com`    | Origins (with scheme) trusted for admin/CSRF.                  |
| `CORS_ALLOWED_ORIGINS` | no       | `http://localhost:3000`            | Only needed if the frontend runs on a different origin.        |
| `VAULT_ENCRYPTION_KEY` | **yes**  | _(Fernet key)_                     | Encrypts vault secrets. Never change after data is saved.      |
| `DB_NAME`              | **yes**  | `itcommand`                        | PostgreSQL database name.                                      |
| `DB_USER`              | **yes**  | `itcommand`                        | PostgreSQL user.                                               |
| `DB_PASSWORD`          | **yes**  | _(strong password)_                | PostgreSQL password.                                           |
| `GUNICORN_WORKERS`     | no       | `3`                                | Backend worker processes — roughly `(2 × CPU cores) + 1`.      |
| `GUNICORN_TIMEOUT`     | no       | `120`                              | Maximum request duration in seconds.                           |
| `NEXT_PUBLIC_API_URL`  | no       | `/api`                             | API base baked into the frontend. Keep `/api` for same-origin. |

Security variables default to local-development-safe values:

| Variable | Production value | Purpose |
|----------|------------------|---------|
| `SECURE_SSL_REDIRECT` | `True` after TLS works | Redirect application requests to HTTPS. |
| `SESSION_COOKIE_SECURE` | `True` | Never send admin session cookies over HTTP. |
| `CSRF_COOKIE_SECURE` | `True` | Never send CSRF cookies over HTTP. |
| `SECURE_HSTS_SECONDS` | increase carefully from a short value | Tell browsers to require HTTPS. |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS` / `SECURE_HSTS_PRELOAD` | opt in only after review | Extend HSTS scope/preload. |

Automation variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTOMATION_DAILY_COMMANDS` | finance/license/subscription/contract commands | Comma-separated management commands run once per day. If you pin this in `.env`, newly added commands (e.g. `auto_renew_subscriptions`) are **not** picked up automatically — add them by hand. |
| `AUTOMATION_INTERVAL_COMMANDS` | `check_subscription_alerts` | Idempotent commands run independently on the short interval. |
| `AUTOMATION_INTERVAL_SECONDS` | `300` | Seconds between interval-command runs. |
| `AUTOMATION_POLL_SECONDS` | `60` | Runner wake-up interval. |
| `AUTOMATION_RETRY_SECONDS` | `300` | Backoff after a failed command. |
| `AUTOMATION_PING_ENABLED` | `True` | Enable network reachability checks. |
| `PING_CHECK_INTERVAL_SECONDS` | `300` | Seconds between ping sweeps. |
| `AUTOMATION_EMAIL_REPORT_ENABLED` | `False` | Enable the monthly finance email after SMTP setup. |
| `FINANCE_REPORT_DAY` | `1` | Local day of month (1–28); missed days catch up after restart. |

Email delivery uses `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`,
`EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `EMAIL_USE_SSL`, and
`DEFAULT_FROM_EMAIL`. See `.env.example` for a complete template.

> `DB_HOST` and `DB_PORT` are **not** needed in `.env` — Compose sets them to the
> internal `db` service automatically.

---

## 7. Local development with Docker

The same setup runs locally. From the repo root:

```bash
cp .env.example .env       # generate fresh local SECRET_KEY and vault key
# (ensure ALLOWED_HOSTS includes localhost,127.0.0.1)
docker compose up -d --build
docker compose exec backend python manage.py createsuperuser
```

Open `http://localhost/`.

> Prefer running without Docker for active development? See the non-Docker
> instructions in [README.md](README.md) (separate `venv` backend on `:8000`
> and `npm run dev` frontend on `:3000`).

### Keep secrets and runtime data out of Git

The ignore rules cover `.env`, virtual environments, SQLite databases, media,
logs, exports, and build caches. Ignore rules do not remove files that were
already tracked. Audit before every release:

```bash
git ls-files | grep -E '(^|/)(\.env|db\.sqlite3|media/|venv/)|\.sql$'
```

If that lists runtime data, remove it from the index with `git rm --cached`
(not plain `rm` if you need the local copy), rotate any exposed secrets, and
follow your incident process for repository-history cleanup.

---

## 8. Troubleshooting

**`DisallowedHost` / `Bad Request (400)`**
Your host/IP isn't in `ALLOWED_HOSTS`. Add it (comma-separated), then
`docker compose up -d` to apply.

**Admin login fails with a CSRF error (`403`)**
Add the exact origin you're visiting (with scheme, e.g. `http://1.2.3.4`) to
`CSRF_TRUSTED_ORIGINS` and restart the backend.

**`502 Bad Gateway` from nginx**
A backend/frontend container is still starting or crashed. Check
`docker compose ps` and `docker compose logs backend frontend`.

**Port is already allocated**
Something else uses port 80. Set `HTTP_PORT=8080` in `.env` and re-run
`docker compose up -d`.

**Admin pages look unstyled**
Static files weren't collected. They are collected automatically on backend
start; check `docker compose logs backend` for the "Collecting static files"
step, or run `docker compose exec backend python manage.py collectstatic --noinput`.

**Database connection refused on first boot**
The backend waits for Postgres to be healthy before starting. If it raced, just
`docker compose up -d` again.

**I changed `VAULT_ENCRYPTION_KEY` and vault entries won't decrypt**
That key must stay constant. Restore the original key to read existing secrets.

---

## 9. (Optional) Importing existing SQLite data

The Docker stack uses PostgreSQL. If you have an existing dev `db.sqlite3` and
want its data on the new server, dump it before switching DBs:

```bash
# On the old/dev setup (SQLite), export data:
python manage.py dumpdata --natural-foreign --natural-primary \
  -e contenttypes -e auth.permission -e admin.logentry \
  -e sessions.session > datadump.json

# Copy the dump into the already-built container, load it, then remove the copy:
docker compose cp datadump.json backend:/tmp/datadump.json
docker compose exec -T backend python manage.py loaddata /tmp/datadump.json
docker compose exec -T backend rm /tmp/datadump.json
```
