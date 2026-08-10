import json
from django.core.serializers.json import DjangoJSONEncoder
from .models import AuditLog


def client_ip(request):
    """The caller's IP, honouring a proxy header when one is present."""
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def record_audit(request, action, obj=None, changes=None, user=None):
    """Write an audit row outside a viewset.

    `AuditLogMixin.log_action` needs `self.request` and an authenticated user,
    which sign-in cannot satisfy: at that point there is either no user yet or,
    for a failed attempt, no user at all. Both are exactly the events worth
    recording, so they get a function rather than a mixin.
    """
    AuditLog.objects.create(
        user=user if user and user.is_authenticated else None,
        action=action,
        model_name=obj.__class__.__name__ if obj is not None else 'User',
        object_id=str(obj.pk) if obj is not None else '',
        changes=changes,
        ip_address=client_ip(request),
    )


class AuditLogMixin:
    def get_client_ip(self, request):
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip

    def log_action(self, action, obj, changes=None):
        if not hasattr(self, 'request') or not self.request.user.is_authenticated:
            return
            
        AuditLog.objects.create(
            user=self.request.user,
            action=action,
            model_name=obj.__class__.__name__,
            object_id=str(obj.pk),
            changes=changes,
            ip_address=self.get_client_ip(self.request)
        )

    def perform_create(self, serializer):
        obj = serializer.save()
        if hasattr(obj, 'created_by_id') and not getattr(obj, 'created_by_id', None):
            obj.created_by = self.request.user
            obj.save()
        self.log_action('CREATE', obj, serializer.data)

    def perform_update(self, serializer):
        obj = serializer.instance
        # Simple diff logic can be added here, but for now we just store the new data
        obj = serializer.save()
        self.log_action('UPDATE', obj, serializer.data)

    def perform_destroy(self, instance):
        self.log_action('DELETE', instance)
        instance.delete()
