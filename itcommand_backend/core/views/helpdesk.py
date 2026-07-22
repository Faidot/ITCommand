from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.pagination import PageNumberPagination
from django.utils import timezone
from django.db.models import Q, Count, Avg, F
from datetime import timedelta

from core.models import (
    TicketCategory, SLAPolicy, Ticket, TicketComment, TicketAttachment,
    Notification, User
)
from core.serializers.helpdesk import (
    TicketCategorySerializer, SLAPolicySerializer,
    TicketListSerializer, TicketDetailSerializer, TicketCreateSerializer,
    TicketCommentSerializer, TicketAttachmentSerializer
)
from core.permissions import (
    IsAdminOrSuperadmin, IsManagerOrHigher, ReadOnlyViewerOrHigher,
    HasModulePermission, has_role_permission,
)
from core.mixins import AuditLogMixin


# ─── Helpers ──────────────────────────────────────────────────────────
def create_notification(user, message, notification_type='TICKET', link=None):
    """Helper to create a notification for a user."""
    if user:
        Notification.objects.create(
            user=user,
            message=message,
            notification_type=notification_type,
            link=link or '/helpdesk/tickets'
        )


def notify_admins(message, notification_type='TICKET', link=None):
    """Notify all ADMIN and SUPERADMIN users."""
    admins = User.objects.filter(role__in=['ADMIN', 'SUPERADMIN'], is_active=True)
    for admin in admins:
        create_notification(admin, message, notification_type, link)


def can_manage_helpdesk(user):
    """Roles with edit/delete access can see and operate on the full queue."""
    return (
        has_role_permission(user, 'helpdesk', 'edit')
        or has_role_permission(user, 'helpdesk', 'delete')
    )


class TicketPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


# ─── TicketCategory CRUD ────────────────────────────────────────────
class TicketCategoryViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = TicketCategory.objects.all()
    serializer_class = TicketCategorySerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'settings'


# ─── SLA Policy CRUD ────────────────────────────────────────────────
class SLAPolicyViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = SLAPolicy.objects.all()
    serializer_class = SLAPolicySerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'settings'


