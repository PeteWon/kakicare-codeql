# KakiCare backend — production image (Django + gunicorn).
#
# SECURITY:
# - python:3.11-slim base, kept up to date by rebuilding regularly.
# - Runs as a non-root user inside the container.
# - DEBUG must be False in production; settings.py enforces this via env.
# - Secrets (SECRET_KEY, POSTGRES_PASSWORD, etc.) come from environment
#   variables, never baked into the image. Do NOT COPY a .env file in.

FROM python:3.11-slim AS base

# Avoid Python writing .pyc files and buffering stdout/stderr — both hurt
# Docker logging and waste image space.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System packages: libpq for psycopg, plus build tools only as needed.
# Install, then clean apt lists to keep the image small.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so layer caches when only code changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy source after deps so editing code doesn't bust the deps layer.
COPY . .

# Non-root user (UID 1000 — convention; matches host user mounts cleanly).
RUN useradd --create-home --uid 1000 --shell /bin/bash app \
    && mkdir -p /app/staticfiles /app/private_media \
    && chown -R app:app /app
USER app

EXPOSE 8000

# Gunicorn: 3 workers is sane for a small EC2 (t2.micro / t3.micro class).
# Adjust --workers up if the instance has more cores. The migrate/collectstatic
# steps run in docker-compose.prod.yml's command, not here, so this image can
# be re-used for one-off tasks (e.g. `docker compose run web python manage.py
# createsuperuser`) without forcing a migration.
CMD ["gunicorn", "kakicare.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
