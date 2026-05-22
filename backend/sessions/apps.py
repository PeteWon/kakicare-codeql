from django.apps import AppConfig


class SessionsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'sessions'
    # The Python package is `sessions`, but Django's built-in
    # `django.contrib.sessions` already claims the app label "sessions" and
    # labels must be unique. Override the label so both can coexist; this
    # prefixes our tables (e.g. befriending_sessions_session).
    label = 'befriending_sessions'
    verbose_name = 'Befriending sessions'
