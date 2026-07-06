"""Audit logging mixin for concern views.

Thin subclass of the shared audit.mixins.AuditMixin; target_type is always
'WelfareConcern'.

SECURITY (SR-AUD-03): target_id carries only the WelfareConcern pk, never
description or resolution_note.
"""

from audit.mixins import AuditMixin


class _ConcernAuditMixin(AuditMixin):
    audit_target_type = 'WelfareConcern'
