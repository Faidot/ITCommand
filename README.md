# IT Command

IT Command is an enterprise-grade full-stack IT Department Management platform. It tracks assets, software subscriptions, IT budgets and expenses, secure credentials, employees, and departments in one place.

## 🚀 Features

> 📖 **Full module-by-module feature reference:** see [FEATURES.md](FEATURES.md) for a detailed breakdown of every module (data model → API → UI → automation), with the Finance module documented in depth.

- **Asset Management**: Track inventory, assignments, notes, and lifecycle history.
- **Software Subscriptions**: Manage cloud, AI, and SaaS services with ownership, spend dashboards, renewal/cancellation reminders, budget alerts, and PDF/Excel reports.
- **Finance Module**: Manage budgets, track expenses, log petty cash, and schedule recurring bills.
- **Secure Vault**: Encrypted credential and workspace management.
- **Dashboard & Reporting**: Interactive charts and data exports (Excel) for deep insights.
- **RBAC (Role-Based Access Control)**:
  - `SUPERADMIN`: Full system access, App Settings, and Audit Logs.
  - `ADMIN`: Full access (cannot manage other admins).
  - `MANAGER`: Write access to Finance, Assets, and Vault; Read-only Users.
  - `VIEWER`: Strictly read-only access globally; restricted entirely from Vault.
- **Audit Logging**: Comprehensive JSON diff tracking for all creation, updates, and deletions across the platform.

## 🛠 Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, Zustand, Recharts, React Hook Form + Zod.
- **Backend**: Django 5, Django REST Framework, SimpleJWT, Cryptography (Fernet AES-256).
- **Database**: PostgreSQL / SQLite (Development).
- **Deployment**: Docker, Docker Compose, nginx, Gunicorn — see [DEPLOYMENT.md](DEPLOYMENT.md).

## 🐳 Quick Start with Docker (recommended)

The whole stack (PostgreSQL + Django/Gunicorn + scheduled automation + Next.js + nginx) is
containerized. From the repository root:

```bash
cp .env.example .env          # then edit .env (keys, ALLOWED_HOSTS, DB password)
docker compose up -d --build  # build & start everything
docker compose exec backend python manage.py createsuperuser
```

Open **http://localhost/** (admin at **/admin/**). Migrations and static-file
collection run automatically on startup. The `automation` service runs finance
posting, subscription/license renewals and alerts, contract checks, and network reachability checks; inspect it with
`docker compose logs -f automation`.

Never commit `.env`, SQLite databases, uploaded media, virtual environments, or
database exports. If one was ever tracked, adding it to `.gitignore` is not
enough: remove it from the index/history as appropriate and rotate exposed keys.

> 📖 **Deploying to another server (e.g. Ubuntu)?** Follow the full step-by-step
> guide in **[DEPLOYMENT.md](DEPLOYMENT.md)** — prerequisites, environment
> variables, HTTPS, backups, and troubleshooting.

## 📦 Manual Setup & Installation (without Docker)

### 1. Backend Setup (Django)

```bash
cd itcommand_backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Environment Variables
# Create a .env file in the backend root:
SECRET_KEY=your_django_secret_key
DEBUG=True
VAULT_ENCRYPTION_KEY=your_32_urlsafe_base64_encoded_fernet_key # Generate via: python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# Apply the repository's reviewed migrations
python3 manage.py migrate

# Create Superuser
python3 manage.py createsuperuser

# Start Server
python3 manage.py runserver 8000
```

### 2. Frontend Setup (Next.js)

```bash
cd itcommand_frontend

# Install dependencies
npm install

# Environment Variables
# Create a .env.local file in the frontend root:
NEXT_PUBLIC_API_URL=http://localhost:8000/api

# Start Development Server
npm run dev
```

## 🔐 Environment Variables Required

### Backend `.env`
- `SECRET_KEY`: Django secret key.
- `VAULT_ENCRYPTION_KEY`: A 32-urlsafe-base64-encoded string used for encrypting vault passwords via `cryptography`.

### Frontend `.env.local`
- `NEXT_PUBLIC_API_URL`: The base URL to the Django API (e.g., `http://localhost:8000/api`).

## 📱 Mobile Responsiveness
The platform is optimized for mobile usage out of the box with horizontal scrollable data tables, responsive modal dialogs, and a bottom navigation bar for quick access.

## 📜 License
MIT License
