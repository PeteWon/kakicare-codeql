#!/bin/sh
set -e
# Fix ownership of mounted volumes — they may have been initialised by another
# container (e.g. nginx) before this one started, leaving them root-owned.
chown -R app:app /app/staticfiles /app/private_media
python manage.py migrate --noinput
# Idempotent: skips tables that already exist, safe to run on every start.
python manage.py createcachetable
python manage.py collectstatic --noinput
# Drop from root to the app user for the long-running gunicorn process.
exec gosu app "$@"
