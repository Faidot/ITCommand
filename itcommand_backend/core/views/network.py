from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Count, Q
from django.utils import timezone
from datetime import timedelta

from core.models.network import (
    NetworkLocation, NetworkDevice, IPAddressPool, NetworkDevicePort, NetworkNote,
    NetworkDeviceStatusLog,
)
from core.serializers.network import (
    NetworkLocationSerializer, NetworkDeviceListSerializer,
    NetworkDeviceDetailSerializer, NetworkDeviceCreateSerializer,
    IPAddressPoolSerializer, NetworkDevicePortSerializer, NetworkNoteSerializer,
    NetworkDeviceStatusLogSerializer,
)
from core.permissions import HasModulePermission

RACK_LOCATION_TYPES = ('SERVER_ROOM', 'RACK', 'CABINET')
RACK_UNITS = 42


def _log_status_change(device, old_status, new_status, user, note=''):
    """Record a status transition and keep last_seen_online fresh when a
    device comes online."""
    if old_status == new_status:
        return None
    NetworkDeviceStatusLog.objects.create(
        device=device, old_status=old_status or '', new_status=new_status,
        changed_by=user if (user and user.is_authenticated) else None, note=note or '',
    )
    if new_status == 'ONLINE':
        device.last_seen_online = timezone.now()
        device.save(update_fields=['last_seen_online'])
    return True


class NetworkLocationViewSet(viewsets.ModelViewSet):
    serializer_class = NetworkLocationSerializer
    queryset = NetworkLocation.objects.all().order_by('name')
    permission_classes = [HasModulePermission]
    rbac_module = 'network'


