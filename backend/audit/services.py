"""Audit logging helper.

`record_audit(...)` is the single entry point for writing audit entries. Other
apps call it; it is intentionally simple and side-effect-only (write one row).

SECURITY (AC-06, SR-AUD-01): ALL read and write access to Senior records must be
audited via this helper — every view/serializer/service that reads or mutates a
Senior must call record_audit so access to sensitive data is fully traceable.
(There are no views yet; this helper exists so that wiring is trivial later.)

SECURITY (SR-AUD-03): pass only references (target type + id), never sensitive
record contents, in the arguments below.
"""

from __future__ import annotations

from .models import AuditLogEntry


def record_audit(
    *,
    user=None,
    action: str,
    target_type: str = '',
    target_id: str | int = '',
    request_ip: str | None = None,
    user_role: str | None = None,
) -> AuditLogEntry:
    """Write a single append-only audit entry and return it.

    Args:
        user: the acting User, or None for unauthenticated events.
        action: short action string, e.g. "senior.viewed", "volunteer.approved".
        target_type: type name of the affected object, e.g. "Senior".
        target_id: id of the affected object (no contents).
        request_ip: source IP of the request, if available.
        user_role: overrides the role recorded; defaults to user.role if present.
    """
    if user_role is None:
        user_role = getattr(user, 'role', '') or ''

    return AuditLogEntry.objects.create(
        user=user,
        user_role=user_role,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id != '' else '',
        request_ip=request_ip,
    )
