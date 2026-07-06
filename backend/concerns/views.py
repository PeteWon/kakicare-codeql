"""Welfare concern views.

Endpoint layout:
  Volunteer-facing (/api/volunteer/concerns/):
    POST concerns/               raise a new welfare concern (FR-V-14)

  Staff-facing (/api/staff/concerns/):
    GET  concerns/               list all concerns, filterable by ?status=
    POST concerns/<pk>/resolve/  mark a concern resolved

SECURITY (SR-AUTHZ-01): every view declares a permission class explicitly.
SECURITY (SR-AUTHZ-02): session ownership is verified inline before linking a
  concern to a session: 404 (not 403) on mismatch to avoid leaking record
  existence.
SECURITY (SR-AUD-03): audit calls carry only concern pk, never description or
  resolution_note.
"""

import logging

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from sessions.models import Session
from accounts.permissions import IsApprovedVolunteer, IsStaff

from .audit import _ConcernAuditMixin
from .models import WelfareConcern
from .pagination import _StandardPagination
from .serializers import ConcernCreateSerializer, ConcernReadSerializer

logger = logging.getLogger(__name__)


class VolunteerConcernCreateView(_ConcernAuditMixin, APIView):
    """POST /api/volunteer/concerns/: raise a welfare concern.

    raised_by is always set from request.user, never accepted from the client.
    If a session pk is provided, ownership is verified before the concern is
    saved: 404 (not 403) on mismatch (SR-AUTHZ-02).
    """

    permission_classes = [IsApprovedVolunteer]

    def post(self, request):
        serializer = ConcernCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # SR-AUTHZ-02: if a session is supplied, verify it belongs to this
        # volunteer before linking. Return 404 (not 403) to avoid leaking existence.
        session = data.get('session')
        if session is not None:
            try:
                session = Session.objects.get(
                    pk=session.pk,
                    match__volunteer=request.user,
                )
            except Session.DoesNotExist:
                return Response(status=status.HTTP_404_NOT_FOUND)

        concern = WelfareConcern.objects.create(
            raised_by=request.user,
            session=session,
            target_senior=data['target_senior'],
            description=data['description'],
        )

        self._audit(request, 'concern.submitted', target_id=concern.pk)
        return Response(
            ConcernReadSerializer(concern).data,
            status=status.HTTP_201_CREATED,
        )


class StaffConcernListView(_ConcernAuditMixin, APIView):
    """GET /api/staff/concerns/: list all concerns.

    Supports ?status=open|resolved query param. Returns a paginated list.
    """

    permission_classes = [IsStaff]

    def get(self, request):
        qs = (
            WelfareConcern.objects
            .select_related(
                'raised_by',
                'session',
                'target_senior',
                'resolved_by',
            )
            .order_by('-created_at')
        )

        status_filter = request.query_params.get('status')
        if status_filter in (WelfareConcern.Status.OPEN, WelfareConcern.Status.RESOLVED):
            qs = qs.filter(status=status_filter)

        paginator = _StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            ConcernReadSerializer(page, many=True).data
        )


class StaffConcernResolveView(_ConcernAuditMixin, APIView):
    """POST /api/staff/concerns/<pk>/resolve/: mark a concern resolved.

    Body: { "resolution_note": "..." } (optional).
    Returns 409 if the concern is already resolved.
    """

    permission_classes = [IsStaff]

    def post(self, request, pk):
        try:
            concern = WelfareConcern.objects.select_related(
                'raised_by', 'session', 'target_senior', 'resolved_by',
            ).get(pk=pk)
        except WelfareConcern.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if concern.status == WelfareConcern.Status.RESOLVED:
            return Response(
                {'detail': 'This concern has already been resolved.'},
                status=status.HTTP_409_CONFLICT,
            )

        resolution_note = request.data.get('resolution_note', '')
        concern.status = WelfareConcern.Status.RESOLVED
        concern.resolved_by = request.user
        concern.resolved_at = timezone.now()
        concern.resolution_note = resolution_note
        concern.save(update_fields=['status', 'resolved_by', 'resolved_at', 'resolution_note'])

        self._audit(request, 'concern.resolved', target_id=concern.pk)
        return Response(ConcernReadSerializer(concern).data)
