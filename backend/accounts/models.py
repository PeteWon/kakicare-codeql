"""Account models: the custom User and the hashed one-time-token models.

We implement authentication ourselves (no OAuth / third-party provider). Email
is the unique login identifier; there is no username.
"""

import re
from binascii import unhexlify

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone
from django_otp.plugins.otp_totp.models import TOTPDevice

from .encryption import decrypt_totp_key, encrypt_totp_key

_HEX_RE = re.compile(r'^[0-9a-fA-F]+$')


class UserManager(BaseUserManager):
    """Manager for the email-based custom User (no username field)."""

    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError('An email address is required.')
        # Normalize the domain part to avoid trivial duplicate accounts.
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        # set_password hashes with the configured Argon2id hasher; the raw
        # password is never stored.
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault('role', User.Role.VOLUNTEER)
        extra_fields.setdefault('is_staff', False)
        extra_fields.setdefault('is_superuser', False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('role', User.Role.STAFF)
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        extra_fields.setdefault('is_active', True)
        extra_fields.setdefault('is_email_verified', True)
        if extra_fields.get('is_staff') is not True:
            raise ValueError('Superuser must have is_staff=True.')
        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')
        return self._create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """A KakiCare account. Either a volunteer or a staff member.

    Seniors are NOT users — they never authenticate (see seniors app).
    """

    class Role(models.TextChoices):
        VOLUNTEER = 'volunteer', 'Volunteer'
        STAFF = 'staff', 'Staff'

    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=255)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VOLUNTEER)

    # is_active gates login. New volunteers stay inactive until email is verified
    # and (per process) staff approval — enforced in business logic later.
    is_active = models.BooleanField(default=False)
    # Whether the user has confirmed their email via a verification token.
    is_email_verified = models.BooleanField(default=False)

    # is_staff controls Django-admin access; distinct from the app 'staff' role.
    is_staff = models.BooleanField(default=False)

    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['full_name']  # prompted by createsuperuser besides email/password

    def __str__(self):
        return self.email


class _HashedToken(models.Model):
    """Abstract base for single-use, time-limited tokens.

    SECURITY: only a hash of the token is ever stored. The raw token is sent to
    the user (e.g. emailed) and never persisted — a database leak must not allow
    an attacker to use outstanding tokens. Lookups hash the presented token and
    compare against token_hash.
    """

    token_hash = models.CharField(max_length=128, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True

    def is_valid(self):
        return self.used_at is None and self.expires_at > timezone.now()


class EmailVerificationToken(_HashedToken):
    """Token emailed to a new user to confirm their email address.

    The raw token is emailed; only its hash is stored here (see _HashedToken).
    """

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='email_verification_tokens'
    )

    def __str__(self):
        return f'EmailVerificationToken(user={self.user_id})'


class PasswordResetToken(_HashedToken):
    """Token emailed to a user to reset their password.

    The raw token is emailed; only its hash is stored here (see _HashedToken).
    """

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='password_reset_tokens'
    )

    def __str__(self):
        return f'PasswordResetToken(user={self.user_id})'


class StaffInviteToken(_HashedToken):
    """Token emailed to a newly-provisioned staff member to set their password.

    A staff account is created (inactive, with no usable password) by an admin
    in the Django portal; this single-use token lets the staff member set their
    own password and activate the account, so no password is ever shared
    out-of-band. The raw token is emailed; only its hash is stored (_HashedToken).
    """

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='staff_invite_tokens'
    )

    def __str__(self):
        return f'StaffInviteToken(user={self.user_id})'


class MFAResetRequest(models.Model):
    """Identity-verified request to reset a user's MFA enrollment."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        RESOLVED = 'resolved', 'Resolved'
        REJECTED = 'rejected', 'Rejected'

    requester = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='mfa_reset_requests'
    )
    target_user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='mfa_reset_targets'
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    reason = models.CharField(max_length=255, blank=True)

    verification_method = models.CharField(max_length=255, blank=True)
    verification_outcome = models.CharField(max_length=255, blank=True)

    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_mfa_reset_requests',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return (
            f'MFAResetRequest(requester={self.requester_id}, '
            f'target={self.target_user_id}, status={self.status})'
        )


class VolunteerDeactivationRequest(models.Model):
    """Volunteer-initiated account deactivation request reviewed by staff.

    The request itself does not deactivate the account. A staff approval action
    performs the lifecycle cascade so account invalidation, session cancellation,
    and audit logging happen together.
    """

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    requester = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='deactivation_requests'
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    reason = models.TextField(blank=True)

    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_deactivation_requests',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    staff_note = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['requester'],
                condition=models.Q(status='pending'),
                name='unique_pending_volunteer_deactivation_request',
            ),
        ]

    def __str__(self):
        return (
            f'VolunteerDeactivationRequest('
            f'requester={self.requester_id}, status={self.status})'
        )


class MFABackupCode(models.Model):
    """Single-use recovery code for TOTP MFA.

    SECURITY: only the SHA-256 hash of the raw code is stored. The raw codes
    are returned exactly once at MFA enrolment (via mfa/setup) and never
    persisted — a database leak cannot expose valid backup codes.
    """

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='mfa_backup_codes'
    )
    # SHA-256 hex digest (64 chars)
    code_hash = models.CharField(max_length=64, db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['user', 'used_at']),
        ]

    def __str__(self):
        return f'MFABackupCode(user={self.user_id}, used={self.used_at is not None})'


class EncryptedTOTPDevice(TOTPDevice):
    """Proxy of TOTPDevice that stores the TOTP secret encrypted at rest.

    The key column is widened to varchar(500) via migration 0004 to fit the
    Fernet ciphertext. On save, plaintext hex keys are encrypted before
    writing. bin_key decrypts transparently so django-otp verify_token works
    without any other changes.
    """

    class Meta:
        proxy = True

    @property
    def bin_key(self):
        raw = self.key
        if raw and not _HEX_RE.match(raw):
            raw = decrypt_totp_key(raw)
        return unhexlify(raw)

    def save(self, *args, **kwargs):
        if self.key and _HEX_RE.match(self.key):
            self.key = encrypt_totp_key(self.key)
        super().save(*args, **kwargs)
