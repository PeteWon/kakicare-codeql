"""Volunteer-initiated account deactivation: request + staff review/resolve."""

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import record_audit
from matching.models import Match
from sessions.models import Session

from ..models import User, VolunteerDeactivationRequest
from ..serializers import (
    VolunteerDeactivationRequestReadSerializer,
    VolunteerDeactivationRequestSerializer,
    VolunteerDeactivationResolveSerializer,
)
from ._common import _StandardPagination, _get_ip


class VolunteerDeactivationRequestView(APIView):
    """POST /api/auth/deactivation-request

    FR-V-17: a volunteer may request account deactivation, but the account is
    not deactivated until staff review and approve the request.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if request.user.role != User.Role.VOLUNTEER:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = VolunteerDeactivationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if VolunteerDeactivationRequest.objects.filter(
            requester=request.user,
            status=VolunteerDeactivationRequest.Status.PENDING,
        ).exists():
            return Response(
                {'detail': 'A deactivation request is already pending review.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        request_obj = VolunteerDeactivationRequest.objects.create(
            requester=request.user,
            reason=serializer.validated_data.get('reason', '').strip(),
        )
        record_audit(
            user=request.user,
            action='auth.deactivation.requested',
            target_type='VolunteerDeactivationRequest',
            target_id=request_obj.pk,
            request_ip=_get_ip(request),
        )

        return Response(
            VolunteerDeactivationRequestReadSerializer(request_obj).data,
            status=status.HTTP_201_CREATED,
        )


class StaffVolunteerDeactivationRequestListView(APIView):
    """GET /api/staff/deactivation-requests/

    FR-S-12: staff review queue for volunteer deactivation requests.
    Defaults to pending requests; pass ?status=approved or ?status=rejected to
    inspect resolved history.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role != User.Role.STAFF:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        status_param = request.query_params.get(
            'status',
            VolunteerDeactivationRequest.Status.PENDING,
        )
        if status_param not in VolunteerDeactivationRequest.Status.values:
            return Response(
                {
                    'status': (
                        'Invalid status. Choose from: '
                        f'{", ".join(VolunteerDeactivationRequest.Status.values)}.'
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = (
            VolunteerDeactivationRequest.objects
            .filter(status=status_param)
            .select_related('requester', 'reviewed_by')
            .order_by('-created_at')
        )
        count = qs.count()
        record_audit(
            user=request.user,
            action='auth.deactivation.list',
            target_type='VolunteerDeactivationRequest',
            target_id=f'status={status_param},count={count}',
            request_ip=_get_ip(request),
        )

        paginator = _StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            VolunteerDeactivationRequestReadSerializer(page, many=True).data
        )


class StaffVolunteerDeactivationRequestResolveView(APIView):
    """POST /api/staff/deactivation-requests/<id>/resolve/

    Approval deactivates the volunteer account, ends their non-ended matches,
    and cancels active/upcoming sessions in the same transaction.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk: int):
        if request.user.role != User.Role.STAFF:
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = VolunteerDeactivationResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        decision = serializer.validated_data['decision']
        staff_note = serializer.validated_data.get('staff_note', '').strip()

        with transaction.atomic():
            try:
                request_obj = (
                    VolunteerDeactivationRequest.objects
                    .select_related('requester')
                    .select_for_update()
                    .get(pk=pk)
                )
            except VolunteerDeactivationRequest.DoesNotExist:
                return Response(
                    {'detail': 'Deactivation request not found.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if request_obj.status != VolunteerDeactivationRequest.Status.PENDING:
                return Response(
                    {'detail': 'Deactivation request has already been resolved.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            now = timezone.now()
            target_user = request_obj.requester
            cancelled_sessions = 0
            ended_matches = 0

            request_obj.reviewed_by = request.user
            request_obj.reviewed_at = now
            request_obj.staff_note = staff_note

            if decision == 'approve':
                request_obj.status = VolunteerDeactivationRequest.Status.APPROVED
                target_user.is_active = False
                target_user.save(update_fields=['is_active'])

                ended_matches = (
                    Match.objects
                    .filter(volunteer=target_user)
                    .exclude(status=Match.Status.ENDED)
                    .update(status=Match.Status.ENDED, ended_at=now)
                )

                cancelled_sessions = (
                    Session.objects
                    .filter(
                        match__volunteer=target_user,
                        status__in=[
                            Session.Status.PENDING_CONFIRMATION,
                            Session.Status.CONFIRMED,
                            Session.Status.IN_PROGRESS,
                        ],
                    )
                    .update(
                        status=Session.Status.CANCELLED,
                        cancel_reason='Volunteer account deactivation approved.',
                    )
                )
                audit_action = 'auth.deactivation.approved'
            else:
                request_obj.status = VolunteerDeactivationRequest.Status.REJECTED
                audit_action = 'auth.deactivation.rejected'

            request_obj.save(
                update_fields=['status', 'reviewed_by', 'reviewed_at', 'staff_note']
            )

            record_audit(
                user=request.user,
                action=audit_action,
                target_type='VolunteerDeactivationRequest',
                target_id=request_obj.pk,
                metadata={
                    'target_user_id': target_user.pk,
                    'cancelled_session_count': cancelled_sessions,
                    'ended_match_count': ended_matches,
                },
                request_ip=_get_ip(request),
            )

        return Response(VolunteerDeactivationRequestReadSerializer(request_obj).data)
