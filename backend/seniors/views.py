"""Senior records views — staff-only, fully audit-logged.

Endpoint layout (all under /api/staff/seniors/, see seniors/staff_urls.py):
  POST    seniors/             — create a senior record
  GET     seniors/             — list seniors (paginated, filterable)
  GET     seniors/<id>/        — full detail
  PUT     seniors/<id>/        — full update
  PATCH   seniors/<id>/        — partial update
  POST    seniors/<id>/deactivate/  — soft-deactivate

SECURITY (SR-AUTHZ-01): every view declares IsStaff. Volunteers and unauthenticated
users are blocked server-side — the frontend never controls this decision.

SECURITY (AC-06, SR-AUD-01): every handler MUST call self._audit(...) before
returning. The _AuditMixin design enforces this structurally — inheriting the mixin
makes _audit available, and the code review contract is simple: grep for any Senior
view that lacks a _audit call. No Senior-data code path exists outside these views.
"""

import logging

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from kakicare.pagination import StandardPagination
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from audit.mixins import AuditMixin
from matching.models import Match
from sessions.models import Session
from accounts.permissions import IsStaff

from .models import Senior
from .serializers import SeniorSerializer

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Audit mixin — structural audit logging for every Senior view
# ---------------------------------------------------------------------------

class _AuditMixin(AuditMixin):
    """Wire audit logging into every Senior view.

    Design intent: all Senior-related views inherit this mixin. The single
    call point (_audit, from audit.mixins.AuditMixin) means there is NO code
    path to a Senior record that can accidentally skip the audit log — a
    reviewer only needs to confirm that each handler body calls self._audit once.

    AC-06, SR-AUD-01: every read and write of Senior data must be logged.
    SR-AUD-03: _audit logs only references (ids, action names, counts) — NEVER
    sensitive field values (address, phone, next-of-kin). The SeniorSerializer
    data must not be passed to the audit log.
    """

    audit_target_type = 'Senior'


# ---------------------------------------------------------------------------
# Throttle — bulk senior list is the highest-risk read in the system
# ---------------------------------------------------------------------------

class SeniorListThrottle(SimpleRateThrottle):
    """AC-02 / AC-06: rate-limit bulk listing of senior (elderly client) records.

    Listing all seniors exposes the most personal data in a single response.
    Throttling limits the volume an insider can silently exfiltrate in a short
    window and makes mass scraping detectable. Keyed by source IP.
    """

    scope = 'senior_list'

    def parse_rate(self, rate):
        # Hardcoded: 30 requests per 60 seconds (ignores the settings string
        # but the scope must still exist in DEFAULT_THROTTLE_RATES for DRF's
        # get_rate() lookup to succeed).
        return (30, 60)

    def get_cache_key(self, request, view):
        return self.cache_format % {
            'scope': self.scope,
            'ident': self.get_ident(request),
        }


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _get_senior_or_none(pk: int) -> Senior | None:
    try:
        return Senior.objects.select_related('created_by').get(pk=pk)
    except Senior.DoesNotExist:
        return None


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class SeniorListCreateView(_AuditMixin, APIView):
    """POST /api/staff/seniors/   — create a senior record
    GET  /api/staff/seniors/   — list seniors (paginated, filterable)

    AC-02 / AC-06: bulk listing is a sensitive operation — it returns ALL
    senior PII in a single paginated stream. The view is therefore:
      (a) rate-limited via SeniorListThrottle to cap exfiltration volume, and
      (b) audit-logged on every request so bulk-access patterns are detectable.

    Query parameters for GET:
      ?is_active=true|false   filter by active status (omit for all)
      ?search=<text>          case-insensitive match on full_name or address
    """

    permission_classes = [IsStaff]

    def get_throttles(self):
        # Only throttle GET (list). POST (create) uses the global default (none).
        if self.request.method == 'GET':
            return [SeniorListThrottle()]
        return []

    def get(self, request):
        qs = Senior.objects.select_related('created_by').order_by('-created_at')

        is_active_param = request.query_params.get('is_active')
        if is_active_param is not None:
            if is_active_param.lower() == 'true':
                qs = qs.filter(is_active=True)
            elif is_active_param.lower() == 'false':
                qs = qs.filter(is_active=False)

        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(full_name__icontains=search) | Q(address__icontains=search)
            )

        count = qs.count()

        # SR-AUD-01: audit the list access. We log count=N rather than every
        # individual id to keep entries compact while still recording scope.
        # SR-AUD-03: no Senior field values (address, phone, etc.) are logged.
        self._audit(request, 'senior.list', target_id=f'count={count}')

        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(SeniorSerializer(page, many=True).data)

    def post(self, request):
        serializer = SeniorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # created_by is set here, not from request.data (SR-AUTHZ-01).
        senior = serializer.save(created_by=request.user)

        self._audit(request, 'senior.create', target_id=senior.pk)

        return Response(SeniorSerializer(senior).data, status=status.HTTP_201_CREATED)


