"""Network discovery: scan jobs, discovered hosts, and per-device integrations.

Discovered hosts land in a **staging** table rather than straight into
`NetworkDevice`. A sweep finds phones, printers and personal laptops as well as
managed kit, and writing those directly into the authoritative inventory would
bypass the IP-uniqueness rule the serializer enforces. Somebody reviews and
promotes what matters.
"""
from django.db import models

from core.encryption import decrypt_value, encrypt_value

from .network import NetworkDevice, IPAddressPool
from .users import User


class NetworkIntegration(models.Model):
    """Credentials for one piece of network equipment or monitoring tool.

    Separate from `Integration` because that model is one-row-per-provider,
    and a site can have several routers and firewalls.
    """

    KIND_CHOICES = (
        ("MIKROTIK", "MikroTik RouterOS"),
        ("PFSENSE", "pfSense / OPNsense"),
        ("NTOPNG", "ntopng"),
        ("GENERIC", "Generic REST endpoint"),
    )

    #: What each kind needs, so the UI can describe it without hardcoding.
    KIND_SPECS = {
        "MIKROTIK": {
            "label": "MikroTik RouterOS",
            "description": "Pulls ARP/DHCP leases and interfaces from RouterOS.",
            "help": (
                "RouterOS v7+ with the REST service enabled "
                "(/ip service enable www-ssl). Use a read-only user."
            ),
            "default_port": 443,
            "needs_username": True,
        },
        "PFSENSE": {
            "label": "pfSense / OPNsense",
            "description": "Pulls DHCP leases and ARP entries from the firewall.",
            "help": (
                "pfSense needs the REST API package; OPNsense uses an API "
                "key/secret pair. A read-only account is enough."
            ),
            "default_port": 443,
            "needs_username": True,
        },
        "NTOPNG": {
            "label": "ntopng",
            "description": "Pulls actively-seen hosts and their traffic counters.",
            "help": "ntopng REST API v2. Use a user with read access.",
            "default_port": 3000,
            "needs_username": True,
        },
        "GENERIC": {
            "label": "Generic REST endpoint",
            "description": "Any endpoint returning a JSON list of hosts.",
            "help": "Expects JSON containing ip / mac / hostname keys.",
            "default_port": 443,
            "needs_username": False,
        },
    }

    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=32, choices=KIND_CHOICES, db_index=True)
    host = models.CharField(
        max_length=255, help_text="Hostname or IP of the device's management interface."
    )
    port = models.PositiveIntegerField(default=443)
    use_tls = models.BooleanField(default=True)
    verify_tls = models.BooleanField(
        default=False,
        help_text="Most network gear ships a self-signed certificate; leave off unless you have installed a trusted one.",
    )
    username = models.CharField(max_length=150, blank=True, default="")
    encrypted_secret = models.TextField(blank=True, default="")

    is_enabled = models.BooleanField(default=False)
    #: Restrict what this source is trusted to report, if desired.
    pools = models.ManyToManyField(
        IPAddressPool, blank=True, related_name="integrations"
    )

    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=16, blank=True, default="")
    last_message = models.TextField(blank=True, default="")

    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_network_integrations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["kind", "host"], name="unique_integration_host"),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_kind_display()})"

    def set_secret(self, raw):
        self.encrypted_secret = encrypt_value(raw) if raw else ""

    def get_secret(self):
        if not self.encrypted_secret:
            return ""
        try:
            return decrypt_value(self.encrypted_secret)
        except Exception:
            return ""

    @property
    def has_secret(self):
        return bool(self.encrypted_secret)

    @property
    def base_url(self):
        scheme = "https" if self.use_tls else "http"
        return f"{scheme}://{self.host}:{self.port}"

    def mark_result(self, status, message=""):
        from django.utils import timezone

        self.last_status = status
        self.last_message = (message or "")[:2000]
        self.last_sync_at = timezone.now()
        self.save(update_fields=["last_status", "last_message", "last_sync_at", "updated_at"])


class NetworkScan(models.Model):
    """One discovery run, kept so progress and history are visible."""

    STATUS_CHOICES = (
        ("RUNNING", "Running"),
        ("COMPLETED", "Completed"),
        ("FAILED", "Failed"),
        ("CANCELLED", "Cancelled"),
    )
    SOURCE_CHOICES = (
        ("SWEEP", "Network sweep"),
        ("INTEGRATION", "Device integration"),
    )

    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default="SWEEP")
    pool = models.ForeignKey(
        IPAddressPool, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="scans",
    )
    integration = models.ForeignKey(
        NetworkIntegration, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="scans",
    )
    target = models.CharField(max_length=120, blank=True, default="")

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="RUNNING")
    hosts_scanned = models.PositiveIntegerField(default=0)
    hosts_found = models.PositiveIntegerField(default=0)
    hosts_new = models.PositiveIntegerField(default=0)
    message = models.TextField(blank=True, default="")

    started_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="network_scans",
    )
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self):
        return f"{self.get_source_display()} {self.target} ({self.status})"

    @property
    def duration_seconds(self):
        if not self.finished_at:
            return None
        return round((self.finished_at - self.started_at).total_seconds(), 1)


class DiscoveredHost(models.Model):
    """Something answering on the network, awaiting review.

    Kept separate from NetworkDevice so a sweep never silently rewrites the
    inventory. `state` records what the reviewer decided.
    """

    STATE_CHOICES = (
        ("NEW", "New"),
        ("LINKED", "Linked to a device"),
        ("IGNORED", "Ignored"),
    )

    ip_address = models.GenericIPAddressField(db_index=True)
    mac_address = models.CharField(max_length=17, blank=True, default="", db_index=True)
    hostname = models.CharField(max_length=255, blank=True, default="")
    vendor_guess = models.CharField(
        max_length=120, blank=True, default="",
        help_text="Manufacturer inferred from the MAC address prefix.",
    )
    open_ports = models.JSONField(default=list, blank=True)
    #: Where this sighting came from — a sweep, or a named integration.
    discovered_via = models.CharField(max_length=64, blank=True, default="SWEEP")

    state = models.CharField(
        max_length=12, choices=STATE_CHOICES, default="NEW", db_index=True
    )
    linked_device = models.ForeignKey(
        NetworkDevice, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="discovered_hosts",
    )

    times_seen = models.PositiveIntegerField(default=1)
    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)
    last_scan = models.ForeignKey(
        NetworkScan, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="hosts",
    )

    class Meta:
        ordering = ["ip_address"]
        constraints = [
            models.UniqueConstraint(fields=["ip_address"], name="unique_discovered_ip"),
        ]

    def __str__(self):
        return f"{self.ip_address} ({self.hostname or self.mac_address or 'unknown'})"

    @property
    def matches_existing_device(self):
        """An inventory device already at this IP or MAC, if any."""
        queryset = NetworkDevice.objects.filter(ip_address=self.ip_address)
        if self.mac_address:
            queryset = queryset | NetworkDevice.objects.filter(
                mac_address__iexact=self.mac_address
            )
        return queryset.first()
