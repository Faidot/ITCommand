from django.urls import path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from .search import GlobalSearchView
from .notifications import NotificationViewSet
from .views.vault import (
    VaultMasterStatusView, VaultMasterSetView, VaultUnlockView, VaultLockView,
    VaultPasswordGeneratorView,
    VaultPersonalStatusView, VaultPersonalSetupView, VaultPersonalChangeView,
    VaultPersonalResetView,
)
from .views import (
    ProfileView, ChangePasswordView,
    LoginView, LogoutView, UserMeView, DepartmentViewSet, UserViewSet, RoleViewSet,
    AssetCategoryViewSet, AssetViewSet, AssetNoteViewSet, VaultCredentialViewSet, AccountWorkspaceViewSet,
    FinancialYearViewSet, BudgetCategoryViewSet, BudgetViewSet, ExpenseViewSet, IncomeViewSet,
    IncomeSourceViewSet, CostOverviewView, RecurringIncomeViewSet,
    PettyCashTransactionViewSet, DirectPaymentViewSet, RecurringBillViewSet, BillPaymentViewSet,
    BillViewSet,
    FinanceDashboardView, SettingsView, ListOfValuesView, ListOfValuesItemView, IntegrationsView, IntegrationTestView, BrexConnectionTestView, AuditLogViewSet, LocationViewSet,
    CalendarFeedView, MyCalendarFeedView,
    NetworkIntegrationViewSet, DiscoveredHostViewSet, NetworkScanViewSet,
    RunNetworkScanView, DiscoveryOptionsView,
    TicketCategoryViewSet, SLAPolicyViewSet, TicketViewSet, HelpdeskDashboardView,
    ChecklistTemplateViewSet, ChecklistTemplateItemViewSet, OnboardingRecordViewSet, OnboardingTaskViewSet, OnboardingDashboardView,
    OfficeViewSet, FloorViewSet, SeatViewSet, SeatAssignmentViewSet, FloorMapObjectViewSet, SeatingStatsView, UserSeatView,
    VendorViewSet, VendorContractViewSet, VendorPaymentViewSet, VendorNoteViewSet,
    PurchaseRequestViewSet, ProcurementDashboardView,
    NetworkLocationViewSet, NetworkDeviceViewSet, IPAddressPoolViewSet, NetworkDashboardView,
    NetworkTopologyView, NetworkExportView, NetworkDeviceLookupView,
    KBCategoryViewSet, KBTagViewSet, KBArticleViewSet, KBDashboardView, KBSuggestView,
    ProviderViewSet, ProviderAccountViewSet, PropertyViewSet, ServiceViewSet,
    PaymentCardViewSet, ServicePaymentViewSet, CardAccountViewSet,
    EstateDashboardView, EstateOverviewView, EstateGapsView, EstateSettingsView, ExchangeRateViewSet,
)
from .reports import (
    FinancialSummaryView, AssetSummaryView, ExportFinancialView, ExportAssetsView, MainDashboardView,
    HelpdeskSummaryView, ProcurementSummaryView, VendorSummaryView,
    SeatingSummaryView, NetworkSummaryView, OnboardingSummaryView, KBSummaryView, UserSummaryView,
    ExportHelpdeskView, ExportProcurementView, ExportVendorsView,
    ExportNetworkView, ExportSeatingView, ExportOnboardingView, ExportKBView, ExportUsersView,
    MasterUserReportView, ExportMasterUserView,
)

