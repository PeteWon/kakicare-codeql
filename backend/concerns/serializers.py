"""Welfare concern serializers.

ConcernCreateSerializer validates input from the volunteer.
ConcernReadSerializer is the full output shape used by both volunteer (201
response) and staff (list + resolve responses).
"""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from seniors.models import Senior
from sessions.models import Session

from .models import WelfareConcern

User = get_user_model()


class ConcernCreateSerializer(serializers.Serializer):
    """Input shape for POST /api/volunteer/concerns/.

    raised_by is always set server-side from request.user — it is intentionally
    absent here so a client can never impersonate another user.
    """

    target_type = serializers.ChoiceField(choices=WelfareConcern.TargetType.choices)
    target_senior = serializers.PrimaryKeyRelatedField(
        queryset=Senior.objects.all(),
        required=False,
        allow_null=True,
        default=None,
    )
    target_volunteer = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        required=False,
        allow_null=True,
        default=None,
    )
    description = serializers.CharField(max_length=5000)
    session = serializers.PrimaryKeyRelatedField(
        queryset=Session.objects.all(),
        required=False,
        allow_null=True,
        default=None,
        write_only=True,
    )

    def validate(self, data):
        target_type = data['target_type']
        has_senior = data.get('target_senior') is not None
        has_volunteer = data.get('target_volunteer') is not None

        if target_type == WelfareConcern.TargetType.SENIOR:
            if not has_senior:
                raise serializers.ValidationError(
                    {'target_senior': 'Required when target_type is "senior".'}
                )
            if has_volunteer:
                raise serializers.ValidationError(
                    {'target_volunteer': 'Must be omitted when target_type is "senior".'}
                )
        elif target_type == WelfareConcern.TargetType.VOLUNTEER:
            if not has_volunteer:
                raise serializers.ValidationError(
                    {'target_volunteer': 'Required when target_type is "volunteer".'}
                )
            if has_senior:
                raise serializers.ValidationError(
                    {'target_senior': 'Must be omitted when target_type is "volunteer".'}
                )

        return data


class ConcernReadSerializer(serializers.ModelSerializer):
    """Full output shape — used for 201 responses and staff list/resolve responses."""

    raised_by = serializers.SerializerMethodField()
    session = serializers.SerializerMethodField()
    target_senior = serializers.SerializerMethodField()
    target_volunteer = serializers.SerializerMethodField()
    resolved_by = serializers.SerializerMethodField()

    class Meta:
        model = WelfareConcern
        fields = [
            'id',
            'raised_by',
            'session',
            'target_type',
            'target_senior',
            'target_volunteer',
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
        if obj.target_senior_id is None:
            return None
        return {'id': obj.target_senior_id, 'full_name': obj.target_senior.full_name}

    def get_target_volunteer(self, obj):
        if obj.target_volunteer_id is None:
            return None
        u = obj.target_volunteer
        return {'id': u.pk, 'full_name': u.full_name}

    def get_resolved_by(self, obj):
        if obj.resolved_by_id is None:
            return None
        u = obj.resolved_by
        return {'id': u.pk, 'full_name': u.full_name}
