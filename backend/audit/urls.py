from django.urls import path

from .views import AuditLogListView

# Mounted at /api/staff/ in kakicare/urls.py — staff-only audit log.
urlpatterns = [
    path('audit-log/', AuditLogListView.as_view(), name='audit-log-list'),
]
