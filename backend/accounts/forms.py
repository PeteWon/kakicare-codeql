"""Admin forms for the custom email-based User.

Django's built-in UserCreationForm/UserChangeForm assume a `username` field, so
we provide our own. Staff accounts are provisioned WITHOUT a password: the admin
only supplies email/name/role, and the new user sets their own password via an
emailed invite link (see accounts.views.issue_and_send_staff_invite). The admin
therefore never knows or transmits a staff password.
"""

from django import forms
from django.contrib.auth.forms import ReadOnlyPasswordHashField

from .models import User


class UserAdminCreationForm(forms.ModelForm):
    """Create a staff User from the admin — no password is set here.

    The account is saved inactive with an unusable password; the invite flow
    (triggered in UserAdmin.save_model) lets the user set their own password.
    """

    class Meta:
        model = User
        fields = ('email', 'full_name', 'role')

    def save(self, commit=True):
        user = super().save(commit=False)
        # No usable password: the user sets one via the emailed invite link.
        # The account stays inactive/unverified until the invite is accepted.
        user.set_unusable_password()
        user.is_active = False
        user.is_email_verified = False
        # Least privilege: staff never get Django admin access.
        user.is_staff = False
        user.is_superuser = False
        if commit:
            user.save()
        return user


class UserAdminChangeForm(forms.ModelForm):
    """Edit a User from the admin without exposing the password hash.

    The password is shown as a read-only hash with a link to the dedicated
    change-password form (Django renders this automatically for this field).
    """

    password = ReadOnlyPasswordHashField(
        label='Password',
        help_text=(
            'Raw passwords are not stored, so there is no way to see this '
            'user’s password. Staff set their own password via the invite link; '
            'use <a href="../password/">this form</a> to override it.'
        ),
    )

    class Meta:
        model = User
        fields = '__all__'
