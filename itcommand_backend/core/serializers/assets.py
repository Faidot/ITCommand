from rest_framework import serializers

from core.models.assets import (
    Asset, AssetCategory, AssetHistory, AssetMaintenance, AssetNote,
    AssetUnitAssignment,
)
from core.asset_specs import validate_asset_specs
from django.core.exceptions import ValidationError as DjangoValidationError


class AssetCategorySerializer(serializers.ModelSerializer):
    asset_count = serializers.SerializerMethodField()

    class Meta:
        model = AssetCategory
        fields = [
            'id', 'name', 'code', 'icon', 'description',
            'is_serialized', 'bulk_allowed', 'spec_schema',
            'is_active', 'created_at', 'asset_count',
        ]
        read_only_fields = ['id', 'created_at', 'asset_count']

    def get_asset_count(self, obj):
        return obj.asset_set.count()

    def validate_spec_schema(self, value):
        """spec_schema must be a list of dicts with at least 'key', 'label', 'type'."""
        if value in (None, ''):
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("spec_schema must be a list.")
        allowed_types = {'text', 'number', 'select', 'date', 'bool'}
        seen_keys = set()
        for i, item in enumerate(value):
            if not isinstance(item, dict):
                raise serializers.ValidationError(f"Field {i} must be an object.")
            key = item.get('key')
            label = item.get('label')
            ftype = item.get('type')
            if not key or not isinstance(key, str):
                raise serializers.ValidationError(f"Field {i}: 'key' is required.")
            if key in seen_keys:
                raise serializers.ValidationError(f"Field {i}: duplicate key '{key}'.")
            seen_keys.add(key)
            if not label or not isinstance(label, str):
                raise serializers.ValidationError(f"Field {i}: 'label' is required.")
            if ftype not in allowed_types:
                raise serializers.ValidationError(
                    f"Field {i}: 'type' must be one of {sorted(allowed_types)}."
                )
            if ftype == 'select':
                opts = item.get('options', [])
                if not isinstance(opts, list) or not opts:
                    raise serializers.ValidationError(
                        f"Field {i}: select type requires non-empty 'options' list."
                    )
        return value


class AssetUnitAssignmentSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.full_name', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True)
    assigned_by_name = serializers.CharField(source='assigned_by.full_name', read_only=True)

    class Meta:
        model = AssetUnitAssignment
        fields = [
            'id', 'asset', 'user', 'user_name', 'user_email',
            'assigned_by', 'assigned_by_name',
            'assigned_date', 'returned_date', 'is_active', 'notes',
        ]
        read_only_fields = [
            'id', 'assigned_by', 'assigned_date', 'returned_date', 'is_active',
        ]


class AssetMaintenanceSerializer(serializers.ModelSerializer):
    vendor_name = serializers.CharField(source='vendor.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    event_type_display = serializers.CharField(source='get_event_type_display', read_only=True)

    class Meta:
        model = AssetMaintenance
        fields = [
            'id', 'asset', 'event_type', 'event_type_display', 'description',
            'cost', 'vendor', 'vendor_name', 'performed_on', 'downtime_days',
            'affected_quantity',
            'created_by', 'created_by_name', 'created_at',
        ]
        read_only_fields = ['created_by', 'created_at']


class AssetSerializer(serializers.ModelSerializer):
    assigned_user_name = serializers.CharField(source='assigned_to.full_name', read_only=True)
    category_name = serializers.CharField(source='category.name', read_only=True)
    vendor_name = serializers.CharField(source='vendor.name', read_only=True)

    # Type & condition are admin-managed via the LOV groups "asset_type" /
    # "asset_condition", so accept any value defined there rather than the
    # model's static choices. Status stays a fixed system list (logic branches
    # on its codes), so it keeps the model's ChoiceField.
    asset_type = serializers.CharField(required=False)
    condition = serializers.CharField(required=False)

    def _validate_lov(self, group, value):
        from core.lov import is_valid

        code = (value or '').strip().upper()
        # active_only=False so hiding a value in the admin never blocks saving an
        # asset that already uses it.
        if not is_valid(group, code, active_only=False):
            raise serializers.ValidationError("Not a recognised value. Add it under List of Values first.")
        return code

    def validate_asset_type(self, value):
        return self._validate_lov('asset_type', value)

    def validate_condition(self, value):
        return self._validate_lov('asset_condition', value)

    # Computed depreciation
    monthly_depreciation = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    accumulated_depreciation = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    current_book_value = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    months_in_service = serializers.IntegerField(read_only=True)
    is_fully_depreciated = serializers.BooleanField(read_only=True)

    # Computed warranty
    days_until_warranty_expiry = serializers.IntegerField(read_only=True)
    warranty_status = serializers.CharField(read_only=True)

    # Computed TCO
    total_maintenance_cost = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    total_cost_of_ownership = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )

    # Computed quantity
    quantity_assigned = serializers.IntegerField(read_only=True)
    quantity_available = serializers.IntegerField(read_only=True)
    is_bulk = serializers.BooleanField(read_only=True)

    location_ref_name = serializers.CharField(source='location_ref.name', read_only=True)

    class Meta:
        model = Asset
        fields = [
            'id', 'asset_tag', 'name', 'category', 'category_name',
            'asset_type', 'status', 'condition',
            'brand', 'model', 'serial_number',
            'purchase_date', 'purchase_price', 'unit_price',
            'vendor', 'vendor_name', 'warranty_expiry',
            'depreciation_method', 'useful_life_months', 'salvage_value',
            'quantity_total', 'quantity_assigned', 'quantity_available', 'is_bulk',
            'assigned_to', 'assigned_user_name', 'assigned_date',
            'location', 'location_ref', 'location_ref_name', 'notes',
            'specs',
            'created_by', 'created_at', 'updated_at',
            'source_purchase_request_item',
            # Computed
            'monthly_depreciation', 'accumulated_depreciation',
            'current_book_value', 'months_in_service', 'is_fully_depreciated',
            'days_until_warranty_expiry', 'warranty_status',
            'total_maintenance_cost', 'total_cost_of_ownership',
        ]
        read_only_fields = [
            'id', 'asset_tag', 'created_by', 'created_at', 'updated_at',
            'source_purchase_request_item',
        ]

    def validate_quantity_total(self, value):
        """Don't allow shrinking below the number of units currently assigned."""
        if value is None:
            return value
        if self.instance and value < self.instance.quantity_assigned:
            raise serializers.ValidationError(
                f'Cannot reduce quantity below currently-assigned units '
                f'({self.instance.quantity_assigned}). Return some units first.'
            )
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        category = attrs.get(
            'category', self.instance.category if self.instance else None
        )
        specs = attrs.get('specs', self.instance.specs if self.instance else {})
        try:
            validate_asset_specs(category, specs)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict)
        return attrs


class AssetNoteSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)

    class Meta:
        model = AssetNote
        fields = ['id', 'asset', 'note', 'created_by', 'created_by_name', 'created_at']
        read_only_fields = ['created_by', 'created_at']


class AssetHistorySerializer(serializers.ModelSerializer):
    from_user_name = serializers.CharField(source='from_user.full_name', read_only=True)
    to_user_name = serializers.CharField(source='to_user.full_name', read_only=True)

    class Meta:
        model = AssetHistory
        fields = [
            'id', 'asset', 'action', 'from_user', 'from_user_name',
            'to_user', 'to_user_name', 'note', 'timestamp',
        ]
