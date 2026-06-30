#!/bin/sh
# Backend container startup: apply migrations, collect static files, then run
# the Gunicorn application server. Exec'ing Gunicorn makes it PID 1 so it
# receives stop/restart signals from Docker correctly.
set -e

echo "==> Applying database migrations"
python manage.py migrate --noinput

echo "==> Collecting static files"
python manage.py collectstatic --noinput

echo "==> Starting Gunicorn on :8000"
exec gunicorn itcommand_backend.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers "${GUNICORN_WORKERS:-3}" \
    --timeout "${GUNICORN_TIMEOUT:-120}"
