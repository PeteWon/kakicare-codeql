from django.urls import path

from .views import (
    VolunteerSessionCheckInView,
    VolunteerSessionCheckOutView,
    VolunteerSessionDetailView,
    VolunteerSessionListCreateView,
)

# Mounted at /api/volunteer/ in kakicare/urls.py
urlpatterns = [
    path('sessions/', VolunteerSessionListCreateView.as_view(), name='volunteer-session-list-create'),
    path('sessions/<int:pk>/', VolunteerSessionDetailView.as_view(), name='volunteer-session-detail'),
    path('sessions/<int:pk>/checkin/', VolunteerSessionCheckInView.as_view(), name='volunteer-session-checkin'),
    path('sessions/<int:pk>/checkout/', VolunteerSessionCheckOutView.as_view(), name='volunteer-session-checkout'),
]
