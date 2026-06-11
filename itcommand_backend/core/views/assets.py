from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core.models.assets import (
    Asset, AssetCategory, AssetHistory, AssetMaintenance, AssetNote,
    AssetUnitAssignment,
)
from core.models.users import User
from core.serializers.assets import (
    AssetCategorySerializer, AssetHistorySerializer,
    AssetMaintenanceSerializer, AssetNoteSerializer, AssetSerializer,
    AssetUnitAssignmentSerializer,
)
from core.mixins import AuditLogMixin
from core.permissions import IsAdminOrSuperadmin, ReadOnlyViewerOrHigher, HasModulePermission


class AssetCategoryViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = AssetCategory.objects.all().order_by('name')
    serializer_class = AssetCategorySerializer
    # Categories are configuration data managed under Settings.
    permission_classes = [HasModulePermission]
    rbac_module = 'settings'

class AssetViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Asset.objects.all().order_by('-created_at')
    serializer_class = AssetSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'assets'

    def get_queryset(self):
        queryset = super().get_queryset()
        status = self.request.query_params.get('status', None)
        assigned_to = self.request.query_params.get('assigned_to', None)
        category = self.request.query_params.get('category', None)
        asset_type = self.request.query_params.get('asset_type', None)
        search = self.request.query_params.get('search', None)
        
        if status:
            queryset = queryset.filter(status=status)
        if assigned_to:
            queryset = queryset.filter(assigned_to_id=assigned_to)
        if category:
            queryset = queryset.filter(category_id=category)
        if asset_type:
            queryset = queryset.filter(asset_type=asset_type)
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | 
                Q(asset_tag__icontains=search) | 
                Q(serial_number__icontains=search)
            )
            
        return queryset

    def perform_create(self, serializer):
        asset = serializer.save(created_by=self.request.user)
        AssetHistory.objects.create(
            asset=asset,
            action="CREATED",
            note="Asset created in the system.",
            from_user=self.request.user
        )

    # ─── Delete protection ──────────────────────────────────────────

    @staticmethod
    def _blocked_reason(asset):
        """Return a human-readable reason this asset cannot be deleted, or None."""
        if asset.assigned_to_id:
            return f'currently assigned to {asset.assigned_to.full_name}'
        active_units = asset.unit_assignments.filter(is_active=True).count()
        if active_units:
            return f'{active_units} active unit assignment(s)'
        return None

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        reason = self._blocked_reason(instance)
        if reason:
            return Response(
                {'detail': f'Cannot delete asset {instance.asset_tag}: {reason}. Return / unassign it first.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'], url_path='bulk_delete',
            permission_classes=[IsAdminOrSuperadmin])
    def bulk_delete(self, request):
        """Delete many assets. Skips (does not delete) any that are in use,
        and reports them in `blocked` so the UI can show a clear message."""
        ids = request.data.get('ids', [])
        if not isinstance(ids, list):
            return Response({'detail': 'ids must be a list of integers.'},
                            status=status.HTTP_400_BAD_REQUEST)

        deleted, blocked = [], []
        for pk in ids:
            try:
                asset = Asset.objects.get(pk=pk)
            except (Asset.DoesNotExist, ValueError, TypeError):
                blocked.append({'id': pk, 'reason': 'not found'})
                continue
            reason = self._blocked_reason(asset)
            if reason:
                blocked.append({'id': pk, 'tag': asset.asset_tag, 'reason': reason})
            else:
                asset.delete()
                deleted.append(pk)

        return Response({
            'deleted_count': len(deleted),
            'blocked_count': len(blocked),
            'deleted': deleted,
            'blocked': blocked,
        })

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        asset = self.get_object()
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'detail': 'User ID is required.'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
            
        asset.assigned_to = target_user
        asset.assigned_date = timezone.now()
        asset.status = 'ASSIGNED'
        asset.save()
        
        AssetHistory.objects.create(
            asset=asset,
            action="ASSIGNED",
            from_user=self.request.user,
            to_user=target_user,
            note=request.data.get('note', '')
        )
        return Response(AssetSerializer(asset).data)

    @action(detail=True, methods=['post'])
    def return_asset(self, request, pk=None):
        asset = self.get_object()
        if not asset.assigned_to:
            return Response({'detail': 'Asset is not currently assigned.'}, status=status.HTTP_400_BAD_REQUEST)
            
        previous_user = asset.assigned_to
        asset.assigned_to = None
        asset.assigned_date = None
        asset.status = 'AVAILABLE'
        asset.save()
        
        AssetHistory.objects.create(
            asset=asset,
            action="RETURNED",
            from_user=previous_user,
            to_user=self.request.user,
            note=request.data.get('note', '')
        )
        return Response(AssetSerializer(asset).data)

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        asset = self.get_object()
        history = asset.history.all()
        return Response(AssetHistorySerializer(history, many=True).data)

    # ─── Per-unit assignment (bulk assets) ──────────────────────────

    @action(detail=True, methods=['get'], url_path='unit_assignments')
    def unit_assignments(self, request, pk=None):
        asset = self.get_object()
        qs = asset.unit_assignments.select_related('user', 'assigned_by').all()
        return Response(AssetUnitAssignmentSerializer(qs, many=True).data)

    @action(detail=True, methods=['post'], url_path='assign_unit',
            permission_classes=[IsAdminOrSuperadmin])
    def assign_unit(self, request, pk=None):
        """Assign one or more units of a bulk asset to a user.

        Body: {user_id, notes?, quantity?}
        quantity defaults to 1. Refuses if quantity > quantity_available.
        Creates that many AssetUnitAssignment rows in a single transaction
        and writes a single AssetHistory entry summarising the change.
        """
        asset = self.get_object()
        user_id = request.data.get('user_id')
        notes = request.data.get('notes', '')

        if not user_id:
            return Response({'detail': 'user_id is required.'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            quantity = int(request.data.get('quantity', 1))
        except (TypeError, ValueError):
            return Response({'detail': 'quantity must be an integer.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if quantity < 1:
            return Response({'detail': 'quantity must be at least 1.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if quantity > asset.quantity_available:
            return Response(
                {'detail': f'Only {asset.quantity_available} unit(s) available '
                           f'({asset.quantity_assigned}/{asset.quantity_total} already assigned).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            target_user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            created = [
                AssetUnitAssignment.objects.create(
                    asset=asset, user=target_user,
                    assigned_by=request.user, notes=notes,
                )
                for _ in range(quantity)
            ]
            AssetHistory.objects.create(
                asset=asset, action='UNIT_ASSIGNED',
                from_user=request.user, to_user=target_user,
                note=(
                    f"{quantity} unit(s) assigned "
                    f"({asset.quantity_assigned}/{asset.quantity_total} after this)."
                ),
            )
        # Return the freshly-created rows (most recent first matches the model
        # ordering, but we still pass them in creation order for clarity).
        return Response(
            AssetUnitAssignmentSerializer(created, many=True).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'], url_path=r'return_unit/(?P<assignment_id>\d+)',
            permission_classes=[IsAdminOrSuperadmin])
    def return_unit(self, request, pk=None, assignment_id=None):
        """Mark a specific per-unit assignment as returned."""
        asset = self.get_object()
        try:
            assignment = asset.unit_assignments.get(pk=assignment_id, is_active=True)
        except AssetUnitAssignment.DoesNotExist:
            return Response({'detail': 'Active assignment not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        previous_user = assignment.user
        with transaction.atomic():
            assignment.is_active = False
            assignment.returned_date = timezone.now()
            assignment.notes = (
                f"{assignment.notes}\n[returned] {request.data.get('notes', '')}".strip()
            )
            assignment.save()
            AssetHistory.objects.create(
                asset=asset, action='UNIT_RETURNED',
                from_user=previous_user, to_user=request.user,
                note=f"Unit returned ({asset.quantity_assigned}/{asset.quantity_total} after this).",
            )
        return Response(AssetUnitAssignmentSerializer(assignment).data)

    @action(detail=True, methods=['delete'],
            url_path=r'maintenance/(?P<record_id>\d+)',
            permission_classes=[IsAdminOrSuperadmin])
    def delete_maintenance(self, request, pk=None, record_id=None):
        """Admin: remove a single maintenance record. Also writes an audit log."""
        asset = self.get_object()
        try:
            rec = asset.maintenance_records.get(pk=record_id)
        except AssetMaintenance.DoesNotExist:
            return Response({'detail': 'Maintenance record not found.'},
                            status=status.HTTP_404_NOT_FOUND)

        snapshot = {
            'event_type': rec.event_type,
            'description': rec.description,
            'cost': str(rec.cost),
            'performed_on': str(rec.performed_on),
            'maintenance_record_id': rec.id,
        }
        rec.delete()
        AssetHistory.objects.create(
            asset=asset, action='MAINTENANCE_DELETED', from_user=request.user,
            note=f"Maintenance record removed: {snapshot['event_type']} on {snapshot['performed_on']}",
        )
        self.log_action('MAINTENANCE_DELETED', asset, changes=snapshot)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get', 'post'], url_path='maintenance')
    def maintenance(self, request, pk=None):
        asset = self.get_object()
        if request.method == 'GET':
            records = asset.maintenance_records.all()
            return Response(AssetMaintenanceSerializer(records, many=True).data)

        serializer = AssetMaintenanceSerializer(data={**request.data, 'asset': asset.id})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            record = serializer.save(created_by=request.user)
            event_label = record.get_event_type_display()
            summary = f"{event_label}: {record.description[:140]} (cost {record.cost})"

            # 1. Asset history (timeline in the drawer)
            AssetHistory.objects.create(
                asset=asset,
                action="MAINTENANCE",
                from_user=request.user,
                note=summary,
            )

            # 2. Asset note (auto-generated, visible in Notes section)
            AssetNote.objects.create(
                asset=asset,
                created_by=request.user,
                note=(
                    f"[Auto · {event_label}] {record.description}\n"
                    f"Performed on {record.performed_on} · Cost: {record.cost}"
                    + (f" · Downtime: {record.downtime_days}d" if record.downtime_days else "")
                    + (f" · Vendor: {record.vendor.name}" if record.vendor else "")
                ),
            )

            # 3. Global audit log (for superadmin review)
            self.log_action(
                'MAINTENANCE',
                asset,
                changes={
                    'event_type': record.event_type,
                    'description': record.description,
                    'cost': str(record.cost),
                    'vendor': record.vendor_id,
                    'performed_on': str(record.performed_on),
                    'downtime_days': record.downtime_days,
                    'maintenance_record_id': record.id,
                },
            )

        return Response(AssetMaintenanceSerializer(record).data, status=status.HTTP_201_CREATED)

class AssetNoteViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = AssetNote.objects.all().order_by('-created_at')
    serializer_class = AssetNoteSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'assets'

    def get_queryset(self):
        queryset = super().get_queryset()
        asset = self.request.query_params.get('asset', None)
        if asset:
            queryset = queryset.filter(asset_id=asset)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