router = DefaultRouter()
router.register(r'departments', DepartmentViewSet, basename='department')
router.register(r'users', UserViewSet, basename='user')
router.register(r'roles', RoleViewSet, basename='role')
router.register(r'asset-categories', AssetCategoryViewSet, basename='asset-category')
router.register(r'assets', AssetViewSet, basename='asset')
router.register(r'asset-notes', AssetNoteViewSet, basename='asset-note')
router.register(r'vault/credentials', VaultCredentialViewSet, basename='vault-credential')
router.register(r'vault/workspaces', AccountWorkspaceViewSet, basename='vault-workspace')
router.register(r'finance/years', FinancialYearViewSet, basename='finance-year')
router.register(r'finance/categories', BudgetCategoryViewSet, basename='finance-category')
router.register(r'finance/sources', IncomeSourceViewSet, basename='finance-source')
router.register(r'finance/budgets', BudgetViewSet, basename='finance-budget')
router.register(r'finance/expenses', ExpenseViewSet, basename='finance-expense')
router.register(r'finance/income', IncomeViewSet, basename='finance-income')
router.register(r'finance/recurring-income', RecurringIncomeViewSet, basename='finance-recurring-income')
router.register(r'finance/petty-cash', PettyCashTransactionViewSet, basename='finance-petty-cash')
router.register(r'finance/direct-payments', DirectPaymentViewSet, basename='finance-direct-payment')
router.register(r'finance/recurring-bills', RecurringBillViewSet, basename='finance-recurring-bill')
router.register(r'finance/bill-payments', BillPaymentViewSet, basename='finance-bill-payment')
router.register(r'finance/bills', BillViewSet, basename='finance-bill')
router.register(r'audit-logs', AuditLogViewSet, basename='audit-log')
router.register(r'notifications', NotificationViewSet, basename='notification')
router.register(r'locations', LocationViewSet, basename='location')
# Helpdesk
router.register(r'helpdesk/categories', TicketCategoryViewSet, basename='ticket-category')
router.register(r'helpdesk/sla-policies', SLAPolicyViewSet, basename='sla-policy')
router.register(r'helpdesk/tickets', TicketViewSet, basename='ticket')
# Onboarding
router.register(r'onboarding/templates', ChecklistTemplateViewSet, basename='onboarding-template')
router.register(r'onboarding/template-items', ChecklistTemplateItemViewSet, basename='onboarding-template-item')
router.register(r'onboarding/records', OnboardingRecordViewSet, basename='onboarding-record')
router.register(r'onboarding/tasks', OnboardingTaskViewSet, basename='onboarding-task')
# Seating
router.register(r'seating/offices', OfficeViewSet, basename='seating-office')
router.register(r'seating/floors', FloorViewSet, basename='seating-floor')
router.register(r'seating/seats', SeatViewSet, basename='seating-seat')
router.register(r'seating/assignments', SeatAssignmentViewSet, basename='seating-assignment')
router.register(r'seating/map-objects', FloorMapObjectViewSet, basename='seating-map-object')
# Vendors
router.register(r'vendors/contracts', VendorContractViewSet, basename='vendor-contract')
router.register(r'vendors/payments', VendorPaymentViewSet, basename='vendor-payment')
router.register(r'vendors/notes', VendorNoteViewSet, basename='vendor-note')
router.register(r'vendors', VendorViewSet, basename='vendor')
# Procurement
router.register(r'procurement/requests', PurchaseRequestViewSet, basename='procurement-request')
# Network
router.register(r'network/locations', NetworkLocationViewSet, basename='network-location')
router.register(r'network/devices', NetworkDeviceViewSet, basename='network-device')
router.register(r'network/integrations', NetworkIntegrationViewSet, basename='network-integration')
router.register(r'network/discovered', DiscoveredHostViewSet, basename='discovered-host')
router.register(r'network/scans', NetworkScanViewSet, basename='network-scan')
router.register(r'network/ip-pools', IPAddressPoolViewSet, basename='network-ip-pool')
# KB
router.register(r'kb/categories', KBCategoryViewSet, basename='kb-category')
router.register(r'kb/tags', KBTagViewSet, basename='kb-tag')
router.register(r'kb/articles', KBArticleViewSet, basename='kb-article')
# Digital Estate
router.register(r'estate/providers', ProviderViewSet, basename='estate-provider')
router.register(r'estate/accounts', ProviderAccountViewSet, basename='estate-account')
router.register(r'estate/properties', PropertyViewSet, basename='estate-property')
router.register(r'estate/services', ServiceViewSet, basename='estate-service')
# Read-only views onto what the Brex sync writes. Cards and charges sit under
# estate because they answer an estate question; balances are gated on finance.
router.register(r'estate/cards', PaymentCardViewSet, basename='estate-card')
router.register(r'estate/payments', ServicePaymentViewSet, basename='estate-payment')
router.register(r'finance/card-accounts', CardAccountViewSet, basename='card-account')
router.register(r'exchange-rates', ExchangeRateViewSet, basename='exchange-rate')

