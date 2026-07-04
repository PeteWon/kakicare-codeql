from django.urls import path

from .views import StaffConcernListView, StaffConcernResolveView

# Mounted at /api/staff/ in kakicare/urls.py
urlpatterns = [
    path('concerns/', StaffConcernListView.as_view(), name='staff-concern-list'),
    path('concerns/<uuid:pk>/resolve/', StaffConcernResolveView.as_view(), name='staff-concern-resolve'),
]
