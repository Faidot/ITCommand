from django.contrib import admin
from .models import (
    Department, User, AssetCategory, Asset, AssetNote, AssetHistory, 
    VaultCredential, AccountWorkspace, VaultMasterPassword, VaultUnlockSession,
    FinancialYear, BudgetCategory, Budget, Expense, 
    PettyCashTransaction, DirectPayment, RecurringBill, BillPayment,
    TicketCategory, SLAPolicy, Ticket, TicketComment, TicketAttachment,
    Provider, ProviderAccount, Property, Service, EstateSettings,
    ListOfValues, AppSettings, Integration, ExchangeRate,
    BrexObject, CardAccount, PaymentCard, ServicePayment,
)
from django import forms
from core.lov import GROUPS, GROUP_CHOICES

@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_at')
    search_fields = ('name',)

@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ('email', 'full_name', 'role', 'department', 'is_active', 'is_staff')
    list_filter = ('role', 'is_active', 'is_staff', 'department')
    search_fields = ('email', 'full_name')
    ordering = ('email',)
    
    fieldsets = (
        (None, {'fields': ('email', 'password')}),
        ('Personal Info', {'fields': ('full_name', 'avatar', 'department', 'role')}),
        ('Permissions', {
            'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions'),
        }),
        ('Important Dates', {'fields': ('last_login', 'created_at')}),
    )
    
    readonly_fields = ('created_at', 'last_login')

@admin.register(AssetCategory)
class AssetCategoryAdmin(admin.ModelAdmin):
    list_display = ('name',)
    search_fields = ('name',)

@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ('asset_tag', 'name', 'category', 'status', 'assigned_to')
    list_filter = ('status', 'category')
    search_fields = ('asset_tag', 'name', 'serial_number')
    autocomplete_fields = ['assigned_to']

@admin.register(AssetNote)
class AssetNoteAdmin(admin.ModelAdmin):
    list_display = ('asset', 'created_by', 'created_at')
    list_filter = ('created_at', 'created_by')
    search_fields = ('asset__asset_tag', 'note')

@admin.register(AssetHistory)
class AssetHistoryAdmin(admin.ModelAdmin):
    list_display = ('asset', 'action', 'timestamp')
    list_filter = ('action', 'timestamp')

@admin.register(VaultCredential)
class VaultCredentialAdmin(admin.ModelAdmin):
    list_display = ('title', 'username', 'category', 'workspace_tag', 'created_by')
    list_filter = ('category', 'is_shared')
    search_fields = ('title', 'username', 'workspace_tag')

@admin.register(AccountWorkspace)
class AccountWorkspaceAdmin(admin.ModelAdmin):
    list_display = ('name', 'platform', 'login_email', 'owner_name', 'renewal_date')
    list_filter = ('platform',)
    search_fields = ('name', 'login_email', 'owner_name')

@admin.register(VaultMasterPassword)
class VaultMasterPasswordAdmin(admin.ModelAdmin):
    list_display = ('id', 'set_by', 'set_at', 'rotation_count', 'session_ttl_minutes')
    readonly_fields = ('password_hash', 'set_at', 'rotation_count')

@admin.register(VaultUnlockSession)
class VaultUnlockSessionAdmin(admin.ModelAdmin):
    list_display = ('user', 'issued_at', 'expires_at', 'revoked', 'ip_address')
    list_filter = ('revoked',)
    search_fields = ('user__email',)
    readonly_fields = ('token', 'issued_at', 'expires_at', 'last_used_at', 'ip_address')

admin.site.register(FinancialYear)
admin.site.register(BudgetCategory)
admin.site.register(Budget)
admin.site.register(Expense)
admin.site.register(PettyCashTransaction)
admin.site.register(DirectPayment)
admin.site.register(RecurringBill)
admin.site.register(BillPayment)


@admin.register(TicketCategory)
class TicketCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'icon_name', 'is_active', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('name',)


@admin.register(SLAPolicy)
class SLAPolicyAdmin(admin.ModelAdmin):
    list_display = ('priority', 'response_hours', 'resolution_hours')


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ('ticket_number', 'title', 'status', 'priority', 'requester', 'assigned_to', 'due_date', 'created_at')
    list_filter = ('status', 'priority', 'category')
    search_fields = ('ticket_number', 'title', 'requester__email', 'requester__full_name')
    autocomplete_fields = ['requester', 'assigned_to', 'asset']
    readonly_fields = ('ticket_number', 'created_at', 'updated_at')


@admin.register(TicketComment)
class TicketCommentAdmin(admin.ModelAdmin):
    list_display = ('ticket', 'author', 'is_internal', 'created_at')
    list_filter = ('is_internal', 'created_at')


@admin.register(TicketAttachment)
class TicketAttachmentAdmin(admin.ModelAdmin):
    list_display = ('ticket', 'uploaded_by', 'uploaded_at')


# ---------------------------------------------------------------------------
# Lists of values (admin-managed dropdowns)
# ---------------------------------------------------------------------------

class ListOfValuesForm(forms.ModelForm):
    """Restricts `group` to the registry and explains each group inline."""

    group = forms.ChoiceField(choices=GROUP_CHOICES)

    class Meta:
        model = ListOfValues
        fields = ('group', 'code', 'label', 'sort_order', 'is_active')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        notes = '<br>'.join(
            f'<b>{spec.label}</b> \u2014 {spec.help_text}'
            for spec in (GROUPS[key] for key, _ in GROUP_CHOICES)
            if spec.help_text
        )
        self.fields['group'].help_text = notes
        instance = getattr(self, 'instance', None)
        # A system value's code is load-bearing; show it, do not let it move.
        if instance is not None and instance.pk and instance.is_system:
            self.fields['code'].disabled = True
            self.fields['code'].help_text = (
                'Referenced by application logic \u2014 edit the label instead.'
            )


