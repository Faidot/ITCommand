from rest_framework import serializers
from core.models.procurement import PurchaseRequest, PurchaseRequestItem, PRApprovalLog, PRDocument


class PurchaseRequestItemSerializer(serializers.ModelSerializer):
    estimated_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    actual_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = PurchaseRequestItem
        fields = '__all__'
        read_only_fields = ['received_quantity', 'status']


class PRApprovalLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source='actor.full_name', read_only=True)
    actor_email = serializers.CharField(source='actor.email', read_only=True)

    class Meta:
        model = PRApprovalLog
        fields = '__all__'
        read_only_fields = ['pr', 'actor', 'timestamp']


class PRDocumentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(source='uploaded_by.full_name', read_only=True)

    class Meta:
        model = PRDocument
        fields = '__all__'
        read_only_fields = ['uploaded_by', 'uploaded_at']


class PurchaseRequestListSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.CharField(source='requested_by.full_name', read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True, default=None)
    vendor_name = serializers.CharField(source='preferred_vendor.name', read_only=True, default=None)
    budget_category_name = serializers.CharField(source='budget_category.name', read_only=True, default=None)
    items_count = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseRequest
        fields = [
            'id', 'pr_number', 'title', 'description', 'requested_by', 'requested_by_name',
            'department', 'department_name', 'priority', 'status',
            'preferred_vendor', 'vendor_name', 'required_by_date',
            'budget_category', 'budget_category_name',
            'total_estimated_cost', 'total_actual_cost',
            'items_count', 'created_at', 'updated_at'
        ]

    def get_items_count(self, obj):
        return obj.items.count()


class PurchaseRequestDetailSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.CharField(source='requested_by.full_name', read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True, default=None)
    vendor_name = serializers.CharField(source='preferred_vendor.name', read_only=True, default=None)
    budget_category_name = serializers.CharField(source='budget_category.name', read_only=True, default=None)
    approved_by_name = serializers.CharField(source='approved_by.full_name', read_only=True, default=None)
    items = PurchaseRequestItemSerializer(many=True, read_only=True)
    approval_logs = PRApprovalLogSerializer(many=True, read_only=True)
    documents = PRDocumentSerializer(many=True, read_only=True)

    class Meta:
        model = PurchaseRequest
        fields = '__all__'
        read_only_fields = [
            'pr_number', 'total_estimated_cost', 'total_actual_cost',
            'approved_by', 'approved_at', 'created_at', 'updated_at'
        ]


class PRItemInlineSerializer(serializers.Serializer):
    """Lightweight serializer for inline item creation (no pr FK needed)."""
    item_name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    quantity = serializers.IntegerField(default=1, min_value=1)
    unit = serializers.CharField(max_length=50, default='pcs')
    estimated_unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, default=0)
    category = serializers.ChoiceField(
        choices=['HARDWARE', 'SOFTWARE', 'PERIPHERAL', 'SERVICE', 'CONSUMABLE', 'OTHER'],
        default='OTHER'
    )


class PurchaseRequestCreateSerializer(serializers.ModelSerializer):
    items = PRItemInlineSerializer(many=True, required=False)

    class Meta:
        model = PurchaseRequest
        fields = [
            'title', 'description', 'department', 'priority', 'justification',
            'preferred_vendor', 'required_by_date', 'budget_category', 'notes', 'items'
        ]

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        pr = PurchaseRequest.objects.create(**validated_data)

        for item_data in items_data:
            PurchaseRequestItem.objects.create(pr=pr, **item_data)

        pr.recalculate_total()
        return pr
