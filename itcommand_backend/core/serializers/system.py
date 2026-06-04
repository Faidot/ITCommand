from rest_framework import serializers

from core.models.system import AppSettings, AuditLog, Location, Notification


class AppSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppSettings
        fields = ['id', 'key', 'value', 'description']


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.get_full_name', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            'id', 'user', 'user_name', 'user_email', 'action',
            'model_name', 'object_id', 'changes', 'ip_address', 'timestamp',
        ]


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            'id', 'user', 'message', 'notification_type',
            'is_read', 'link', 'created_at',
        ]


class LocationSerializer(serializers.ModelSerializer):
    asset_count = serializers.SerializerMethodField()

    class Meta:
        model = Location
        fields = [
            'id', 'name', 'code', 'address', 'description',
            'is_active', 'created_at', 'asset_count',
        ]
        read_only_fields = ['id', 'created_at', 'asset_count']

    def get_asset_count(self, obj):
        return obj.assets.count()
