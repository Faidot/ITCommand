from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from core.discovery import MAX_HOSTS, expand_target, record_results, sweep
from core.mixins import AuditLogMixin
from core.models import (
    DiscoveredHost,
    IPAddressPool,
    NetworkDevice,
    NetworkIntegration,
    NetworkScan,
)
from core.network_sources import fetch_hosts
from core.permissions import HasModulePermission, has_role_permission


class NetworkIntegrationSerializer(serializers.ModelSerializer):
    secret = serializers.CharField(write_only=True, required=False, allow_blank=True)
    has_secret = serializers.BooleanField(read_only=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = NetworkIntegration
        fields = [
            "id", "name", "kind", "kind_label", "host", "port", "use_tls",
            "verify_tls", "username", "secret", "has_secret", "is_enabled",
            "pools", "last_sync_at", "last_status", "last_message",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "has_secret", "last_sync_at", "last_status", "last_message",
            "created_at", "updated_at",
        ]

    def create(self, validated_data):
        secret = validated_data.pop("secret", "")
        pools = validated_data.pop("pools", [])
        instance = NetworkIntegration(**validated_data)
        if secret:
            instance.set_secret(secret)
        instance.save()
        instance.pools.set(pools)
        return instance

    def update(self, instance, validated_data):
        secret = validated_data.pop("secret", None)
        pools = validated_data.pop("pools", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        # Blank means "leave it alone"; clearing is an explicit action.
        if secret:
            instance.set_secret(secret)
        instance.save()
        if pools is not None:
            instance.pools.set(pools)
        return instance


class DiscoveredHostSerializer(serializers.ModelSerializer):
    matched_device_id = serializers.SerializerMethodField()
    matched_device_name = serializers.SerializerMethodField()

    class Meta:
        model = DiscoveredHost
        fields = [
            "id", "ip_address", "mac_address", "hostname", "vendor_guess",
            "open_ports", "discovered_via", "state", "linked_device",
            "matched_device_id", "matched_device_name", "times_seen",
            "first_seen_at", "last_seen_at",
        ]
        read_only_fields = fields

    def get_matched_device_id(self, obj):
        match = obj.matches_existing_device
        return match.pk if match else None

    def get_matched_device_name(self, obj):
        match = obj.matches_existing_device
        return match.device_name if match else None


class NetworkScanSerializer(serializers.ModelSerializer):
    started_by_name = serializers.CharField(
        source="started_by.full_name", read_only=True, default=None
    )
    duration_seconds = serializers.FloatField(read_only=True)

    class Meta:
        model = NetworkScan
        fields = [
            "id", "source", "pool", "integration", "target", "status",
            "hosts_scanned", "hosts_found", "hosts_new", "message",
            "started_by", "started_by_name", "started_at", "finished_at",
            "duration_seconds",
        ]
        read_only_fields = fields


class NetworkIntegrationViewSet(AuditLogMixin, viewsets.ModelViewSet):
    """Manage credentials for routers, firewalls and monitoring tools."""

    queryset = NetworkIntegration.objects.all()
    serializer_class = NetworkIntegrationSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "network"

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="test")
    def test(self, request, pk=None):
        """Contact the device now and report exactly what happened."""
        integration = self.get_object()
        # A disabled integration should still be testable — that is how you
        # check credentials before turning it on.
        was_enabled = integration.is_enabled
        integration.is_enabled = True
        results, error = fetch_hosts(integration)
        integration.is_enabled = was_enabled

        if error:
            integration.mark_result("ERROR", error)
            return Response({"ok": False, "detail": error, "hosts_found": 0})
        message = f"Reachable — {len(results)} host(s) reported."
        integration.mark_result("OK", message)
        return Response({"ok": True, "detail": message, "hosts_found": len(results)})


class DiscoveredHostViewSet(AuditLogMixin, viewsets.ReadOnlyModelViewSet):
    """Review what discovery found."""

    serializer_class = DiscoveredHostSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "network"

    def get_queryset(self):
        queryset = DiscoveredHost.objects.select_related("linked_device").all()
        state = (self.request.query_params.get("state") or "").upper()
        if state in dict(DiscoveredHost.STATE_CHOICES):
            queryset = queryset.filter(state=state)
        search = (self.request.query_params.get("search") or "").strip()
        if search:
            from django.db.models import Q

            queryset = queryset.filter(
                Q(ip_address__icontains=search)
                | Q(hostname__icontains=search)
                | Q(mac_address__icontains=search)
                | Q(vendor_guess__icontains=search)
            )
        return queryset

    @action(detail=True, methods=["post"], url_path="ignore")
    def ignore(self, request, pk=None):
        host = self.get_object()
        host.state = "IGNORED"
        host.save(update_fields=["state"])
        self.log_action("UPDATE", host, {"state": "IGNORED"})
        return Response(DiscoveredHostSerializer(host).data)

    @action(detail=True, methods=["post"], url_path="reset")
    def reset(self, request, pk=None):
        host = self.get_object()
        host.state = "NEW"
        host.save(update_fields=["state"])
        return Response(DiscoveredHostSerializer(host).data)

    @action(detail=True, methods=["post"], url_path="promote")
    def promote(self, request, pk=None):
        """Create (or link) a NetworkDevice from this sighting."""
        if not has_role_permission(request.user, "network", "add"):
            return Response(
                {"detail": "You do not have permission to add network devices."},
                status=status.HTTP_403_FORBIDDEN,
            )

        host = self.get_object()
        existing = host.matches_existing_device
        if existing:
            host.state = "LINKED"
            host.linked_device = existing
            host.save(update_fields=["state", "linked_device"])
            return Response(
                {
                    "detail": f"Already in inventory as {existing.device_name}.",
                    "device_id": existing.pk,
                    "created": False,
                },
                status=status.HTTP_200_OK,
            )

        name = (
            request.data.get("device_name")
            or host.hostname
            or f"{host.vendor_guess or 'Device'} {host.ip_address}"
        )
        with transaction.atomic():
            device = NetworkDevice.objects.create(
                device_name=name[:255],
                device_type=request.data.get("device_type") or "OTHER",
                brand=host.vendor_guess[:255] if host.vendor_guess else "",
                ip_address=host.ip_address,
                mac_address=host.mac_address[:17],
                hostname=host.hostname[:255],
                status="ONLINE",
                last_seen_online=timezone.now(),
                location_id=request.data.get("location") or None,
                notes=f"Added from network discovery ({host.discovered_via}).",
                created_by=request.user,
            )
            host.state = "LINKED"
            host.linked_device = device
            host.save(update_fields=["state", "linked_device"])
            self.log_action("CREATE", device, {"source": "discovery"})

        return Response(
            {"detail": f"Added {device.device_name}.", "device_id": device.pk, "created": True},
            status=status.HTTP_201_CREATED,
        )


class NetworkScanViewSet(AuditLogMixin, viewsets.ReadOnlyModelViewSet):
    queryset = NetworkScan.objects.select_related("started_by", "pool", "integration")
    serializer_class = NetworkScanSerializer
    permission_classes = [HasModulePermission]
    rbac_module = "network"


class RunNetworkScanView(APIView):
    """Kick off a discovery run.

    Scanning is a write-shaped action — it creates records and touches the
    network — so it requires `add` on the network module, not just `view`.
    """

    permission_classes = [HasModulePermission]
    rbac_module = "network"

    def get_rbac_action(self):
        return "add"

    def post(self, request):
        if not has_role_permission(request.user, "network", "add"):
            return Response(
                {"detail": "You do not have permission to run a network scan."},
                status=status.HTTP_403_FORBIDDEN,
            )

        pool_id = request.data.get("pool")
        integration_id = request.data.get("integration")
        target = (request.data.get("target") or "").strip()
        probe_ports = bool(request.data.get("probe_ports"))

        if integration_id:
            return self._scan_integration(request, integration_id)

        pool = None
        if pool_id:
            pool = IPAddressPool.objects.filter(pk=pool_id).first()
            if not pool:
                return Response(
                    {"detail": "No such IP pool."}, status=status.HTTP_400_BAD_REQUEST
                )
            target = f"{pool.network_address}/{pool.cidr_prefix}"

        if not target:
            return Response(
                {"detail": "Choose an IP pool or enter a range like 192.168.1.0/24."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        hosts, error = expand_target(target)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)

        scan = NetworkScan.objects.create(
            source="SWEEP", pool=pool, target=target, started_by=request.user
        )
        try:
            results, sweep_error = sweep(target, probe_ports=probe_ports)
            if sweep_error:
                scan.status = "FAILED"
                scan.message = sweep_error
            else:
                found, new_count = record_results(results, scan)
                scan.status = "COMPLETED"
                scan.hosts_scanned = len(hosts)
                scan.hosts_found = found
                scan.hosts_new = new_count
                scan.message = f"{found} host(s) answered, {new_count} not seen before."
        except Exception as exc:
            scan.status = "FAILED"
            scan.message = f"{type(exc).__name__}: {exc}"
        scan.finished_at = timezone.now()
        scan.save()

        self.log_action_safe(request, scan)
        return Response(NetworkScanSerializer(scan).data)

    def _scan_integration(self, request, integration_id):
        integration = NetworkIntegration.objects.filter(pk=integration_id).first()
        if not integration:
            return Response(
                {"detail": "No such integration."}, status=status.HTTP_400_BAD_REQUEST
            )

        scan = NetworkScan.objects.create(
            source="INTEGRATION",
            integration=integration,
            target=integration.host,
            started_by=request.user,
        )
        results, error = fetch_hosts(integration)
        if error:
            scan.status = "FAILED"
            scan.message = error
            integration.mark_result("ERROR", error)
        else:
            found, new_count = record_results(results, scan)
            scan.status = "COMPLETED"
            scan.hosts_scanned = found
            scan.hosts_found = found
            scan.hosts_new = new_count
            scan.message = f"{found} host(s) reported, {new_count} not seen before."
            integration.mark_result("OK", scan.message)
        scan.finished_at = timezone.now()
        scan.save()
        return Response(NetworkScanSerializer(scan).data)

    def log_action_safe(self, request, scan):
        try:
            from core.models import AuditLog

            AuditLog.objects.create(
                user=request.user,
                action="SCAN",
                model_name="NetworkScan",
                object_id=str(scan.pk),
                changes={"target": scan.target, "found": scan.hosts_found},
            )
        except Exception:
            pass


class DiscoveryOptionsView(APIView):
    """Everything the discovery page needs to render its controls."""

    permission_classes = [HasModulePermission]
    rbac_module = "network"

    def get(self, request):
        return Response({
            "pools": [
                {
                    "id": pool.pk,
                    "name": pool.name,
                    "target": f"{pool.network_address}/{pool.cidr_prefix}",
                }
                for pool in IPAddressPool.objects.all()
            ],
            "integrations": [
                {
                    "id": integration.pk,
                    "name": integration.name,
                    "kind": integration.kind,
                    "kind_label": integration.get_kind_display(),
                    "is_enabled": integration.is_enabled,
                    "last_status": integration.last_status,
                }
                for integration in NetworkIntegration.objects.all()
            ],
            "kinds": [
                {
                    "value": key,
                    "label": spec["label"],
                    "description": spec["description"],
                    "help": spec["help"],
                    "default_port": spec["default_port"],
                    "needs_username": spec["needs_username"],
                }
                for key, spec in NetworkIntegration.KIND_SPECS.items()
            ],
            "device_types": [
                {"value": value, "label": label}
                for value, label in NetworkDevice._meta.get_field("device_type").choices
            ],
            "max_hosts": MAX_HOSTS,
        })
