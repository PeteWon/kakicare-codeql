"""Reusable DRF permission classes for the KakiCare volunteer/staff split.

SECURITY (SR-AUTHZ-01): authorisation is enforced server-side on EVERY request
by these permission classes. The frontend hiding pages for a given role is a
usability convenience, NOT a security control — it is trivially bypassable.
Every endpoint that should be role-restricted must declare the appropriate
permission class; never rely on the frontend to keep a user out.
"""

from rest_framework.permissions import BasePermission

from accounts.models import User
from volunteers.models import VolunteerProfile


class IsVolunteer(BasePermission):
    """Allow authenticated, email-verified volunteers only.

    SR-AUTHZ-01: enforced server-side on every request — not by the frontend.
    SR-AUTHZ-02: volunteers are further restricted to their own data inside views;
    the role check here is the first gate, not the last.
    """

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.role == User.Role.VOLUNTEER
            # Defence-in-depth: login already blocks unverified users, but
            # we double-check so this class is safe to use in isolation.
            and user.is_email_verified
        )


class IsApprovedVolunteer(BasePermission):
    """Allow approved, email-verified volunteers only.

    SR-AUTHZ-01: enforced server-side on every request.
    AC-05: unvetted volunteers must not access match data or accept proposals —
    only volunteers who have passed staff vetting (application_status='approved')
    may interact with matches. This is checked here so no view needs to repeat it.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (
            user
            and user.is_authenticated
            and user.role == User.Role.VOLUNTEER
            and user.is_email_verified
        ):
            return False
        try:
            return (
                user.volunteer_profile.application_status
                == VolunteerProfile.ApplicationStatus.APPROVED
            )
        except VolunteerProfile.DoesNotExist:
            return False


class IsStaff(BasePermission):
    """Allow authenticated staff members only.

    SR-AUTHZ-01: enforced server-side on every request — not by the frontend.
    MFA is enforced at login for staff; the session only exists after both
    password and TOTP have been successfully verified, so a valid staff session
    already implies MFA completion.
    """

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.role == User.Role.STAFF
        )