# ─── Ticket ViewSet ─────────────────────────────────────────────────
class TicketViewSet(AuditLogMixin, viewsets.ModelViewSet):
    permission_classes = [HasModulePermission]
    rbac_module = 'helpdesk'
    rbac_action_permissions = {
        'comments': {'POST': 'add'},
        'attachments': {'POST': 'add'},
    }
    pagination_class = TicketPagination

    def get_serializer_class(self):
        if self.action == 'create':
            return TicketCreateSerializer
        if self.action in ['list']:
            return TicketListSerializer
        return TicketDetailSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Ticket.objects.select_related(
            'category', 'requester', 'assigned_to', 'asset'
        )

        # Self-service/view-only roles can only see tickets they submitted.
        # Custom roles gain queue-wide visibility only with edit/delete access.
        if not can_manage_helpdesk(user):
            qs = qs.filter(requester=user)

        # Filters
        params = self.request.query_params
        status_filter = params.get('status')
        priority = params.get('priority')
        category = params.get('category')
        assigned_to = params.get('assigned_to')
        requester = params.get('requester')
        is_overdue = params.get('is_overdue')
        search = params.get('search')

        if status_filter:
            # Support comma-separated multi-status
            statuses = [s.strip() for s in status_filter.split(',')]
            qs = qs.filter(status__in=statuses)
        if priority:
            qs = qs.filter(priority=priority)
        if category:
            qs = qs.filter(category_id=category)
        if assigned_to:
            qs = qs.filter(assigned_to_id=assigned_to)
        if requester:
            qs = qs.filter(requester_id=requester)
        if is_overdue == 'true':
            qs = qs.exclude(status__in=['RESOLVED', 'CLOSED']).filter(
                due_date__lt=timezone.now()
            )
        if search:
            qs = qs.filter(
                Q(ticket_number__icontains=search) |
                Q(title__icontains=search) |
                Q(requester__full_name__icontains=search) |
                Q(requester__email__icontains=search)
            )

        return qs.order_by('-created_at')

    def perform_create(self, serializer):
        ticket = serializer.save()
        self.log_action('CREATE', ticket, serializer.data)

    # POST /tickets/{id}/assign/
    @action(detail=True, methods=['post'], permission_classes=[HasModulePermission])
    def assign(self, request, pk=None):
        ticket = self.get_object()
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'detail': 'user_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            assignee = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        old_assignee = ticket.assigned_to
        ticket.assigned_to = assignee
        if ticket.status == 'OPEN':
            ticket.status = 'IN_PROGRESS'
        ticket.save()

        # Create assignment comment
        TicketComment.objects.create(
            ticket=ticket,
            author=request.user,
            body=f"Ticket assigned to {assignee.full_name}",
            is_internal=True
        )

        # Notification: assignee
        create_notification(
            assignee,
            f"Ticket {ticket.ticket_number} has been assigned to you: {ticket.title}",
            link=f"/helpdesk/tickets/{ticket.id}"
        )

        self.log_action('UPDATE', ticket, {'action': 'assign', 'assigned_to': user_id})
        return Response(TicketDetailSerializer(ticket, context={'request': request}).data)

    # POST /tickets/{id}/status/
    @action(detail=True, methods=['post'], url_path='status')
    def change_status(self, request, pk=None):
        ticket = self.get_object()
        new_status = request.data.get('status')
        note = request.data.get('note', '')

        valid_statuses = [s[0] for s in Ticket.STATUS_CHOICES]
        if new_status not in valid_statuses:
            return Response({'detail': f'Invalid status. Choose from: {valid_statuses}'}, status=status.HTTP_400_BAD_REQUEST)

        old_status = ticket.status
        ticket.status = new_status

        if new_status == 'RESOLVED' and not ticket.resolved_at:
            ticket.resolved_at = timezone.now()
        if new_status == 'CLOSED' and not ticket.closed_at:
            ticket.closed_at = timezone.now()
            if not ticket.resolved_at:
                ticket.resolved_at = timezone.now()

        ticket.save()

        # Create status change comment
        body = f"Status changed from {old_status} to {new_status}"
        if note:
            body += f": {note}"
        TicketComment.objects.create(
            ticket=ticket,
            author=request.user,
            body=body,
            is_internal=True
        )

        # Notification: requester on resolve
        if new_status == 'RESOLVED':
            create_notification(
                ticket.requester,
                f"Your ticket {ticket.ticket_number} has been resolved.",
                link=f"/helpdesk/tickets/{ticket.id}"
            )

        self.log_action('UPDATE', ticket, {'action': 'status_change', 'from': old_status, 'to': new_status})
        return Response(TicketDetailSerializer(ticket, context={'request': request}).data)

    # POST /tickets/{id}/comments/
    @action(detail=True, methods=['get', 'post'], url_path='comments')
    def comments(self, request, pk=None):
        ticket = self.get_object()

        if request.method == 'GET':
            qs = ticket.comments.all()
            if not can_manage_helpdesk(request.user):
                qs = qs.filter(is_internal=False)
            return Response(TicketCommentSerializer(qs, many=True).data)

        # POST
        body = request.data.get('body', '').strip()
        if not body:
            return Response({'detail': 'Comment body is required.'}, status=status.HTTP_400_BAD_REQUEST)

        is_internal = request.data.get('is_internal', False)
        # Only MANAGER+ can set internal flag
        if is_internal and request.user.role not in ['MANAGER', 'ADMIN', 'SUPERADMIN']:
            is_internal = False

        comment = TicketComment.objects.create(
            ticket=ticket,
            author=request.user,
            body=body,
            is_internal=is_internal
        )

        # Notifications
        if not is_internal:
            # Notify requester if commenter is not the requester
            if request.user != ticket.requester:
                create_notification(
                    ticket.requester,
                    f"New comment on your ticket {ticket.ticket_number}",
                    link=f"/helpdesk/tickets/{ticket.id}"
                )
            # Notify assignee if commenter is not the assignee
            if ticket.assigned_to and request.user != ticket.assigned_to:
                create_notification(
                    ticket.assigned_to,
                    f"New comment on ticket {ticket.ticket_number}",
                    link=f"/helpdesk/tickets/{ticket.id}"
                )

        return Response(TicketCommentSerializer(comment).data, status=status.HTTP_201_CREATED)

    # POST /tickets/{id}/attachments/
    @action(detail=True, methods=['post', 'get'], url_path='attachments',
            parser_classes=[MultiPartParser, FormParser])
    def attachments(self, request, pk=None):
        ticket = self.get_object()

        if request.method == 'GET':
            return Response(TicketAttachmentSerializer(ticket.attachments.all(), many=True).data)

        file = request.FILES.get('file')
        if not file:
            return Response({'detail': 'File is required.'}, status=status.HTTP_400_BAD_REQUEST)

        attachment = TicketAttachment.objects.create(
            ticket=ticket,
            file=file,
            uploaded_by=request.user
        )
        return Response(TicketAttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED)


