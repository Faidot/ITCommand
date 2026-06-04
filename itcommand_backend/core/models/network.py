from django.db import models
from django.conf import settings
from django.utils import timezone
from .users import Department
from .vendors import Vendor
from .assets import Asset
from .seating import Office


class LocationType(models.TextChoices):
    SERVER_ROOM = 'SERVER_ROOM', 'Server Room'
    RACK = 'RACK', 'Rack'
    CABINET = 'CABINET', 'Cabinet'
    FLOOR = 'FLOOR', 'Floor'
    BUILDING = 'BUILDING', 'Building'
    CLOUD = 'CLOUD', 'Cloud'


class DeviceType(models.TextChoices):
    SERVER = 'SERVER', 'Server'
    SWITCH = 'SWITCH', 'Switch'
    ROUTER = 'ROUTER', 'Router'
    FIREWALL = 'FIREWALL', 'Firewall'
    ACCESS_POINT = 'ACCESS_POINT', 'Access Point'
    NAS = 'NAS', 'NAS'
    UPS = 'UPS', 'UPS'
    PATCH_PANEL = 'PATCH_PANEL', 'Patch Panel'
    CABLE_MODEM = 'CABLE_MODEM', 'Cable Modem'
    VM = 'VM', 'Virtual Machine'
    OTHER = 'OTHER', 'Other'


class DeviceStatus(models.TextChoices):
    ONLINE = 'ONLINE', 'Online'
    OFFLINE = 'OFFLINE', 'Offline'
    MAINTENANCE = 'MAINTENANCE', 'Maintenance'
    DECOMMISSIONED = 'DECOMMISSIONED', 'Decommissioned'


class PortType(models.TextChoices):
    ETHERNET = 'ETHERNET', 'Ethernet'
    FIBER = 'FIBER', 'Fiber'
    USB = 'USB', 'USB'
    CONSOLE = 'CONSOLE', 'Console'
    MGMT = 'MGMT', 'Management'


class NetworkLocation(models.Model):
    name = models.CharField(max_length=255)
    office = models.ForeignKey(Office, on_delete=models.SET_NULL, null=True, blank=True, related_name='network_locations')
    location_type = models.CharField(max_length=30, choices=LocationType.choices, default=LocationType.SERVER_ROOM)
    description = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class NetworkDevice(models.Model):
    device_name = models.CharField(max_length=255)
    device_code = models.CharField(max_length=50, unique=True, blank=True)
    device_type = models.CharField(max_length=30, choices=DeviceType.choices, default=DeviceType.OTHER)
    brand = models.CharField(max_length=100, blank=True, null=True)
    model = models.CharField(max_length=100, blank=True, null=True)
    serial_number = models.CharField(max_length=255, blank=True, null=True)
    location = models.ForeignKey(NetworkLocation, on_delete=models.SET_NULL, null=True, blank=True, related_name='devices')
    rack_unit_start = models.PositiveIntegerField(null=True, blank=True)
    rack_unit_size = models.PositiveIntegerField(null=True, blank=True, default=1)
    status = models.CharField(max_length=30, choices=DeviceStatus.choices, default=DeviceStatus.OFFLINE)
    ip_address = models.GenericIPAddressField(blank=True, null=True)
    mac_address = models.CharField(max_length=17, blank=True, null=True)
    subnet_mask = models.CharField(max_length=50, blank=True, null=True)
    gateway = models.CharField(max_length=50, blank=True, null=True)
    dns_primary = models.CharField(max_length=50, blank=True, null=True)
    dns_secondary = models.CharField(max_length=50, blank=True, null=True)
    vlan_id = models.PositiveIntegerField(null=True, blank=True)
    hostname = models.CharField(max_length=255, blank=True, null=True)
    os_name = models.CharField(max_length=100, blank=True, null=True)
    os_version = models.CharField(max_length=100, blank=True, null=True)
    firmware_version = models.CharField(max_length=100, blank=True, null=True)
    cpu_info = models.CharField(max_length=255, blank=True, null=True)
    ram_gb = models.PositiveIntegerField(null=True, blank=True)
    storage_info = models.TextField(blank=True, null=True)
    purchase_date = models.DateField(null=True, blank=True)
    warranty_expiry = models.DateField(null=True, blank=True)
    vendor = models.ForeignKey(Vendor, on_delete=models.SET_NULL, null=True, blank=True, related_name='network_devices')
    linked_asset = models.ForeignKey(Asset, on_delete=models.SET_NULL, null=True, blank=True, related_name='network_devices')
    last_seen_online = models.DateTimeField(null=True, blank=True)
    uptime_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True, null=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.device_code:
            last = NetworkDevice.objects.order_by('-id').first()
            if last and last.device_code.startswith('NET-'):
                try:
                    n = int(last.device_code.split('-')[1])
                    self.device_code = f"NET-{n+1:03d}"
                except ValueError:
                    self.device_code = f"NET-{NetworkDevice.objects.count()+1:03d}"
            else:
                self.device_code = f"NET-{NetworkDevice.objects.count()+1:03d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.device_name} ({self.device_code})"

    class Meta:
        ordering = ['-created_at']


class IPAddressPool(models.Model):
    name = models.CharField(max_length=255)
    network_address = models.CharField(max_length=50)
    subnet_mask = models.CharField(max_length=50, default='255.255.255.0')
    cidr_prefix = models.PositiveIntegerField(default=24)
    gateway = models.CharField(max_length=50, blank=True, null=True)
    vlan_id = models.PositiveIntegerField(null=True, blank=True)
    description = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.network_address}/{self.cidr_prefix})"

    def get_ip_range(self):
        """Return list of host IPs in this pool."""
        import ipaddress
        try:
            net = ipaddress.ip_network(f"{self.network_address}/{self.cidr_prefix}", strict=False)
            return [str(ip) for ip in net.hosts()]
        except ValueError:
            return []


class NetworkDevicePort(models.Model):
    device = models.ForeignKey(NetworkDevice, on_delete=models.CASCADE, related_name='ports')
    port_number = models.PositiveIntegerField()
    port_name = models.CharField(max_length=50, blank=True, null=True)
    port_type = models.CharField(max_length=20, choices=PortType.choices, default=PortType.ETHERNET)
    connected_to_device = models.ForeignKey(NetworkDevice, on_delete=models.SET_NULL, null=True, blank=True, related_name='connected_ports')
    connected_to_port = models.PositiveIntegerField(null=True, blank=True)
    speed_mbps = models.PositiveIntegerField(null=True, blank=True)
    is_uplink = models.BooleanField(default=False)
    description = models.CharField(max_length=255, blank=True, null=True)

    def __str__(self):
        return f"{self.device.device_name} Port {self.port_number}"

    class Meta:
        ordering = ['port_number']
        unique_together = ['device', 'port_number']


class NetworkNote(models.Model):
    device = models.ForeignKey(NetworkDevice, on_delete=models.CASCADE, related_name='device_notes')
    note = models.TextField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Note on {self.device.device_name}"

    class Meta:
        ordering = ['-created_at']
