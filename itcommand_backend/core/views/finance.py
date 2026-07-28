from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate
from django.utils import timezone
from django.db.models import Sum, Q
from django.http import HttpResponse
from datetime import timedelta, date
import csv
import random
import string
from core.models import *
from core.serializers import *
from core.encryption import decrypt_value
from core.mixins import AuditLogMixin
from core.permissions import IsSuperadmin, IsAdminOrSuperadmin, IsManagerOrHigher, ReadOnlyViewerOrHigher, VaultAccessPermission, UserManagementPermission, HasModulePermission
from rest_framework.pagination import PageNumberPagination


def _xlsx_response(name, headers, rows):
    """Build an .xlsx HTTP response from header + row lists."""
    from openpyxl import Workbook
    from io import BytesIO
    wb = Workbook()
    ws = wb.active
    ws.title = name[:31]
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    resp = HttpResponse(buf.read(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    resp['Content-Disposition'] = f'attachment; filename="{name}.xlsx"'
    return resp


def _category_remaining(category, fy):
    """Allocated budget minus APPROVED spend for a category in a year."""
    if not category or not fy:
        return None
    allocated = Budget.objects.filter(financial_year=fy, category=category).aggregate(s=Sum('allocated_amount'))['s'] or 0
    spent = Expense.objects.filter(financial_year=fy, category=category, status='APPROVED').aggregate(s=Sum('amount'))['s'] or 0
    return float(allocated) - float(spent)


def _would_exceed_budget(category, fy, amount):
    """True if approving `amount` breaches a hard-limited category."""
    if not category or not getattr(category, 'enforce_budget', False):
        return False
    remaining = _category_remaining(category, fy)
    if remaining is None:
        return False
    return float(amount or 0) > remaining


def _notify_managers(message, link=''):
    from core.models import Notification
    mgrs = User.objects.filter(role__in=['MANAGER', 'ADMIN', 'SUPERADMIN'], is_active=True)
    Notification.objects.bulk_create([
        Notification(user=u, message=message, notification_type='BUDGET', link=link) for u in mgrs
    ])


def _notify_user(user, message, link=''):
    from core.models import Notification
    if user:
        Notification.objects.create(user=user, message=message, notification_type='BUDGET', link=link)


def _log_expense(expense, action, by, note=''):
    ExpenseApprovalLog.objects.create(expense=expense, action=action, by=by, note=note)


class FinancialYearViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = FinancialYear.objects.all().order_by('-start_date')
    serializer_class = FinancialYearSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'settings'

    def _enforce_single_active(self, instance):
        if instance.is_active:
            FinancialYear.objects.exclude(pk=instance.pk).update(is_active=False)

    def perform_create(self, serializer):
        self._enforce_single_active(serializer.save())

    def perform_update(self, serializer):
        self._enforce_single_active(serializer.save())

class BudgetCategoryViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = BudgetCategory.objects.all()
    serializer_class = BudgetCategorySerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'settings'

class IncomeSourceViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = IncomeSource.objects.all().order_by('name')
    serializer_class = IncomeSourceSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'settings'

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get('active') == 'true':
            queryset = queryset.filter(is_active=True)
        return queryset

class BudgetViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Budget.objects.all()
    serializer_class = BudgetSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'

    def get_queryset(self):
        queryset = super().get_queryset()
        fy = self.request.query_params.get('financial_year', None)
        if fy:
            queryset = queryset.filter(financial_year_id=fy)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['post'], url_path='clone', permission_classes=[HasModulePermission])
    def clone(self, request):
        """Copy budget allocations from one financial year to another so they
        don't have to be re-entered. `rollover` adds each category's remaining
        amount on top of the source allocation."""
        source_id = request.data.get('source')
        target_id = request.data.get('target')
        rollover = bool(request.data.get('rollover', False))
        if not source_id or not target_id or str(source_id) == str(target_id):
            return Response({'detail': 'Provide distinct source and target years.'}, status=status.HTTP_400_BAD_REQUEST)
        source_fy = FinancialYear.objects.filter(pk=source_id).first()
        target_fy = FinancialYear.objects.filter(pk=target_id).first()
        if not source_fy or not target_fy:
            return Response({'detail': 'Year not found.'}, status=status.HTTP_400_BAD_REQUEST)

        created, skipped = 0, 0
        for b in Budget.objects.filter(financial_year=source_fy):
            if Budget.objects.filter(financial_year=target_fy, category=b.category).exists():
                skipped += 1
                continue
            amount = b.allocated_amount
            if rollover:
                rem = _category_remaining(b.category, source_fy) or 0
                amount = b.allocated_amount + (rem if rem > 0 else 0)
            Budget.objects.create(financial_year=target_fy, category=b.category, allocated_amount=amount,
                                  notes=b.notes, created_by=request.user)
            created += 1
        return Response({'created': created, 'skipped': skipped})

def _expense_status_for(user):
    """Admins/superadmins auto-approve their own entries; everyone else is
    held for approval."""
    return 'APPROVED' if getattr(user, 'role', None) in ('ADMIN', 'SUPERADMIN') else 'PENDING'


def _apply_date_range(queryset, request, field):
    start = request.query_params.get('start')
    end = request.query_params.get('end')
    if start:
        queryset = queryset.filter(**{f'{field}__gte': start})
    if end:
        queryset = queryset.filter(**{f'{field}__lte': end})
    return queryset


class ExpenseViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Expense.objects.all().select_related('bill').order_by('-expense_date', '-created_at')
    serializer_class = ExpenseSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        queryset = super().get_queryset()
        category = self.request.query_params.get('category', None)
        if category:
            queryset = queryset.filter(category_id=category)
        st = self.request.query_params.get('status', None)
        if st:
            queryset = queryset.filter(status=st)
        return _apply_date_range(queryset, self.request, 'expense_date')

    def perform_create(self, serializer):
        st = _expense_status_for(self.request.user)
        extra = {'created_by': self.request.user, 'status': st}
        if st == 'APPROVED':
            extra['approved_by'] = self.request.user
            extra['approved_at'] = timezone.now()
        exp = serializer.save(**extra)
        if st == 'APPROVED':
            if _would_exceed_budget(exp.category, exp.financial_year, exp.amount):
                exp.delete()
                raise ValidationError({'detail': f"'{exp.category.name}' has a hard budget limit and this would exceed it."})
            _log_expense(exp, 'APPROVED', self.request.user, 'Auto-approved on creation')
        else:
            _log_expense(exp, 'SUBMITTED', self.request.user)
            _notify_managers(f"Expense '{exp.title}' (${exp.amount}) needs approval.", '/finance/expenses')

    @action(detail=True, methods=['post'], url_path='approve', permission_classes=[HasModulePermission])
    def approve(self, request, pk=None):
        exp = self.get_object()
        if exp.status != 'PENDING':
            return Response(
                {'detail': 'Only pending expenses can be approved.'},
                status=status.HTTP_409_CONFLICT,
            )
        if _would_exceed_budget(exp.category, exp.financial_year, exp.amount):
            return Response({'detail': f"Blocked: '{exp.category.name}' has a hard budget limit and this expense exceeds the remaining budget."},
                            status=status.HTTP_400_BAD_REQUEST)
        exp.status = 'APPROVED'
        exp.approved_by = request.user
        exp.approved_at = timezone.now()
        exp.rejection_reason = ''
        exp.save()
        _log_expense(exp, 'APPROVED', request.user, request.data.get('note', ''))
        _notify_user(exp.created_by, f"Your expense '{exp.title}' was approved.", '/finance/expenses')
        return Response(self.get_serializer(exp).data)

    @action(detail=True, methods=['post'], url_path='reject', permission_classes=[HasModulePermission])
    def reject(self, request, pk=None):
        exp = self.get_object()
        if exp.status != 'PENDING':
            return Response(
                {'detail': 'Only pending expenses can be rejected.'},
                status=status.HTTP_409_CONFLICT,
            )
        reason = request.data.get('reason', '').strip()
        if not reason:
            return Response(
                {'detail': 'A rejection reason is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        exp.status = 'REJECTED'
        exp.approved_by = request.user
        exp.approved_at = timezone.now()
        exp.rejection_reason = reason
        exp.save()
        _log_expense(exp, 'REJECTED', request.user, reason)
        _notify_user(exp.created_by, f"Your expense '{exp.title}' was rejected. {reason}".strip(), '/finance/expenses')
        return Response(self.get_serializer(exp).data)

    @action(detail=False, methods=['get'], url_path='export')
    def export(self, request):
        qs = self.filter_queryset(self.get_queryset())
        fmt = request.query_params.get('format', 'csv')
        headers = ['Date', 'Title', 'Amount', 'Category', 'Paid To', 'Method', 'Source', 'Status', 'Receipt']
        rows = [[str(e.expense_date), e.title, float(e.amount), e.category.name if e.category else '',
                 e.paid_to, e.payment_method, e.source.name if e.source else '', e.status, e.receipt_number or '']
                for e in qs]
        if fmt == 'xlsx':
            return _xlsx_response('expenses', headers, rows)
        resp = HttpResponse(content_type='text/csv')
        resp['Content-Disposition'] = 'attachment; filename="expenses.csv"'
        w = csv.writer(resp)
        w.writerow(headers)
        for r in rows:
            w.writerow(r)
        return resp

    @action(detail=False, methods=['post'], url_path='upload',
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def upload(self, request):
        """Add expense entries together with an uploaded bill. One uploaded
        bill document backs one or many expense entries (one-bill-multi-entry).

        Accepts (multipart):
          - document (file, optional), bill_number, bill_date
          - entries: JSON array of {title, amount, category, description}
          - shared fields: expense_date, paid_to, payment_method,
            financial_year, category (fallback per entry)
        """
        import json

        # Parse the line entries (JSON string in multipart, or list in JSON body).
        raw = request.data.get('entries')
        if isinstance(raw, str):
            try:
                entries = json.loads(raw or '[]')
            except (ValueError, TypeError):
                return Response({'detail': 'Invalid entries JSON.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            entries = raw or []
        if not entries:
            return Response({'detail': 'At least one entry is required.'}, status=status.HTTP_400_BAD_REQUEST)

        # Create the bill container only if a document or bill reference exists.
        document = request.FILES.get('document')
        bill_number = request.data.get('bill_number', '')
        bill_date = request.data.get('bill_date') or None
        bill = None
        if document or bill_number or bill_date:
            bill = Bill.objects.create(
                document=document,
                bill_number=bill_number,
                bill_date=bill_date,
                uploaded_by=request.user,
            )

        shared_date = request.data.get('expense_date') or None
        shared_paid_to = request.data.get('paid_to', '')
        shared_method = request.data.get('payment_method', 'BANK_TRANSFER')
        shared_fy = request.data.get('financial_year') or None
        shared_category = request.data.get('category') or None
        shared_source = request.data.get('source') or None

        st = _expense_status_for(request.user)
        approver = request.user if st == 'APPROVED' else None
        approved_at = timezone.now() if st == 'APPROVED' else None

        created = []
        for e in entries:
            if not e or not e.get('title'):
                continue
            expense = Expense.objects.create(
                title=e.get('title'),
                amount=e.get('amount') or 0,
                expense_date=e.get('expense_date') or shared_date,
                category_id=e.get('category') or shared_category,
                financial_year_id=e.get('financial_year') or shared_fy,
                payment_method=e.get('payment_method') or shared_method,
                paid_to=e.get('paid_to') or shared_paid_to,
                source_id=e.get('source') or shared_source,
                linked_asset_id=e.get('linked_asset') or None,
                linked_license_id=e.get('linked_license') or None,
                linked_purchase_request_id=e.get('linked_purchase_request') or None,
                linked_subscription_id=e.get('linked_subscription') or None,
                receipt_number=bill_number or e.get('receipt_number', ''),
                description=e.get('description', ''),
                bill=bill,
                status=st,
                approved_by=approver,
                approved_at=approved_at,
                created_by=request.user,
            )
            if st == 'APPROVED' and _would_exceed_budget(expense.category, expense.financial_year, expense.amount):
                expense.delete()
                return Response({'detail': f"'{expense.category.name}' has a hard budget limit and this would exceed it."},
                                status=status.HTTP_400_BAD_REQUEST)
            _log_expense(expense, st if st == 'APPROVED' else 'SUBMITTED', request.user,
                         'Auto-approved on creation' if st == 'APPROVED' else '')
            created.append(expense)

        if st != 'APPROVED' and created:
            _notify_managers(f"{len(created)} expense entr{'y' if len(created) == 1 else 'ies'} need approval.", '/finance/expenses')

        serializer = self.get_serializer(created, many=True)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

class IncomeViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Income.objects.all().select_related('bill').order_by('-income_date', '-created_at')
    serializer_class = IncomeSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        queryset = super().get_queryset()
        category = self.request.query_params.get('category', None)
        if category:
            queryset = queryset.filter(category_id=category)
        fy = self.request.query_params.get('financial_year', None)
        if fy:
            queryset = queryset.filter(financial_year_id=fy)
        return _apply_date_range(queryset, self.request, 'income_date')

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get'], url_path='export')
    def export(self, request):
        qs = self.filter_queryset(self.get_queryset())
        fmt = request.query_params.get('format', 'csv')
        headers = ['Date', 'Title', 'Amount', 'Source', 'Category', 'Method', 'Reference']
        rows = [[str(i.income_date), i.title, float(i.amount), i.source.name if i.source else '',
                 i.category.name if i.category else '', i.payment_method, i.reference or ''] for i in qs]
        if fmt == 'xlsx':
            return _xlsx_response('income', headers, rows)
        resp = HttpResponse(content_type='text/csv')
        resp['Content-Disposition'] = 'attachment; filename="income.csv"'
        w = csv.writer(resp)
        w.writerow(headers)
        for r in rows:
            w.writerow(r)
        return resp

    @action(detail=False, methods=['post'], url_path='upload',
            parser_classes=[MultiPartParser, FormParser, JSONParser])
    def upload(self, request):
        """Add income entries together with an optional uploaded receipt. One
        receipt can back one or many income entries."""
        import json

        raw = request.data.get('entries')
        if isinstance(raw, str):
            try:
                entries = json.loads(raw or '[]')
            except (ValueError, TypeError):
                return Response({'detail': 'Invalid entries JSON.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            entries = raw or []
        if not entries:
            return Response({'detail': 'At least one entry is required.'}, status=status.HTTP_400_BAD_REQUEST)

        document = request.FILES.get('document')
        bill_number = request.data.get('bill_number', '')
        bill_date = request.data.get('bill_date') or None
        bill = None
        if document or bill_number or bill_date:
            bill = Bill.objects.create(
                document=document,
                bill_number=bill_number,
                bill_date=bill_date,
                uploaded_by=request.user,
            )

        shared_date = request.data.get('income_date') or None
        shared_source = request.data.get('source') or None
        shared_method = request.data.get('payment_method', 'BANK_TRANSFER')
        shared_fy = request.data.get('financial_year') or None
        shared_category = request.data.get('category') or None

        created = []
        for e in entries:
            if not e or not e.get('title'):
                continue
            income = Income.objects.create(
                title=e.get('title'),
                source_id=e.get('source') or shared_source,
                amount=e.get('amount') or 0,
                income_date=e.get('income_date') or shared_date,
                category_id=e.get('category') or shared_category,
                financial_year_id=e.get('financial_year') or shared_fy,
                payment_method=e.get('payment_method') or shared_method,
                reference=bill_number or e.get('reference', ''),
                description=e.get('description', ''),
                bill=bill,
                created_by=request.user,
            )
            created.append(income)

        serializer = self.get_serializer(created, many=True)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

class PettyCashTransactionViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = PettyCashTransaction.objects.all().order_by('-date', '-created_at')
    serializer_class = PettyCashTransactionSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

class DirectPaymentViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = DirectPayment.objects.all().order_by('-payment_date', '-created_at')
    serializer_class = DirectPaymentSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

def _freq_days(frequency):
    return {'MONTHLY': 30, 'QUARTERLY': 90, 'YEARLY': 365}.get(frequency, 30)


class RecurringBillViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = RecurringBill.objects.all().order_by('next_due_date')
    serializer_class = RecurringBillSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

class BillPaymentViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = BillPayment.objects.all().order_by('-paid_date')
    serializer_class = BillPaymentSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'

    def perform_create(self, serializer):
        payment = serializer.save(created_by=self.request.user)
        bill = payment.recurring_bill

        # When paid from the IT budget, record a matching Expense so it hits IT
        # spend. Company-account (direct) payments are recorded only. The
        # recorded payment is an actual transaction, so it is auto-approved.
        if payment.paid_from == 'IT' and not payment.expense:
            active_fy = FinancialYear.objects.filter(is_active=True).first()
            expense = Expense.objects.create(
                title=f"Bill payment: {bill.title}",
                amount=payment.amount_paid,
                expense_date=payment.paid_date,
                category=payment.category or bill.category,
                financial_year=active_fy,
                payment_method=bill.payment_method if bill.payment_method in dict(Expense.PAYMENT_METHOD_CHOICES) else 'BANK_TRANSFER',
                paid_to=bill.title,
                source=payment.source,
                receipt_number=payment.reference or '',
                description=f"Auto-recorded from recurring bill '{bill.title}'.",
                status='APPROVED',
                approved_by=self.request.user,
                approved_at=timezone.now(),
                created_by=self.request.user,
            )
            payment.expense = expense
            payment.save(update_fields=['expense'])

        # Advance the next due date by the bill's frequency
        bill.next_due_date = bill.next_due_date + timedelta(days=_freq_days(bill.frequency))
        bill.save()

    def perform_destroy(self, instance):
        """Void/reverse a payment: delete the linked IT expense and roll the
        bill's next due date back by one cycle."""
        bill = instance.recurring_bill
        if instance.expense_id:
            Expense.objects.filter(pk=instance.expense_id).delete()
        if bill:
            bill.next_due_date = bill.next_due_date - timedelta(days=_freq_days(bill.frequency))
            bill.save()
        instance.delete()

class RecurringIncomeViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = RecurringIncome.objects.all().order_by('next_date')
    serializer_class = RecurringIncomeSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'], url_path='receive')
    def receive(self, request, pk=None):
        """Record the scheduled income as an actual Income entry and advance
        the next date by the frequency."""
        ri = self.get_object()
        active_fy = ri.financial_year or FinancialYear.objects.filter(is_active=True).first()
        income = Income.objects.create(
            title=ri.title,
            source=ri.source,
            amount=request.data.get('amount') or ri.amount,
            income_date=request.data.get('income_date') or ri.next_date,
            category=ri.category,
            financial_year=active_fy,
            payment_method=ri.payment_method or 'BANK_TRANSFER',
            reference=request.data.get('reference', ''),
            description=f"Received from scheduled income '{ri.title}'.",
            recurring=ri,
            created_by=request.user,
        )
        ri.next_date = ri.next_date + timedelta(days=_freq_days(ri.frequency))
        ri.save(update_fields=['next_date'])
        return Response(IncomeSerializer(income, context={'request': request}).data, status=status.HTTP_201_CREATED)

class BillViewSet(AuditLogMixin, viewsets.ModelViewSet):
    queryset = Bill.objects.all().prefetch_related('expenses').order_by('-uploaded_at')
    serializer_class = BillSerializer
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class CostOverviewView(APIView):
    """Aggregated IT cost picture across finance + other modules (read-only)."""
    permission_classes = [HasModulePermission]
    rbac_module = 'finance'

    def get(self, request):
        def total(qs, field):
            return float(qs.aggregate(s=Sum(field))['s'] or 0)

        active_fy = FinancialYear.objects.filter(is_active=True).first()
        # Only APPROVED expenses count toward booked IT spend.
        exp_qs = Expense.objects.filter(status='APPROVED')
        inc_qs = Income.objects.all()
        if active_fy:
            exp_qs = exp_qs.filter(financial_year=active_fy)
            inc_qs = inc_qs.filter(financial_year=active_fy)

        total_income = total(inc_qs, 'amount')
        total_expenses = total(exp_qs, 'amount')
        pending_expenses = total(
            (Expense.objects.filter(status='PENDING', financial_year=active_fy) if active_fy else Expense.objects.filter(status='PENDING')),
            'amount')
        total_budget = total(Budget.objects.filter(financial_year=active_fy) if active_fy else Budget.objects.none(), 'allocated_amount')

        asset_cost = total(Asset.objects.all(), 'purchase_price')
        license_cost = total(SoftwareLicense.objects.all(), 'cost')
        procurement_actual = total(PurchaseRequest.objects.all(), 'total_actual_cost')
        procurement_estimated = total(PurchaseRequest.objects.all(), 'total_estimated_cost')

        # Avoid counting the same purchase once as a booked Expense and again
        # as its Asset/License/PR source. Assets created from a PR are represented
        # by that PR until the PR itself is converted to a booked expense.
        unbooked_assets = Asset.objects.exclude(
            Q(expenses__status='APPROVED')
            | Q(source_purchase_request_item__isnull=False)
        ).distinct()
        unbooked_licenses = SoftwareLicense.objects.exclude(
            expenses__status='APPROVED'
        ).distinct()
        unbooked_prs = PurchaseRequest.objects.exclude(
            expenses__status='APPROVED'
        ).distinct()
        unbooked_asset_cost = total(unbooked_assets, 'purchase_price')
        unbooked_license_cost = total(unbooked_licenses, 'cost')
        unbooked_procurement_actual = total(unbooked_prs, 'total_actual_cost')

        # Annualized asset depreciation (Asset.monthly_depreciation is computed)
        asset_depreciation_annual = 0.0
        for a in Asset.objects.all():
            try:
                asset_depreciation_annual += float(a.monthly_depreciation or 0) * 12
            except Exception:
                pass

        # Direct expenses by category (the slice IT actually books)
        by_category = []
        for c in BudgetCategory.objects.all():
            spent = total(exp_qs.filter(category=c), 'amount')
            if spent:
                by_category.append({'category': c.name, 'spent': spent})

        modules = [
            {'module': 'Expenses (booked)', 'amount': total_expenses},
            {'module': 'Assets (not yet booked)', 'amount': unbooked_asset_cost},
            {'module': 'Licenses (not yet booked)', 'amount': unbooked_license_cost},
            {'module': 'Procurement (not yet booked)', 'amount': unbooked_procurement_actual},
            {'module': 'Asset depreciation (yr)', 'amount': round(asset_depreciation_annual, 2)},
        ]
        grand_total = (
            total_expenses
            + unbooked_asset_cost
            + unbooked_license_cost
            + unbooked_procurement_actual
        )

        # Subscription spend, sliced the two ways the estate cares about.
        #
        # Kept out of `grand_total_cost` on purpose: that figure is booked and
        # unbooked *purchases*, while subscription spend is a recurring
        # commitment, and any renewal already booked as an expense is inside
        # `total_expenses` too. Adding them would double-count. These carry
        # their own converted-money blocks, complete with `is_complete`.
        from core import finance_estate

        estate_spend = finance_estate.subscription_spend_by_property_and_layer()

        return Response({
            'financial_year': active_fy.name if active_fy else None,
            'total_income': total_income,
            'total_expenses': total_expenses,
            'pending_expenses': pending_expenses,
            'total_budget': total_budget,
            'remaining_budget': total_budget - total_expenses,
            'net_cash_flow': total_income - total_expenses,
            'asset_cost': asset_cost,
            'license_cost': license_cost,
            'procurement_actual': procurement_actual,
            'procurement_estimated': procurement_estimated,
            'unbooked_asset_cost': unbooked_asset_cost,
            'unbooked_license_cost': unbooked_license_cost,
            'unbooked_procurement_actual': unbooked_procurement_actual,
            'asset_depreciation_annual': round(asset_depreciation_annual, 2),
            'grand_total_cost': grand_total,
            'modules': modules,
            'by_category': by_category,
            'subscriptions': {
                'currency': estate_spend['currency'],
                'by_property': estate_spend['by_property'],
                'by_layer': estate_spend['by_layer'],
                'orphaned': estate_spend['orphaned'],
                'note': (
                    'Recurring commitment, shown separately from booked spend. '
                    'Not included in grand_total_cost.'
                ),
            },
            'budget_impact': finance_estate.budget_impact(financial_year=active_fy),
            'vendor_subscription_spend': finance_estate.subscription_spend_by_vendor(),
        })
