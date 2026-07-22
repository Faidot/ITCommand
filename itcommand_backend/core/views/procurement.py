from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Sum, Q, Count, Avg, F
from django.utils import timezone
from datetime import timedelta

from core.models.procurement import (
    PurchaseRequest, PurchaseRequestItem, PRApprovalLog, PRDocument,
    PRStatus, PRApprovalAction, PRItemStatus
)
from core.models.assets import Asset
from core.models import Notification

from core.serializers.procurement import (
    PurchaseRequestListSerializer, PurchaseRequestDetailSerializer,
    PurchaseRequestCreateSerializer, PurchaseRequestItemSerializer,
    PRApprovalLogSerializer, PRDocumentSerializer
)
from core.permissions import HasModulePermission, has_role_permission
from core.asset_specs import validate_asset_specs
from django.core.exceptions import ValidationError as DjangoValidationError


def can_manage_procurement(user):
    """Edit/delete permission grants organization-wide procurement visibility."""
    return (
        has_role_permission(user, 'procurement', 'edit')
        or has_role_permission(user, 'procurement', 'delete')
    )


class PurchaseRequestViewSet(viewsets.ModelViewSet):
    queryset = PurchaseRequest.objects.all()
    permission_classes = [HasModulePermission]
    rbac_module = 'procurement'
    rbac_action_permissions = {
        'manage_documents': {'POST': 'add'},
        'manage_items': {'POST': 'add', 'PUT': 'edit', 'DELETE': 'delete'},
    }

    def get_serializer_class(self):
        if self.action in ['retrieve', 'update', 'partial_update']:
            return PurchaseRequestDetailSerializer
        if self.action == 'create':
            return PurchaseRequestCreateSerializer
        return PurchaseRequestListSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user

        # View-only and request-only custom roles see only their own requests.
        if not can_manage_procurement(user):
            qs = qs.filter(requested_by=user)

        # Filters
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(Q(pr_number__icontains=search) | Q(title__icontains=search))

        status_filter = self.request.query_params.get('status')
        if status_filter:
            statuses = status_filter.split(',')
            qs = qs.filter(status__in=statuses)

        priority = self.request.query_params.get('priority')
        if priority:
            qs = qs.filter(priority=priority)

        department = self.request.query_params.get('department')
        if department:
            qs = qs.filter(department_id=department)

        requested_by = self.request.query_params.get('requested_by')
        if requested_by:
            qs = qs.filter(requested_by_id=requested_by)

        date_from = self.request.query_params.get('date_from')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        # "my" filter for current user's PRs
        mine = self.request.query_params.get('mine')
        if mine == 'true':
            qs = qs.filter(requested_by=user)

        # "pending_approval" filter
        pending = self.request.query_params.get('pending_approval')
        if pending == 'true':
            qs = qs.filter(status__in=['SUBMITTED', 'UNDER_REVIEW'])

        return qs

    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        # Return full detail response with id
        pr = serializer.instance
        detail = PurchaseRequestDetailSerializer(pr).data
        return Response(detail, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        instance = serializer.save()
        instance.recalculate_total()

    # --- Workflow Actions ---

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        pr = self.get_object()
        if pr.status != PRStatus.DRAFT:
            return Response({'error': 'Can only submit DRAFT requests.'}, status=status.HTTP_400_BAD_REQUEST)
        if pr.items.count() == 0:
            return Response({'error': 'Cannot submit a PR with no items.'}, status=status.HTTP_400_BAD_REQUEST)

        pr.status = PRStatus.SUBMITTED
        pr.recalculate_total()
        pr.save(update_fields=['status'])

        PRApprovalLog.objects.create(pr=pr, action=PRApprovalAction.SUBMITTED, actor=request.user,
                                     comment=request.data.get('comment', ''))

        # Notify managers/admins
        from core.models.users import User
        managers = User.objects.filter(role__in=['MANAGER', 'ADMIN', 'SUPERADMIN'], is_active=True)
        for mgr in managers:
            Notification.objects.create(
                user=mgr,
                message=f"New PR {pr.pr_number} '{pr.title}' submitted by {pr.requested_by.full_name} for approval.",
                notification_type='SYSTEM',
                link=f'/procurement/requests/{pr.id}'
            )

        return Response(PurchaseRequestDetailSerializer(pr).data)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        pr = self.get_object()
        user = request.user

        if not can_manage_procurement(user):
            return Response({'error': 'Procurement edit permission is required.'}, status=status.HTTP_403_FORBIDDEN)

        if pr.status not in [PRStatus.SUBMITTED, PRStatus.UNDER_REVIEW]:
            return Response({'error': 'PR is not pending approval.'}, status=status.HTTP_400_BAD_REQUEST)

        pr.status = PRStatus.APPROVED
        pr.approved_by = user
        pr.approved_at = timezone.now()
        pr.save(update_fields=['status', 'approved_by', 'approved_at'])

        PRApprovalLog.objects.create(pr=pr, action=PRApprovalAction.APPROVED, actor=user,
                                     comment=request.data.get('comment', ''))

        Notification.objects.create(
            user=pr.requested_by,
            message=f"Your PR {pr.pr_number} '{pr.title}' has been APPROVED by {user.full_name}.",
            notification_type='SYSTEM',
            link=f'/procurement/requests/{pr.id}'
        )

        return Response(PurchaseRequestDetailSerializer(pr).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        pr = self.get_object()
        user = request.user
        reason = request.data.get('rejection_reason', '')

        if not can_manage_procurement(user):
            return Response({'error': 'Procurement edit permission is required.'}, status=status.HTTP_403_FORBIDDEN)

        if pr.status not in [PRStatus.SUBMITTED, PRStatus.UNDER_REVIEW]:
            return Response({'error': 'PR is not pending approval.'}, status=status.HTTP_400_BAD_REQUEST)

        if not reason:
            return Response({'error': 'Rejection reason is required.'}, status=status.HTTP_400_BAD_REQUEST)

        pr.status = PRStatus.REJECTED
        pr.rejection_reason = reason
        pr.save(update_fields=['status', 'rejection_reason'])

        PRApprovalLog.objects.create(pr=pr, action=PRApprovalAction.REJECTED, actor=user, comment=reason)

        Notification.objects.create(
            user=pr.requested_by,
            message=f"Your PR {pr.pr_number} '{pr.title}' was REJECTED. Reason: {reason}",
            notification_type='SYSTEM',
            link=f'/procurement/requests/{pr.id}'
        )

        return Response(PurchaseRequestDetailSerializer(pr).data)

    @action(detail=True, methods=['post'])
    def order(self, request, pk=None):
        pr = self.get_object()
        if pr.status != PRStatus.APPROVED:
            return Response({'error': 'Can only order APPROVED requests.'}, status=status.HTTP_400_BAD_REQUEST)

        pr.status = PRStatus.ORDERED
        pr.save(update_fields=['status'])

        # Update all items to ORDERED
        pr.items.update(status=PRItemStatus.ORDERED)

        PRApprovalLog.objects.create(pr=pr, action=PRApprovalAction.ORDERED, actor=request.user,
                                     comment=request.data.get('comment', ''))

        return Response(PurchaseRequestDetailSerializer(pr).data)

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        pr = self.get_object()
        if pr.status not in [PRStatus.ORDERED, PRStatus.PARTIALLY_RECEIVED]:
            return Response({'error': 'PR must be ORDERED or PARTIALLY_RECEIVED.'}, status=status.HTTP_400_BAD_REQUEST)

        items_data = request.data.get('items', [])
        for item_update in items_data:
            try:
                item = pr.items.get(id=item_update['id'])
                received_qty = int(item_update.get('received_quantity', 0))
                item.received_quantity = received_qty
                if item_update.get('actual_unit_price'):
                    item.actual_unit_price = item_update['actual_unit_price']
                if received_qty >= item.quantity:
                    item.status = PRItemStatus.RECEIVED
                elif received_qty > 0:
                    item.status = PRItemStatus.PARTIALLY_RECEIVED
                item.save()
            except PurchaseRequestItem.DoesNotExist:
                pass

        # Check if all items received
        all_received = all(i.status == PRItemStatus.RECEIVED for i in pr.items.all())
        any_received = any(i.received_quantity > 0 for i in pr.items.all())

        if all_received:
            pr.status = PRStatus.RECEIVED
        elif any_received:
            pr.status = PRStatus.PARTIALLY_RECEIVED

        pr.save(update_fields=['status'])
        pr.recalculate_total()

        PRApprovalLog.objects.create(pr=pr, action=PRApprovalAction.RECEIVED, actor=request.user,
                                     comment=request.data.get('comment', 'Items received'))

        return Response(PurchaseRequestDetailSerializer(pr).data)

    @action(detail=True, methods=['post'], url_path='create-assets')
    def create_assets(self, request, pk=None):
        """Create Asset rows from received PR hardware items.

        Body: {items: [{item_id, asset_name?, serial_number?, category?, specs?}]}

        For each item the dialog may also supply:
          - category: AssetCategory id (FK on the new asset)
          - specs:    dict of category spec_schema values
        """
        from core.models.assets import AssetCategory
        pr = self.get_object()
        if pr.status not in [PRStatus.RECEIVED, PRStatus.PARTIALLY_RECEIVED]:
            return Response({'error': 'PR must be RECEIVED.'}, status=status.HTTP_400_BAD_REQUEST)

        items_to_create = request.data.get('items', [])
        created_assets = []
        existing_assets = []

        # Categories that can become asset rows. Services / consumables /
        # software (licenses live in a different module) are excluded.
        ASSETABLE_CATEGORIES = {'HARDWARE', 'PERIPHERAL', 'OTHER'}

        for item_data in items_to_create:
            try:
                pr_item = pr.items.get(id=item_data['item_id'])
            except PurchaseRequestItem.DoesNotExist:
                continue

            existing = Asset.objects.filter(
                source_purchase_request_item=pr_item
            ).first()
            if existing:
                existing_assets.append({
                    'id': existing.id,
                    'asset_tag': existing.asset_tag,
                    'name': existing.name,
                })
                continue

            if pr_item.category not in ASSETABLE_CATEGORIES:
                continue

            # Resolve optional category FK
            category_obj = None
            cat_id = item_data.get('category')
            if cat_id:
                try:
                    category_obj = AssetCategory.objects.get(pk=cat_id)
                except (AssetCategory.DoesNotExist, ValueError, TypeError):
                    category_obj = None

            specs = item_data.get('specs') or {}
            if not isinstance(specs, dict):
                specs = {}
            try:
                validate_asset_specs(category_obj, specs)
            except DjangoValidationError as exc:
                return Response(
                    {
                        'error': 'Invalid asset specifications.',
                        'item_id': pr_item.id,
                        'details': exc.message_dict,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Quantity: use what was actually received when known, otherwise
            # fall back to the ordered quantity. Either way, never less than 1
            # so a single-row asset always gets created for unrecorded receipts.
            qty = pr_item.received_quantity or pr_item.quantity or 1
            unit_price = pr_item.actual_unit_price or pr_item.estimated_unit_price or 0
            # Asset.save() will auto-derive purchase_price = unit_price * qty.
            # Purchase date defaults to when the PR was approved (closest to
            # the real acquisition date we have); fall back to today.
            purchase_date = pr.approved_at.date() if pr.approved_at else timezone.now().date()

            # PR category maps directly onto the Asset.asset_type vocabulary
            # for the assetable subset.
            asset_type = pr_item.category if pr_item.category in {'HARDWARE', 'PERIPHERAL', 'OTHER'} else 'HARDWARE'

            asset = Asset.objects.create(
                name=item_data.get('asset_name', pr_item.item_name),
                serial_number=item_data.get('serial_number', ''),
                asset_type=asset_type,
                category=category_obj,
                specs=specs,
                unit_price=unit_price,
                quantity_total=qty,
                purchase_date=purchase_date,
                vendor=pr.preferred_vendor,
                status='AVAILABLE',
                condition='NEW',
                notes=f"Auto-created from PR {pr.pr_number}",
                created_by=request.user,
                source_purchase_request_item=pr_item,
            )
            created_assets.append({
                'id': asset.id,
                'asset_tag': asset.asset_tag,
                'name': asset.name,
                'category': category_obj.id if category_obj else None,
                'quantity_total': asset.quantity_total,
                'unit_price': str(asset.unit_price) if asset.unit_price is not None else None,
                'purchase_price': str(asset.purchase_price) if asset.purchase_price is not None else None,
            })

        return Response({
            'created_count': len(created_assets),
            'existing_count': len(existing_assets),
            'assets': created_assets,
            'existing_assets': existing_assets,
        })

    @action(detail=True, methods=['get'])
    def timeline(self, request, pk=None):
        pr = self.get_object()
        logs = pr.approval_logs.all()
        return Response(PRApprovalLogSerializer(logs, many=True).data)

    @action(detail=True, methods=['post'], url_path='convert-to-expense')
    def convert_to_expense(self, request, pk=None):
        """Create a finance Expense from a fulfilled purchase request."""
        from core.models import Expense, FinancialYear
        from core.serializers import ExpenseSerializer
        pr = self.get_object()
        existing = pr.expenses.order_by('created_at').first()
        if existing:
            return Response(
                {
                    'detail': 'This purchase request already has an expense.',
                    'expense_id': existing.id,
                },
                status=status.HTTP_409_CONFLICT,
            )
        amount = request.data.get('amount') or pr.total_actual_cost or pr.total_estimated_cost or 0
        active_fy = FinancialYear.objects.filter(is_active=True).first()
        role = getattr(request.user, 'role', None)
        st = 'APPROVED' if role in ('ADMIN', 'SUPERADMIN') else 'PENDING'
        exp = Expense.objects.create(
            title=f"PR {pr.pr_number}: {pr.title}",
            amount=amount,
            expense_date=timezone.now().date(),
            category=pr.budget_category,
            financial_year=active_fy,
            paid_to=pr.preferred_vendor.name if pr.preferred_vendor else '',
            linked_purchase_request=pr,
            description=f"Converted from purchase request {pr.pr_number}.",
            status=st,
            approved_by=request.user if st == 'APPROVED' else None,
            approved_at=timezone.now() if st == 'APPROVED' else None,
            created_by=request.user,
        )
        return Response(ExpenseSerializer(exp).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post', 'get'], url_path='documents')
    def manage_documents(self, request, pk=None):
        pr = self.get_object()

        if request.method == 'GET':
            docs = pr.documents.all()
            return Response(PRDocumentSerializer(docs, many=True).data)

        # POST - upload
        serializer = PRDocumentSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(pr=pr, uploaded_by=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post', 'get', 'put', 'delete'], url_path='items')
    def manage_items(self, request, pk=None):
        pr = self.get_object()

        if request.method == 'GET':
            items = pr.items.all()
            return Response(PurchaseRequestItemSerializer(items, many=True).data)

        if request.method == 'POST':
            data = request.data.copy()
            data['pr'] = pr.id
            serializer = PurchaseRequestItemSerializer(data=data)
            if serializer.is_valid():
                serializer.save()
                pr.recalculate_total()
                return Response(serializer.data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        if request.method == 'PUT':
            item_id = request.data.get('id')
            try:
                item = pr.items.get(id=item_id)
            except PurchaseRequestItem.DoesNotExist:
                return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)
            serializer = PurchaseRequestItemSerializer(item, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                pr.recalculate_total()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        if request.method == 'DELETE':
            item_id = request.data.get('id')
            try:
                item = pr.items.get(id=item_id)
                item.delete()
                pr.recalculate_total()
                return Response({'status': 'deleted'})
            except PurchaseRequestItem.DoesNotExist:
                return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)


class ProcurementDashboardView(APIView):
    permission_classes = [HasModulePermission]
    rbac_module = 'procurement'

    def get(self, request):
        user = request.user
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        prs = PurchaseRequest.objects.all()
        if not can_manage_procurement(user):
            prs = prs.filter(requested_by=user)

        # Status counts
        status_counts = dict(
            prs.values_list('status').annotate(count=Count('id')).values_list('status', 'count')
        )

        # My open PRs
        my_open = prs.filter(
            requested_by=user
        ).exclude(
            status__in=['RECEIVED', 'CANCELLED', 'REJECTED']
        ).count()

        # Pending my approval (MANAGER+ only)
        pending_approval = 0
        if can_manage_procurement(user):
            pending_approval = prs.filter(
                status__in=['SUBMITTED', 'UNDER_REVIEW']
            ).count()

        # Approved this month
        approved_this_month = prs.filter(
            status='APPROVED', approved_at__gte=month_start
        ).count()

        # Total value this month (approved)
        total_value_month = prs.filter(
            status__in=['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED'],
            approved_at__gte=month_start
        ).aggregate(total=Sum('total_estimated_cost'))['total'] or 0

        # Total pending value
        total_pending = prs.filter(
            status__in=['SUBMITTED', 'UNDER_REVIEW']
        ).aggregate(total=Sum('total_estimated_cost'))['total'] or 0

        # Average approval time (hours)
        approved_prs = prs.filter(
            approved_at__isnull=False
        ).exclude(status='DRAFT')
        if approved_prs.exists():
            total_hours = sum(
                (pr.approved_at - pr.created_at).total_seconds() / 3600
                for pr in approved_prs[:50]  # limit for performance
            )
            avg_hours = round(total_hours / min(approved_prs.count(), 50), 1)
        else:
            avg_hours = 0

        # Recent PRs
        recent = prs.order_by('-created_at')[:10]
        recent_data = PurchaseRequestListSerializer(recent, many=True).data

        # Pending approval PRs
        pending_prs = prs.filter(
            status__in=['SUBMITTED', 'UNDER_REVIEW']
        ).order_by('-created_at')[:10]
        pending_data = PurchaseRequestListSerializer(pending_prs, many=True).data

        return Response({
            'status_counts': status_counts,
            'my_open_prs': my_open,
            'pending_approval_count': pending_approval,
            'approved_this_month': approved_this_month,
            'total_value_this_month': float(total_value_month),
            'total_value_pending': float(total_pending),
            'avg_approval_time_hours': avg_hours,
            'recent_prs': recent_data,
            'pending_approval_prs': pending_data,
        })
