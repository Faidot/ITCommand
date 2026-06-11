# IT Command — Feature & Module Reference

A detailed, module-by-module description of every feature in the IT Command platform and how it works end-to-end (data model → API → UI → automation). This complements the setup guide in [README.md](README.md).

- **Backend:** Django 5 + Django REST Framework, JWT auth, SQLite (dev) / PostgreSQL (prod). All models live in the single `core` app.
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind + shadcn/ui, Zustand (auth store), Recharts, Axios.
- **API base:** `/api/…` (e.g. `/api/finance/expenses/`). Most resources are DRF `ModelViewSet`s, so each supports `GET` (list/retrieve), `POST`, `PATCH/PUT`, `DELETE` plus custom `@action` endpoints noted below.

---

## Roles & Access Control (RBAC)

Four roles, enforced by DRF permission classes (`core/permissions.py`):

| Role | Capability |
|------|-----------|
| **SUPERADMIN** | Everything, incl. App Settings, Audit Logs, user management. |
| **ADMIN** | Full read/write across modules (cannot manage other admins). |
| **MANAGER** | Read/write to Finance, Assets, Vault; can **approve expenses**; read-only on Users. |
| **VIEWER** | Strictly read-only everywhere; blocked from Vault. |

Key permission classes: `ReadOnlyViewerOrHigher` (safe methods for everyone, writes for non-viewers), `IsManagerOrHigher`, `IsAdminOrSuperadmin`, `IsSuperadmin`. The frontend mirrors these (e.g. `canModify = role !== "VIEWER"`, `canApprove = role ∈ {MANAGER, ADMIN, SUPERADMIN}`) to hide controls.

Every create/update/delete is captured by the **Audit Log** (`AuditLogMixin`) with a JSON diff, viewable in Settings → Audit Log.

---

## Finance Module

The most extensive module. Navigation is split into two sidebar groups:

- **FINANCE** → Budget
- **TRANSACTIONS** → Income · Expenses · Recurring Bills · Cost Overview

The finance module is **IT-department scoped**: it tracks the IT budget, what IT spends, what comes in, and the true cost of ownership pulled from other modules.

### Core data models (`core/models/finance.py`)

| Model | Purpose |
|-------|---------|
| `FinancialYear` | Fiscal year (name, start, end, `is_active`). Only one active at a time. |
| `BudgetCategory` | Spend categories (Hardware, Software…). `enforce_budget` flag = hard limit. |
| `Budget` | Allocation of an amount to a (category, financial year). |
| `IncomeSource` | Managed dropdown list of funding sources (editable in Settings). |
| `Income` | Money in: amount, date, source, category, method, optional receipt. |
| `Expense` | Money out: amount, date, category, method, source, optional bill + module links + **approval status**. |
| `RecurringBill` | Scheduled outgoing (vendor, amount, frequency, next due) + optional auto-post. |
| `BillPayment` | A payment against a recurring bill (with funding source + optional linked expense). |
| `RecurringIncome` | Scheduled inflow (e.g. monthly recharge) + optional auto-post. |
| `Bill` | An uploaded bill/receipt document that one or many entries can reference. |
| `ExpenseApprovalLog` | Audit trail of an expense's submit → approve/reject lifecycle. |

### Budget (`/finance/budget`)

- **Allocations**: create/edit/delete a budget amount per category for the selected financial year. Each shows allocated / spent / remaining with a colored progress bar (green < 75 %, amber < 90 %, red ≥ 90 %).
- **Summary cards**: Total Budget, Total Spent (approved only), Remaining, **Net Cash Flow** (income − approved expense), **Pending Approvals** (count + amount).
- **Income vs Expense trend chart** (Recharts): grouped monthly bars. Controls let you change the window (**6 / 12 / 24 months**) and **drill into a single category**. Driven by `GET /api/finance/dashboard/?months=&category=`.
- **Clone from year**: copies all allocations from a source year into the current one so you don't re-enter them yearly. Optional **rollover** adds each category's leftover to the new allocation. `POST /api/finance/budgets/clone/ {source, target, rollover}`.
- Access: Admin/Superadmin (page is gated).

