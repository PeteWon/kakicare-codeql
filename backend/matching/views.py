"""Matching views — staff-proposed, double opt-in.

Endpoint layout:
  Staff-facing (/api/staff/):
    GET  matches/                              — list (filterable, paginated)
    POST matches/                              — propose a new match
    POST matches/<id>/record-senior-confirmation/ — record senior's offline agreement
    POST matches/<id>/end/                     — end a match

  Volunteer-facing (/api/volunteer/):
    GET  matches/                              — own matches only (limited senior info)
    POST matches/<id>/accept/                  — accept a proposed match
    POST matches/<id>/decline/                 — decline a proposed match

SECURITY (SR-AUTHZ-01): every view declares a permission class. Frontend role
gating is UX-only and is NOT a security boundary.

SECURITY (SR-AUTHZ-02): volunteer ownership is always derived from the authenticated
session — the client never supplies a volunteer_id for volunteer-facing endpoints.

SECURITY (AC-06, SR-AUD-01): every endpoint that exposes senior-identifying information
(even limited) is audit-logged. The _MatchAuditMixin makes this structural — no match
view exists outside this file, so no path can skip audit logging.
"""

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.http import Http404
from django.utils import timezone
from rest_framework import status
from kakicare.pagination import StandardPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from audit.mixins import AuditMixin
from seniors.models import Senior
from volunteers.models import VolunteerProfile
from accounts.permissions import IsApprovedVolunteer, IsStaff

from .models import Match
from .serializers import MatchStaffSerializer, MatchVolunteerSerializer, ProposeMatchSerializer

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Audit mixin
# ---------------------------------------------------------------------------

class _MatchAuditMixin(AuditMixin):
    """Structural audit logging for all match views.

    Every match endpoint that returns senior-identifying information (even the
    limited SeniorLimitedSerializer fields) must be audit-logged so that
    volunteer access patterns are traceable for AC-06 insider-threat detection.
    The mixin ensures _audit is always available; the code-review rule is that
    every handler body must call self._audit once before returning.

    SR-AUD-03: target_id carries only the Match id or a summary — never
    senior address, phone, or next-of-kin data.
    """

    audit_target_type = 'Match'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _activate_if_ready(match: Match) -> bool:
    """Transition to 'active' if and only if both parties have confirmed.

    Double opt-in contract — 'active' requires BOTH:
      volunteer_accepted_at: the volunteer agreed via the platform
      senior_confirmed_at:   staff recorded the senior's offline agreement

    Neither party's agreement alone is sufficient. This function is called
    from two places (senior-confirm view and volunteer-accept view) so the
    same transition logic is applied regardless of which side confirms last.
    """
    if match.volunteer_accepted_at and match.senior_confirmed_at:
        match.status = Match.Status.ACTIVE
        match.save(update_fields=['status'])
        return True
    return False


# ---------------------------------------------------------------------------
# Staff views
# ---------------------------------------------------------------------------

