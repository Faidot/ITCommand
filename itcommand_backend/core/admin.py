from django.contrib import admin
from .models import (
    Department, User, AssetCategory, Asset, AssetNote, AssetHistory, 
    VaultCredential, AccountWorkspace, VaultMasterPassword, VaultUnlockSession,
    FinancialYear, BudgetCategory, Budget, Expense, 
    PettyCashTransaction, DirectPayment, RecurringBill, BillPayment,
    TicketCategory, SLAPolicy, Ticket, TicketComment, TicketAttachment,
    SoftwareProduct, SoftwareLicense, LicenseAssignment, LicenseAlert,
)

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


@admin.register(SoftwareProduct)
class SoftwareProductAdmin(admin.ModelAdmin):
    list_display = ('name', 'vendor', 'category', 'created_at')
    list_filter = ('category',)
    search_fields = ('name', 'vendor')


@admin.register(SoftwareLicense)
class SoftwareLicenseAdmin(admin.ModelAdmin):
    list_display = ('product', 'license_type', 'seats_total', 'expiry_date', 'is_active', 'cost', 'billing_cycle')
    list_filter = ('license_type', 'is_active', 'billing_cycle', 'product__category')
    search_fields = ('product__name', 'product__vendor', 'purchase_order_number')
    autocomplete_fields = ['product', 'created_by']


@admin.register(LicenseAssignment)
class LicenseAssignmentAdmin(admin.ModelAdmin):
    list_display = ('license', 'user', 'is_active', 'assigned_date', 'revoked_date', 'assigned_by')
    list_filter = ('is_active',)
    search_fields = ('user__email', 'user__full_name', 'license__product__name')
    autocomplete_fields = ['license', 'user', 'assigned_by']


@admin.register(LicenseAlert)
class LicenseAlertAdmin(admin.ModelAdmin):
    list_display = ('license', 'alert_type', 'is_resolved', 'created_at')
    list_filter = ('alert_type', 'is_resolved')
