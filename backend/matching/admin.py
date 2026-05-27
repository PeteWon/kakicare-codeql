from django.contrib import admin

from .models import Match

# NOTE: admin registered for dev convenience; may be disabled in production.


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = ('volunteer', 'senior', 'status', 'proposed_by', 'created_at')
    list_filter = ('status',)
