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
then starts Gunicorn, Next.js, and nginx.

Check status and logs:

```bash
docker compose ps
docker compose logs -f          # all services; Ctrl-C to stop following
docker compose logs -f backend  # just one service
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
| Open a DB shell              | `docker compose exec db psql -U $DB_USER -d $DB_NAME`              |
| Stop **and delete data**     | `docker compose down -v`  ⚠️ removes the database & media volumes |

### Updating to a new version

```bash
git pull                      # or copy new code over
docker compose up -d --build  # rebuilds changed images, re-runs migrations
```

Migrations run automatically on every backend start, so a rebuild is all you
need.

### Database backup & restore

```bash
# Backup to a file on the host
docker compose exec -T db pg_dump -U $DB_USER $DB_NAME > backup_$(date +%F).sql

# Restore from a backup file
cat backup_2026-06-30.sql | docker compose exec -T db psql -U $DB_USER -d $DB_NAME
```

Media uploads live in the `media_volume` Docker volume. To back those up:

```bash
docker run --rm -v it_media_volume:/data -v "$PWD":/backup alpine \
  tar czf /backup/media_backup.tar.gz -C /data .
```

> The volume name is prefixed with the compose project name (the folder name).
> Run `docker volume ls` to see the exact name.

---

## 5. HTTPS (optional but recommended for production)

The stack serves plain HTTP on the chosen port. To add TLS you can either:

1. **Put it behind a reverse proxy you already run** (Caddy, Traefik, or an
   nginx on the host) that terminates TLS and forwards to `HTTP_PORT`. Add your
   `https://domain` to `ALLOWED_HOSTS` (host only) and `CSRF_TRUSTED_ORIGINS`
   (with scheme). The backend already trusts the `X-Forwarded-Proto` header.

2. **Use a cloud load balancer** that terminates TLS in front of the server.

For a single-box setup, **Caddy** in front is the simplest: it gets and renews
Let's Encrypt certificates automatically and proxies to `localhost:${HTTP_PORT}`.

---

## 6. Environment variable reference

All variables live in the root `.env` (see [`.env.example`](.env.example)).

| Variable               | Required | Example / default                  | Purpose                                                        |
|------------------------|----------|------------------------------------|----------------------------------------------------------------|
| `HTTP_PORT`            | no       | `80`                               | Host port nginx publishes.                                     |
| `SECRET_KEY`           | **yes**  | _(random 50+ chars)_               | Django cryptographic signing key.                              |
| `DEBUG`                | **yes**  | `False`                            | Must be `False` in production.                                 |
| `ALLOWED_HOSTS`        | **yes**  | `1.2.3.4,itcommand.example.com`    | Hosts/domains Django will serve (comma-separated).             |
| `CSRF_TRUSTED_ORIGINS` | prod     | `https://itcommand.example.com`    | Origins (with scheme) trusted for admin/CSRF.                  |
| `CORS_ALLOWED_ORIGINS` | no       | `http://localhost:3000`            | Only needed if the frontend runs on a different origin.        |
| `VAULT_ENCRYPTION_KEY` | **yes**  | _(Fernet key)_                     | Encrypts vault secrets. Never change after data is saved.      |
| `DB_NAME`              | **yes**  | `itcommand`                        | PostgreSQL database name.                                      |
| `DB_USER`              | **yes**  | `itcommand`                        | PostgreSQL user.                                               |
| `DB_PASSWORD`          | **yes**  | _(strong password)_                | PostgreSQL password.                                           |
| `GUNICORN_WORKERS`     | no       | `3`                                | Backend worker processes — roughly `(2 × CPU cores) + 1`.      |
| `NEXT_PUBLIC_API_URL`  | no       | `/api`                             | API base baked into the frontend. Keep `/api` for same-origin. |

> `DB_HOST` and `DB_PORT` are **not** needed in `.env` — Compose sets them to the
> internal `db` service automatically.

---

## 7. Local development with Docker

The same setup runs locally. From the repo root:

```bash
cp .env.example .env       # the committed .env already has generated dev keys
# (ensure ALLOWED_HOSTS includes localhost,127.0.0.1)
docker compose up -d --build
docker compose exec backend python manage.py createsuperuser
```

Open `http://localhost/`.

> Prefer running without Docker for active development? See the non-Docker
> instructions in [README.md](README.md) (separate `venv` backend on `:8000`
> and `npm run dev` frontend on `:3000`).

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

# Copy datadump.json into the repo, then load it into the running Postgres stack:
docker compose exec -T backend python manage.py loaddata /app/datadump.json
```

(Place `datadump.json` in `itcommand_backend/` so it's available at `/app/` in
the container.)
