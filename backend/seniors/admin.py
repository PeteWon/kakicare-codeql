from django.contrib import admin

from .models import Senior

# NOTE: admin registered for dev convenience; may be disabled in production.
# Senior records contain sensitive data — admin access to them is itself
# sensitive and should be tightly restricted (or removed) in production.


@admin.register(Senior)
class SeniorAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'preferred_language', 'is_active', 'created_by')
    list_filter = ('is_active',)
    search_fields = ('full_name',)
