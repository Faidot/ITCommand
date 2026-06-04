from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils import timezone
from core.models import ChecklistTemplate, ChecklistTemplateItem, OnboardingRecord, OnboardingTask, User
from core.serializers.onboarding import (
    ChecklistTemplateSerializer, ChecklistTemplateItemSerializer,
    OnboardingRecordSerializer, OnboardingRecordDetailSerializer,
    OnboardingTaskSerializer
)
from core.permissions import IsAdminOrSuperadmin, IsManagerOrHigher

class ChecklistTemplateViewSet(viewsets.ModelViewSet):
    queryset = ChecklistTemplate.objects.all()
    serializer_class = ChecklistTemplateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['get'])
    def items(self, request, pk=None):
        template = self.get_object()
        items = template.items.all()
        return Response(ChecklistTemplateItemSerializer(items, many=True).data)

class ChecklistTemplateItemViewSet(viewsets.ModelViewSet):
    queryset = ChecklistTemplateItem.objects.all()
    serializer_class = ChecklistTemplateItemSerializer
    permission_classes = [permissions.IsAuthenticated]

class OnboardingRecordViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return OnboardingRecordDetailSerializer
        return OnboardingRecordSerializer

    def get_queryset(self):
        qs = OnboardingRecord.objects.select_related('employee', 'template').all()
        
        process_type = self.request.query_params.get('process_type')
        status_param = self.request.query_params.get('status')
        employee = self.request.query_params.get('employee')

        if process_type:
            qs = qs.filter(process_type=process_type)
        if status_param:
            qs = qs.filter(status=status_param)
        if employee:
            qs = qs.filter(employee_id=employee)

        return qs.order_by('-created_at')

    def perform_create(self, serializer):
        record = serializer.save(created_by=self.request.user)
        
        # Auto-generate tasks from template
        if record.template:
            items = record.template.items.all()
            for item in items:
                OnboardingTask.objects.create(
                    record=record,
                    title=item.title,
                    description=item.description,
                    category=item.category,
                    assigned_role=item.assigned_role,
                    order=item.order
                )
        
        # Auto-link onboarding to seating
        if record.process_type == 'ONBOARDING':
            OnboardingTask.objects.create(
                record=record,
                title="Assign workstation seat",
                description="Assign a desk/workstation seat to the new employee.",
                category='HARDWARE',
                assigned_role='IT',
                order=999
            )
        elif record.process_type == 'OFFBOARDING':
            OnboardingTask.objects.create(
                record=record,
                title="Vacate and reassign seat",
                description="Vacate the employee's desk/seat and make it available.",
                category='HARDWARE',
                assigned_role='IT',
                order=999
            )

    @action(detail=True, methods=['get'])
    def tasks(self, request, pk=None):
        record = self.get_object()
        tasks = record.tasks.all()
        return Response(OnboardingTaskSerializer(tasks, many=True).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        record = self.get_object()
        record.status = 'COMPLETED'
        record.actual_completion_date = timezone.now().date()
        record.save()
        return Response({'status': 'Record marked as completed'})

class OnboardingTaskViewSet(viewsets.ModelViewSet):
    queryset = OnboardingTask.objects.all()
    serializer_class = OnboardingTaskSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_update(self, serializer):
        instance = serializer.save()
        if instance.status in ['DONE', 'SKIPPED'] and not instance.completed_at:
            instance.completed_at = timezone.now()
            instance.completed_by = self.request.user
            instance.save()
        
        # Update record status if all tasks done
        record = instance.record
        if record.status != 'COMPLETED':
            total = record.tasks.count()
            completed = record.tasks.filter(status__in=['DONE', 'SKIPPED']).count()
            if total > 0 and total == completed:
                record.status = 'COMPLETED'
                record.actual_completion_date = timezone.now().date()
                record.save()
            elif record.status == 'NOT_STARTED' and completed > 0:
                record.status = 'IN_PROGRESS'
                record.save()

class OnboardingDashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()

        active_on = OnboardingRecord.objects.filter(process_type='ONBOARDING').exclude(status='COMPLETED')
        active_off = OnboardingRecord.objects.filter(process_type='OFFBOARDING').exclude(status='COMPLETED')

        overdue_tasks = OnboardingTask.objects.filter(
            due_date__lt=today
        ).exclude(status__in=['DONE', 'SKIPPED'])

        # Completion stats (last 30 days)
        thirty_days_ago = today - timezone.timedelta(days=30)
        completed_records = OnboardingRecord.objects.filter(
            status='COMPLETED', 
            actual_completion_date__gte=thirty_days_ago
        )

        on_time = 0
        for rec in completed_records:
            if rec.target_completion_date and rec.actual_completion_date <= rec.target_completion_date:
                on_time += 1
                
        on_time_rate = round((on_time / completed_records.count() * 100) if completed_records.count() > 0 else 100, 1)

        return Response({
            'active_onboardings': OnboardingRecordSerializer(active_on, many=True).data,
            'active_offboardings': OnboardingRecordSerializer(active_off, many=True).data,
            'overdue_tasks': OnboardingTaskSerializer(overdue_tasks, many=True).data,
            'completion_stats': {
                'completed_last_30_days': completed_records.count(),
                'on_time_rate': on_time_rate
            }
        })