urlpatterns = [
    path('auth/login/', LoginView.as_view(), name='auth_login'),
    path('auth/logout/', LogoutView.as_view(), name='auth_logout'),
    path('auth/me/', UserMeView.as_view(), name='auth_me'),
    path('auth/profile/', ProfileView.as_view(), name='auth_profile'),
    path('auth/password/', ChangePasswordView.as_view(), name='auth_password'),
    path('search/', GlobalSearchView.as_view(), name='global_search'),
    path('auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('finance/dashboard/', FinanceDashboardView.as_view(), name='finance_dashboard'),
    path('finance/cost-overview/', CostOverviewView.as_view(), name='finance_cost_overview'),
    path('reports/financial-summary/', FinancialSummaryView.as_view(), name='reports_financial_summary'),
    path('reports/asset-summary/', AssetSummaryView.as_view(), name='reports_asset_summary'),
    path('reports/helpdesk-summary/', HelpdeskSummaryView.as_view(), name='reports_helpdesk_summary'),
    path('reports/procurement-summary/', ProcurementSummaryView.as_view(), name='reports_procurement_summary'),
    path('reports/vendor-summary/', VendorSummaryView.as_view(), name='reports_vendor_summary'),
    path('reports/seating-summary/', SeatingSummaryView.as_view(), name='reports_seating_summary'),
    path('reports/network-summary/', NetworkSummaryView.as_view(), name='reports_network_summary'),
    path('reports/onboarding-summary/', OnboardingSummaryView.as_view(), name='reports_onboarding_summary'),
    path('reports/kb-summary/', KBSummaryView.as_view(), name='reports_kb_summary'),
    path('reports/user-summary/', UserSummaryView.as_view(), name='reports_user_summary'),
    path('reports/master-user/', MasterUserReportView.as_view(), name='reports_master_user'),
    path('reports/export/financial/', ExportFinancialView.as_view(), name='reports_export_financial'),
    path('reports/export/assets/', ExportAssetsView.as_view(), name='reports_export_assets'),
    path('reports/export/helpdesk/', ExportHelpdeskView.as_view(), name='reports_export_helpdesk'),
    path('reports/export/procurement/', ExportProcurementView.as_view(), name='reports_export_procurement'),
    path('reports/export/vendors/', ExportVendorsView.as_view(), name='reports_export_vendors'),
    path('reports/export/network/', ExportNetworkView.as_view(), name='reports_export_network'),
    path('reports/export/seating/', ExportSeatingView.as_view(), name='reports_export_seating'),
    path('reports/export/onboarding/', ExportOnboardingView.as_view(), name='reports_export_onboarding'),
    path('reports/export/kb/', ExportKBView.as_view(), name='reports_export_kb'),
    path('reports/export/users/', ExportUsersView.as_view(), name='reports_export_users'),
    path('reports/export/master-user/', ExportMasterUserView.as_view(), name='reports_export_master_user'),
    path('dashboard/', MainDashboardView.as_view(), name='main_dashboard'),
    path('settings/', SettingsView.as_view(), name='app_settings'),
    path('lov/', ListOfValuesView.as_view(), name='list_of_values'),
    path('lov/values/<int:pk>/', ListOfValuesItemView.as_view(), name='list_of_values_item'),
    path('integrations/', IntegrationsView.as_view(), name='integrations'),
    path('integrations/test/', IntegrationTestView.as_view(), name='integration_test'),
    path('integrations/brex/test/', BrexConnectionTestView.as_view(), name='brex_connection_test'),
    path('calendar/me/', MyCalendarFeedView.as_view(), name='my_calendar_feed'),
    path('calendar/<str:token>.ics', CalendarFeedView.as_view(), name='calendar_feed'),
    # Helpdesk
    path('helpdesk/dashboard/', HelpdeskDashboardView.as_view(), name='helpdesk_dashboard'),
        # Onboarding & Seating
    path('onboarding/dashboard/', OnboardingDashboardView.as_view(), name='onboarding_dashboard'),
    path('seating/stats/', SeatingStatsView.as_view(), name='seating_stats'),
    path('seating/users/<int:user_id>/seat/', UserSeatView.as_view(), name='user_seat'),
    # Procurement
    path('procurement/dashboard/', ProcurementDashboardView.as_view(), name='procurement_dashboard'),
    # Network
    path('network/scan/', RunNetworkScanView.as_view(), name='network_scan'),
    path('network/discovery-options/', DiscoveryOptionsView.as_view(), name='discovery_options'),
    path('network/dashboard/', NetworkDashboardView.as_view(), name='network_dashboard'),
    path('network/topology/', NetworkTopologyView.as_view(), name='network_topology'),
    path('network/lookup/', NetworkDeviceLookupView.as_view(), name='network_lookup'),
    path('network/export/', NetworkExportView.as_view(), name='network_export'),
    # Digital Estate aggregations
    path('estate/dashboard/', EstateDashboardView.as_view(), name='estate_dashboard'),
    path('estate/overview/', EstateOverviewView.as_view(), name='estate_overview'),
    path('estate/gaps/', EstateGapsView.as_view(), name='estate_gaps'),
    path('estate/settings/', EstateSettingsView.as_view(), name='estate_settings'),
    # KB
    path('kb/dashboard/', KBDashboardView.as_view(), name='kb_dashboard'),
    path('kb/suggest/', KBSuggestView.as_view(), name='kb_suggest'),
    # Vault master password / unlock
    path('vault/master/status/', VaultMasterStatusView.as_view(), name='vault_master_status'),
    path('vault/master/set/', VaultMasterSetView.as_view(), name='vault_master_set'),
    path('vault/unlock/', VaultUnlockView.as_view(), name='vault_unlock'),
    path('vault/lock/', VaultLockView.as_view(), name='vault_lock'),
    path('vault/generate-password/', VaultPasswordGeneratorView.as_view(), name='vault_generate_password'),
    # Personal vault password / E2E keypair
    path('vault/personal/status/', VaultPersonalStatusView.as_view(), name='vault_personal_status'),
    path('vault/personal/setup/', VaultPersonalSetupView.as_view(), name='vault_personal_setup'),
    path('vault/personal/change-password/', VaultPersonalChangeView.as_view(), name='vault_personal_change'),
    path('vault/personal/reset/', VaultPersonalResetView.as_view(), name='vault_personal_reset'),
] + router.urls
