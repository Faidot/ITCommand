from rest_framework import serializers
from django.contrib.auth import get_user_model
from core.models import TicketCategory, SLAPolicy, Ticket, TicketComment, TicketAttachment
from core.permissions import has_role_permission

User = get_user_model()


class TicketCategorySerializer(serializers.ModelSerializer):
    ticket_count = serializers.SerializerMethodField()

    class Meta:
        model = TicketCategory
        fields = '__all__'

    def get_ticket_count(self, obj):
        return obj.tickets.count()


class SLAPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = SLAPolicy
        fields = '__all__'


class TicketCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source='author.full_name', read_only=True)
    author_email = serializers.CharField(source='author.email', read_only=True)
    author_avatar = serializers.ImageField(source='author.avatar', read_only=True)

    class Meta:
        model = TicketComment
        fields = '__all__'
        read_only_fields = ['author', 'ticket']


class TicketAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(source='uploaded_by.full_name', read_only=True)

    class Meta:
        model = TicketAttachment
        fields = '__all__'
        read_only_fields = ['uploaded_by', 'ticket']


class TicketListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    requester_name = serializers.CharField(source='requester.full_name', read_only=True)
    requester_email = serializers.CharField(source='requester.email', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.full_name', read_only=True, default=None)
    category_name = serializers.CharField(source='category.name', read_only=True, default=None)
    category_icon = serializers.CharField(source='category.icon_name', read_only=True, default=None)
    is_overdue = serializers.BooleanField(read_only=True)
    sla_status = serializers.CharField(read_only=True)
    sla_progress_pct = serializers.FloatField(read_only=True)
    time_remaining_seconds = serializers.FloatField(read_only=True)

    class Meta:
        model = Ticket
        fields = [
            'id', 'ticket_number', 'title', 'priority', 'status',
            'requester', 'requester_name', 'requester_email',
            'assigned_to', 'assigned_to_name',
            'category', 'category_name', 'category_icon',
            'asset', 'due_date', 'is_overdue', 'sla_status',
            'sla_progress_pct', 'time_remaining_seconds',
            'created_at', 'updated_at', 'resolved_at', 'closed_at',
        ]


class TicketDetailSerializer(serializers.ModelSerializer):
    """Full serializer for detail views."""
    requester_name = serializers.CharField(source='requester.full_name', read_only=True)
    requester_email = serializers.CharField(source='requester.email', read_only=True)
    requester_avatar = serializers.ImageField(source='requester.avatar', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.full_name', read_only=True, default=None)
    assigned_to_email = serializers.CharField(source='assigned_to.email', read_only=True, default=None)
    category_name = serializers.CharField(source='category.name', read_only=True, default=None)
    category_icon = serializers.CharField(source='category.icon_name', read_only=True, default=None)
    asset_name = serializers.CharField(source='asset.name', read_only=True, default=None)
    asset_tag = serializers.CharField(source='asset.asset_tag', read_only=True, default=None)
    is_overdue = serializers.BooleanField(read_only=True)
    sla_status = serializers.CharField(read_only=True)
    sla_progress_pct = serializers.FloatField(read_only=True)
    time_remaining_seconds = serializers.FloatField(read_only=True)
    comments = serializers.SerializerMethodField()
    attachments = TicketAttachmentSerializer(many=True, read_only=True)
    suggested_kb_articles = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = '__all__'
        read_only_fields = ['ticket_number', 'requester', 'resolved_at', 'closed_at']

    def get_comments(self, obj):
        request = self.context.get('request')
        qs = obj.comments.all()
        # Self-service/view-only custom roles must never receive internal notes.
        can_manage = bool(request) and (
            has_role_permission(request.user, 'helpdesk', 'edit')
            or has_role_permission(request.user, 'helpdesk', 'delete')
        )
        if request and not can_manage:
            qs = qs.filter(is_internal=False)
        return TicketCommentSerializer(qs, many=True).data

    def get_suggested_kb_articles(self, obj):
        from core.serializers.kb import KBArticleListSerializer
        from core.views.kb import visible_to

        request = self.context.get('request')
        if not obj.category or not request:
            return []
        articles = visible_to(
            request.user,
            obj.category.kb_articles.filter(status='PUBLISHED'),
        ).order_by('-view_count')[:3]
        return KBArticleListSerializer(articles, many=True).data


class TicketCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ticket
        fields = ['title', 'description', 'category', 'priority', 'asset']

    def create(self, validated_data):
        validated_data['requester'] = self.context['request'].user
        return super().create(validated_data)
