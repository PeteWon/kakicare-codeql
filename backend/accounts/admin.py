from django.contrib import admin

from .models import EmailVerificationToken, PasswordResetToken, User

# NOTE: Django admin is registered for development convenience. We may DISABLE
# the admin entirely in production (it's a large attack surface and we serve a
# separate API/SPA), so do not build operational workflows that depend on it.


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ('email', 'full_name', 'role', 'is_active', 'is_email_verified')
    list_filter = ('role', 'is_active', 'is_email_verified')
    search_fields = ('email', 'full_name')
    # Never expose the password hash in a list/search context.
    exclude = ('password',)


@admin.register(EmailVerificationToken)
class EmailVerificationTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'created_at', 'expires_at', 'used_at')


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'created_at', 'expires_at', 'used_at')
