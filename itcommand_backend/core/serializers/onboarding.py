from rest_framework import serializers
from core.models import ChecklistTemplate, ChecklistTemplateItem, OnboardingRecord, OnboardingTask

class ChecklistTemplateItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChecklistTemplateItem
        fields = '__all__'

class ChecklistTemplateSerializer(serializers.ModelSerializer):
    items = ChecklistTemplateItemSerializer(many=True, read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True)
    
    class Meta:
        model = ChecklistTemplate
        fields = '__all__'

class OnboardingTaskSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.CharField(source='assigned_to.full_name', read_only=True, default=None)
    completed_by_name = serializers.CharField(source='completed_by.full_name', read_only=True, default=None)

    class Meta:
        model = OnboardingTask
        fields = '__all__'

class OnboardingRecordSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_avatar = serializers.CharField(source='employee.avatar', read_only=True)
    template_name = serializers.CharField(source='template.name', read_only=True)
    progress_stats = serializers.ReadOnlyField()
    
    class Meta:
        model = OnboardingRecord
        fields = '__all__'

class OnboardingRecordDetailSerializer(OnboardingRecordSerializer):
    tasks = OnboardingTaskSerializer(many=True, read_only=True)
