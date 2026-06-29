"""Audit logging mixin for concern views.

Mirrors _SessionAuditMixin in sessions/views.py exactly.
target_type is always 'WelfareConcern'.

SECURITY (SR-AUD-03): target_id carries only the WelfareConcern pk, never
description or resolution_note.
"""

from audit.services import record_audit


class _ConcernAuditMixin:

    @staticmethod
    def _get_ip(request) -> str | None:
        xff = request.META.get('HTTP_X_FORWARDED_FOR')
        return xff.split(',')[0].strip() if xff else request.META.get('REMOTE_ADDR')

    def _audit(self, request, action: str, target_id: str | int = '') -> None:
        record_audit(
            user=request.user,
            action=action,
            target_type='WelfareConcern',
            target_id=target_id,
            request_ip=self._get_ip(request),
        )
