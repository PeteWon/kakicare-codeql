from django.contrib import admin

from .models import VolunteerDocument, VolunteerProfile

# NOTE: admin registered for dev convenience; may be disabled in production.


@admin.register(VolunteerProfile)
class VolunteerProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'application_status', 'reviewed_by', 'reviewed_at')
    list_filter = ('application_status',)


@admin.register(VolunteerDocument)
class VolunteerDocumentAdmin(admin.ModelAdmin):
    list_display = ('profile', 'document_type', 'original_filename', 'uploaded_at')
    list_filter = ('document_type',)
