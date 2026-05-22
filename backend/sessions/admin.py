from django.contrib import admin

from .models import Session

# NOTE: admin registered for dev convenience; may be disabled in production.


@admin.register(Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = ('match', 'session_type', 'status', 'scheduled_start', 'scheduled_end')
    list_filter = ('session_type', 'status')
    # The check-in code hash is security-sensitive plumbing — keep it out of the UI.
    exclude = ('checkin_code_hash',)