class SeniorDetailView(_AuditMixin, APIView):
    """GET / PUT / PATCH /api/staff/seniors/<pk>/"""

    permission_classes = [IsStaff]

    def get(self, request, pk: int):
        senior = _get_senior_or_none(pk)
        if senior is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        self._audit(request, 'senior.read', target_id=pk)
        return Response(SeniorSerializer(senior).data)

    def put(self, request, pk: int):
        return self._update(request, pk, partial=False)

    def patch(self, request, pk: int):
        return self._update(request, pk, partial=True)

    def _update(self, request, pk: int, partial: bool):
        senior = _get_senior_or_none(pk)
        if senior is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        serializer = SeniorSerializer(senior, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        senior = serializer.save()

        self._audit(request, 'senior.update', target_id=pk)
        return Response(SeniorSerializer(senior).data)


class SeniorDeactivateView(_AuditMixin, APIView):
    """POST /api/staff/seniors/<pk>/deactivate/

    Soft-deactivates (sets is_active=False) rather than deleting the row.

    Lifecycle cascade: deactivating a senior also ends the befriending
    relationship cleanly, in one transaction:
      - any non-ended matches for this senior are set to ENDED, and
      - any upcoming, not-yet-started sessions (PENDING_CONFIRMATION / CONFIRMED)
        under those matches are CANCELLED with an explanatory reason.
    A session already IN_PROGRESS is left alone — a visit happening right now
    must still be checked out and recorded. Completed/missed/cancelled sessions
    are historical and untouched. This prevents the incoherent state where a
    volunteer can keep booking or attending sessions for a senior who is no
    longer in the programme. The session-booking endpoint also re-checks
    is_active as defence-in-depth.

    Why soft-delete for sensitive personal records:
      - Preserves the full audit trail. Hard-deleting a Senior would leave
        AuditLogEntry rows pointing at a nonexistent target_id, breaking
        forensic reconstruction of who accessed this person's record.
      - Retains matching history and session records for compliance and data
        integrity (befriending visits already took place and must remain logged).
      - Allows reactivation if the senior returns to the programme without
        requiring data re-entry.
      - Any actual erasure of personal data (GDPR right-to-erasure) must go
        through a separate, explicitly authorised process — not an API call.
    """

    permission_classes = [IsStaff]

    def post(self, request, pk: int):
        try:
            senior = Senior.objects.get(pk=pk)
        except Senior.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if not senior.is_active:
            return Response(
                {'detail': 'Senior record is already inactive.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()
        with transaction.atomic():
            senior.is_active = False
            senior.save(update_fields=['is_active'])

            # End the relationship: no match for an inactive senior should remain
            # proposed/active. Bulk update keeps this a single statement.
            ended_matches = (
                Match.objects
                .filter(senior=senior)
                .exclude(status=Match.Status.ENDED)
                .update(status=Match.Status.ENDED, ended_at=now)
            )

            # Cancel upcoming sessions that have not started yet. IN_PROGRESS is
            # deliberately excluded so an in-flight visit can still be checked out.
            cancelled_sessions = (
                Session.objects
                .filter(
                    match__senior=senior,
                    status__in=[
                        Session.Status.PENDING_CONFIRMATION,
                        Session.Status.CONFIRMED,
                    ],
                )
                .update(
                    status=Session.Status.CANCELLED,
                    cancel_reason='Senior record deactivated.',
                )
            )

        self._audit(
            request, 'senior.deactivate',
            target_id=(
                f'{pk},ended_matches={ended_matches},'
                f'cancelled_sessions={cancelled_sessions}'
            ),
        )
        return Response(SeniorSerializer(senior).data)