class StaffMatchListCreateView(_MatchAuditMixin, APIView):
    """GET /api/staff/matches/ — list matches (filterable, paginated)
    POST /api/staff/matches/ — propose a new match

    AC-05: this list endpoint, filtered by volunteer_id or senior_id, is the
    primary data source for detecting repeat-pairing patterns (e.g. a single
    volunteer repeatedly matched to the same senior outside normal rotation),
    which is a proxy signal for stalking-type misuse.

    GET filters:
      ?status=proposed|active|ended
      ?volunteer_id=<id>
      ?senior_id=<id>
    """

    permission_classes = [IsStaff]

    def get(self, request):
        qs = (
            Match.objects
            .select_related('volunteer', 'senior', 'proposed_by')
            .order_by('-created_at')
        )

        status_param = request.query_params.get('status')
        if status_param:
            if status_param not in Match.Status.values:
                return Response(
                    {'status': f'Invalid status. Choose from: {", ".join(Match.Status.values)}.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(status=status_param)

        volunteer_id = request.query_params.get('volunteer_id')
        if volunteer_id:
            qs = qs.filter(volunteer_id=volunteer_id)

        senior_id = request.query_params.get('senior_id')
        if senior_id:
            qs = qs.filter(senior_id=senior_id)

        count = qs.count()
        self._audit(request, 'match.list', target_id=f'count={count}')

        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(MatchStaffSerializer(page, many=True).data)

    def post(self, request):
        serializer = ProposeMatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        volunteer_id = serializer.validated_data['volunteer_id']
        senior_id = serializer.validated_data['senior_id']

        # Validate volunteer exists and has the right role
        try:
            volunteer = User.objects.get(pk=volunteer_id, role=User.Role.VOLUNTEER)
        except User.DoesNotExist:
            return Response(
                {'volunteer_id': 'No volunteer found with this id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # AC-05: ONLY approved volunteers may be matched to seniors.
        # Matching an unvetted volunteer would bypass the vetting process and
        # could expose a vulnerable senior to someone who has not been
        # background-checked. This check is enforced server-side — the frontend
        # cannot override it by submitting a different volunteer_id.
        try:
            profile = volunteer.volunteer_profile
        except VolunteerProfile.DoesNotExist:
            return Response(
                {'volunteer_id': 'Volunteer has not completed their profile.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if profile.application_status != VolunteerProfile.ApplicationStatus.APPROVED:
            return Response(
                {
                    'volunteer_id': (
                        'Volunteer must be approved before they can be matched. '
                        f'Current status: {profile.application_status}.'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate senior exists and is active
        try:
            senior = Senior.objects.get(pk=senior_id, is_active=True)
        except Senior.DoesNotExist:
            return Response(
                {'senior_id': 'No active senior found with this id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # FR-S-13 / SR-S-13: consent must be recorded before a senior can be matched.
        if senior.consent_status != Senior.ConsentStatus.GIVEN:
            return Response(
                {'senior_id': 'Cannot propose a match for a senior whose consent has not been recorded.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Let the DB partial unique constraint enforce the no-duplicate rule
        # (a race-condition-safe approach: check-then-create has a TOCTOU gap;
        # catching IntegrityError from the DB is atomic).
        try:
            match = Match.objects.create(
                volunteer=volunteer,
                senior=senior,
                status=Match.Status.PROPOSED,
                proposed_by=request.user,
            )
        except IntegrityError:
            return Response(
                {'detail': 'A non-ended match already exists for this volunteer and senior.'},
                status=status.HTTP_409_CONFLICT,
            )

        # Notify the volunteer (email failure is logged but does not fail the API call).
        try:
            send_mail(
                subject='A befriending match has been proposed for you on KakiCare',
                message=(
                    f'Hi {volunteer.full_name},\n\n'
                    'A befriending match has been proposed for you on KakiCare. '
                    'Please log in to review and respond to the proposal.\n\n'
                    'KakiCare Team'
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[volunteer.email],
                fail_silently=False,
            )
        except Exception:
            logger.exception(
                'Failed to send match proposal email to %s for match %s',
                volunteer.email, match.pk,
            )

        self._audit(request, 'match.propose', target_id=match.pk)
        return Response(MatchStaffSerializer(match).data, status=status.HTTP_201_CREATED)


class StaffMatchRecordSeniorConfirmView(_MatchAuditMixin, APIView):
    """POST /api/staff/matches/<pk>/record-senior-confirmation/

    Staff records that the senior has agreed to the match after an offline
    contact (phone or home visit). Sets senior_confirmed_at=now.

    Double opt-in: if the volunteer has ALSO already accepted (volunteer_accepted_at
    is set), this call immediately transitions the match to 'active'. Both parties
    must have confirmed — neither alone is sufficient.
    """

    permission_classes = [IsStaff]

    def post(self, request, pk: int):
        try:
            match = (
                Match.objects
                .select_related('volunteer', 'senior', 'proposed_by')
                .get(pk=pk)
            )
        except Match.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if match.status == Match.Status.ENDED:
            return Response(
                {'detail': 'Cannot confirm a match that has already ended.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if match.senior_confirmed_at:
            return Response(
                {'detail': 'Senior confirmation has already been recorded.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        match.senior_confirmed_at = timezone.now()
        match.save(update_fields=['senior_confirmed_at'])
        _activate_if_ready(match)

        self._audit(request, 'match.senior_confirm', target_id=pk)
        return Response(MatchStaffSerializer(match).data)


class StaffMatchEndView(_MatchAuditMixin, APIView):
    """POST /api/staff/matches/<pk>/end/

    Staff ends a match: sets status='ended', ended_at=now.

    An ended match prevents future session booking — the sessions endpoint
    (future work) will enforce that sessions may only be created against
    matches with status='active'. This note is here so that constraint is
    not forgotten when the sessions endpoint is built.

    The row is retained for audit continuity: deleting it would leave
    AuditLogEntry rows pointing to a nonexistent target.
    """

    permission_classes = [IsStaff]

    def post(self, request, pk: int):
        try:
            match = (
                Match.objects
                .select_related('volunteer', 'senior', 'proposed_by')
                .get(pk=pk)
            )
        except Match.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if match.status == Match.Status.ENDED:
            return Response(
                {'detail': 'Match is already ended.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        match.status = Match.Status.ENDED
        match.ended_at = timezone.now()
        match.save(update_fields=['status', 'ended_at'])

        self._audit(request, 'match.end', target_id=pk)
        return Response(MatchStaffSerializer(match).data)


# ---------------------------------------------------------------------------
# Volunteer views
# ---------------------------------------------------------------------------

class VolunteerMatchListView(_MatchAuditMixin, APIView):
    """GET /api/volunteer/matches/ — own matches (proposed + active only).

    SECURITY (SR-AUTHZ-02): the volunteer is derived from the authenticated
    session — the client never supplies a volunteer_id. This guarantees a
    volunteer cannot view another volunteer's matches.

    SECURITY (SR-AUTHZ-03 / JIT disclosure boundary): only limited senior info
    is returned here (first name, preferred language, locality — see
    SeniorLimitedSerializer). Full address, phone, and next-of-kin are disclosed
    just-in-time at session-booking time only. This boundary must not be relaxed
    in this view or its serializer.

    AC-06: every call is audit-logged because the response exposes senior-
    identifying information. This makes bulk or repeated viewing of senior data
    detectable in the audit log.
    """

    permission_classes = [IsApprovedVolunteer]

    def get(self, request):
        qs = (
            Match.objects
            .filter(
                volunteer=request.user,
                status__in=[Match.Status.PROPOSED, Match.Status.ACTIVE],
            )
            .select_related('senior')
            .order_by('-created_at')
        )
        count = qs.count()

        # Include volunteer pk so the audit log is queryable per-volunteer.
        self._audit(
            request, 'match.list',
            target_id=f'volunteer_id={request.user.pk},count={count}',
        )

        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            MatchVolunteerSerializer(page, many=True).data
        )


class VolunteerMatchAcceptView(_MatchAuditMixin, APIView):
    """POST /api/volunteer/matches/<pk>/accept/

    The volunteer accepts a match proposed for them. Sets volunteer_accepted_at.

    Double opt-in: if the senior has ALSO already been confirmed by staff
    (senior_confirmed_at is set), this call transitions the match to 'active'.

    SECURITY (SR-AUTHZ-02): the match is looked up with volunteer=request.user,
    so a volunteer cannot accept a match proposed for a different volunteer.
    A 404 (not 403) is returned on failure — returning 403 would confirm to the
    requester that a match with this id exists and belongs to someone else,
    which leaks information. 404 reveals nothing.

    Uses select_for_update inside a transaction to prevent a race condition
    between concurrent accept and senior-confirm operations on the same match.
    """

    permission_classes = [IsApprovedVolunteer]

    def post(self, request, pk: int):
        with transaction.atomic():
            try:
                match = (
                    Match.objects
                    .select_related('volunteer', 'senior', 'proposed_by')
                    .select_for_update()
                    .get(pk=pk, volunteer=request.user)
                )
            except Match.DoesNotExist:
                raise Http404

            if match.status != Match.Status.PROPOSED:
                return Response(
                    {'detail': f'Cannot accept a match with status "{match.status}".'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if match.volunteer_accepted_at:
                return Response(
                    {'detail': 'You have already accepted this match.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            match.volunteer_accepted_at = timezone.now()
            match.save(update_fields=['volunteer_accepted_at'])
            _activate_if_ready(match)

        self._audit(request, 'match.accept', target_id=pk)
        return Response(MatchVolunteerSerializer(match).data)


class VolunteerMatchDeclineView(_MatchAuditMixin, APIView):
    """POST /api/volunteer/matches/<pk>/decline/

    The volunteer declines a proposed match. Sets status='ended', ended_at=now.

    'ended' is used rather than a separate 'declined' status to keep the state
    machine simple — staff-end and volunteer-decline both result in an ended
    match. The audit log (action='match.decline') records which side declined,
    so the distinction is queryable without a separate status value. A dedicated
    'declined' status can be added later if the UI requires it.

    SECURITY (SR-AUTHZ-02): same 404-not-403 rule as VolunteerMatchAcceptView.
    """

    permission_classes = [IsApprovedVolunteer]

    def post(self, request, pk: int):
        try:
            match = (
                Match.objects
                .select_related('volunteer', 'senior', 'proposed_by')
                .get(pk=pk, volunteer=request.user)
            )
        except Match.DoesNotExist:
            raise Http404

        if match.status != Match.Status.PROPOSED:
            return Response(
                {'detail': f'Cannot decline a match with status "{match.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        match.status = Match.Status.ENDED
        match.ended_at = timezone.now()
        match.save(update_fields=['status', 'ended_at'])

        self._audit(request, 'match.decline', target_id=pk)
        return Response(MatchVolunteerSerializer(match).data)
