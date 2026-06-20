"""Sessions views.

Endpoint layout:
  Volunteer-facing (/api/volunteer/sessions/):
    GET  sessions/                 — own sessions (all statuses)
    POST sessions/                 — book a session against an active match
    GET  sessions/<id>/            — retrieve a single session
    POST sessions/<id>/checkin/    — check in with one-time code (rate-limited)
    POST sessions/<id>/checkout/   — check out; completes the session

  Staff-facing (/api/staff/sessions/):
    GET  sessions/                 — all sessions (filterable, paginated)
    GET  sessions/<id>/            — retrieve a single session
    POST sessions/<id>/confirm/    — confirm and generate single-use check-in code
    POST sessions/<id>/cancel/     — cancel with reason
    POST sessions/<id>/followup/   — record welfare follow-up for a missed session

SECURITY (SR-AUTHZ-03): JIT disclosure is enforced in SessionVolunteerSerializer,
computed fresh from the server clock on every request — never a stored flag.

SECURITY (AC-04): check-in codes are 6-digit random numerics. Only the SHA-256
hash is persisted; the raw code is returned to staff ONCE on confirmation.
hmac.compare_digest provides constant-time comparison. The check-in endpoint is
rate-limited to prevent brute-force attempts.

SECURITY (SR-AUTHZ-02): volunteer ownership always derived from the authenticated
session. 404 (not 403) for wrong-volunteer access — 403 would leak that a record
exists with the given id.

SECURITY (SR-AUTHZ-01): every view declares a permission class explicitly.
"""

import hashlib
import hmac
import logging
import secrets

from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from audit.services import record_audit
from matching.models import Match
from seniors.models import Senior
from volunteers.permissions import IsApprovedVolunteer, IsStaff

