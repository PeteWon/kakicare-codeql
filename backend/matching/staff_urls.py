from django.urls import path

from .views import (
    StaffMatchEndView,
    StaffMatchListCreateView,
    StaffMatchRecordSeniorConfirmView,
)

# Mounted at /api/staff/ in kakicare/urls.py
urlpatterns = [
    path('matches/', StaffMatchListCreateView.as_view(), name='staff-match-list-create'),
    path('matches/<int:pk>/record-senior-confirmation/', StaffMatchRecordSeniorConfirmView.as_view(), name='staff-match-senior-confirm'),
    path('matches/<int:pk>/end/', StaffMatchEndView.as_view(), name='staff-match-end'),
]
