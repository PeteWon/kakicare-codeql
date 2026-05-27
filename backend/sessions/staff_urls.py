from django.urls import path

from .views import (
    StaffSessionCancelView,
    StaffSessionConfirmView,
    StaffSessionDetailView,
    StaffSessionFollowUpView,
    StaffSessionListView,
)

# Mounted at /api/staff/ in kakicare/urls.py
urlpatterns = [
    path('sessions/', StaffSessionListView.as_view(), name='staff-session-list'),
    path('sessions/<int:pk>/', StaffSessionDetailView.as_view(), name='staff-session-detail'),
    path('sessions/<int:pk>/confirm/', StaffSessionConfirmView.as_view(), name='staff-session-confirm'),
    path('sessions/<int:pk>/cancel/', StaffSessionCancelView.as_view(), name='staff-session-cancel'),
    path('sessions/<int:pk>/followup/', StaffSessionFollowUpView.as_view(), name='staff-session-followup'),
]
