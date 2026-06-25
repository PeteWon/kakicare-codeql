from django.urls import path

from .views import MFAResetResolveView

# Mounted at /api/staff/ in kakicare/urls.py
urlpatterns = [
    path(
        'mfa-reset/requests/<int:pk>/resolve/',
        MFAResetResolveView.as_view(),
        name='staff-mfa-reset-resolve',
    ),
]