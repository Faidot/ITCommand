from rest_framework import serializers
from django.contrib.auth import get_user_model
from core.models import (
    SoftwareProduct, SoftwareLicense, LicenseAssignment,
    LicenseAlert, LicenseRenewal,
)
from core.encryption import encrypt_value

User = get_user_model()


class LicenseRenewalSerializer(serializers.ModelSerializer):
    renewed_by_name = serializers.CharField(source='renewed_by.full_name', read_only=True)

    class Meta:
        model = LicenseRenewal
        fields = [
            'id', 'license',
            'previous_expiry', 'new_expiry',
            'cost', 'seats_added', 'notes',
            'renewed_by', 'renewed_by_name', 'renewed_at',
        ]
        read_only_fields = ['id', 'renewed_by', 'renewed_at']


class SoftwareProductSerializer(serializers.ModelSerializer):
    license_count = serializers.SerializerMethodField()

    class Meta:
        model = SoftwareProduct
        fields = '__all__'

    def get_license_count(self, obj):
        return obj.licenses.count()


class LicenseAssignmentSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.full_name', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True)
    user_avatar = serializers.ImageField(source='user.avatar', read_only=True)
    user_department = serializers.CharField(source='user.department.name', read_only=True, default=None)
    assigned_by_name = serializers.CharField(source='assigned_by.full_name', read_only=True, default=None)

    class Meta:
        model = LicenseAssignment
        fields = [
            'id', 'license', 'user', 'user_name', 'user_email', 'user_avatar',
            'user_department', 'assigned_date', 'revoked_date', 'is_active',
            'notes', 'assigned_by', 'assigned_by_name', 'created_at',
        ]
        read_only_fields = ['assigned_by']


class SoftwareLicenseListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_vendor = serializers.CharField(source='product.vendor', read_only=True)
    product_logo_url = serializers.URLField(source='product.logo_url', read_only=True)
    product_category = serializers.CharField(source='product.category', read_only=True)
    seats_used = serializers.IntegerField(read_only=True)
    seats_available = serializers.SerializerMethodField()
    seats_usage_pct = serializers.FloatField(read_only=True)
    is_expired = serializers.BooleanField(read_only=True)
    days_until_expiry = serializers.SerializerMethodField()
    annual_cost = serializers.FloatField(read_only=True)

    class Meta:
        model = SoftwareLicense
        fields = [
            'id', 'product', 'product_name', 'product_vendor', 'product_logo_url',
            'product_category', 'license_type', 'seats_total', 'seats_used',
            'seats_available', 'seats_usage_pct', 'purchase_date', 'expiry_date',
            'cost', 'billing_cycle', 'is_active', 'auto_renew', 'is_expired',
            'days_until_expiry', 'annual_cost', 'created_at', 'updated_at',
        ]

    def get_seats_available(self, obj):
        return obj.seats_available

    def get_days_until_expiry(self, obj):
        return obj.days_until_expiry


class SoftwareLicenseDetailSerializer(serializers.ModelSerializer):
    """Full serializer for detail views."""
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_vendor = serializers.CharField(source='product.vendor', read_only=True)
    product_logo_url = serializers.URLField(source='product.logo_url', read_only=True)
    product_category = serializers.CharField(source='product.category', read_only=True)
    product_description = serializers.CharField(source='product.description', read_only=True)
    seats_used = serializers.IntegerField(read_only=True)
    seats_available = serializers.SerializerMethodField()
    seats_usage_pct = serializers.FloatField(read_only=True)
    is_expired = serializers.BooleanField(read_only=True)
    days_until_expiry = serializers.SerializerMethodField()
    annual_cost = serializers.FloatField(read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True, default=None)
    assignments = serializers.SerializerMethodField()
    masked_key = serializers.SerializerMethodField()

    class Meta:
        model = SoftwareLicense
        fields = [
            'id', 'product', 'product_name', 'product_vendor', 'product_logo_url',
            'product_category', 'product_description',
            'masked_key', 'license_type', 'seats_total', 'seats_used',
            'seats_available', 'seats_usage_pct',
            'purchase_date', 'expiry_date', 'cost', 'billing_cycle',
            'vendor_contact', 'purchase_order_number', 'notes',
            'is_active', 'auto_renew', 'is_expired', 'days_until_expiry', 'annual_cost',
            'created_by', 'created_by_name', 'created_at', 'updated_at',
            'assignments',
        ]
        read_only_fields = ['created_by']

    def get_seats_available(self, obj):
        return obj.seats_available

    def get_days_until_expiry(self, obj):
        return obj.days_until_expiry

    def get_masked_key(self, obj):
        return '••••••••••••••••' if obj.encrypted_license_key else None

    def get_assignments(self, obj):
        return LicenseAssignmentSerializer(
            obj.assignments.all().order_by('-is_active', '-assigned_date'),
            many=True
        ).data


class SoftwareLicenseCreateSerializer(serializers.ModelSerializer):
    license_key = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = SoftwareLicense
        fields = [
            'id', 'product', 'license_key', 'license_type', 'seats_total',
            'purchase_date', 'expiry_date', 'cost', 'billing_cycle',
            'vendor_contact', 'purchase_order_number', 'notes',
            'is_active', 'auto_renew',
        ]
        read_only_fields = ['id']

    def create(self, validated_data):
        license_key = validated_data.pop('license_key', '')
        instance = SoftwareLicense(**validated_data)
        instance.set_license_key(license_key)
        instance.created_by = self.context['request'].user
        instance.save()
        return instance

    def update(self, instance, validated_data):
        license_key = validated_data.pop('license_key', None)
        if license_key is not None:
            instance.set_license_key(license_key)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


class LicenseAlertSerializer(serializers.ModelSerializer):
    license_product_name = serializers.CharField(source='license.product.name', read_only=True)

    class Meta:
        model = LicenseAlert
        fields = '__all__'


class UserLicenseSerializer(serializers.ModelSerializer):
    """Serializer for showing licenses assigned to a user."""
    product_name = serializers.CharField(source='license.product.name', read_only=True)
    product_vendor = serializers.CharField(source='license.product.vendor', read_only=True)
    product_logo_url = serializers.URLField(source='license.product.logo_url', read_only=True)
    license_type = serializers.CharField(source='license.license_type', read_only=True)
    license_id = serializers.IntegerField(source='license.id', read_only=True)

    class Meta:
        model = LicenseAssignment
        fields = [
            'id', 'license_id', 'product_name', 'product_vendor', 'product_logo_url',
            'license_type', 'assigned_date', 'is_active', 'notes',
        ]
