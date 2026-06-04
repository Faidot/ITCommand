from rest_framework import serializers
from core.models.vendors import Vendor, VendorContract, VendorPayment, VendorNote
from core.serializers.assets import AssetSerializer
from core.serializers.licenses import SoftwareLicenseListSerializer
from core.serializers.finance import RecurringBillSerializer
from django.db.models import Sum
from datetime import timedelta
from django.utils import timezone

class VendorNoteSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)

    class Meta:
        model = VendorNote
        fields = '__all__'


class VendorPaymentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    contract_title = serializers.CharField(source='contract.title', read_only=True)

    class Meta:
        model = VendorPayment
        fields = '__all__'


class VendorContractSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    vendor_name = serializers.CharField(source='vendor.name', read_only=True)

    class Meta:
        model = VendorContract
        fields = '__all__'
        read_only_fields = ['contract_number', 'created_by', 'created_at', 'updated_at']


class VendorSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    active_contracts_count = serializers.SerializerMethodField()
    total_spend = serializers.SerializerMethodField()

    class Meta:
        model = Vendor
        fields = '__all__'
        read_only_fields = ['vendor_code', 'created_by', 'created_at', 'updated_at']

    def get_active_contracts_count(self, obj):
        return obj.contracts.filter(status='ACTIVE').count()

    def get_total_spend(self, obj):
        total = obj.payments.aggregate(total=Sum('amount'))['total']
        return float(total) if total else 0.0


class VendorDetailSerializer(VendorSerializer):
    notes = VendorNoteSerializer(source='timeline_notes', many=True, read_only=True)
    contracts = VendorContractSerializer(many=True, read_only=True)
    payments = VendorPaymentSerializer(many=True, read_only=True)
