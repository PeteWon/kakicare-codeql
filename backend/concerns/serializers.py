"""Welfare concern serializers.

ConcernCreateSerializer validates input from the volunteer.
ConcernReadSerializer is the full output shape used by both volunteer (201
response) and staff (list + resolve responses).
"""

from rest_framework import serializers

from seniors.models import Senior
from sessions.models import Session

from .models import WelfareConcern


class ConcernCreateSerializer(serializers.Serializer):
    """Input shape for POST /api/volunteer/concerns/.

    raised_by is always set server-side from request.user. It is intentionally
    absent here so a client can never impersonate another user.
    """

    target_senior = serializers.PrimaryKeyRelatedField(
        queryset=Senior.objects.all(),
    )
    description = serializers.CharField(max_length=5000)
    session = serializers.PrimaryKeyRelatedField(
        queryset=Session.objects.all(),
        required=False,
        allow_null=True,
        default=None,
        write_only=True,
    )


class ConcernReadSerializer(serializers.ModelSerializer):
    """Full output shape used for 201 responses and staff list/resolve responses."""

    raised_by = serializers.SerializerMethodField()
    session = serializers.SerializerMethodField()
    target_senior = serializers.SerializerMethodField()
    resolved_by = serializers.SerializerMethodField()

    class Meta:
        model = WelfareConcern
        fields = [
            'id',
            'raised_by',
            'session',
            'target_senior',
            'description',
            'status',
            'resolved_by',
            'resolution_note',
            'created_at',
            'resolved_at',
        ]

    def get_raised_by(self, obj):
        u = obj.raised_by
        return {'id': u.pk, 'full_name': u.full_name}

    def get_session(self, obj):
        if obj.session_id is None:
            return None
        return {'id': obj.session_id}

    def get_target_senior(self, obj):
        return {'id': obj.target_senior_id, 'full_name': obj.target_senior.full_name}

    def get_resolved_by(self, obj):
        if obj.resolved_by_id is None:
            return None
        u = obj.resolved_by
        return {'id': u.pk, 'full_name': u.full_name}
