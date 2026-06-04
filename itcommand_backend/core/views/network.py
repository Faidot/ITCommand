from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Count, Q
from django.utils import timezone
from datetime import timedelta

from core.models.network import (
    NetworkLocation, NetworkDevice, IPAddressPool, NetworkDevicePort, NetworkNote
)
from core.serializers.network import (
    NetworkLocationSerializer, NetworkDeviceListSerializer,
    NetworkDeviceDetailSerializer, NetworkDeviceCreateSerializer,
    IPAddressPoolSerializer, NetworkDevicePortSerializer, NetworkNoteSerializer
)


class NetworkLocationViewSet(viewsets.ModelViewSet):
    serializer_class = NetworkLocationSerializer
    queryset = NetworkLocation.objects.all().order_by('name')


class NetworkDeviceViewSet(viewsets.ModelViewSet):
    queryset = NetworkDevice.objects.all()

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
        return Response(NetworkDeviceDetailSerializer(serializer.instance).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'put'], url_path='ports')
    def ports(self, request, pk=None):
        device = self.get_object()
        if request.method == 'GET':
            return Response(NetworkDevicePortSerializer(device.ports.all(), many=True).data)
        # PUT - bulk update ports
        ports_data = request.data.get('ports', [])
        # Clear existing and recreate
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

        return Response({
            'pool': IPAddressPoolSerializer(pool).data,
            'total': len(all_ips),
            'used': len(used_map),
            'free': len(all_ips) - len(used_map) - (1 if pool.gateway in [i for i in all_ips] else 0),
            'ips': ip_list
        })


class NetworkDashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        now = timezone.now().date()
        thirty_days = now + timedelta(days=30)

        by_type = dict(NetworkDevice.objects.values_list('device_type').annotate(c=Count('id')).values_list('device_type', 'c'))
        by_status = dict(NetworkDevice.objects.values_list('status').annotate(c=Count('id')).values_list('status', 'c'))

        offline = NetworkDevice.objects.filter(status='OFFLINE').values(
            'id', 'device_name', 'device_code', 'device_type', 'ip_address', 'last_seen_online'
        )[:20]

        warranty_expiring = NetworkDevice.objects.filter(
            warranty_expiry__isnull=False, warranty_expiry__lte=thirty_days, warranty_expiry__gte=now
        ).exclude(status='DECOMMISSIONED').values(
            'id', 'device_name', 'device_code', 'warranty_expiry'
        )[:10]

        pools = IPAddressPool.objects.all()
        pool_summary = []
        for p in pools:
            ips = p.get_ip_range()
            used = NetworkDevice.objects.exclude(status='DECOMMISSIONED').filter(ip_address__in=ips).count()
            pool_summary.append({
                'id': p.id, 'name': p.name, 'network': f"{p.network_address}/{p.cidr_prefix}",
                'total': len(ips), 'used': used, 'free': len(ips) - used
            })

        return Response({
            'total_devices': NetworkDevice.objects.count(),
            'device_count_by_type': by_type,
            'device_count_by_status': by_status,
            'offline_devices': list(offline),
            'devices_with_expiring_warranty': list(warranty_expiring),
            'ip_pools_summary': pool_summary,
        })
