from rest_framework import serializers
from core.models.network import NetworkLocation, NetworkDevice, IPAddressPool, NetworkDevicePort, NetworkNote


class NetworkLocationSerializer(serializers.ModelSerializer):
    office_name = serializers.CharField(source='office.name', read_only=True, default=None)
    device_count = serializers.SerializerMethodField()

    class Meta:
        model = NetworkLocation
        fields = '__all__'

    def get_device_count(self, obj):
        return obj.devices.count()


class NetworkDevicePortSerializer(serializers.ModelSerializer):
    connected_to_device_name = serializers.CharField(source='connected_to_device.device_name', read_only=True, default=None)

    class Meta:
        model = NetworkDevicePort
        fields = '__all__'
        read_only_fields = ['device']


class NetworkNoteSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True, default=None)

    class Meta:
        model = NetworkNote
        fields = '__all__'
        read_only_fields = ['created_by', 'created_at']


class NetworkDeviceListSerializer(serializers.ModelSerializer):
    location_name = serializers.CharField(source='location.name', read_only=True, default=None)
    vendor_name = serializers.CharField(source='vendor.name', read_only=True, default=None)

    class Meta:
        model = NetworkDevice
        fields = [
            'id', 'device_name', 'device_code', 'device_type', 'brand', 'model',
            'status', 'ip_address', 'mac_address', 'hostname', 'vlan_id',
            'location', 'location_name', 'vendor_name',
            'rack_unit_start', 'rack_unit_size',
            'last_seen_online', 'uptime_percent', 'warranty_expiry',
            'created_at'
        ]


class NetworkDeviceDetailSerializer(serializers.ModelSerializer):
    location_name = serializers.CharField(source='location.name', read_only=True, default=None)
    vendor_name = serializers.CharField(source='vendor.name', read_only=True, default=None)
    linked_asset_name = serializers.CharField(source='linked_asset.name', read_only=True, default=None)
    ports = NetworkDevicePortSerializer(many=True, read_only=True)
    device_notes = NetworkNoteSerializer(many=True, read_only=True)

    class Meta:
        model = NetworkDevice
        fields = '__all__'
        read_only_fields = ['device_code', 'created_by', 'created_at', 'updated_at']


class NetworkDeviceCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = NetworkDevice
        fields = '__all__'
        read_only_fields = ['device_code', 'created_by', 'created_at', 'updated_at']

    def validate_ip_address(self, value):
        if value:
            qs = NetworkDevice.objects.filter(ip_address=value).exclude(status='DECOMMISSIONED')
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(f"IP {value} is already assigned to device '{qs.first().device_name}'.")
        return value


class IPAddressPoolSerializer(serializers.ModelSerializer):
    total_ips = serializers.SerializerMethodField()
    used_ips = serializers.SerializerMethodField()

    class Meta:
        model = IPAddressPool
        fields = '__all__'

    def get_total_ips(self, obj):
        return len(obj.get_ip_range())

    def get_used_ips(self, obj):
        ips = obj.get_ip_range()
        used = NetworkDevice.objects.exclude(status='DECOMMISSIONED').filter(
            ip_address__in=ips
        ).count()
        return used
