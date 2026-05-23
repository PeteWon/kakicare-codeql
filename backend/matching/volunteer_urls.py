from django.urls import path

from .views import (
    VolunteerMatchAcceptView,
    VolunteerMatchDeclineView,
    VolunteerMatchListView,
)

# Mounted at /api/volunteer/ in kakicare/urls.py
urlpatterns = [
    path('matches/', VolunteerMatchListView.as_view(), name='volunteer-match-list'),
    path('matches/<int:pk>/accept/', VolunteerMatchAcceptView.as_view(), name='volunteer-match-accept'),
    path('matches/<int:pk>/decline/', VolunteerMatchDeclineView.as_view(), name='volunteer-match-decline'),
]
