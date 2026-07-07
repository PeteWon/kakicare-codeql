"""Session cleanup helper for account deactivation.

NOTE: this is not what actually blocks a deactivated user's access — DRF's
SessionAuthentication and Django admin's has_permission() both already
recheck is_active on every request (independent of ModelBackend.get_user()
doing the same), so access is cut immediately regardless of whether the
session row still exists. This helper just removes the now-dead row from
django_session on deactivation, rather than leaving it to expire naturally;
treat it as hygiene/defense-in-depth, not the access-control mechanism.
"""

from django.contrib.sessions.models import Session
from django.utils import timezone


def invalidate_user_sessions(user_id):
    """Delete all non-expired Django sessions authenticated as user_id.

    Session data has no indexed FK to filter on, so this decodes each
    non-expired session to check its _auth_user_id. Fine at this app's scale;
    a custom session backend keyed by user would be needed at high volume.
    """
    for session in Session.objects.filter(expire_date__gte=timezone.now()):
        if session.get_decoded().get('_auth_user_id') == str(user_id):
            session.delete()