class NetworkDeviceViewSet(viewsets.ModelViewSet):
    queryset = NetworkDevice.objects.all()
    permission_classes = [HasModulePermission]
    rbac_module = 'network'

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return NetworkDeviceDetailSerializer
        if self.action in ['create', 'update', 'partial_update']:
            return NetworkDeviceCreateSerializer
        return NetworkDeviceListSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                Q(device_name__icontains=search) | Q(ip_address__icontains=search) |
                Q(mac_address__icontains=search) | Q(hostname__icontains=search) |
                Q(device_code__icontains=search)
            )
        dt = self.request.query_params.get('device_type')
        if dt:
            qs = qs.filter(device_type=dt)
        st = self.request.query_params.get('status')
        if st:
            qs = qs.filter(status=st)
        loc = self.request.query_params.get('location')
        if loc:
            qs = qs.filter(location_id=loc)
        vlan = self.request.query_params.get('vlan_id')
        if vlan:
            qs = qs.filter(vlan_id=vlan)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        device = serializer.instance
        # Seed the status timeline with the device's initial state.
        NetworkDeviceStatusLog.objects.create(
            device=device, old_status='', new_status=device.status,
            changed_by=request.user, note='Device created',
        )
        return Response(NetworkDeviceDetailSerializer(device).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        old_status = instance.status
        response = super().update(request, *args, **kwargs)
        instance.refresh_from_db()
        _log_status_change(instance, old_status, instance.status, request.user, 'Edited via device form')
        return response

    @action(detail=True, methods=['post'], url_path='set-status')
    def set_status(self, request, pk=None):
        device = self.get_object()
        new_status = request.data.get('status')
        valid = {c[0] for c in NetworkDevice._meta.get_field('status').choices}
        if new_status not in valid:
            return Response({'error': 'Invalid status'}, status=status.HTTP_400_BAD_REQUEST)
        old_status = device.status
        device.status = new_status
        device.save(update_fields=['status'])
        _log_status_change(device, old_status, new_status, request.user, request.data.get('note', ''))
        return Response(NetworkDeviceDetailSerializer(device).data)

    @action(detail=True, methods=['get'], url_path='status-history')
    def status_history(self, request, pk=None):
        device = self.get_object()
        return Response(NetworkDeviceStatusLogSerializer(device.status_logs.all()[:100], many=True).data)

    @action(detail=False, methods=['post'], url_path='bulk-update')
    def bulk_update(self, request):
        ids = request.data.get('ids', [])
        if not ids:
            return Response({'error': 'No device ids provided'}, status=status.HTTP_400_BAD_REQUEST)
        new_status = request.data.get('status')
        new_location = request.data.get('location')
        updated = 0
        for d in NetworkDevice.objects.filter(id__in=ids):
            old_status = d.status
            changed = False
            if new_status and new_status != d.status:
                d.status = new_status
                changed = True
            if new_location is not None:
                d.location_id = new_location or None
                changed = True
            if changed:
                d.save()
                if new_status:
                    _log_status_change(d, old_status, new_status, request.user, 'Bulk update')
                updated += 1
        return Response({'updated': updated})

    @action(detail=True, methods=['get', 'put'], url_path='ports')
    def ports(self, request, pk=None):
        device = self.get_object()
        if request.method == 'GET':
            return Response(NetworkDevicePortSerializer(device.ports.all(), many=True).data)
        ports_data = request.data.get('ports', [])
        device.ports.all().delete()
        for pd in ports_data:
            pd.pop('id', None)
            pd.pop('connected_to_device_name', None)
            NetworkDevicePort.objects.create(device=device, **pd)
        return Response(NetworkDevicePortSerializer(device.ports.all(), many=True).data)

    @action(detail=True, methods=['get', 'post'], url_path='notes')
    def notes(self, request, pk=None):
        device = self.get_object()
        if request.method == 'GET':
            return Response(NetworkNoteSerializer(device.device_notes.all(), many=True).data)
        note_text = request.data.get('note', '')
        if not note_text:
            return Response({'error': 'Note text required'}, status=status.HTTP_400_BAD_REQUEST)
        note = NetworkNote.objects.create(device=device, note=note_text, created_by=request.user)
        return Response(NetworkNoteSerializer(note).data, status=status.HTTP_201_CREATED)


class IPAddressPoolViewSet(viewsets.ModelViewSet):
    serializer_class = IPAddressPoolSerializer
    queryset = IPAddressPool.objects.all().order_by('name')
    permission_classes = [HasModulePermission]
    rbac_module = 'network'

    @action(detail=True, methods=['get'], url_path='usage')
    def usage(self, request, pk=None):
        pool = self.get_object()
        all_ips = pool.get_ip_range()
        used_devices = NetworkDevice.objects.exclude(status='DECOMMISSIONED').filter(
            ip_address__in=all_ips
        ).values('ip_address', 'device_name', 'hostname', 'device_code', 'id', 'status')
        used_map = {d['ip_address']: d for d in used_devices}

        ip_list = []
        for ip in all_ips:
            entry = {'ip': ip, 'status': 'free'}
            if ip == pool.gateway:
                entry['status'] = 'reserved'
                entry['label'] = 'Gateway'
            elif ip in used_map:
                entry['status'] = 'used'
                entry['device'] = used_map[ip]
            ip_list.append(entry)

        gateway_in_pool = 1 if pool.gateway in all_ips else 0
        return Response({
            'pool': IPAddressPoolSerializer(pool).data,
            'total': len(all_ips),
            'used': len(used_map),
            'free': len(all_ips) - len(used_map) - gateway_in_pool,
            'ips': ip_list
        })


class NetworkDashboardView(APIView):
    permission_classes = [HasModulePermission]
    rbac_module = 'network'

    def get(self, request):
        now = timezone.now()
        today = now.date()
        try:
            warranty_days = int(request.query_params.get('warranty_days', 30))
        except (TypeError, ValueError):
            warranty_days = 30
        warranty_cutoff = today + timedelta(days=warranty_days)

        all_devices = NetworkDevice.objects.all()
        by_type = dict(all_devices.values_list('device_type').annotate(c=Count('id')).values_list('device_type', 'c'))
        by_status = dict(all_devices.values_list('status').annotate(c=Count('id')).values_list('status', 'c'))

        # Offline devices, with how long they've been offline.
        offline = []
        for d in all_devices.filter(status='OFFLINE').values(
            'id', 'device_name', 'device_code', 'device_type', 'ip_address', 'last_seen_online'
        )[:30]:
            offline_for_days = None
            if d['last_seen_online']:
                offline_for_days = (now - d['last_seen_online']).days
            d['offline_for_days'] = offline_for_days
            offline.append(d)

        warranty_expiring = list(all_devices.filter(
            warranty_expiry__isnull=False, warranty_expiry__lte=warranty_cutoff, warranty_expiry__gte=today
        ).exclude(status='DECOMMISSIONED').values(
            'id', 'device_name', 'device_code', 'warranty_expiry'
        ).order_by('warranty_expiry')[:25])
        for w in warranty_expiring:
            w['days_remaining'] = (w['warranty_expiry'] - today).days

        # Devices by location.
        by_location = list(all_devices.values('location__name').annotate(c=Count('id')).order_by('-c'))
        by_location = [{'name': b['location__name'] or 'Unassigned', 'count': b['c']} for b in by_location]

        # VLAN breakdown.
        by_vlan = list(all_devices.exclude(vlan_id__isnull=True).values('vlan_id').annotate(c=Count('id')).order_by('-c')[:12])
        by_vlan = [{'vlan': b['vlan_id'], 'count': b['c']} for b in by_vlan]

        # Rack utilization per rack-style location.
        rack_util = []
        for loc in NetworkLocation.objects.filter(location_type__in=RACK_LOCATION_TYPES):
            used_u = 0
            for d in loc.devices.exclude(rack_unit_start__isnull=True):
                used_u += (d.rack_unit_size or 1)
            rack_util.append({
                'id': loc.id, 'name': loc.name,
                'used_u': min(used_u, RACK_UNITS), 'total_u': RACK_UNITS,
                'pct': round(min(used_u, RACK_UNITS) / RACK_UNITS * 100),
            })

        # IP pools.
        pool_summary = []
        for p in IPAddressPool.objects.all():
            ips = p.get_ip_range()
            used = NetworkDevice.objects.exclude(status='DECOMMISSIONED').filter(ip_address__in=ips).count()
            pool_summary.append({
                'id': p.id, 'name': p.name, 'network': f"{p.network_address}/{p.cidr_prefix}",
                'total': len(ips), 'used': used, 'free': len(ips) - used
            })

        # Average uptime across monitored devices.
        uptimes = [float(u) for u in all_devices.exclude(uptime_percent__isnull=True).values_list('uptime_percent', flat=True)]
        avg_uptime = round(sum(uptimes) / len(uptimes), 2) if uptimes else None

        # Recent status activity feed.
        recent_activity = [{
            'id': log.id,
            'device_id': log.device_id,
            'device_name': log.device.device_name,
            'old_status': log.old_status,
            'new_status': log.new_status,
            'note': log.note,
            'changed_by_name': log.changed_by.full_name if log.changed_by else None,
            'created_at': log.created_at,
        } for log in NetworkDeviceStatusLog.objects.select_related('device', 'changed_by')[:15]]

        return Response({
            'total_devices': all_devices.count(),
            'device_count_by_type': by_type,
            'device_count_by_status': by_status,
            'offline_devices': offline,
            'devices_with_expiring_warranty': warranty_expiring,
            'warranty_window_days': warranty_days,
            'ip_pools_summary': pool_summary,
            'devices_by_location': by_location,
            'vlan_breakdown': by_vlan,
            'rack_utilization': rack_util,
            'avg_uptime': avg_uptime,
            'recent_activity': recent_activity,
        })


class NetworkTopologyView(APIView):
    """Nodes (devices) + edges (port interconnections) for the topology map."""
    permission_classes = [HasModulePermission]
    rbac_module = 'network'

    def get(self, request):
        devices = NetworkDevice.objects.exclude(status='DECOMMISSIONED')
        loc = request.query_params.get('location')
        if loc:
            devices = devices.filter(location_id=loc)

        nodes = [{
            'id': d.id, 'name': d.device_name, 'code': d.device_code,
            'type': d.device_type, 'status': d.status, 'ip': d.ip_address,
            'location': d.location.name if d.location else None,
        } for d in devices.select_related('location')]

        node_ids = {n['id'] for n in nodes}
        edges = []
        seen = set()
        for port in NetworkDevicePort.objects.exclude(connected_to_device__isnull=True).select_related('device', 'connected_to_device'):
            a, b = port.device_id, port.connected_to_device_id
            if a not in node_ids or b not in node_ids:
                continue
            key = tuple(sorted((a, b)))
            if key in seen:
                continue
            seen.add(key)
            edges.append({
                'source': a, 'target': b,
                'is_uplink': port.is_uplink,
                'speed_mbps': port.speed_mbps,
            })

        return Response({'nodes': nodes, 'edges': edges})


class NetworkDeviceLookupView(APIView):
    """Find the device that matches a browser tab's host (IP or hostname).

    Used by the browser extension to link the page you're on to its IT Command
    network record. Exact IP / hostname wins; falls back to a fuzzy match.
    """
    permission_classes = [HasModulePermission]
    rbac_module = 'network'

    def get(self, request):
        host = (request.query_params.get('host') or '').strip()
        if not host:
            return Response({'device': None})

        device = NetworkDevice.objects.select_related('location').filter(
            Q(ip_address=host) | Q(hostname__iexact=host)
        ).first()
        if not device:
            device = NetworkDevice.objects.select_related('location').filter(
                Q(hostname__icontains=host) | Q(device_name__icontains=host)
            ).first()
        if not device:
            return Response({'device': None})

        return Response({'device': {
            'id': device.id,
            'device_name': device.device_name,
            'device_code': device.device_code,
            'device_type': device.device_type,
            'status': device.status,
            'ip_address': device.ip_address,
            'hostname': device.hostname,
            'location_name': device.location.name if device.location else None,
            'uptime_percent': float(device.uptime_percent) if device.uptime_percent is not None else None,
            'warranty_expiry': device.warranty_expiry.strftime('%Y-%m-%d') if device.warranty_expiry else None,
        }})


class NetworkExportView(APIView):
    """Excel export: Devices, Ports and IP Allocations on separate sheets."""
    permission_classes = [HasModulePermission]
    rbac_module = 'network'

    def get(self, request):
        from core.reports import make_xlsx

        dev_headers = ['Code', 'Name', 'Type', 'Status', 'Brand', 'Model', 'Serial',
                       'IP Address', 'MAC', 'Hostname', 'VLAN', 'Location', 'Rack U',
                       'OS', 'Warranty Expiry', 'Uptime %']
        dev_rows = []
        for d in NetworkDevice.objects.select_related('location').order_by('device_code'):
            rack = f"U{d.rack_unit_start}-U{d.rack_unit_start + (d.rack_unit_size or 1) - 1}" if d.rack_unit_start else ''
            dev_rows.append([
                d.device_code, d.device_name, d.device_type, d.status, d.brand or '',
                d.model or '', d.serial_number or '', d.ip_address or '', d.mac_address or '',
                d.hostname or '', d.vlan_id or '', d.location.name if d.location else '',
                rack, f"{d.os_name or ''} {d.os_version or ''}".strip(),
                d.warranty_expiry.strftime('%Y-%m-%d') if d.warranty_expiry else '',
                float(d.uptime_percent) if d.uptime_percent is not None else '',
            ])

        port_headers = ['Device', 'Port #', 'Name', 'Type', 'Speed (Mbps)', 'Connected To', 'Uplink']
        port_rows = [[
            p.device.device_name, p.port_number, p.port_name or '', p.port_type,
            p.speed_mbps or '', p.connected_to_device.device_name if p.connected_to_device else '',
            'Yes' if p.is_uplink else 'No',
        ] for p in NetworkDevicePort.objects.select_related('device', 'connected_to_device').order_by('device__device_name', 'port_number')]

        ip_headers = ['Pool', 'Network', 'IP Address', 'Status', 'Device']
        ip_rows = []
        for pool in IPAddressPool.objects.all():
            ips = pool.get_ip_range()
            used = {d.ip_address: d for d in NetworkDevice.objects.exclude(status='DECOMMISSIONED').filter(ip_address__in=ips)}
            net = f"{pool.network_address}/{pool.cidr_prefix}"
            for ip in ips:
                if ip == pool.gateway:
                    ip_rows.append([pool.name, net, ip, 'Reserved (Gateway)', ''])
                elif ip in used:
                    ip_rows.append([pool.name, net, ip, 'Used', used[ip].device_name])
                else:
                    ip_rows.append([pool.name, net, ip, 'Free', ''])

        return make_xlsx('network_inventory.xlsx', [
            ('Devices', dev_headers, dev_rows),
            ('Ports', port_headers, port_rows),
            ('IP Allocations', ip_headers, ip_rows),
        ])
