"""Registration, email verification, staff-invite acceptance and contact form."""

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import EmailMessage, send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import record_audit

from ..models import EmailVerificationToken, StaffInviteToken, User
from ..serializers import (
    AcceptInviteSerializer,
    ContactSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    VerifyEmailSerializer,
)
from ._common import (
    ContactRateThrottle,
    RegistrationRateThrottle,
    ResendVerificationRateThrottle,
    _GENERIC_INVITE_ERROR,
    _GENERIC_VERIFY_ERROR,
    _STAFF_INVITE_EXPIRY_HOURS,
    _TOKEN_EXPIRY_HOURS,
    _get_ip,
    _hash_token,
    logger,
)


class RegisterView(APIView):
    """POST /api/auth/register"""

    permission_classes = [AllowAny]
    throttle_classes = [RegistrationRateThrottle]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data['email']
        full_name = serializer.validated_data['full_name']
        password = serializer.validated_data['password']

        # SR-AUTH-06: same response whether email exists or not.
        if not User.objects.filter(email=email).exists():
            user = User.objects.create_user(
                email=email,
                password=password,  # SR-AUTH-01: hashed with Argon2id
                full_name=full_name,
                role=User.Role.VOLUNTEER,
                is_active=True,
                is_email_verified=False,
            )
            _issue_and_send_verification_token(user)
            record_audit(user=user, action='auth.register', request_ip=_get_ip(request))

        return Response(
            {'detail': 'If this email is valid, a verification link has been sent.'},
            status=status.HTTP_200_OK,
        )


