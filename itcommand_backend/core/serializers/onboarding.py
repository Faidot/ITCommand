from rest_framework import serializers
from core.models import ChecklistTemplate, ChecklistTemplateItem, OnboardingRecord, OnboardingTask

class ChecklistTemplateItemSerializer(serializers.ModelSerializer):
    # Categories are admin-managed via the "onboarding_category" LOV group, so
    # accept any active value there rather than the model's static choices.
    category = serializers.CharField()

    class Meta:
        model = ChecklistTemplateItem
        fields = '__all__'

    def validate_category(self, value):
        from core.lov import is_valid

        code = (value or '').strip().upper()
        if not is_valid('onboarding_category', code):
            raise serializers.ValidationError(
                "Unknown category. Add it under List of Values first."
            )
        return code

class ChecklistTemplateSerializer(serializers.ModelSerializer):
    items = ChecklistTemplateItemSerializer(many=True, read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True)
    
    class Meta:
        model = ChecklistTemplate
        fields = '__all__'

class OnboardingTaskSerializer(serializers.ModelSerializer):
    # Copied from the template item, which now allows LOV-managed categories —
    # accept them here too instead of the model's static choices.
    category = serializers.CharField(required=False)
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
