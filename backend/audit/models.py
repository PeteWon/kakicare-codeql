"""Audit log model.

SECURITY (SR-AUD-02): the audit log is APPEND-ONLY. No update or delete path is
exposed anywhere — not in the API, and (in production) not in Django admin
either. Entries are written via audit.services.record_audit and never modified.

SECURITY (SR-AUD-03): entries must NOT contain sensitive payloads. Store only
references (actor, action, target type + id, IP) — never the contents of a
Senior record or other sensitive data.
"""

from django.conf import settings
from django.db import models


class AuditLogEntry(models.Model):
    """A single append-only audit record of a security-relevant action."""

    # Nullable so unauthenticated events (e.g. failed login) can still be logged.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_entries',
    )
    # Captured at write time so the role is preserved even if the user's role
    # later changes or the user is deleted.
    user_role = models.CharField(max_length=20, blank=True)

    action = models.CharField(max_length=100)

    # Reference to the affected object — type name + id only, never its contents.
    target_type = models.CharField(max_length=100, blank=True)
    target_id = models.CharField(max_length=64, blank=True)

    request_ip = models.GenericIPAddressField(null=True, blank=True)

    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name_plural = 'Audit log entries'
        ordering = ['-timestamp']

    def __str__(self):
        return f'AuditLogEntry({self.action} by user={self.user_id} at {self.timestamp})'
