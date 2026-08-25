#!/bin/sh
# Fail the deploy rather than start an app whose isolation is decorative.
set -e

echo "==> migrating"
python manage.py migrate --noinput

echo "==> verifying row-level security"
# Refuses to continue if RLS is missing, unforced, or bypassable by this role.
# A silent pass here would mean the database is not enforcing isolation and
# nothing would tell you until someone read someone else's mail.
python manage.py check_rls

echo "==> collecting static"
python manage.py collectstatic --noinput

echo "==> starting gunicorn"
exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers "${GUNICORN_WORKERS:-3}" \
    --timeout 60 \
    --access-logfile - \
    --error-logfile -
