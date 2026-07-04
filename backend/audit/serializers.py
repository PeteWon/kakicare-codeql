"""Read-only serializers for the audit log.

SECURITY (SR-AUD-02): AuditLogEntry is append-only. These serializers are used
exclusively for reading (GET /api/staff/audit-log). There is no write serializer
because audit entries are created exclusively via audit.services.record_audit —
never through the API.
"""

from rest_framework import serializers

from .models import AuditLogEntry


class AuditLogEntrySerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(
        source='user.email', read_only=True, allow_null=True
    )

    class Meta:
        model = AuditLogEntry
        fields = [
            'id',
            'user_id',
            'user_email',
            'user_role',
            'action',
            'target_type',
            'target_id',
            'metadata',
            'request_ip',
            'timestamp',
        ]
