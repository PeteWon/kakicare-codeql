"""Accounts view package.

Previously a single 1,481-line ``accounts/views.py``; split by concern into
auth / mfa / password / registration / deactivation submodules (shared helpers
and throttles live in ``_common``). This package re-exports the same public
names the old module exposed, so ``accounts.urls``, ``accounts.staff_urls``,
``accounts.admin`` and the test suite import from ``accounts.views`` unchanged.
"""

from .auth import LoginView, LogoutView, MeView
from .deactivation import (
    StaffVolunteerDeactivationRequestListView,
    StaffVolunteerDeactivationRequestResolveView,
    VolunteerDeactivationRequestView,
)
from .mfa import (
    MFADisableView,
    MFAResetRequestView,
    MFAResetResolveView,
    MFASetupView,
    MFAStatusView,
    MFAVerifyView,
    StaffMFAResetRequestListView,
    _generate_backup_codes,
)
from .password import (
    ChangePasswordView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
)
from .registration import (
    AcceptInviteView,
    ContactView,
    RegisterView,
    ResendVerificationView,
    VerifyEmailView,
    issue_and_send_staff_invite,
)
from ._common import _hash_token

__all__ = [
    # auth
    'LoginView',
    'LogoutView',
    'MeView',
    # mfa
    'MFASetupView',
    'MFAVerifyView',
    'MFAResetRequestView',
    'MFAResetResolveView',
    'StaffMFAResetRequestListView',
    'MFAStatusView',
    'MFADisableView',
    # password
    'PasswordResetRequestView',
    'PasswordResetConfirmView',
    'ChangePasswordView',
    # registration
    'RegisterView',
    'ResendVerificationView',
    'AcceptInviteView',
    'VerifyEmailView',
    'ContactView',
    'issue_and_send_staff_invite',
    # deactivation
    'VolunteerDeactivationRequestView',
    'StaffVolunteerDeactivationRequestListView',
    'StaffVolunteerDeactivationRequestResolveView',
    # helpers re-exported for admin.py / tests
    '_generate_backup_codes',
    '_hash_token',
]
