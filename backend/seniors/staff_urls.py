from django.urls import path

from .views import SeniorDeactivateView, SeniorDetailView, SeniorListCreateView

# Mounted at /api/staff/ in kakicare/urls.py alongside volunteers/staff_urls.py.
# The audit-log route lives in audit/urls.py (also mounted at /api/staff/) — it is
# intentionally NOT duplicated here.
urlpatterns = [
    path('seniors/', SeniorListCreateView.as_view(), name='staff-senior-list-create'),
    path('seniors/<int:pk>/', SeniorDetailView.as_view(), name='staff-senior-detail'),
    path('seniors/<int:pk>/deactivate/', SeniorDeactivateView.as_view(), name='staff-senior-deactivate'),
]