# ─── Helpdesk Dashboard ─────────────────────────────────────────────
class HelpdeskDashboardView(APIView):
    permission_classes = [HasModulePermission]
    rbac_module = 'helpdesk'

    def get(self, request):
        now = timezone.now()
        thirty_days_ago = now - timedelta(days=30)

        all_tickets = Ticket.objects.all()
        if not can_manage_helpdesk(request.user):
            all_tickets = all_tickets.filter(requester=request.user)

        # Counts by status
        status_counts = dict(
            all_tickets.values_list('status').annotate(count=Count('id')).values_list('status', 'count')
        )

        # Counts by priority
        priority_counts = dict(
            all_tickets.values_list('priority').annotate(count=Count('id')).values_list('priority', 'count')
        )

        # Overdue count
        overdue_count = all_tickets.exclude(
            status__in=['RESOLVED', 'CLOSED']
        ).filter(due_date__lt=now).count()

        # Average resolution time (last 30 days)
        resolved_recently = all_tickets.filter(
            resolved_at__isnull=False,
            resolved_at__gte=thirty_days_ago
        )
        avg_resolution = None
        if resolved_recently.exists():
            durations = []
            for t in resolved_recently:
                delta = (t.resolved_at - t.created_at).total_seconds() / 3600
                durations.append(delta)
            avg_resolution = round(sum(durations) / len(durations), 1) if durations else None

        # Tickets by category (for chart)
        tickets_by_category = list(
            all_tickets.filter(category__isnull=False)
            .values('category__name')
            .annotate(count=Count('id'))
            .order_by('-count')
        )

        # Tickets by priority (for pie chart)
        tickets_by_priority = [
            {'name': p, 'value': priority_counts.get(p, 0)}
            for p in ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
        ]

        # My assigned tickets (for IT staff)
        my_open_tickets = []
        if can_manage_helpdesk(request.user):
            my_qs = all_tickets.filter(
                assigned_to=request.user
            ).exclude(status__in=['RESOLVED', 'CLOSED']).order_by('-created_at')[:10]
            my_open_tickets = TicketListSerializer(my_qs, many=True).data

        # Recent tickets (last 10)
        recent_tickets = TicketListSerializer(
            all_tickets.order_by('-created_at')[:10], many=True
        ).data

        # Resolved today count
        resolved_today = all_tickets.filter(
            resolved_at__date=now.date()
        ).count()

        return Response({
            'status_counts': {
                'open': status_counts.get('OPEN', 0),
                'in_progress': status_counts.get('IN_PROGRESS', 0),
                'pending': status_counts.get('PENDING', 0),
                'resolved': status_counts.get('RESOLVED', 0),
                'closed': status_counts.get('CLOSED', 0),
            },
            'priority_counts': priority_counts,
            'overdue_count': overdue_count,
            'avg_resolution_time_hours': avg_resolution,
            'tickets_by_category': [
                {'name': t['category__name'], 'count': t['count']}
                for t in tickets_by_category
            ],
            'tickets_by_priority': tickets_by_priority,
            'my_open_tickets': my_open_tickets,
            'recent_tickets': recent_tickets,
            'resolved_today': resolved_today,
        })