from .models import Session
from .serializers import (
    CheckInSerializer,
    CheckOutSerializer,
    SessionBookSerializer,
    SessionCancelSerializer,
    SessionFollowUpSerializer,
    SessionStaffSerializer,
    SessionVolunteerSerializer,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Throttle
# ---------------------------------------------------------------------------

class CheckInThrottle(SimpleRateThrottle):
    """AC-04: limit brute-force attempts against check-in codes."""

    scope = 'checkin_verify'

    def parse_rate(self, rate):
        return (5, 15 * 60)

    def get_cache_key(self, request, view):
        return self.cache_format % {
            'scope': self.scope,
            'ident': self.get_ident(request),
        }


# ---------------------------------------------------------------------------
# Audit mixin
# ---------------------------------------------------------------------------

class _SessionAuditMixin:
    """Structural audit logging for all session views.

    SR-AUD-03: target_id carries only the Session pk or a summary — never
    senior address, phone, or next-of-kin data.
    """

    @staticmethod
    def _get_ip(request) -> str | None:
        xff = request.META.get('HTTP_X_FORWARDED_FOR')
        return xff.split(',')[0].strip() if xff else request.META.get('REMOTE_ADDR')

    def _audit(self, request, action: str, target_id: str | int = '') -> None:
        record_audit(
            user=request.user,
            action=action,
            target_type='Session',
            target_id=target_id,
            request_ip=self._get_ip(request),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_checkin_code() -> tuple[str, str]:
    """Return (raw_6_digit_code, sha256_hex_digest).

    AC-04: the raw code is never stored — only the hash is persisted.
    """
    raw = f'{secrets.randbelow(1_000_000):06d}'
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return raw, digest


def _verify_checkin_code(presented: str, stored_hash: str) -> bool:
    """AC-04: constant-time comparison to prevent timing side-channels."""
    presented_hash = hashlib.sha256(presented.encode()).hexdigest()
    return hmac.compare_digest(presented_hash, stored_hash)


class _StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


# ---------------------------------------------------------------------------
# Volunteer views
# ---------------------------------------------------------------------------

class VolunteerSessionListCreateView(_SessionAuditMixin, APIView):
    """GET /api/volunteer/sessions/  — own sessions
    POST /api/volunteer/sessions/ — book a new session
    """

    permission_classes = [IsApprovedVolunteer]

    def get(self, request):
        qs = (
            Session.objects
            .filter(match__volunteer=request.user)
            .select_related('match__senior', 'match__volunteer')
            .order_by('-scheduled_start')
        )
        count = qs.count()
        self._audit(
            request, 'session.list',
            target_id=f'volunteer_id={request.user.pk},count={count}',
        )
        paginator = _StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            SessionVolunteerSerializer(page, many=True).data
        )

    def post(self, request):
        serializer = SessionBookSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # SR-AUTHZ-02: match must belong to this volunteer and be active.
        # 404 (not 403) — revealing "forbidden" would confirm the id exists.
        try:
            match = Match.objects.select_related('senior').get(
                pk=data['match_id'],
                volunteer=request.user,
                status=Match.Status.ACTIVE,
            )
        except Match.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        # FR-S-13 / SR-S-13: block scheduling if senior's consent is not recorded.
        if match.senior.consent_status != Senior.ConsentStatus.GIVEN:
            return Response(
                {'detail': 'Cannot book a session for a senior whose consent has not been recorded.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Reject overlapping bookings for the same volunteer. Two intervals
        # overlap iff a.start < b.end AND a.end > b.start. Cancelled and missed
        # sessions are excluded since they no longer occupy the calendar.
        overlap = (
            Session.objects
            .filter(
                match__volunteer=request.user,
                scheduled_start__lt=data['scheduled_end'],
                scheduled_end__gt=data['scheduled_start'],
            )
            .exclude(status__in=[
                Session.Status.CANCELLED,
                Session.Status.MISSED,
            ])
            .exists()
        )
        if overlap:
            return Response(
                {'non_field_errors': [
                    'This time overlaps with another of your sessions.'
                ]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = Session.objects.create(
            match=match,
            session_type=data['session_type'],
            scheduled_start=data['scheduled_start'],
            scheduled_end=data['scheduled_end'],
            status=Session.Status.PENDING_CONFIRMATION,
        )
        self._audit(request, 'session.book', target_id=session.pk)
        return Response(
            SessionVolunteerSerializer(session).data,
            status=status.HTTP_201_CREATED,
        )


class VolunteerSessionDetailView(_SessionAuditMixin, APIView):
    """GET /api/volunteer/sessions/<pk>/"""

    permission_classes = [IsApprovedVolunteer]

    def get(self, request, pk: int):
        try:
            session = (
                Session.objects
                .select_related('match__senior', 'match__volunteer')
                .get(pk=pk, match__volunteer=request.user)
            )
        except Session.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        self._audit(request, 'session.view', target_id=pk)
        return Response(SessionVolunteerSerializer(session).data)


class VolunteerSessionCheckInView(_SessionAuditMixin, APIView):
    """POST /api/volunteer/sessions/<pk>/checkin/

    AC-04: throttled to 5 attempts per 15 minutes per IP. Constant-time code
    comparison. Failed attempts are audit-logged separately from successes so
    that repeated failures on the same session are detectable.
    """

    permission_classes = [IsApprovedVolunteer]
    throttle_classes = [CheckInThrottle]

    def post(self, request, pk: int):
        serializer = CheckInSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            session = (
                Session.objects
                .select_related('match__senior', 'match__volunteer')
                .get(pk=pk, match__volunteer=request.user)
            )
        except Session.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if session.status != Session.Status.CONFIRMED:
            return Response(
                {'detail': f'Cannot check in to a session with status "{session.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not _verify_checkin_code(serializer.validated_data['code'], session.checkin_code_hash):
            self._audit(request, 'session.checkin_fail', target_id=pk)
            return Response(
                {'detail': 'Invalid check-in code.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session.status = Session.Status.IN_PROGRESS
        session.checkin_at = timezone.now()
        session.save(update_fields=['status', 'checkin_at'])

        self._audit(request, 'session.checkin', target_id=pk)
        return Response(SessionVolunteerSerializer(session).data)


class VolunteerSessionCheckOutView(_SessionAuditMixin, APIView):
    """POST /api/volunteer/sessions/<pk>/checkout/"""

    permission_classes = [IsApprovedVolunteer]

    def post(self, request, pk: int):
        serializer = CheckOutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            session = (
                Session.objects
                .select_related('match__senior', 'match__volunteer')
                .get(pk=pk, match__volunteer=request.user)
            )
        except Session.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if session.status != Session.Status.IN_PROGRESS:
            return Response(
                {'detail': f'Cannot check out of a session with status "{session.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session.status = Session.Status.COMPLETED
        session.checkout_at = timezone.now()
        session.volunteer_note = serializer.validated_data.get('volunteer_note', '')
        session.save(update_fields=['status', 'checkout_at', 'volunteer_note'])

        self._audit(request, 'session.checkout', target_id=pk)
        return Response(SessionVolunteerSerializer(session).data)


# ---------------------------------------------------------------------------
# Staff views
# ---------------------------------------------------------------------------

class StaffSessionListView(_SessionAuditMixin, APIView):
    """GET /api/staff/sessions/

    Filters: ?match_id= ?status= ?volunteer_id= ?senior_id=
    """

    permission_classes = [IsStaff]

    def get(self, request):
        qs = (
            Session.objects
            .select_related('match__senior', 'match__volunteer', 'confirmed_by')
            .order_by('-scheduled_start')
        )

        match_id = request.query_params.get('match_id')
        if match_id:
            qs = qs.filter(match_id=match_id)

        status_param = request.query_params.get('status')
        if status_param:
            if status_param not in Session.Status.values:
                return Response(
                    {'status': f'Invalid status. Choose from: {", ".join(Session.Status.values)}.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(status=status_param)

        volunteer_id = request.query_params.get('volunteer_id')
        if volunteer_id:
            qs = qs.filter(match__volunteer_id=volunteer_id)

        senior_id = request.query_params.get('senior_id')
        if senior_id:
            qs = qs.filter(match__senior_id=senior_id)

        count = qs.count()
        self._audit(request, 'session.list', target_id=f'count={count}')

        paginator = _StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            SessionStaffSerializer(page, many=True).data
        )


class StaffSessionDetailView(_SessionAuditMixin, APIView):
    """GET /api/staff/sessions/<pk>/"""

    permission_classes = [IsStaff]

    def get(self, request, pk: int):
        try:
            session = (
                Session.objects
                .select_related('match__senior', 'match__volunteer', 'confirmed_by')
                .get(pk=pk)
            )
        except Session.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        self._audit(request, 'session.view', target_id=pk)
        return Response(SessionStaffSerializer(session).data)


class StaffSessionConfirmView(_SessionAuditMixin, APIView):
    """POST /api/staff/sessions/<pk>/confirm/

    Confirms a pending session and generates a single-use 6-digit check-in code.

    AC-04: the raw code is returned ONCE in this response body and is NEVER
    stored in the database — only its SHA-256 hash is persisted. The staff
    member must relay this code to the volunteer before the session.
    """

    permission_classes = [IsStaff]

    def post(self, request, pk: int):
        try:
            session = (
                Session.objects
                .select_related('match__senior', 'match__volunteer', 'confirmed_by')
                .get(pk=pk)
            )
        except Session.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if session.status != Session.Status.PENDING_CONFIRMATION:
            return Response(
                {'detail': f'Cannot confirm a session with status "{session.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_code, code_hash = _generate_checkin_code()
        session.status = Session.Status.CONFIRMED
        session.checkin_code_hash = code_hash
        session.confirmed_by = request.user
        session.save(update_fields=['status', 'checkin_code_hash', 'confirmed_by'])

        self._audit(request, 'session.confirm', target_id=pk)

        data = SessionStaffSerializer(session).data
        # AC-04: raw code disclosed ONCE here — never retrievable again
        data['checkin_code'] = raw_code
        return Response(data)


class StaffSessionCancelView(_SessionAuditMixin, APIView):
    """POST /api/staff/sessions/<pk>/cancel/"""

    permission_classes = [IsStaff]

    def post(self, request, pk: int):
        serializer = SessionCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            session = (
                Session.objects
                .select_related('match__senior', 'match__volunteer', 'confirmed_by')
                .get(pk=pk)
            )
        except Session.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        terminal = (Session.Status.COMPLETED, Session.Status.CANCELLED)
        if session.status in terminal:
            return Response(
                {'detail': f'Cannot cancel a session with status "{session.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session.status = Session.Status.CANCELLED
        session.cancel_reason = serializer.validated_data['cancel_reason']
        session.save(update_fields=['status', 'cancel_reason'])

        self._audit(request, 'session.cancel', target_id=pk)
        return Response(SessionStaffSerializer(session).data)


class StaffSessionFollowUpView(_SessionAuditMixin, APIView):
    """POST /api/staff/sessions/<pk>/followup/

    Records a welfare follow-up outcome for a session that was missed.
    Can only be set once — re-submission is rejected.
    """

    permission_classes = [IsStaff]

    def post(self, request, pk: int):
        serializer = SessionFollowUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            session = (
                Session.objects
                .select_related('match__senior', 'match__volunteer', 'confirmed_by')
                .get(pk=pk)
            )
        except Session.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if session.status != Session.Status.MISSED:
            return Response(
                {'detail': 'Follow-up can only be recorded for missed sessions.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if session.followup_outcome:
            return Response(
                {'detail': 'Follow-up outcome has already been recorded for this session.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session.followup_outcome = serializer.validated_data['followup_outcome']
        session.followup_note = serializer.validated_data.get('followup_note', '')
        session.save(update_fields=['followup_outcome', 'followup_note'])

        self._audit(request, 'session.followup', target_id=pk)
        return Response(SessionStaffSerializer(session).data)