### Income (`/finance/income`)

Two tabs:

1. **Entries** — full ledger of inflows.
   - Add one or many entries at once (multi-row), with an optional shared **receipt upload** (one receipt can back several entries). `POST /api/finance/income/upload/` (multipart).
   - **Source** is a managed dropdown with an inline **＋ add source** (persists to Settings).
   - Full CRUD: view detail, edit, delete, multi-select bulk delete.
   - **Filters**: search, category, **date range**. **Export** to CSV / XLSX (respects filters) and **Print** (→ PDF). `GET /api/finance/income/export/?format=csv|xlsx&start=&end=&category=`.
   - Stat cards: total (filtered), this month, count.
2. **Scheduled** — `RecurringIncome` management.
   - Create recurring inflows (title, source, amount, frequency, next date, category).
   - **Receive** (✓) records an Income entry and advances the next date. `POST /api/finance/recurring-income/{id}/receive/`.
   - **Auto-post** toggle: the scheduled job records it automatically when due (see Automation).

### Expenses (`/finance/expenses`)

The single money-out ledger (replaces the old petty-cash / direct-payment pages — those are payment *methods* now).

- **Add** one or many entries with an optional shared **bill upload** (one bill → many expense lines).
- Fields: title, amount, date, category, **source (fund)**, payment method (Petty Cash / Bank Transfer / Card / Cash / Cheque / Online-UPI / Other), receipt number, description.
- **Module links** (on edit): attach an expense to an **Asset**, **License**, or **Purchase Request** for traceability.
- **Approval workflow** (see below) with a **Status** column + filter (Pending / Approved / Rejected).
- **Budget guardrail**: while adding, if the entries for a category exceed its remaining budget an amber warning lists the overspend and asks to confirm on save.
- Filters: search, category, status, **date range**. **Export** CSV / XLSX, **Print**.
- Detail view shows the full **Approval Timeline** (who submitted/approved/rejected and when) and any linked module records.
- Stat cards: total (filtered), approved this month, **pending count**, entry count.

#### Expense approval workflow

- New expenses default to **Pending**. If the creator is **Admin/Superadmin** they are **auto-approved**; a **Manager's** entries stay Pending.
- **Approve / Reject** is available to Manager+ from the row menu or the detail dialog (reject captures a reason). `POST /api/finance/expenses/{id}/approve/` and `…/reject/`.
- **Only APPROVED expenses count** toward Total Spent, budget remaining, the dashboard, and the Cost Overview. Pending/Rejected do not.
- **Notifications**: submitting a Pending expense notifies all Managers/Admins; approving/rejecting notifies the creator (via the `Notification` model → bell UI).
- **Approval audit trail**: every transition writes an `ExpenseApprovalLog` row (action, by, note, at), surfaced as a timeline.
- **Hard budget block**: if a category has `enforce_budget = true`, approving (or auto-approving) an expense that would exceed the category's remaining budget is **blocked** with a 400 error instead of merely warned.

### Recurring Bills (`/finance/recurring-bills`)

Scheduled / recurring outgoings with due tracking.

- **Summary cards**: Overdue (count + amount), Due in 7 days, Active, Est. Monthly cost (frequency-normalized).
- **Status tabs**: All / Overdue / Due Soon / Upcoming, with per-row status badges.
- **Record Payment** asks **"Paid directly from company accounts?"**:
  - **Yes → Company**: records the payment and advances the due date, **no IT budget impact** (informational).
  - **No → IT Budget**: asks **category + source**, then **auto-creates an approved Expense** that reduces the IT budget. `POST /api/finance/bill-payments/` with `paid_from`.
- **Void / reverse a payment**: from the bill's Payment History, Void deletes the linked IT expense and rolls the due date back one cycle. `DELETE /api/finance/bill-payments/{id}/` (custom `perform_destroy`).
- **Detail view** includes a **month calendar + timeline** (built with `date-fns`): green = paid, red = due, amber = projected next cycles, plus the payment history list.
- **Auto-post** toggle + **auto-pay-from** (Company / IT): the scheduled job records due payments automatically.
- Full CRUD with vendor + category.

