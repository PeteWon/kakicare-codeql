from django.urls import path

from audit.views import AuditLogListView

from .views import SeniorDeactivateView, SeniorDetailView, SeniorListCreateView

# Mounted at /api/staff/ in kakicare/urls.py alongside volunteers/staff_urls.py.
urlpatterns = [
    path('seniors/', SeniorListCreateView.as_view(), name='staff-senior-list-create'),
    path('seniors/<int:pk>/', SeniorDetailView.as_view(), name='staff-senior-detail'),
    path('seniors/<int:pk>/deactivate/', SeniorDeactivateView.as_view(), name='staff-senior-deactivate'),
    path('audit-log/', AuditLogListView.as_view(), name='staff-audit-log'),
]
