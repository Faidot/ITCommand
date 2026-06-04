# IT Command - Backend

The enterprise-grade backend for the IT Command Platform built with Django 5 and Django REST Framework.

## Features
- **Asset Management API**: Endpoints for tracking inventory, assignments, and histories.
- **Finance API**: Complete suite for budgets, expenses, petty cash, and recurring bills.
- **Secure Vault API**: Military-grade AES-256 encryption via Cryptography for storing passwords.
- **Reporting Engine**: Dynamic Excel exports and comprehensive JSON dashboards.
- **Role-Based Access Control**: Granular permissions (Superadmin, Admin, Manager, Viewer).
- **Audit Logging**: Comprehensive JSON tracking for all creation, updates, and deletions.

## Setup & Installation

### 1. Environment Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Environment Variables

Create a `.env` file in the root directory:
```env
SECRET_KEY=your_secure_django_secret_key
DEBUG=True
VAULT_ENCRYPTION_KEY=your_32_urlsafe_base64_encoded_fernet_key
```
*Note: To generate a Vault key, run `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`*

### 3. Database Migration

```bash
python3 manage.py makemigrations
python3 manage.py migrate
```

### 4. Run Server

```bash
# Create a superuser account for the dashboard
python3 manage.py createsuperuser

# Start the development server
python3 manage.py runserver 8000
```
