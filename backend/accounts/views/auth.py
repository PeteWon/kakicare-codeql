"""Login, logout and current-user endpoints."""

from django.contrib import auth
from django.contrib.auth.hashers import check_password
from django.middleware.csrf import get_token
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import record_audit

from ..models import EncryptedTOTPDevice, User
from ..serializers import LoginSerializer
from ._common import LoginRateThrottle, _DUMMY_PASSWORD_HASH, _get_ip


class LoginView(APIView):
    """POST /api/auth/login"""

    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        # Stamp the CSRF cookie so the frontend can send X-CSRFToken on
        # subsequent state-changing requests (logout, MFA verify, etc.).
        # SR-SESS-01: session cookie is HttpOnly; CSRF cookie is readable.
        get_token(request)

        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        email = serializer.validated_data['email']
        password = serializer.validated_data['password']

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # SR-AUTH-06 (timing equalizer): run Argon2id against a dummy hash
            # so response time is indistinguishable from a wrong-password attempt.
            check_password(password, _DUMMY_PASSWORD_HASH)
            record_audit(user=None, action='auth.login.failed', request_ip=_get_ip(request))
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        if not user.check_password(password):
            record_audit(user=user, action='auth.login.failed', request_ip=_get_ip(request))
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        # SR-AUTH-06: inactive/unverified → same generic error as wrong password.
        if not user.is_active or not user.is_email_verified:
            record_audit(user=user, action='auth.login.failed', request_ip=_get_ip(request))
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        # Determine MFA requirement based on role and enrolment state.
        has_confirmed_totp = EncryptedTOTPDevice.objects.devices_for_user(
            user, confirmed=True
        ).exists()

        if user.role == User.Role.STAFF:
            # SR-AUTH-03: staff ALWAYS require MFA — never issue a session here.
            request.session.flush()
            request.session['mfa_pending_user_id'] = user.pk
            if not has_confirmed_totp:
                # First login: must complete MFA setup before verify.
                request.session['mfa_needs_setup'] = True
            request.session.set_expiry(5 * 60)  # 5-min window to complete MFA
            return Response(
                {'status': 'mfa_required', 'mfa_enrolled': has_confirmed_totp},
                status=status.HTTP_200_OK,
            )

        if has_confirmed_totp:
            # Volunteer who has opted into MFA — gate behind verify.
            request.session.flush()
            request.session['mfa_pending_user_id'] = user.pk
            request.session.set_expiry(5 * 60)
            return Response(
                {'status': 'mfa_required', 'mfa_enrolled': True},
                status=status.HTTP_200_OK,
            )

        # Volunteer without MFA: establish a full session immediately.
        # SR-SESS-01: session ID in HttpOnly cookie only — never in JSON body.
        auth.login(request, user)
        request.session.set_expiry(8 * 3600)  # SR-AUTH-05: 8-hour volunteer session
        record_audit(user=user, action='auth.login.success', request_ip=_get_ip(request))

        return Response(
            {'status': 'success', 'role': user.role},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    """POST /api/auth/logout"""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        record_audit(user=request.user, action='auth.logout', request_ip=_get_ip(request))
        auth.logout(request)
        return Response({'detail': 'Logged out.'}, status=status.HTTP_200_OK)


class MeView(APIView):
    """GET /api/auth/me

    Returns the current user's safe profile. 401 when not authenticated.
    Used by the frontend's ProtectedRoute.

    NOTE: snake_case field names here; frontend will map full_name → fullName
    and is_email_verified → emailVerifiedAt when wiring up.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        u = request.user
        return Response({
            'id': str(u.pk),
            'email': u.email,
            'full_name': u.full_name,
            'role': u.role,
            'is_email_verified': u.is_email_verified,
        })