def _issue_and_send_verification_token(user: User) -> None:
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = timezone.now() + timedelta(hours=_TOKEN_EXPIRY_HOURS)

    EmailVerificationToken.objects.create(
        user=user,
        token_hash=token_hash,
        expires_at=expires_at,
    )

    verify_url = f'{settings.FRONTEND_BASE_URL}/verify-email?token={raw_token}'

    # Best-effort: a transient SMTP failure must not 500 registration. The user
    # row already exists; an unverified user can be re-sent a link later.
    try:
        send_mail(
            subject='Verify your KakiCare email address',
            message=(
                f'Hi {user.full_name},\n\n'
                f'Please verify your email address by clicking the link below.\n'
                f'The link expires in {_TOKEN_EXPIRY_HOURS} hours.\n\n'
                f'{verify_url}\n\n'
                f'If you did not register for KakiCare, you can ignore this email.'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception:
        logger.exception('Failed to send verification email to %s', user.email)


class ResendVerificationView(APIView):
    """POST /api/auth/resend-verification

    Re-sends the email-verification link to an account that has registered but
    not yet verified. This is the self-service recovery path for a lost/expired
    verification email — without it a volunteer whose first email never arrived
    is permanently stuck (login is refused while unverified, and re-registering
    is a no-op because the email already exists).

    SR-AUTH-06 (anti-enumeration): the response is identical whether or not the
    email maps to an unverified account, exactly like password-reset/request, so
    the endpoint cannot be used to probe which addresses are registered or which
    are already verified.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ResendVerificationRateThrottle]

    def post(self, request):
        # Single generic response — never branch on account existence/state.
        generic_ok = Response(
            {'detail': 'If this email needs verification, a new link has been sent.'},
            status=status.HTTP_200_OK,
        )

        serializer = ResendVerificationSerializer(data=request.data)
        if not serializer.is_valid():
            return generic_ok

        email = serializer.validated_data['email']

        # Only unverified, active accounts are eligible. Already-verified or
        # nonexistent emails fall through to the same generic response.
        try:
            user = User.objects.get(
                email=email, is_active=True, is_email_verified=False
            )
        except User.DoesNotExist:
            return generic_ok

        # Expire any outstanding verification tokens before issuing a new one so
        # the inbox never accumulates multiple live links (mirrors password-reset).
        user.email_verification_tokens.filter(used_at__isnull=True).update(
            used_at=timezone.now()
        )

        # Guard the send: a prod SMTP failure must not surface as a 500 (which
        # would also leak that the email is a real unverified account). The token
        # is issued regardless; the user can retry the resend.
        try:
            _issue_and_send_verification_token(user)
        except Exception:
            logger.exception(
                'Failed to send verification email on resend for user %s', user.pk
            )

        record_audit(
            user=user, action='auth.email.resend', request_ip=_get_ip(request)
        )
        return generic_ok


def issue_and_send_staff_invite(user: User) -> None:
    """Issue a single-use invite token and email the staff member a set-password link.

    Called when an admin provisions a staff account in the Django portal. Any
    outstanding invites are expired first so only one link is ever live (also
    makes this safe to call again as a 'resend'). Public (not underscored) so the
    admin (admin.py) can call it.
    """
    # Expire any outstanding invites before issuing a new one.
    user.staff_invite_tokens.filter(used_at__isnull=True).update(
        used_at=timezone.now()
    )

    raw_token = secrets.token_urlsafe(32)
    # SR-DATA: only the hash is stored; the raw token goes to email only.
    token_hash = _hash_token(raw_token)
    expires_at = timezone.now() + timedelta(hours=_STAFF_INVITE_EXPIRY_HOURS)

    StaffInviteToken.objects.create(
        user=user,
        token_hash=token_hash,
        expires_at=expires_at,
    )

    # Public path (not under /staff, which is auth-gated) — the invitee is not
    # logged in yet when they click this link.
    invite_url = f'{settings.FRONTEND_BASE_URL}/accept-invite?token={raw_token}'

    # Best-effort: a transient SMTP failure must not raise out of the admin
    # save_model (which would 500 the admin page). The token is already stored, so
    # the admin can use the "Resend staff invite" action to retry delivery.
    try:
        send_mail(
            subject='You have been invited to KakiCare',
            message=(
                f'Hi {user.full_name},\n\n'
                f'A KakiCare administrator has created a staff account for you. '
                f'Click the link below to set your password and activate your account. '
                f'The link expires in {_STAFF_INVITE_EXPIRY_HOURS} hours.\n\n'
                f'{invite_url}\n\n'
                f'If you were not expecting this invitation, you can ignore this email.'
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception:
        logger.exception('Failed to send staff-invite email to %s', user.email)


class AcceptInviteView(APIView):
    """POST /api/auth/accept-invite

    A staff member sets their initial password from an emailed invite token.
    On success the account is activated and marked email-verified (clicking the
    link proves control of the inbox). First login then forces TOTP enrolment.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = AcceptInviteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        raw_token = serializer.validated_data['token']
        new_password = serializer.validated_data['new_password']
        token_hash = _hash_token(raw_token)

        with transaction.atomic():
            try:
                token_obj = (
                    StaffInviteToken.objects
                    .select_related('user')
                    .select_for_update()
                    .get(token_hash=token_hash)
                )
            except StaffInviteToken.DoesNotExist:
                # SR-AUTH-06: single generic error for invalid/expired/used token.
                return Response(
                    {'detail': _GENERIC_INVITE_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not token_obj.is_valid():
                return Response(
                    {'detail': _GENERIC_INVITE_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user = token_obj.user

            # Validate against the full policy (SR-AUTH-02), incl. HIBP and the
            # similarity check against this user's email/name.
            try:
                validate_password(new_password, user=user)
            except DjangoValidationError as exc:
                return Response(
                    {'new_password': list(exc.messages)},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            token_obj.used_at = timezone.now()
            token_obj.save(update_fields=['used_at'])

            # SR-AUTH-01: set_password hashes with Argon2id. Activate the account
            # and mark email verified — clicking the link proves inbox control.
            user.set_password(new_password)
            user.is_active = True
            user.is_email_verified = True
            user.save(update_fields=['password', 'is_active', 'is_email_verified'])
            record_audit(user=user, action='auth.staff_invite.accepted', request_ip=_get_ip(request))

        return Response(
            {'detail': 'Password set successfully. You can now log in.'},
            status=status.HTTP_200_OK,
        )


class VerifyEmailView(APIView):
    """POST /api/auth/verify-email"""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'detail': _GENERIC_VERIFY_ERROR},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token_hash = _hash_token(serializer.validated_data['token'])

        with transaction.atomic():
            try:
                token_obj = (
                    EmailVerificationToken.objects
                    .select_related('user')
                    .select_for_update()
                    .get(token_hash=token_hash)
                )
            except EmailVerificationToken.DoesNotExist:
                return Response(
                    {'detail': _GENERIC_VERIFY_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not token_obj.is_valid():
                return Response(
                    {'detail': _GENERIC_VERIFY_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            now = timezone.now()
            token_obj.used_at = now
            token_obj.save(update_fields=['used_at'])

            user = token_obj.user
            user.is_email_verified = True
            user.save(update_fields=['is_email_verified'])
            record_audit(user=user, action='auth.email.verified', request_ip=_get_ip(request))

        return Response(
            {'detail': 'Email verified successfully.'},
            status=status.HTTP_200_OK,
        )


class ContactView(APIView):
    """POST /api/auth/contact

    Public landing-page contact form. Sends the message straight to the
    KakiCare contact inbox, with the visitor's address set as Reply-To so
    staff can reply directly from their email client.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ContactRateThrottle]

    def post(self, request):
        serializer = ContactSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        name = serializer.validated_data['name']
        email = serializer.validated_data['email']
        message = serializer.validated_data['message']

        try:
            EmailMessage(
                subject=f'KakiCare contact form message from {name}',
                body=f'From: {name} <{email}>\n\n{message}',
                from_email=settings.DEFAULT_FROM_EMAIL,
                to=[settings.CONTACT_EMAIL],
                reply_to=[email],
            ).send(fail_silently=False)
        except Exception:
            logger.exception('Failed to send contact-form email from %s', email)
            return Response(
                {'detail': 'Could not send your message. Please try again later.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response(
            {'detail': 'Your message has been sent.'},
            status=status.HTTP_200_OK,
        )
