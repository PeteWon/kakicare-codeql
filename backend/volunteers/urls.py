from django.urls import path

from .views import DocumentDownloadView, DocumentUploadView, VolunteerProfileView

# Mounted at /api/volunteer/ in kakicare/urls.py
urlpatterns = [
    path('profile/', VolunteerProfileView.as_view(), name='volunteer-profile'),
    path('documents/', DocumentUploadView.as_view(), name='volunteer-documents-upload'),
    path('documents/<int:pk>/download', DocumentDownloadView.as_view(), name='volunteer-document-download'),
]
