from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from datetime import timedelta
from django.db.models import Sum
from .models import Notification, Asset, RecurringBill, FinancialYear, Budget, Expense, Ticket, User, SoftwareLicense
from .serializers import NotificationSerializer
from .permissions import has_role_permission

class NotificationViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        # A notification created through the API always belongs to its caller.
        # System notifications for another user must be created by trusted
        # server-side code, never by accepting a client-supplied user id.
        serializer.save(user=self.request.user)

    def get_queryset(self):
        user = self.request.user

        # Polling clients only need the already-created inbox. The legacy
        # generators below scan several modules and may write notifications,
        # so let frequent refreshes explicitly request a side-effect-free read.
        if self.request.query_params.get('generate', 'true').lower() in {
            'false', '0', 'no',
        }:
            return Notification.objects.filter(
                user=user,
                is_read=False,
            ).order_by('-created_at')
        
        # Auto-generate notifications logic
        today = timezone.now().date()
        
        # 1. Warranty Expiring
        thirty_days = today + timedelta(days=30)
        expiring_assets = (
            Asset.objects.filter(
                warranty_expiry__gte=today,
                warranty_expiry__lte=thirty_days,
            )
            if has_role_permission(user, 'assets', 'view')
            else Asset.objects.none()
        )
        for asset in expiring_assets:
            msg = f"Warranty for '{asset.name}' ({asset.asset_tag}) expires on {asset.warranty_expiry}."
            if not Notification.objects.filter(user=user, message=msg, is_read=False).exists():
                Notification.objects.create(user=user, message=msg, notification_type='WARRANTY', link='/assets')

        # 2. Recurring Bill Due
        seven_days = today + timedelta(days=7)
        due_bills = (
            RecurringBill.objects.filter(
                is_active=True,
                next_due_date__gte=today,
                next_due_date__lte=seven_days,
            )
            if has_role_permission(user, 'finance', 'view')
            else RecurringBill.objects.none()
        )
        for bill in due_bills:
            msg = f"Bill '{bill.title}' from {bill.vendor} is due on {bill.next_due_date}."
            if not Notification.objects.filter(user=user, message=msg, is_read=False).exists():
                Notification.objects.create(user=user, message=msg, notification_type='BILL', link='/finance/bills')

        # 3. Budget Exceeding 90%
        active_fy = FinancialYear.objects.filter(is_active=True).first()
        if active_fy and has_role_permission(user, 'finance', 'view'):
            budgets = Budget.objects.filter(financial_year=active_fy)
            for b in budgets:
                spent = Expense.objects.filter(
                    category=b.category,
                    financial_year=active_fy,
                    status='APPROVED',
                ).aggregate(Sum('amount'))['amount__sum'] or 0
                if b.allocated_amount > 0 and (spent / b.allocated_amount) >= 0.9:
                    msg = f"Budget for {b.category.name} has exceeded 90% utilization."
                    if not Notification.objects.filter(user=user, message=msg, is_read=False).exists():
                        Notification.objects.create(user=user, message=msg, notification_type='BUDGET', link='/finance/budget')

        # 4. Overdue Tickets — notify assignee + admins
        if has_role_permission(user, 'helpdesk', 'view'):
            overdue_tickets = Ticket.objects.exclude(
                status__in=['RESOLVED', 'CLOSED']
            ).filter(due_date__lt=timezone.now())

            for ticket in overdue_tickets:
                msg = f"Ticket {ticket.ticket_number} '{ticket.title}' is overdue."
                link = f"/helpdesk/tickets/{ticket.id}"
                # Notify assignee
                if ticket.assigned_to and ticket.assigned_to == user:
                    if not Notification.objects.filter(user=user, message=msg, is_read=False).exists():
                        Notification.objects.create(user=user, message=msg, notification_type='TICKET', link=link)
                # Notify admins
                elif (
                    has_role_permission(user, 'helpdesk', 'edit')
                    or has_role_permission(user, 'helpdesk', 'delete')
                ):
                    if not Notification.objects.filter(user=user, message=msg, is_read=False).exists():
                        Notification.objects.create(user=user, message=msg, notification_type='TICKET', link=link)

        return Notification.objects.filter(user=user).order_by('-created_at')

    @action(detail=True, methods=['post'])
    def read(self, request, pk=None):
        notif = self.get_object()
        notif.is_read = True
        notif.save()
        return Response({'status': 'marked as read'})
