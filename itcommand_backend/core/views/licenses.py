from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from django.utils import timezone
from django.db.models import Q, Sum, Count
from datetime import timedelta
from decimal import Decimal

from core.models import (
    SoftwareProduct, SoftwareLicense, LicenseAssignment, LicenseAlert,
    LicenseRenewal, Notification, User,
)
from core.serializers.licenses import (
    SoftwareProductSerializer,
    SoftwareLicenseListSerializer, SoftwareLicenseDetailSerializer,
    SoftwareLicenseCreateSerializer,
    LicenseAssignmentSerializer, LicenseAlertSerializer,
    LicenseRenewalSerializer, UserLicenseSerializer,
)
from core.permissions import (
    IsAdminOrSuperadmin, IsManagerOrHigher, ReadOnlyViewerOrHigher,
    HasModulePermission, has_role_permission,
)
from core.mixins import AuditLogMixin
from core.encryption import decrypt_value
from django.db import transaction
from datetime import date as _date
from calendar import monthrange


# ─── Renewal helpers (shared by manual renew + auto-renew runner) ──

def _add_months(d, n):
    """Return `d + n months`, clipping day if the target month is shorter."""
    m0 = d.month - 1 + n
    year = d.year + m0 // 12
    month = m0 % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return _date(year, month, day)


def next_expiry_for_cycle(current_expiry, billing_cycle):
    """Suggested new expiry for a renewal, based on the license's billing
    cycle. Monthly → +1 month, Yearly → +1 year. Returns None if we don't
    have enough info to compute (e.g. perpetual / one-time / null current)."""
    if not current_expiry:
        return None
    if billing_cycle == 'MONTHLY':
        return _add_months(current_expiry, 1)
    if billing_cycle == 'YEARLY':
        return _date(current_expiry.year + 1, current_expiry.month, current_expiry.day) \
            if not (current_expiry.month == 2 and current_expiry.day == 29) \
            else _date(current_expiry.year + 1, 2, 28)
    return None


def apply_renewal(license_obj, *, new_expiry_date, cost=0, seats_added=0, notes='', renewer=None):
    """Create a LicenseRenewal row, advance the license's expiry, top up
    seats, and resolve any open expiry alerts. Returns the LicenseRenewal."""
    previous_expiry = license_obj.expiry_date
    renewal = LicenseRenewal.objects.create(
        license=license_obj,
        previous_expiry=previous_expiry,
        new_expiry=new_expiry_date,
        cost=cost,
        seats_added=seats_added,
        notes=notes,
        renewed_by=renewer,
    )
    license_obj.expiry_date = new_expiry_date
    if seats_added and license_obj.seats_total is not None:
        license_obj.seats_total = license_obj.seats_total + seats_added
    license_obj.save(update_fields=['expiry_date', 'seats_total', 'updated_at'])
    license_obj.alerts.filter(
        is_resolved=False,
        alert_type__in=['EXPIRING_SOON', 'EXPIRED'],
    ).update(is_resolved=True)
    return renewal


def run_auto_renewals(actor=None):
    """For every active license with auto_renew=True and an expiry that has
    passed today, advance expiry by one billing cycle. Repeats per license
    until the expiry is in the future (so a license whose auto-renew is
    months overdue catches up in one run). Returns a list of {id, name,
    previous, new, cycles_advanced} for caller reporting.
    """
    today = _date.today()
    results = []
    qs = SoftwareLicense.objects.filter(
        is_active=True, auto_renew=True,
        expiry_date__isnull=False, expiry_date__lt=today,
        billing_cycle__in=['MONTHLY', 'YEARLY'],
    )
    for lic in qs:
        cycles = 0
        previous = lic.expiry_date
        with transaction.atomic():
            while lic.expiry_date and lic.expiry_date < today and cycles < 60:
                nxt = next_expiry_for_cycle(lic.expiry_date, lic.billing_cycle)
                if not nxt:
                    break
                apply_renewal(
                    lic,
                    new_expiry_date=nxt,
                    cost=0,
                    seats_added=0,
                    notes='Auto-renewed',
                    renewer=actor,
                )
                cycles += 1
        if cycles:
            results.append({
                'id': lic.id,
                'name': lic.product.name,
                'previous_expiry': str(previous),
                'new_expiry': str(lic.expiry_date),
                'cycles_advanced': cycles,
            })
    return results


# ─── Helpers ──────────────────────────────────────────────────────────
def create_notification(user, message, notification_type='LICENSE', link=None):
    if user:
        Notification.objects.create(
            user=user,
            message=message,
            notification_type=notification_type,
            link=link or '/licenses'
        )


class LicensePagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


# ─── SoftwareProduct CRUD ───────────────────────────────────────────
class SoftwareProductViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = SoftwareProduct.objects.all()
    serializer_class = SoftwareProductSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'licenses'

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get('search')
        category = self.request.query_params.get('category')

        if search:
            qs = qs.filter(
                Q(name__icontains=search) |
                Q(vendor__icontains=search)
            )
        if category:
            qs = qs.filter(category=category)
        return qs


# ─── SoftwareLicense CRUD ───────────────────────────────────────────
class SoftwareLicenseViewSet(AuditLogMixin, viewsets.ModelViewSet):
    permission_classes = [HasModulePermission]
    rbac_module = 'licenses'
    pagination_class = LicensePagination

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return SoftwareLicenseCreateSerializer
        if self.action == 'list':
            return SoftwareLicenseListSerializer
        return SoftwareLicenseDetailSerializer

    def get_queryset(self):
        qs = SoftwareLicense.objects.select_related('product', 'created_by').all()

        params = self.request.query_params
        product = params.get('product')
        license_type = params.get('license_type')
        is_active = params.get('is_active')
        category = params.get('category')
        search = params.get('search')
        expiring_within = params.get('expiring_within')

        if product:
            qs = qs.filter(product_id=product)
        if license_type:
            qs = qs.filter(license_type=license_type)
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        if category:
            qs = qs.filter(product__category=category)
        if search:
            qs = qs.filter(
                Q(product__name__icontains=search) |
                Q(product__vendor__icontains=search) |
                Q(purchase_order_number__icontains=search)
            )
        if expiring_within:
            try:
                days = int(expiring_within)
                future = timezone.now().date() + timedelta(days=days)
                qs = qs.filter(expiry_date__lte=future, expiry_date__gte=timezone.now().date())
            except ValueError:
                pass

        return qs.order_by('-created_at')

    # GET /licenses/{id}/key/ → reveal decrypted license key (ADMIN+ only)
    @action(detail=True, methods=['get'], url_path='key', permission_classes=[IsAdminOrSuperadmin])
    def reveal_key(self, request, pk=None):
        license_obj = self.get_object()
        try:
            key = license_obj.get_license_key()
            # Audit log the reveal
            self.log_action('REVEAL_KEY', license_obj, {'action': 'reveal_license_key'})
            return Response({'license_key': key})
        except Exception:
            return Response(
                {'detail': 'Failed to decrypt license key.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # POST /licenses/{id}/assign/ → assign license seat to a user
    @action(detail=True, methods=['post'], url_path='assign', permission_classes=[IsAdminOrSuperadmin])
    @transaction.atomic
    def assign_seat(self, request, pk=None):
        license_obj = SoftwareLicense.objects.select_for_update().get(
            pk=self.get_object().pk
        )
        user_id = request.data.get('user_id')

        if not user_id:
            return Response({'detail': 'user_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Check if seats available
        if license_obj.seats_total is not None and license_obj.seats_available is not None:
            if license_obj.seats_available <= 0:
                return Response(
                    {'detail': 'No seats available for this license.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        # Prevent duplicate active assignment
        existing = LicenseAssignment.objects.filter(
            license=license_obj, user=target_user, is_active=True
        ).exists()
        if existing:
            return Response(
                {'detail': f'{target_user.full_name} already has an active assignment for this license.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        assignment = LicenseAssignment.objects.create(
            license=license_obj,
            user=target_user,
            assigned_by=request.user,
            notes=request.data.get('notes', '')
        )

        # Notification
        create_notification(
            target_user,
            f"You have been assigned a license for {license_obj.product.name}.",
            link=f"/licenses/{license_obj.id}"
        )

        self.log_action('ASSIGN_LICENSE', license_obj, {
            'action': 'assign_seat', 'user_id': user_id
        })

        return Response(
            LicenseAssignmentSerializer(assignment).data,
            status=status.HTTP_201_CREATED
        )

    # POST /licenses/{id}/revoke/{user_id}/ → revoke assignment
    @action(detail=True, methods=['post'], url_path=r'revoke/(?P<user_id>\d+)',
            permission_classes=[IsAdminOrSuperadmin])
    def revoke_seat(self, request, pk=None, user_id=None):
        license_obj = self.get_object()

        try:
            target_user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        assignment = LicenseAssignment.objects.filter(
            license=license_obj, user=target_user, is_active=True
        ).first()

        if not assignment:
            return Response(
                {'detail': 'No active assignment found for this user.'},
                status=status.HTTP_404_NOT_FOUND
            )

        assignment.is_active = False
        assignment.revoked_date = timezone.now()
        assignment.save()

        create_notification(
            target_user,
            f"Your license for {license_obj.product.name} has been revoked.",
            link=f"/licenses/{license_obj.id}"
        )

        self.log_action('REVOKE_LICENSE', license_obj, {
            'action': 'revoke_seat', 'user_id': user_id
        })

        return Response({'detail': 'Assignment revoked successfully.'})

    # GET /licenses/{id}/assignments/ → list all assignments for a license
    @action(detail=True, methods=['get'], url_path='assignments')
    def list_assignments(self, request, pk=None):
        license_obj = self.get_object()
        assignments = license_obj.assignments.all().order_by('-is_active', '-assigned_date')
        return Response(LicenseAssignmentSerializer(assignments, many=True).data)

    # ─── Delete protection ─────────────────────────────────────────

    @staticmethod
    def _blocked_reason(lic):
        active = lic.assignments.filter(is_active=True).count()
        if active:
            return f'{active} active seat assignment(s)'
        return None

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        reason = self._blocked_reason(instance)
        if reason:
            return Response(
                {'detail': f'Cannot delete {instance.product.name}: {reason}. Revoke seats first.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'], url_path='bulk_delete',
            permission_classes=[IsAdminOrSuperadmin])
    def bulk_delete(self, request):
        ids = request.data.get('ids', [])
        if not isinstance(ids, list):
            return Response({'detail': 'ids must be a list of integers.'},
                            status=status.HTTP_400_BAD_REQUEST)
        deleted, blocked = [], []
        for pk in ids:
            try:
                lic = SoftwareLicense.objects.select_related('product').get(pk=pk)
            except (SoftwareLicense.DoesNotExist, ValueError, TypeError):
                blocked.append({'id': pk, 'reason': 'not found'})
                continue
            reason = self._blocked_reason(lic)
            if reason:
                blocked.append({'id': pk, 'name': lic.product.name, 'reason': reason})
            else:
                lic.delete()
                deleted.append(pk)
        return Response({
            'deleted_count': len(deleted), 'blocked_count': len(blocked),
            'deleted': deleted, 'blocked': blocked,
        })

    # GET /licenses/{id}/renewals/ → renewal history
    @action(detail=True, methods=['get'], url_path='renewals')
    def list_renewals(self, request, pk=None):
        license_obj = self.get_object()
        return Response(
            LicenseRenewalSerializer(license_obj.renewals.all(), many=True).data
        )

    # POST /licenses/{id}/renew/ → renew with new expiry, optional cost/seats
    @action(detail=True, methods=['post'], url_path='renew',
            permission_classes=[IsAdminOrSuperadmin])
    def renew(self, request, pk=None):
        """Extend a license's expiry and capture a renewal record.

        Body:
            new_expiry (date, required)
            cost (decimal, optional, default 0)
            seats_added (int, optional, default 0)
            notes (str, optional)
        """
        license_obj = self.get_object()

        new_expiry = request.data.get('new_expiry')
        if not new_expiry:
            return Response({'detail': 'new_expiry is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            new_expiry_date = (
                _date.fromisoformat(new_expiry) if isinstance(new_expiry, str)
                else new_expiry
            )
        except (TypeError, ValueError):
            return Response({'detail': 'new_expiry must be YYYY-MM-DD.'},
                            status=status.HTTP_400_BAD_REQUEST)

        if license_obj.expiry_date and new_expiry_date <= license_obj.expiry_date:
            return Response(
                {'detail': f'new_expiry ({new_expiry_date}) must be after the current expiry '
                           f'({license_obj.expiry_date}).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            cost = float(request.data.get('cost') or 0)
            seats_added = int(request.data.get('seats_added') or 0)
        except (TypeError, ValueError):
            return Response({'detail': 'cost / seats_added must be numeric.'},
                            status=status.HTTP_400_BAD_REQUEST)

        if seats_added < 0:
            return Response({'detail': 'seats_added cannot be negative.'},
                            status=status.HTTP_400_BAD_REQUEST)

        notes = request.data.get('notes', '')
        previous_expiry = license_obj.expiry_date

        with transaction.atomic():
            renewal = apply_renewal(
                license_obj,
                new_expiry_date=new_expiry_date,
                cost=cost,
                seats_added=seats_added,
                notes=notes,
                renewer=request.user,
            )
            self.log_action(
                'RENEW',
                license_obj,
                changes={
                    'previous_expiry': str(previous_expiry) if previous_expiry else None,
                    'new_expiry': str(new_expiry_date),
                    'cost': cost,
                    'seats_added': seats_added,
                    'renewal_id': renewal.id,
                },
            )

        return Response(
            LicenseRenewalSerializer(renewal).data,
            status=status.HTTP_201_CREATED,
        )

    # GET /licenses/{id}/suggest_next_expiry/ → returns next expiry by cycle
    @action(detail=True, methods=['get'], url_path='suggest_next_expiry')
    def suggest_next_expiry(self, request, pk=None):
        license_obj = self.get_object()
        nxt = next_expiry_for_cycle(license_obj.expiry_date, license_obj.billing_cycle)
        return Response({
            'current_expiry': str(license_obj.expiry_date) if license_obj.expiry_date else None,
            'billing_cycle': license_obj.billing_cycle,
            'suggested_expiry': str(nxt) if nxt else None,
        })

    # POST /licenses/process_auto_renewals/ → run auto-renewals server-wide
    @action(detail=False, methods=['post'], url_path='process_auto_renewals',
            permission_classes=[IsAdminOrSuperadmin])
    def process_auto_renewals(self, request):
        results = run_auto_renewals(actor=request.user)
        # One audit row per renewed license so the trail captures who triggered
        # the batch and which licenses moved.
        for r in results:
            try:
                lic = SoftwareLicense.objects.get(pk=r['id'])
                self.log_action(
                    'AUTO_RENEW',
                    lic,
                    changes={
                        'previous_expiry': r['previous_expiry'],
                        'new_expiry': r['new_expiry'],
                        'cycles_advanced': r['cycles_advanced'],
                    },
                )
            except SoftwareLicense.DoesNotExist:
                pass
        return Response({'renewed_count': len(results), 'renewed': results})


# ─── User Licenses ─────────────────────────────────────────────────
class UserLicensesView(APIView):
    """GET /licenses/user/{user_id}/ → all licenses assigned to a user"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, user_id):
        # Users can view their own, managers+ can view anyone's
        if (
            str(request.user.id) != str(user_id)
            and not has_role_permission(request.user, 'licenses', 'view')
        ):
            return Response({'detail': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

        assignments = LicenseAssignment.objects.filter(
            user_id=user_id, is_active=True
        ).select_related('license__product')

        return Response(UserLicenseSerializer(assignments, many=True).data)


# ─── License Dashboard ─────────────────────────────────────────────
class LicenseDashboardView(APIView):
    permission_classes = [HasModulePermission]
    rbac_module = 'licenses'

    def get(self, request):
        today = timezone.now().date()
        thirty_days = today + timedelta(days=30)

        all_licenses = SoftwareLicense.objects.select_related('product').filter(is_active=True)
        all_products = SoftwareProduct.objects.all()

        total_licenses = all_licenses.count()
        total_products = all_products.count()

        # Expiring within 30 days
        expiring_soon = all_licenses.filter(
            expiry_date__gte=today, expiry_date__lte=thirty_days
        )
        expiring_soon_data = SoftwareLicenseListSerializer(expiring_soon, many=True).data

        # Already expired
        expired = all_licenses.filter(expiry_date__lt=today)
        expired_data = SoftwareLicenseListSerializer(expired, many=True).data

        # Near capacity (>= 80% seats used)
        near_capacity = []
        for lic in all_licenses.filter(seats_total__isnull=False, seats_total__gt=0):
            if lic.seats_usage_pct >= 80:
                near_capacity.append(lic)
        near_capacity_data = SoftwareLicenseListSerializer(near_capacity, many=True).data

        # Total annual cost (normalize monthly to yearly)
        total_annual_cost = 0
        for lic in all_licenses:
            total_annual_cost += lic.annual_cost

        # Cost by category
        cost_by_category = {}
        for lic in all_licenses:
            cat = lic.product.category
            cat_display = lic.product.get_category_display()
            if cat not in cost_by_category:
                cost_by_category[cat] = {'category': cat, 'label': cat_display, 'cost': 0}
            cost_by_category[cat]['cost'] += lic.annual_cost
        cost_by_category_list = list(cost_by_category.values())

        # Unresolved alerts
        unresolved_alerts = LicenseAlert.objects.filter(is_resolved=False).count()

        return Response({
            'total_licenses': total_licenses,
            'total_products': total_products,
            'expiring_within_30_days': expiring_soon_data,
            'expired': expired_data,
            'near_capacity': near_capacity_data,
            'total_annual_cost': round(total_annual_cost, 2),
            'cost_by_category': cost_by_category_list,
            'unresolved_alerts': unresolved_alerts,
        })
