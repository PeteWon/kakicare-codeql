from django.urls import path

from .views import ApplicationDecisionView, ApplicationDetailView, ApplicationListView

# Mounted at /api/staff/ in kakicare/urls.py
urlpatterns = [
    path('applications/', ApplicationListView.as_view(), name='staff-applications-list'),
    path('applications/<int:pk>/', ApplicationDetailView.as_view(), name='staff-applications-detail'),
    path('applications/<int:pk>/decision/', ApplicationDecisionView.as_view(), name='staff-applications-decision'),
]
