# KakiCare backend — production image (Django + gunicorn).
#
# SECURITY:
# - python:3.13-slim base, kept up to date by rebuilding regularly. Pinned to
#   3.13 (not 3.14): it is the newest Python on Django 5.2's officially
#   supported matrix (3.10–3.13). 3.14 builds but is not an officially
#   supported Django 5.2 target, so we stay on the supported version.
# - Runs as a non-root user inside the container.
# - DEBUG must be False in production; settings.py enforces this via env.
# - Secrets (SECRET_KEY, POSTGRES_PASSWORD, etc.) come from environment
#   variables, never baked into the image. Do NOT COPY a .env file in.

FROM python:3.13-slim AS base

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
        gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so layer caches when only code changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy source after deps so editing code doesn't bust the deps layer.
COPY . .

# Non-root user (UID 1000). The container starts as root so the entrypoint
# can fix volume ownership (Docker volumes may be initialized by any service
# that mounts them first), then drops to app via gosu for the long-running
# gunicorn process.
RUN useradd --create-home --uid 1000 --shell /bin/bash app \
    && mkdir -p /app/staticfiles /app/private_media \
    && chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "kakicare.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "3", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
