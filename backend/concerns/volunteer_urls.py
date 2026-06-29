from django.urls import path

from .views import VolunteerConcernCreateView

# Mounted at /api/volunteer/ in kakicare/urls.py
urlpatterns = [
    path('concerns/', VolunteerConcernCreateView.as_view(), name='volunteer-concern-create'),
]
