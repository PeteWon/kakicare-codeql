"""
Django settings for the KakiCare project.

Secrets and environment-specific values are read from environment variables
(loaded from a local .env in development via django-environ). Nothing sensitive
is hardcoded here — see .env.example for the variables this project expects.
"""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Environment loading -----------------------------------------------------
# django-environ reads OS environment variables and an optional local .env file.
# Defaults below are DEV-FRIENDLY ONLY; production must supply real values.
env = environ.Env(
    DEBUG=(bool, False),  # SECURITY: default False — must be False in production.
    ALLOWED_HOSTS=(list, []),
)
environ.Env.read_env(BASE_DIR / '.env')

# SECURITY: the secret key is REQUIRED from the environment — never hardcoded or
# committed. Rotating it invalidates sessions and signed tokens.
SECRET_KEY = env('SECRET_KEY')

# SECURITY WARNING: DEBUG must be False in production (it leaks stack traces and
# settings). Controlled by env so local dev can enable it.
DEBUG = env('DEBUG')

ALLOWED_HOSTS = env('ALLOWED_HOSTS')


# --- Applications ------------------------------------------------------------

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'rest_framework',
    'django_otp',  # TOTP MFA framework (installed; no MFA logic wired yet).
    'django_otp.plugins.otp_totp',  # TOTP device plugin.

    # Local apps
    'accounts.apps.AccountsConfig',
    'volunteers.apps.VolunteersConfig',
    'seniors.apps.SeniorsConfig',
    'matching.apps.MatchingConfig',
    'sessions.apps.SessionsConfig',  # label overridden to 'befriending_sessions'
    'audit.apps.AuditConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    # django-otp: sets request.user.is_verified() based on a verified TOTP
    # device. Installed now; enforcement (requiring MFA for staff) comes later.
    'django_otp.middleware.OTPMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'kakicare.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'kakicare.wsgi.application'


# --- Database ----------------------------------------------------------------
# PostgreSQL. Credentials come from the environment (defaults are for local dev
# convenience only; production must set them explicitly).
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('POSTGRES_DB', default='kakicare'),
        'USER': env('POSTGRES_USER', default='kakicare'),
        'PASSWORD': env('POSTGRES_PASSWORD', default=''),
        'HOST': env('POSTGRES_HOST', default='localhost'),
        'PORT': env('POSTGRES_PORT', default='5432'),
    }
}


# --- Authentication ----------------------------------------------------------

# Custom user model: email is the login identifier (no username).
AUTH_USER_MODEL = 'accounts.User'

# SECURITY (SR-AUTH): Argon2id is the first/default password hasher. Django's
# Argon2PasswordHasher uses the Argon2id variant. Hashers listed after it are
# kept so existing hashes (if any) can still be verified and transparently
# upgraded on next login.
PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.Argon2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher',
    'django.contrib.auth.hashers.BCryptSHA256PasswordHasher',
    'django.contrib.auth.hashers.ScryptPasswordHasher',
]

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
     'OPTIONS': {'min_length': 12}},  # SR-AUTH: minimum length enforced server-side.
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


# --- Django REST Framework ---------------------------------------------------
# Secure-by-default posture: require authentication everywhere unless a view
# explicitly opts out. Session auth pairs with the HttpOnly session cookie.
# (No endpoints exist yet — this only sets the default policy.)
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}


# --- Security settings -------------------------------------------------------
# Several are relaxable via env for local HTTP development, but default to the
# secure value so production is safe unless explicitly loosened.

# Session cookie: not readable by JavaScript (mitigates token theft via XSS).
SESSION_COOKIE_HTTPONLY = True
# Send the session cookie only over HTTPS. Defaults to True in production
# (i.e. when DEBUG is False); can be relaxed for local HTTP via env.
SESSION_COOKIE_SECURE = env.bool('SESSION_COOKIE_SECURE', default=not DEBUG)
# Lax SameSite: cookie withheld on cross-site sub-requests (CSRF mitigation)
# while still sent on top-level navigations.
SESSION_COOKIE_SAMESITE = 'Lax'

# CSRF cookie over HTTPS only in production.
CSRF_COOKIE_SECURE = env.bool('CSRF_COOKIE_SECURE', default=not DEBUG)

# HSTS: instruct browsers to use HTTPS only. 0 in dev; one year in prod by
# default. Only takes effect over HTTPS responses.
SECURE_HSTS_SECONDS = env.int('SECURE_HSTS_SECONDS', default=0 if DEBUG else 31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG

# Send X-Content-Type-Options: nosniff (stops browsers MIME-sniffing responses).
SECURE_CONTENT_TYPE_NOSNIFF = True

# Deny framing entirely (clickjacking protection).
X_FRAME_OPTIONS = 'DENY'


# --- File uploads (volunteer documents) --------------------------------------
# SECURITY (SR-DATA-03): uploaded identity/declaration documents must be stored
# OUTSIDE the web root and never served directly by the web server. MEDIA_ROOT
# points to a private directory; files are only ever returned via an
# authenticated, authorised endpoint (to be built later). There is intentionally
# no public MEDIA_URL static mapping for these files.
MEDIA_ROOT = env('MEDIA_ROOT', default=str(BASE_DIR.parent / 'private_media'))


# --- Internationalization ----------------------------------------------------

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Singapore'
USE_I18N = True
USE_TZ = True


# --- Static files ------------------------------------------------------------

STATIC_URL = 'static/'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# --- Email -------------------------------------------------------------------
# SR-DATA: raw verification tokens appear only in email bodies, never in logs
# or the database. For local dev, emails are printed to the console so no SMTP
# setup is needed. For production, switch to an SMTP or transactional provider
# (e.g. SES, SendGrid) by setting EMAIL_BACKEND and the associated SMTP vars.
EMAIL_BACKEND = env(
    'EMAIL_BACKEND',
    default='django.core.mail.backends.console.EmailBackend',
)
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='noreply@kakicare.example')


# --- Frontend ----------------------------------------------------------------
# Used when constructing links in outgoing emails (e.g. email verification).
FRONTEND_BASE_URL = env('FRONTEND_BASE_URL', default='http://localhost:5173')