### Cost Overview (`/finance/cost-overview`)

Read-only aggregation of the **true IT cost of ownership** across modules. `GET /api/finance/cost-overview/`.

- Top stats: Income, Approved Expenses, Budget Remaining, Net Cash Flow.
- **Total IT Cost by Module** bar list: booked Expenses + Asset purchase costs + License costs + Procurement actuals + **annualized Asset depreciation** (computed from `Asset.monthly_depreciation`).
- Booked spend by category, plus procurement-estimated (pipeline) figure.

### Convert a Purchase Request → Expense

On a received purchase request, Managers get **Convert to Expense** which books a finance expense linked to the PR (amount from actual/estimated cost, applies the approval rule). `POST /api/procurement/requests/{id}/convert-to-expense/`.

### Settings for Finance config (Settings page tabs)

- **Income Sources** — CRUD the funding-source dropdown.
- **Budget Categories** — CRUD categories, including the **hard budget limit** toggle (`enforce_budget`).
- **Financial Years** — CRUD fiscal years; setting one active auto-deactivates the others.

### Automation (scheduled jobs / management commands)

Run via cron (examples):

```bash
# Daily: auto-post due recurring income & bills that are flagged auto_post
0 6 * * *  /path/venv/bin/python manage.py finance_autopost

# Monthly: email a finance summary to admins (needs SMTP EMAIL_* settings)
0 7 1 * *  /path/venv/bin/python manage.py email_finance_report
```

- **`finance_autopost`** — for `auto_post=True` items past due: creates Income entries (recurring income) and records BillPayments (recurring bills, using `auto_pay_from`), advancing each schedule and catching up missed cycles. Notifies managers with a summary.
- **`email_finance_report`** — builds a monthly summary (budget, approved spend, this-month income/expense, net, pending approvals, upcoming bills) and emails Admins/Superadmins. With Django's default console backend it prints instead of sending.

### Finance API quick reference

| Endpoint | Notes |
|----------|-------|
| `/api/finance/years/` | Financial years (one active enforced). |
| `/api/finance/categories/` | Budget categories (`enforce_budget`). |
| `/api/finance/sources/?active=true` | Income/fund sources. |
| `/api/finance/budgets/` + `…/clone/` | Allocations + clone-from-year. |
| `/api/finance/income/` + `…/upload/` + `…/export/` | Income CRUD, multi-entry upload, CSV/XLSX export. |
| `/api/finance/recurring-income/` + `…/{id}/receive/` | Scheduled income + receive. |
| `/api/finance/expenses/` + `…/upload/` + `…/{id}/approve/` + `…/{id}/reject/` + `…/export/` | Expense CRUD, upload, approval, export. |
| `/api/finance/recurring-bills/` | Recurring bills CRUD. |
| `/api/finance/bill-payments/` | Payments (DELETE = void). |
| `/api/finance/dashboard/?months=&category=` | Dashboard + trend drilldown. |
| `/api/finance/cost-overview/` | Cross-module cost rollup. |

---

## Asset Management

- **Models**: `AssetCategory` (with custom `spec_schema` JSON for per-category fields), `Asset`, `AssetNote`.
- **Asset** tracks: name, category, status, assignment, vendor, **purchase price / unit price**, purchase date, warranty expiry, and full **depreciation** (`depreciation_method`, `useful_life_months`, `salvage_value`) with computed `monthly_depreciation`, `accumulated_depreciation`, `current_book_value`, `total_cost_of_ownership`.
- Lifecycle history, notes, assignment to users, and warranty-expiry tracking. Asset purchase costs and depreciation feed the **Finance Cost Overview**.
- Categories and storage **Locations** are managed in Settings.

## Secure Vault

- Encrypted credential store using Fernet (AES-256). Models: `VaultCredential`, `AccountWorkspace`, plus per-user keys/shares (`VaultUserKey`, `VaultShare`).
- A **master unlock** flow issues a short-lived `X-Vault-Token` (sent via header from the frontend) gating access. Personal vault setup/change/reset supported.
- Viewers are entirely blocked; sharing and visibility controls per credential.

