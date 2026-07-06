"""Audit log view — staff-only, read-only.

SECURITY (AC-06): the audit log is a detection-and-response tool. Exposing it
to staff (not volunteers) gives those with oversight responsibility visibility
into who accessed which senior records, when, and from where. It supports
detection of insider misuse patterns (e.g. a single user bulk-reading all
senior records outside business hours, or repeated access to one individual's
record).

SECURITY (SR-AUD-02): this module exposes exactly ONE endpoint: GET (list).
There is NO create, update, or delete path anywhere in the audit app — not
here, not in Django admin (audit entries are excluded from the admin's change/
delete views). AuditLogEntry rows are written once by record_audit() and are
immutable thereafter.
"""

from django.utils.dateparse import parse_datetime
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsStaff

from .models import AuditLogEntry
from .serializers import AuditLogEntrySerializer


class _AuditPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200


class AuditLogListView(APIView):
    """GET /api/staff/audit-log/ — paginated, filterable audit log.

    AC-06: supports staff oversight and insider-misuse detection.
    Read-only — see module docstring for the append-only guarantee.

    Query parameters:
      ?target_id=<id>          entries for a specific target (e.g. a Senior id)
      ?target_type=<type>      e.g. 'Senior'
      ?user_id=<id>            entries for a specific acting user
      ?action=<action>         e.g. 'senior.read'
      ?timestamp_after=<iso>   entries on or after this ISO 8601 datetime
      ?timestamp_before=<iso>  entries on or before this ISO 8601 datetime
    """

    permission_classes = [IsStaff]

    def get(self, request):
        qs = AuditLogEntry.objects.select_related('user').order_by('-timestamp')

        target_id = request.query_params.get('target_id')
        if target_id:
            qs = qs.filter(target_id=target_id)

        target_type = request.query_params.get('target_type')
        if target_type:
            qs = qs.filter(target_type=target_type)

        user_id = request.query_params.get('user_id')
        if user_id:
            qs = qs.filter(user_id=user_id)

        action = request.query_params.get('action')
        if action:
            qs = qs.filter(action=action)

        # Silently ignore malformed datetimes rather than 400-ing on bad input.
        timestamp_after = request.query_params.get('timestamp_after')
        if timestamp_after:
            dt = parse_datetime(timestamp_after)
            if dt:
                qs = qs.filter(timestamp__gte=dt)

        timestamp_before = request.query_params.get('timestamp_before')
        if timestamp_before:
            dt = parse_datetime(timestamp_before)
            if dt:
                qs = qs.filter(timestamp__lte=dt)

        paginator = _AuditPagination()
        page = paginator.paginate_queryset(qs, request)
        return paginator.get_paginated_response(
            AuditLogEntrySerializer(page, many=True).data
        )
