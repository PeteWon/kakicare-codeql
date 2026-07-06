"""Shared structural audit-logging mixin for views.

Every view that touches sensitive data inherits this mixin and calls
``self._audit(request, action, target_id)`` exactly once per handler. Because
the single write path is ``audit.services.record_audit``, a reviewer only needs
to confirm each handler body calls ``self._audit`` — there is no code path to
sensitive data that can silently skip the audit log.

Subclasses set ``audit_target_type`` (e.g. 'Senior', 'Session', 'Match',
'WelfareConcern'); a call may override it per-action via the ``target_type`` kwarg.

SECURITY (SR-AUD-03): ``target_id`` carries only a pk or short summary — NEVER
sensitive field values (address, phone, next-of-kin, free-text descriptions).
"""

from __future__ import annotations

from .services import get_client_ip, record_audit


class AuditMixin:
    """Mixin providing a single ``_audit`` entry point for view handlers."""

    #: Type name recorded on AuditLogEntry.target_type for this view's actions.
    audit_target_type: str = ''

    @staticmethod
    def _get_ip(request) -> str | None:
        # Retained for backward compatibility; delegates to the shared helper.
        return get_client_ip(request)

    def _audit(
        self,
        request,
        action: str,
        target_id: str | int = '',
        *,
        target_type: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        record_audit(
            user=request.user,
            action=action,
            target_type=target_type if target_type is not None else self.audit_target_type,
            target_id=target_id,
            request_ip=get_client_ip(request),
            metadata=metadata,
        )