## Helpdesk

- Models: `TicketCategory`, `SLAPolicy`, `Ticket`, `TicketAttachment`.
- Ticket lifecycle with categories, SLA policies, file attachments, and a helpdesk dashboard. Attachment upload pattern mirrors the finance bill upload (multipart `@action`).

## Software Licenses

- Models: `SoftwareProduct`, `SoftwareLicense` (encrypted key, seats, **cost**, `billing_cycle`, computed `annual_cost`), user assignments.
- Seat tracking, expiry alerts, per-user license views, and a license dashboard. License costs feed the **Finance Cost Overview**. Auto-renew + alert commands exist (`auto_renew_licenses`, `check_license_alerts`).

## Onboarding

- Models: `ChecklistTemplate` + `ChecklistTemplateItem`, `OnboardingRecord` + `OnboardingTask`.
- Reusable onboarding/offboarding checklists instantiated per employee, with task completion tracking and a dashboard.

## Seating / Floor Management

- Models: `Office`, `Floor`, `Seat`, `SeatAssignment`, `FloorMapObject`.
- Visual floor-map editor (drag/drop objects), seat assignments to users, change history, and seating stats. A `FloorManagerPanel` lives in Settings.

## Vendors

- `Vendor` (code, contacts, tax, rating, active), `VendorContract`, `VendorPayment`, `VendorNote`.
- Vendor directory with contract and payment tracking and computed total spend. Vendors are referenced by Recurring Bills, Assets, Licenses, and Procurement. Contract-alert command (`check_contract_alerts`).

## Procurement

- Models: `PurchaseRequest` (PR number, priority, status workflow, budget category, preferred vendor, **estimated/actual cost**), `PRItem`, `PRDocument`, `PRApprovalLog`.
- Full PR lifecycle: Draft → Submitted → Under Review → Approved/Rejected → Ordered → (Partially) Received. Document upload, approval timeline, and **create assets from received items**.
- **Convert to Expense** books the spend into Finance (see Finance). Procurement actuals feed the Cost Overview.

## Network

- Models: `NetworkLocation`, `NetworkDevice`, `IPAddressPool`.
- Device inventory, IP pool management, a network dashboard, and a `ping_check` command for reachability.

## Knowledge Base

- Models: `KBCategory`, `KBTag`, `KBArticle` (TipTap rich text on the frontend).
- Categorized/tagged articles, search/suggest endpoints, linkage to ticket categories, and a KB dashboard.

## Reports

- Financial and asset summary pages with Recharts visualizations and **Excel exports** (`ExportFinancialView`, `ExportAssetsView`), plus a main dashboard aggregation.

## Settings (Superadmin)

Tabbed admin console: **Company**, **Asset Categories**, **Locations**, **Vendors**, **Income Sources**, **Budget Categories**, **Financial Years**, **Offices** (floor manager), **Vault Security**, **Browser Extension**, and **Audit Log**. App-wide key/value config is stored in `AppSettings`.

## Notifications & Audit

- **Notifications** (`Notification`): per-user messages (type, message, link, read flag) surfaced in a bell UI — used by finance approvals, auto-post, warranty/contract/license alerts.
- **Audit Log** (`AuditLog` via `AuditLogMixin`): JSON-diff record of every create/update/delete across modules, filterable in Settings.

---

## Cross-module data flow (Finance lens)

```
Procurement (actual cost) ──convert──▶ Expense ─┐
Recurring Bill ──pay from IT──▶ Expense ────────┤
Manual entry ──────────────────▶ Expense ───────┤ (APPROVED only)
                                                 ├─▶ Budget "spent" / remaining
Assets (purchase + depreciation) ───────────────┤
Licenses (cost) ────────────────────────────────┼─▶ Cost Overview (total IT TCO)
Income / Recurring Income ──────────────────────┴─▶ Net Cash Flow, Dashboard trend
```

Approval gates the Budget/Dashboard side (only approved expenses count); the Cost Overview additionally rolls in live costs from Assets, Licenses, and Procurement.
