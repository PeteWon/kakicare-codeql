from django.urls import path

from .views import (
    MFAResetResolveView,
    StaffVolunteerDeactivationRequestListView,
    StaffVolunteerDeactivationRequestResolveView,
)

# Mounted at /api/staff/ in kakicare/urls.py
urlpatterns = [
    path(
        'deactivation-requests/',
        StaffVolunteerDeactivationRequestListView.as_view(),
        name='staff-deactivation-request-list',
    ),
    path(
        'deactivation-requests/<int:pk>/resolve/',
        StaffVolunteerDeactivationRequestResolveView.as_view(),
        name='staff-deactivation-request-resolve',
    ),
    path(
        'mfa-reset/requests/<int:pk>/resolve/',
        MFAResetResolveView.as_view(),
        name='staff-mfa-reset-resolve',
    ),
]
