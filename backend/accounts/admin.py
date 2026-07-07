from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from audit.services import record_audit

from .forms import UserAdminChangeForm, UserAdminCreationForm
from .models import (
    EmailVerificationToken,
    GlobalConfiguration,
    PasswordResetToken,
    StaffInviteToken,
    User,
)

# NOTE: the Django admin is mounted at /manage/portal/ and is used operationally
# by superusers to provision staff accounts. Creating a user here saves it
# inactive with no usable password and emails an invite link; the staff member
# sets their own password (HIBP-screened) via that link. Admins are NOT created
# here — they are bootstrapped with `manage.py createsuperuser`.


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    add_form = UserAdminCreationForm
    form = UserAdminChangeForm
    model = User

    list_display = ('email', 'full_name', 'role', 'is_active', 'is_email_verified')
    list_filter = ('role', 'is_active', 'is_email_verified', 'is_staff', 'is_superuser')
    search_fields = ('email', 'full_name')
    # BaseUserAdmin defaults to ordering by 'username', which we don't have.
    ordering = ('email',)
    filter_horizontal = ('groups', 'user_permissions')
    actions = ['resend_staff_invite']

    # Edit view: password is the ReadOnlyPasswordHashField from the change form.
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Profile', {'fields': ('full_name', 'role')}),
        ('Status', {'fields': ('is_active', 'is_email_verified')}),
        ('Permissions', {
            'fields': ('is_staff', 'is_superuser', 'groups', 'user_permissions'),
        }),
        ('Dates', {'fields': ('last_login', 'date_joined')}),
    )

    # Create view: admin supplies only email/name/role. The account is saved
    # inactive with no password; save_model emails the invite link.
    add_fieldsets = (
        (None, {
            'classes': ('wide',),
            'fields': ('email', 'full_name', 'role'),
        }),
    )

    def has_delete_permission(self, request, obj=None):
        # Hard-deleting a user conflicts with the append-only audit log
        # (AuditLogEntry.user is SET_NULL, but audit_auditlogentry has a
        # Postgres trigger blocking all UPDATE/DELETE — see
        # audit/migrations/0002_append_only_triggers.py). Deactivate via
        # is_active instead; audit history for the account is preserved.
        return False

    def save_model(self, request, obj, form, change):
        was_active = User.objects.get(pk=obj.pk).is_active if change else None

        super().save_model(request, obj, form, change)

        # On creation, email the new staff member an invite to set their password.
        if not change:
            # Imported here to avoid an import cycle at admin load time.
            from .views import issue_and_send_staff_invite
            issue_and_send_staff_invite(obj)
            self.message_user(request, f'Invite email sent to {obj.email}.')
            return

        if was_active and not obj.is_active:
            # Access is already cut immediately regardless — DRF's
            # SessionAuthentication rechecks is_active per request. This
            # just clears the now-dead session row (see accounts/sessions.py).
            from .sessions import invalidate_user_sessions
            invalidate_user_sessions(obj.pk)
            record_audit(
                user=request.user,
                action='accounts.user.deactivated',
                target_type='User',
                target_id=str(obj.pk),
                request_ip=request.META.get('REMOTE_ADDR'),
            )
            self.message_user(request, f'{obj.email} deactivated.')
        elif not was_active and obj.is_active:
            record_audit(
                user=request.user,
                action='accounts.user.reactivated',
                target_type='User',
                target_id=str(obj.pk),
                request_ip=request.META.get('REMOTE_ADDR'),
            )

    @admin.action(description='Resend staff invite email')
    def resend_staff_invite(self, request, queryset):
        from .views import issue_and_send_staff_invite
        sent = 0
        for user in queryset:
            # Only meaningful for not-yet-activated staff accounts.
            if not user.is_active and not user.has_usable_password():
                issue_and_send_staff_invite(user)
                sent += 1
        self.message_user(request, f'Re-sent {sent} invite email(s).')


@admin.register(EmailVerificationToken)
class EmailVerificationTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'created_at', 'expires_at', 'used_at')


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'created_at', 'expires_at', 'used_at')


@admin.register(StaffInviteToken)
class StaffInviteTokenAdmin(admin.ModelAdmin):
    list_display = ('user', 'created_at', 'expires_at', 'used_at')


@admin.register(GlobalConfiguration)
class GlobalConfigurationAdmin(admin.ModelAdmin):
    list_display = ('jit_disclosure_window_minutes',)

    def has_add_permission(self, request):
        # Singleton: only allow adding the row if none exists yet.
        if GlobalConfiguration.objects.exists():
            return False
        return super().has_add_permission(request)

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        if not change:
            super().save_model(request, obj, form, change)
            return

        # SR-ADMIN-02: audit-log window changes with before/after values.
        old_val = GlobalConfiguration.objects.get(pk=obj.pk).jit_disclosure_window_minutes
        new_val = obj.jit_disclosure_window_minutes
        super().save_model(request, obj, form, change)

        if old_val != new_val:
            record_audit(
                user=request.user,
                action=f'Changed JIT disclosure window from {old_val} mins to {new_val} mins.',
                target_type='GlobalConfiguration',
                target_id=str(obj.pk),
                request_ip=request.META.get('REMOTE_ADDR'),
            )
            self.message_user(request, 'Configuration updated and change audit-logged.')
