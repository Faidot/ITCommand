from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Sum, Q, Count
from django.utils import timezone
from datetime import timedelta

from core.models.vendors import Vendor, VendorContract, VendorPayment, VendorNote
from core.models.assets import Asset
from core.models.estate import Service
from core.models.finance import RecurringBill

from core.serializers.vendors import (
    VendorSerializer, VendorDetailSerializer,
    VendorContractSerializer, VendorPaymentSerializer, VendorNoteSerializer
)
from core.serializers.assets import AssetSerializer
from core.serializers.estate import ServiceSerializer
from core.serializers.finance import RecurringBillSerializer
from core.permissions import IsAdminOrSuperadmin, ReadOnlyViewerOrHigher, HasModulePermission

class VendorViewSet(viewsets.ModelViewSet):
    queryset = Vendor.objects.all().order_by('-created_at')
    permission_classes = [HasModulePermission]
    rbac_module = 'vendors'

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return VendorDetailSerializer
        return VendorSerializer

    @staticmethod
    def _blocked_reason(vendor):
        parts = []
        if vendor.assets.exists():
            parts.append(f'{vendor.assets.count()} asset(s)')
        if hasattr(vendor, 'contracts') and vendor.contracts.exists():
            parts.append(f'{vendor.contracts.count()} contract(s)')
        if vendor.estate_services.exists():
            parts.append(f'{vendor.estate_services.count()} estate service(s)')
        if parts:
            return 'linked to ' + ', '.join(parts)
        return None

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        reason = self._blocked_reason(instance)
        if reason:
            return Response(
                {'detail': f'Cannot delete vendor "{instance.name}": {reason}. Detach or reassign first.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'], url_path='bulk_delete')
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        if not isinstance(ids, list):
            return Response({'detail': 'ids must be a list of integers.'},
                            status=status.HTTP_400_BAD_REQUEST)
        deleted, blocked = [], []
        for pk in ids:
            try:
                v = Vendor.objects.get(pk=pk)
            except (Vendor.DoesNotExist, ValueError, TypeError):
                blocked.append({'id': pk, 'reason': 'not found'})
                continue
            reason = self._blocked_reason(v)
            if reason:
                blocked.append({'id': pk, 'name': v.name, 'reason': reason})
            else:
                v.delete()
                deleted.append(pk)
        return Response({
            'deleted_count': len(deleted), 'blocked_count': len(blocked),
            'deleted': deleted, 'blocked': blocked,
        })

    def get_queryset(self):
        queryset = super().get_queryset()
        
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(vendor_code__icontains=search))
            
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)
            
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
            
        rating = self.request.query_params.get('rating')
        if rating:
            queryset = queryset.filter(rating=rating)
            
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        now = timezone.now().date()
        thirty_days_later = now + timedelta(days=30)
        
        total_vendors = Vendor.objects.count()
        active_contracts = VendorContract.objects.filter(status='ACTIVE').count()
        
        contracts_expiring = VendorContract.objects.filter(
            status='ACTIVE',
            end_date__isnull=False,
            end_date__lte=thirty_days_later,
            end_date__gte=now
        ).order_by('end_date')
        
        expired_contracts = VendorContract.objects.filter(
            status='EXPIRED'
        ).order_by('-end_date')
        
        current_year = now.year
        total_paid_this_year = VendorPayment.objects.filter(
            payment_date__year=current_year
        ).aggregate(total=Sum('amount'))['total'] or 0.0
        
        top_vendors = Vendor.objects.annotate(
            total_spent=Sum('payments__amount')
        ).order_by('-total_spent')[:5]
        
        return Response({
            'total_vendors': total_vendors,
            'active_contracts': active_contracts,
            'contracts_expiring_within_30_days': VendorContractSerializer(contracts_expiring, many=True).data,
            'expired_contracts': VendorContractSerializer(expired_contracts, many=True).data,
            'total_paid_this_year': float(total_paid_this_year),
            'top_vendors_by_spend': [
                {'id': v.id, 'name': v.name, 'total_spent': float(v.total_spent or 0)} 
                for v in top_vendors
            ]
        })

    @action(detail=True, methods=['get'])
    def assets(self, request, pk=None):
        vendor = self.get_object()
        assets = Asset.objects.filter(vendor=vendor)
        return Response(AssetSerializer(assets, many=True).data)

    @action(detail=True, methods=['get'])
    def services(self, request, pk=None):
        """Estate services invoiced through this vendor.

        Replaces the `licenses` action, which went with the licences module in
        Phase 5. A vendor's exposure is now its estate spend.
        """
        vendor = self.get_object()
        services = (
            Service.objects.filter(vendor=vendor)
            .select_related('provider', 'provider_account', 'property')
            .order_by('property__name', 'service_type', 'identifier')
        )
        return Response(
            ServiceSerializer(
                services, many=True, context=self.get_serializer_context()
            ).data
        )

    @action(detail=True, methods=['get'])
    def bills(self, request, pk=None):
        vendor = self.get_object()
        bills = RecurringBill.objects.filter(vendor=vendor)
        return Response(RecurringBillSerializer(bills, many=True).data)


class VendorContractViewSet(viewsets.ModelViewSet):
    serializer_class = VendorContractSerializer
    queryset = VendorContract.objects.all().order_by('-created_at')
    permission_classes = [HasModulePermission]
    rbac_module = 'vendors'

    def get_queryset(self):
        queryset = super().get_queryset()
        
        vendor_id = self.request.query_params.get('vendor')
        if vendor_id:
            queryset = queryset.filter(vendor_id=vendor_id)
            
        status = self.request.query_params.get('status')
        if status:
            queryset = queryset.filter(status=status)
            
        contract_type = self.request.query_params.get('contract_type')
        if contract_type:
            queryset = queryset.filter(contract_type=contract_type)
            
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class VendorPaymentViewSet(viewsets.ModelViewSet):
    serializer_class = VendorPaymentSerializer
    queryset = VendorPayment.objects.all().order_by('-payment_date')
    permission_classes = [HasModulePermission]
    rbac_module = 'vendors'

    def get_queryset(self):
        queryset = super().get_queryset()
        vendor_id = self.request.query_params.get('vendor')
        if vendor_id:
            queryset = queryset.filter(vendor_id=vendor_id)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class VendorNoteViewSet(viewsets.ModelViewSet):
    serializer_class = VendorNoteSerializer
    queryset = VendorNote.objects.all().order_by('-created_at')
    permission_classes = [HasModulePermission]
    rbac_module = 'vendors'

    def get_queryset(self):
        queryset = super().get_queryset()
        vendor_id = self.request.query_params.get('vendor')
        if vendor_id:
            queryset = queryset.filter(vendor_id=vendor_id)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