@admin.register(ListOfValues)
class ListOfValuesAdmin(admin.ModelAdmin):
    form = ListOfValuesForm
    list_display = ('label', 'code', 'group', 'sort_order', 'is_active', 'kind')
    list_filter = ('group', 'is_active', 'is_system')
    list_editable = ('sort_order', 'is_active')
    search_fields = ('code', 'label', 'group')
    ordering = ('group', 'sort_order', 'label')
    list_per_page = 50

    @admin.display(description='Kind', ordering='is_system')
    def kind(self, obj):
        return 'System (label only)' if obj.is_system else 'Custom'

    def has_delete_permission(self, request, obj=None):
        # Deleting a value the code depends on would break dropdowns and
        # leave existing records pointing at a code with no label.
        if obj is not None and obj.is_system:
            return False
        return super().has_delete_permission(request, obj)

    def delete_queryset(self, request, queryset):
        super().delete_queryset(request, queryset.filter(is_system=False))


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    list_display = ('key', 'value', 'description')
    search_fields = ('key', 'value')
    ordering = ('key',)


# ---------------------------------------------------------------------------
# Integrations & exchange rates
# ---------------------------------------------------------------------------

class IntegrationForm(forms.ModelForm):
    api_key = forms.CharField(
        required=False,
        widget=forms.PasswordInput(render_value=False),
        help_text='Stored encrypted. Leave blank to keep the existing key.',
    )

    class Meta:
        model = Integration
        fields = ('provider', 'is_enabled', 'base_url', 'api_key', 'config')

    def save(self, commit=True):
        instance = super().save(commit=False)
        raw = self.cleaned_data.get('api_key')
        if raw:
            instance.set_api_key(raw)
        if commit:
            instance.save()
        return instance


@admin.register(Integration)
class IntegrationAdmin(admin.ModelAdmin):
    form = IntegrationForm
    list_display = ('provider', 'is_enabled', 'key_set', 'last_status', 'last_sync_at')
    list_filter = ('provider', 'is_enabled', 'last_status')
    readonly_fields = ('last_status', 'last_message', 'last_sync_at', 'created_at', 'updated_at')

    @admin.display(boolean=True, description='API key set')
    def key_set(self, obj):
        return obj.has_api_key

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    list_display = ('currency', 'rate', 'base_currency', 'as_of', 'source')
    list_filter = ('base_currency', 'currency', 'source', 'as_of')
    search_fields = ('currency', 'base_currency')
    date_hierarchy = 'as_of'
    ordering = ('-as_of', 'currency')


@admin.register(PaymentCard)
class PaymentCardAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'provider', 'last_four', 'holder_name', 'form', 'status', 'last_synced_at')
    list_filter = ('provider', 'status', 'form')
    search_fields = ('last_four', 'nickname', 'holder_name', 'external_id')


@admin.register(CardAccount)
class CardAccountAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'provider', 'status', 'current_balance', 'currency', 'last_synced_at')
    list_filter = ('provider', 'status', 'currency')
    search_fields = ('name', 'external_id')


@admin.register(BrexObject)
class BrexObjectAdmin(admin.ModelAdmin):
    """Read-only: this mirrors what Brex said, so editing it would be a lie."""

    list_display = ('object_type', 'external_id', 'last_seen_at', 'last_changed_at')
    list_filter = ('object_type',)
    search_fields = ('external_id',)
    readonly_fields = (
        'object_type', 'external_id', 'payload', 'payload_hash',
        'first_seen_at', 'last_seen_at', 'last_changed_at',
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ServicePayment)
class ServicePaymentAdmin(admin.ModelAdmin):
    list_display = ('posted_at', 'merchant', 'amount', 'currency', 'card', 'service', 'match_source')
    list_filter = ('provider', 'match_source', 'currency', 'posted_at')
    search_fields = ('merchant', 'description', 'external_id')
    date_hierarchy = 'posted_at'
    autocomplete_fields = ('service',)
    readonly_fields = ('external_id', 'provider')


# ---------------------------------------------------------------------------
# Digital Estate
# ---------------------------------------------------------------------------

@admin.register(Provider)
class ProviderAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'brand_color', 'is_active')
    search_fields = ('name', 'slug')
    list_filter = ('is_active',)


@admin.register(ProviderAccount)
class ProviderAccountAdmin(admin.ModelAdmin):
    list_display = ('account_email', 'provider', 'auth_type', 'mfa_type', 'owner', 'is_active')
    list_filter = ('mfa_type', 'auth_type', 'is_active', 'provider')
    search_fields = ('account_email', 'provider__name')


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ('name', 'kind', 'owner', 'is_active')
    list_filter = ('kind', 'is_active')
    search_fields = ('name',)


@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = (
        'identifier', 'service_type', 'provider', 'property', 'status',
        'renewal_date', 'auto_renew', 'cost', 'currency',
    )
    list_filter = ('service_type', 'status', 'billing_cycle', 'auto_renew', 'provider')
    search_fields = ('identifier', 'provider__name', 'provider_account__account_email')
    autocomplete_fields = ()


@admin.register(EstateSettings)
class EstateSettingsAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'renewal_warning_days', 'renewal_urgent_days', 'updated_at')
