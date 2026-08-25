from rest_framework import serializers

from core.models.mailboxes import ManagedMailbox


class ManagedMailboxSerializer(serializers.ModelSerializer):
    """What the mailbox console renders.

    Derived state is computed on the model rather than in the frontend, so the
    console and any script agree on what "pending deletion" means.
    """

    status = serializers.CharField(read_only=True)
    local_part = serializers.CharField(read_only=True)
    is_shared = serializers.BooleanField(read_only=True)
    pending_deletion = serializers.BooleanField(read_only=True)
    days_until_purge = serializers.IntegerField(read_only=True)
    usage_percent = serializers.FloatField(read_only=True)
    quota_gb = serializers.FloatField(read_only=True)
    disk_used_gb = serializers.FloatField(read_only=True)

    user_email = serializers.CharField(source="user.email", read_only=True, default=None)
    user_name = serializers.CharField(source="user.full_name", read_only=True, default=None)
    user_is_active = serializers.BooleanField(source="user.is_active", read_only=True, default=None)

    class Meta:
        model = ManagedMailbox
        fields = [
            "id", "address", "local_part", "domain",
            "user", "user_email", "user_name", "user_is_active", "is_shared",
            "quota_mb", "disk_used_mb", "quota_gb", "disk_used_gb", "usage_percent",
            "suspended", "status", "mail_app_enabled",
            "exists_in_cpanel", "missing_since",
            "pending_deletion", "days_until_purge", "purge_after",
            "deletion_requested_at", "deletion_requested_by", "deletion_reason",
            "purged_at", "provisioned_at", "last_synced_at", "created_at",
        ]
        # Everything meaningful changes through an explicit action that talks
        # to cPanel first. A PATCH that silently edited `suspended` would leave
        # the row disagreeing with the mail server.
        read_only_fields = [f for f in fields if f != "user"]
