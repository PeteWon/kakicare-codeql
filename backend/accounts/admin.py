from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .forms import UserAdminChangeForm, UserAdminCreationForm
from .models import EmailVerificationToken, PasswordResetToken, StaffInviteToken, User

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

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        # On creation, email the new staff member an invite to set their password.
        if not change:
            # Imported here to avoid an import cycle at admin load time.
            from .views import issue_and_send_staff_invite
            issue_and_send_staff_invite(obj)
            self.message_user(request, f'Invite email sent to {obj.email}.')

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
