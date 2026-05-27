from django.contrib import admin

from .models import AuditLogEntry

# NOTE: admin registered for dev convenience; may be disabled in production.


@admin.register(AuditLogEntry)
class AuditLogEntryAdmin(admin.ModelAdmin):
    list_display = ('timestamp', 'user', 'user_role', 'action', 'target_type', 'target_id')
    list_filter = ('user_role', 'action')
    search_fields = ('action', 'target_type', 'target_id')

    # SECURITY (SR-AUD-02): the audit log is append-only. Even in admin, disallow
    # adding, changing, and deleting entries — they are written only via
    # audit.services.record_audit.
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
