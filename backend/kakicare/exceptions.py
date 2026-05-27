from rest_framework.views import exception_handler as drf_exception_handler


def custom_exception_handler(exc, context):
    """Return 401 (not 403) when a request lacks authentication.

    DRF's SessionAuthentication emits 403 for unauthenticated requests because
    it has no WWW-Authenticate header to accompany a 401. The frontend's
    ProtectedRoute relies on 401 to distinguish "not logged in" from "logged in
    but forbidden", so we remap here using is_anonymous (the OTP middleware
    wrapper preserves this correctly even when is_authenticated may differ).
    """
    response = drf_exception_handler(exc, context)

    if response is not None and response.status_code == 403:
        user = context['request'].user
        if getattr(user, 'is_anonymous', False):
            response.status_code = 401

    return response
