# Phase 0 — Dependency audit: removing Subscriptions & Licenses

**Status:** report only. No code written, no migrations created, nothing deleted.
**Database read:** `itcommand_backend/db.sqlite3` (local dev; production is PostgreSQL — see §7).
**Date:** 2026-07-29

---

## 0. Read this first — the premise needs adjusting

The brief says "remove the Subscriptions and Licenses modules, then rebuild as
Digital Estate." The dependency graph says that is already half-done, and the
half that is done is built *on top of the thing being deleted*.

Commits `18113705`…`d2167467` (Phases 1–5 of `SUBSCRIPTIONS-REBUILD.md`, merged
last week) already shipped:

| New spec asks for | Already exists | Where |
|---|---|---|
| `Provider` | `Provider` — same fields, 10 rows seeded | `core/models/estate.py:39` |
| `ProviderAccount` | `ProviderAccount` — same fields, different names (`login_email`/`auth_method`/`mfa_method` vs `account_email`/`auth_type`/`mfa_type`) | `core/models/estate.py:96` |
| `Property` | `DigitalProperty` — same fields | `core/models/estate.py:184` |
| `Service` | **`Subscription`** — extended in `0061` with `provider_account`, `digital_property`, `service_layer`, `identifier`, `auto_renew`, `console_url` | `core/models/subscriptions.py:24` |

`core/estate_reports.py` — the entire aggregation layer behind
`/api/estate/dashboard/`-equivalent endpoints — queries `Subscription` as its
service table (`estate_reports.py:98-100`, `:716-722`). `core/finance_estate.py`
reads `SubscriptionSettings` (`:90-92`).

**Consequence:** "drop `Subscription`, then build `Service`" deletes the storage
layer that the Digital Estate currently runs on. The work is not
remove-then-rebuild. It is:

- **Licenses** → genuine removal. Nothing outside it depends on it.
- **Subscription** → **rename and extract into `Service`**, carrying 4 rows across.
- **Subscriptions UI** → genuine removal (1,420-line page + dialogs), replaced by the new Services screen.

This changes what Phase 1 and Phase 5 mean. I have written the report against
the brief as given, and flagged where the two diverge, rather than silently
re-planning. §5 is the recommendation.

---

## 1. Inbound foreign keys

Enumerated with Django's own `_meta` introspection, not grep, so nothing
declared by string reference is missed.

### Pointing at `Subscription`

| Source | Field | on_delete | null | Rows using it |
|---|---|---|---|---|
| `core.Expense` | `linked_subscription` | **SET_NULL** | yes | **0** |
| `core.RecurringBill` | `linked_subscription` | **SET_NULL** | yes | **0** |
| `core.SubscriptionPayment` | `subscription` | **SET_NULL** | yes | **0** |
| `core.SubscriptionAssignment` | `subscription` | CASCADE | no | 0 |
| `core.SubscriptionRenewal` | `subscription` | CASCADE | no | 0 |
| `core.SubscriptionAlertLog` | `subscription` | CASCADE | yes | 4 |

### Pointing at `SoftwareLicense`

| Source | Field | on_delete | null | Rows using it |
|---|---|---|---|---|
| `core.Expense` | `linked_license` | **SET_NULL** | yes | **0** |
| `core.Subscription` | `linked_license` | **SET_NULL** | yes | **1** |
| `core.LicenseAssignment` | `license` | CASCADE | no | 1 |
| `core.LicenseRenewal` | `license` | CASCADE | no | 0 |
| `core.LicenseAlert` | `license` | CASCADE | no | 0 |

### Pointing at `SoftwareProduct`

| Source | Field | on_delete | null |
|---|---|---|---|
| `core.SoftwareLicense` | `product` | CASCADE | no |

### Pointing at the remaining five

`SubscriptionAssignment`, `SubscriptionRenewal`, `SubscriptionSettings`,
`SubscriptionCategoryBudget`, `SubscriptionAlertLog` — **no inbound relations at
all.** They are leaves.

### The models the brief asked me to check specifically

| Model | Relation to the doomed set | Verdict |
|---|---|---|
| `Vendor` | none inbound. `Subscription.vendor` and `SoftwareLicense.vendor` point *outward*, SET_NULL | Safe |
| `Budget` | none | Safe |
| `BudgetCategory` | none inbound. `Subscription.budget_category` points outward, SET_NULL (2 rows) | Safe |
| `Expense` | `linked_license`, `linked_subscription` — both SET_NULL, both **0 rows** | Safe, but the two columns must be dropped or repointed |
| `RecurringBill` | `linked_subscription` — SET_NULL, **0 rows** | Safe |
| `PurchaseRequest` | **none** | Safe |
| `Asset` | **none** | Safe |
| `AccountWorkspace` | **none** — `ProviderAccount.account_workspace` points at *it*, SET_NULL | Safe |
| `Integration` | **none** | Safe |
| `AuditLog` | **none** — see below | Safe |

### GenericForeignKeys

**There are none anywhere in the `core` app.** I checked every model for
`GenericForeignKey` and `GenericRelation`; zero hits.

`AuditLog` does not use a GFK. It stores `model_name` (CharField) and
`object_id` (CharField) as plain text (`core/models/system.py`). So dropping the
tables **cannot break AuditLog referential integrity** — but it leaves 94 rows
pointing at objects that no longer exist:

| `model_name` | rows |
|---|---|
| `SoftwareLicense` | 48 |
| `Subscription` | 30 |
| `SoftwareProduct` | 13 |
| `SubscriptionSettings` | 3 |
| **total** | **94** |

That is history worth keeping, and it survives a drop untouched. It is only
dangling, not corrupt. No action needed beyond deciding not to purge it.

### Not in the brief's list, but real inbound dependencies

Three models the brief did not name, which the graph found:

- **`SubscriptionPayment`** (`core/models/payments.py:65`) → FK to `Subscription`, SET_NULL. Part of the **Brex integration** (`core/brex.py:251-294`). 0 rows, but `brex.py` will raise `ImportError` on drop.
- **`LicenseAssignment` / `LicenseRenewal` / `LicenseAlert`** (`core/models/licenses.py:128,159,187`) → CASCADE off `SoftwareLicense`. They will be silently deleted with it. That is correct behaviour, but the brief's `dumpdata` command does not include them, so **they would not be in the backup.**

---

## 2. Row counts — live database

### Slated for removal

| Table | Rows |
|---|---|
| `Subscription` | **4** |
| `SubscriptionAssignment` | 0 |
| `SubscriptionRenewal` | 0 |
| `SubscriptionSettings` | 1 *(singleton)* |
| `SubscriptionCategoryBudget` | 0 |
| `SubscriptionAlertLog` | 4 |
| `SoftwareProduct` | **5** |
| `SoftwareLicense` | **1** |
| `LicenseAssignment` | 1 |
| `LicenseRenewal` | 0 |
| `LicenseAlert` | 0 |
| `SubscriptionPayment` | 0 |
| **Total business rows** | **16** |

The four subscriptions:

| id | name | cost | cycle | auto_renew | `service_layer` |
|---|---|---|---|---|---|
| 8 | Rapid API | USD 20 | MONTHLY | no | *(empty)* |
| 9 | Calude | USD 20 | MONTHLY | no | *(empty)* |
| 10 | Registrar — WWW | USD 50 | YEARLY | yes | *(empty)* |
| 11 | Hosting — WWW | USD 54 | YEARLY | yes | *(empty)* |

Rows 10 and 11 are already estate services by intent. **No row has
`service_layer` populated** — the Phase 1 extension is migrated but unused.

### Neighbouring tables (for blast-radius context)

| Table | Rows |
|---|---|
| `Vendor` | 2 |
| `Budget` / `BudgetCategory` | 3 / 3 |
| `Expense` | 5 |
| `RecurringBill` | 1 |
| `PurchaseRequest` | 10 |
| `Asset` | 11 |
| `AccountWorkspace` | 1 |
| `Integration` | 1 |
| `VaultCredential` | 2 |
| `AuditLog` | 223 |
| `Provider` | 10 *(seeded)* |
| `ProviderAccount` | 1 |
| `DigitalProperty` | 1 |
| `User` | 5 |

### Cross-boundary linkage — the number that actually decides this

| Link | Rows |
|---|---|
| `Expense.linked_subscription` populated | **0** |
| `Expense.linked_license` populated | **0** |
| `RecurringBill.linked_subscription` populated | **0** |
| `SubscriptionPayment.subscription` populated | **0** |

**Not one row crosses the module boundary.** The Phase 5 finance linkage is
wired but has never been used.

---

## 3. Other consumers — what breaks on removal

Ranked by reference count.

| File | Refs | What breaks | Severity |
|---|---|---|---|
| `core/subscription_alerts.py` (587 ln) | 132 | Entire file. Whole-file delete per brief | Low — self-contained |
| `core/reports.py` (77 refs) | 77 | `DashboardStatsView` license/subscription blocks (`:481-515`, `:644-659`); `LicenseSummaryView` (`:752`); `ExportLicensesView`; **Master User Report** `prefetch_related` on `license_assignments__license__linked_subscriptions` and `subscription_assignments__subscription` (`:1252-1254`, `:1296-1320`) | **High** — 3 report endpoints + the org dashboard |
| `core/estate_reports.py` | 59 | **Queries `Subscription` as the service table.** `active_subscriptions()` at `:98-100`; provider spend at `:716-722` | **Critical** — this is the new module |
| `core/finance_estate.py` | 56 | Reads `SubscriptionSettings.create_expense_on_renewal` (`:90-92`) | **High** — Phase 5 expense automation |
| `core/brex.py` | 35 | `sync_subscription_payments` imports `Subscription`, `SubscriptionPayment` (`:251-294`) | Medium — Brex card reconciliation |
| `core/admin.py` | 29 | Django admin registrations | Low |
| `core/calendar_feed.py` | 11 | Renewal/expiry events from `Subscription` ×2 and `SoftwareLicense` (`:97-134`) — the **ICS feed** | Medium — external calendar subscribers get a broken feed |
| `core/rbac.py` | 5 | `MODULES` keys `licenses`, `subscriptions` (`:35-36`); role defaults at `:71`, `:79`, `:106` | **High** — see §3.1 |
| `core/notify.py`, `core/notifications.py` | 1 each | Notification type labels | Low |
| `it-command-extension/` | **0** | **Nothing.** Verified across `background.js`, `content.js`, `popup.js`, `manifest.json` | None |

### Management commands to remove

`auto_renew_licenses.py`, `auto_renew_subscriptions.py`,
`check_license_alerts.py`, `check_subscription_alerts.py` — all four are
dispatched by `run_automation.py`, which is the **automation loop** running as
its own container (`docker-compose.yml` service `automation`). Removing the
commands without editing `run_automation.py` breaks the loop for *every* module,
not just these.

### Test files that will fail

12 test modules reference `Subscription`. Nine are deleted with the module;
**three are not**, and must be rewritten rather than removed:

- `core/test_estate.py`, `core/test_estate_api.py`, `core/test_estate_settings.py` — the Digital Estate tests, which build fixtures out of `Subscription`.
- Also affected: `core/test_calendar_feed.py`, `core/test_brex.py`, `core/test_finance_estate.py`, `core/test_reports_subscriptions.py`.

### 3.1 RBAC — the brief specifies a module key that does not exist

The brief requires `rbac_module = 'estate'` and a test that "a role without
`estate.view` gets 403". There is **no `estate` key** in `core/rbac.py`
`MODULES` — the existing estate views correctly use
`rbac_module = "subscriptions"` (`core/views/estate.py:62,119,189`).

Adding `estate` requires a data migration over the **7 existing Role rows**
(Superadmin, Admin, Manager, Viewer, HR, Accounts, Employee), whose
`permissions` JSON is keyed by module. Roles not migrated get no `estate` key at
all. Confirm the intended grant per role before Phase 2.

---

## 4. Frontend — routes, components, external importers

### To be removed (19 files, 9,821 lines)

| Path | Lines |
|---|---|
| `app/(app)/subscriptions/page.tsx` | 1,420 |
| `app/(app)/subscriptions/[id]/page.tsx` | 943 |
| `app/(app)/subscriptions/subscription-dialog.tsx` | 623 |
| `app/(app)/subscriptions/subscription-types.ts` | 490 |
| `app/(app)/subscriptions/subscription-settings-dialog.tsx` | 243 |
| `app/(app)/subscriptions/assign-seat-dialog.tsx` | 138 |
| `app/(app)/licenses/page.tsx` | 386 |
| `app/(app)/licenses/[id]/page.tsx` | 511 |
| `app/(app)/licenses/list/page.tsx` | 541 |
| `app/(app)/licenses/add-license-dialog.tsx` | 380 |
| `app/(app)/licenses/my/page.tsx` | 132 |
| `app/(app)/licenses/assign-seat-dialog.tsx` | 123 |

### To be **kept and moved** (6 files, 3,891 lines) — not deleted

These are the Digital Estate, currently nested under `licenses/estate/`. They
are the previous phase's deliverable and largely satisfy Phase 3 already:

`estate-tab.tsx` (1,061) · `estate-types.ts` (795) · `accounts-tab.tsx` (692) ·
`service-dialog.tsx` (584) · `[property]/page.tsx` (494) ·
`property-dialog.tsx` (241) · `estate/page.tsx` (24)

⚠️ `service-dialog.tsx` writes to `/api/subscriptions/` (`:325`, `:328`) and
reads `/subscriptions/options/` (`:178`). It is coupled to the API being deleted.

### Imports from outside the two route groups

One hard cross-module import, which will fail the build on deletion:

- **`app/(app)/finance/budget/page.tsx:18`** → `import { SubscriptionSettingsDialog } from "../../subscriptions/subscription-settings-dialog"`

Plus these runtime consumers (no import, but they call the API or link to routes):

- `app/(app)/finance/expenses/page.tsx:87,89` — fetches `/licenses/` and `/subscriptions/` to populate the expense-link dropdowns (`:408`, `:411`)
- `app/(app)/dashboard/page.tsx:142-145` — `ModuleCard` reading `data.licenses.*`
- `app/(app)/reports/master/page.tsx` — renders `u.licenses` / `u.subscriptions` sections and KPI chips (`:79-116`, `:222-223`, `:286-287`)
- `app/(app)/reports/licenses/page.tsx` — whole page, incl. export to `/reports/export/licenses/`
- `app/(app)/reports/page.tsx:18` — report index tile
- `app/(app)/vendors/[id]/page.tsx:72` — `GET /vendors/<id>/licenses/`
- `components/app-sidebar.tsx:96` — "Software & Subscriptions" → `/licenses`
- `components/split-screen-container.tsx:16` — "Software Licenses" → `/licenses`
- `lib/permissions.ts:33-34` — route→module map for `/licenses` and `/subscriptions`

### Routes needing redirects (brief: "redirect rather than 404")

`/licenses`, `/licenses/[id]`, `/licenses/list`, `/licenses/my`,
`/subscriptions`, `/subscriptions/[id]`, `/licenses/estate`,
`/licenses/estate/[property]`, `/reports/licenses`

---

## 5. Recommendation

**Split the decision. Clean drop for Licenses; migrate-then-retire for Subscription.**

This follows from the graph, not the row count. The row count (16) would justify
a clean drop of everything; the graph does not.

### Why a clean drop is structurally safe for Licenses

1. Every inbound FK from *outside* the module is `SET_NULL` and nullable. A drop physically cannot cascade outward — no other module loses a row.
2. Every `CASCADE` FK is intra-module (`LicenseAssignment`/`Renewal`/`Alert` → `SoftwareLicense` → `SoftwareProduct`). The cascade set is exactly the module.
3. No GenericForeignKey exists anywhere in `core`, so there is no hidden polymorphic edge.
4. `AuditLog` points by text, not FK — 48+13 rows of license history survive intact.
5. Zero rows cross the boundary: `Expense.linked_license` is empty.
6. Nothing in the Chrome extension, `PurchaseRequest`, `Asset`, `AccountWorkspace`, or `Integration` touches it.

The only inbound edge that is *not* intra-module and *is* populated is
`Subscription.linked_license` (1 row) — and `Subscription` is itself going away.

### Why Subscription must be migrated, not dropped

`Subscription` is not a legacy table sitting beside the estate. It **is** the
estate's service table. Dropping it and creating `Service` fresh would:

- delete rows 10 and 11 ("Registrar — WWW", "Hosting — WWW"), which are live estate services the operator entered this week;
- require rewriting `estate_reports.py` (59 refs) and `finance_estate.py` (56 refs) in the same commit as the drop, which is exactly the large-blast-radius change the brief's own constraints forbid;
- reverse the previous phase's merged work rather than build on it.

The honest framing: **`Service` is `Subscription` minus the seat-management
fields, renamed.** Create `Service`, copy 4 rows with a reversible `RunPython`,
repoint `estate_reports.py`, verify, and only then drop. Sequenced that way the
deletion migration touches a table nothing reads any more.

### Suggested sequencing (differs from the brief — please confirm)

| Step | Content | Commit |
|---|---|---|
| A | Add `estate` to `rbac.MODULES` + role permission data migration | own commit |
| B | `CreateModel Service`; rename `DigitalProperty`→`Property` and `ProviderAccount` field names via `AlterField`/`RenameField` | additive |
| C | `RunPython` copy: 4 `Subscription` rows → `Service`. Reversible. | additive |
| D | Repoint `estate_reports.py`, `finance_estate.py`, `calendar_feed.py`, `brex.py`, `reports.py` at `Service` | no schema change |
| E | Frontend: new screens, redirects, remove old routes, fix `finance/budget/page.tsx:18` | no schema change |
| F | **Delete** old models + `subscription_alerts.py` + 4 management commands + `run_automation.py` wiring | **own commit, last** |

Steps A–E are non-destructive and independently revertible. Only F is one-way.

---

## 6. Reversibility

### Existing migrations

All **65** existing migrations are reversible. Two use `RunPython`
(`0038_seed_roles`, `0043_subscriptions`); I checked both — each passes a reverse
callable positionally (`unseed_roles`, `unseed_subscription_permissions`), which
my first grep for `reverse_code=` missed. There is no `RunPython.noop` reverse
and no irreversible operation in the history. `migrate core 0057` would unwind
the entire estate feature cleanly.

### Proposed migrations

| Step | Forward | Reverse | Truly reversible? |
|---|---|---|---|
| A | `RunPython` add `estate` key to 7 roles | `RunPython` strip the key | **Yes** — must be written, not defaulted to `noop` |
| B | `CreateModel` / `RenameField` | auto `DeleteModel` / `RenameField` | **Yes** — Django generates both |
| C | `RunPython` copy 4 rows | `RunPython` delete copied rows by pk | **Yes** — must be written |
| F | `DeleteModel` ×12 | auto `CreateModel` | **Schema yes, data no** |

⚠️ **The honest limit.** Reversing step F restores the *tables*, empty. Django
cannot restore rows a `DeleteModel` removed. Data reversibility for the deletion
comes from the `dumpdata` JSON and the SQL snapshot, **not** from the migration.
Any claim that F is "fully reversible" would be false, and I will not write it
into the commit message.

### Corrections to the brief's backup commands

The commands as written will not run here:

```bash
# ✗ as written — service is named `db`, not `postgres`
docker compose exec -T postgres pg_dump -U <user> <db> > backup.sql

# ✓ correct service name (docker-compose.yml:14)
docker compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" > ~/backups/backup-pre-estate-$(date +%F).sql
```

Also: **local development is SQLite**, not PostgreSQL
(`settings.py:101-117` — PostgreSQL only when DB env vars are set). The audited
data above is the SQLite dev database. If production PostgreSQL holds different
volumes, this audit must be re-run against it before step F.

The `dumpdata` command in the brief **omits three models that CASCADE-delete**:
`core.LicenseAssignment`, `core.LicenseRenewal`, `core.LicenseAlert`. Add them,
or the backup is incomplete:

```bash
python manage.py dumpdata \
  core.Subscription core.SoftwareLicense core.SoftwareProduct \
  core.SubscriptionAssignment core.SubscriptionRenewal core.SubscriptionSettings \
  core.SubscriptionCategoryBudget core.SubscriptionAlertLog \
  core.LicenseAssignment core.LicenseRenewal core.LicenseAlert \
  core.SubscriptionPayment \
  --indent 2 > ~/backups/legacy-subscriptions-$(date +%F).json
```

### The tracked snapshots — confirmed

The brief's warning is accurate. Five SQLite snapshots are tracked in git,
**~8.4 MB**:

```
itcommand_backend/db.sqlite3.bak-pre-0046   1.6M
itcommand_backend/db.sqlite3.bak-pre-0049   1.7M
itcommand_backend/db.sqlite3.bak-pre-0050   1.7M
itcommand_backend/db.sqlite3.bak-pre-0051   1.7M
itcommand_backend/db.sqlite3.bak-pre-0053   1.7M
```

Root cause: `.gitignore` line 29 is `*.sqlite3`, which does not match
`db.sqlite3.bak-pre-0046`. Recommend `git rm --cached` on all five plus a
`db.sqlite3.bak*` ignore rule, as a separate housekeeping commit. **They contain
live vault ciphertext and user records** — worth treating as a disclosure
question, not just repo hygiene. Note that removing them from HEAD does not
remove them from history.

---

## 7. Two further findings worth your decision

**a) Stack order already matches — the catalog does not.** `core/estate.py:40-48`
already defines `REQUIRED_LAYERS` as exactly the brief's seven
(REGISTRAR→DNS→HOSTING→MAIL→CDN→TLS→ANALYTICS). But the full catalog
(`:16-27`) has **ten** entries — the extra three being `STORAGE`, `MONITORING`,
`OTHER` — where the brief specifies `SAAS` as the eighth. `EstateSettings.enabled_layers`
is a JSONField whose stored value validates against the current ten. Changing
the catalog needs a data migration on that singleton. **Which wins: the shipped
10-layer catalog, or the brief's 8?** Per the working agreement I am flagging
rather than choosing.

**b) The vault-reveal audit gap is real.** The brief asserts vault reads are
unlogged; confirmed. `VaultCredentialViewSet.reveal` (`core/views/vault.py:591-604`)
updates `last_revealed_at`, `last_revealed_by` and `reveal_count` on the
credential row, but never calls `self.log_action(...)` — so no `AuditLog` row is
written, despite the viewset mixing in `AuditLogMixin`. `reveal_extras`
(`:608-621`) — which decrypts TOTP secrets and recovery codes — does not even
bump the counter. Fixing this is a **change to the existing vault module**, not
to the estate module, and it is a prerequisite for the brief's acceptance
criterion "a credential reveal writes an AuditLog row." Confirm you want that
fix in scope.

---

## Decisions taken (2026-07-29)

| # | Question | Decision |
|---|---|---|
| 1 | Data strategy for the 4 `Subscription` rows | **Clean drop, rebuild empty.** My §5 recommendation was migrate-then-retire; overruled. The rows survive only in `legacy-subscriptions-2026-07-29.json`. |
| 2 | `service_type` catalog | **7 stack roles + `SAAS` + retain `STORAGE`/`MONITORING`/`OTHER`** as non-stack types. Superset, so no `EstateSettings.enabled_layers` migration and nothing shipped is invalidated. |
| 3 | RBAC | **Mirror each role's existing `subscriptions` grants onto `estate`.** Non-lossy — no one gains or loses access. Implemented in Phase 2. |
| 4 | Vault reveal logging (§7b) | **In scope**, Phase 2. |
| 5 | Tracked `.bak` snapshots | Not yet actioned — still five files, ~8.4 MB, tracked. |

⚠️ Decision 1 is the one with a cost. Because `Subscription` is still the estate's
service table (§0), a clean drop means `estate_reports.py` must be repointed at
`Service` in Phase 2 and the 4 live rows re-entered by hand. Sequencing is
unchanged: Phase 1 creates, Phase 5 deletes, in its own commit.

---

## Phase 1 — delivered

Backups taken **outside the repo** at `~/it-command-backups/`
(`db-pre-0065-2026-07-29.sqlite3`, `legacy-subscriptions-2026-07-29.json`).

**Migrations** — `0065_estate_rename_property_and_account_fields`,
`0066_estate_service`. Both applied; **the reverse path was executed, not
assumed**: `migrate core 0064` restored `login_email`/`auth_method`/`mfa_method`
and `core_digitalproperty` with rows intact, then re-applied forward.

| Change | Note |
|---|---|
| `DigitalProperty` → `Property` | `RenameModel`; related names → `owned_properties`, `properties` |
| `login_email`→`account_email`, `auth_method`→`auth_type`, `mfa_method`→`mfa_type` | `ALTER TABLE … RENAME COLUMN`, verified in `sqlmigrate`. Constraint dropped and re-added around the rename |
| MFA `KEY` → `SECURITY_KEY` | Reversible `RunPython`; 0 rows affected on this database |
| New `Service` model | 4 indexes per spec; `is_orphan`, `is_at_risk`, `monthly_equivalent`/`yearly_equivalent` as `Decimal` |
| `Property.stack_gaps` | Only the 7 stack roles can be a gap; cancelled/expired services do not count as coverage |
| `seed_estate` → `seed_providers` | Vercel `#000000` → `#111111`. Firebase and Sentry retained beyond the spec's eight |

**API contract deliberately unchanged.** The JSON keys stay `login_email` /
`auth_method` / `mfa_method` via serializer `source=`, so the live Accounts tab
keeps working; both sides flip together in Phase 3. Verified by round-tripping a
read and a write against the real viewset.

### Deviations from the spec, flagged not silently chosen

1. **`ProviderAccount.service_count` is a method (`count_services()`), not a property.** Django assigns queryset annotations with `setattr`, so a getter-only property of that name makes every annotated query raise `AttributeError`. The annotation owns the name because it costs one query per page instead of one per row.
2. **`Service` has no separate `name` field.** The spec lists `identifier` among the fields but `name` in the dashboard payload. `identifier` doubles as the display name; the API emits both keys from the one field. A second column would be a second thing to keep truthful.
3. **`@builtins.property` inside `Service`.** The spec fixes the FK name as `property`, which shadows the builtin decorator in that class body.

---

## Phase 2 — delivered

`manage.py test`: **507 tests, OK** (38 new in `test_estate_phase2.py`).

| Area | What landed |
|---|---|
| RBAC | `estate` added to `rbac.MODULES`; migration **0067** copies each role's `subscriptions` grants onto it. Verified across all 7 roles — identical maps, nobody gains or loses access. Every estate view now `rbac_module = "estate"`. |
| Services API | `GET/POST/PATCH/DELETE /api/estate/services/` with `select_related` on provider, account and property; filters for type, provider, property, `expiring_soon`, `auto_renew`, `orphans`, `at_risk`, plus free-text search. |
| Dashboard | `GET /api/estate/dashboard/` — one call carrying `kpis`, `timeline` (single 90-day query), `by_provider` with percentages, and `by_category`. |
| Aggregation | `estate_reports.py` repointed from `Subscription` to `Service`. `active_q` is now a single status test, not a status-plus-date window mirroring a Python property. |
| Bulk writes | `bulk-update` iterates and audits per row rather than `qs.update()` — that endpoint exists to reassign orphans, which is exactly the change someone later has to explain. |
| Credentials | `ServiceSerializer` exposes `vault_credential` as id + masked title only. No new reveal path. |
| **Vault audit gap (§7b)** | `reveal`, `reveal_extras` and `reveal_shared` now call `log_action('REVEAL', …)`. `reveal_extras` previously did not even bump the counter, despite decrypting TOTP seeds and recovery codes. Optional `?service=<id>` attributes a reveal to the estate row it was opened from. The unlock gate is unchanged, and a test pins that an ungated call is still 403 **and** writes no row. |

### Phase 2 deviations, flagged

1. **Off-stack services moved out of the layer list.** A service on an untracked role (SaaS, Storage) used to be appended to the stack diagram as an extra node. It is now returned in `off_stack_services` / `unassigned_services`, matching the brief's "listed separately since they sit outside the stack". The money is still there — the diagram is just the seven-role chain a request travels through. `test_untracked_layer_still_shows_a_service_bound_to_it` was rewritten to assert the new location and explains why.
2. **`unassigned_services` changed meaning.** It was "service with no layer set", which `Service.service_type` (non-null) no longer permits. It now means "attached here but outside the stack". The key is unchanged so the current frontend keeps working.
3. **`finance_estate.py` still reads `Subscription`** for budget-impact and vendor spend, via a clearly-marked `legacy_active_subscriptions()`. Those functions group by `budget_category` and `vendor`, which the estate spec does not give `Service`. Adding speculative finance FKs to the new model, or breaking a working module, both looked worse than an explicit legacy helper that dies with the old table in Phase 5. **The Cost Overview's property/layer slice did move to `Service`.**

---

## Phase 3 — delivered

New route group `/estate`, replacing the tabbed `/licenses` hub. Real routing,
not tab state: every screen is independently linkable.

| Screen | Route | Notes |
|---|---|---|
| Dashboard | `/estate/dashboard` | 5 KPI cards, lane-packed 90-day timeline, provider donut, category bars — all from one `/api/estate/dashboard/` call |
| Properties | `/estate/properties` | Card grid with a layer strip per property |
| Property detail | `/estate/properties/[id]` | Connected 7-node stack diagram; gaps are drawn as empty nodes with "Attach service" |
| Accounts | `/estate/accounts` | MFA badge, rows expand inline to list their services |
| Services | `/estate/services` | Server-side filters, debounced search, optimistic auto-renew toggle with revert, inline property combobox |
| Add Service | modal | 5 steps, per-step validation, Back everywhere, step 5 skippable |
| ⌘K | global | Jump to property/account/service, run Add service, filter to expiring soon. Esc closes from anywhere |

**Currency overflow — the `PKR 13...` bug.** The old `KpiCard` put `truncate` on
a `text-2xl` value in a fixed-width card. `KpiMoney` now switches to compact
notation above 10,000, drops a type size at narrow widths, and keeps the exact
figure in a tooltip. **No `truncate` on any money value.** Verified at 1280 /
1440 / 1920 via the `sm:` / `xl:` grid steps; the KPI row is 5-up only at `xl`.

**Charts.** `recharts` and `cmdk` were already dependencies — no new packages.
A single-bucket donut or bar renders a one-line sentence instead, per the brief.

**Old routes redirect, verified against the running app:** `/licenses`,
`/licenses/list`, `/licenses/my`, `/licenses/:id`, `/licenses/estate`,
`/licenses/estate/:id`, `/subscriptions`, `/subscriptions/:id` → 307 to the
matching estate screen. Temporary (307) on purpose: the old routes still exist
until Phase 5, and a permanent redirect would be cached past the point of recall.

### Bug found by running the app, not by the tests

`STORAGE`, `MONITORING` and `OTHER` were rendering as permanent amber gap nodes
on every property. The stored `EstateSettings.enabled_layers` holds all ten
*pre-rework* codes, and the gap calculation treated every tracked code as a
stack slot. Three gaps nobody can ever close is precisely how people learn to
ignore the colour that means "fix this".

Fixed with `estate_reports.tracked_stack_types()`, which intersects the org's
tracked list with the seven stack roles. The diagram and the gap count read it;
`tracked_layers()` still drives everything else. Four regression tests pin it.

### Phase 3 deviations, flagged

1. **The old `/licenses` and `/subscriptions` screens are still present**, serving redirects. Deleting them is Phase 5, per the brief's sequencing.
2. **`ProviderAccount` JSON keys are still `login_email` / `auth_method` / `mfa_method`.** The frontend normalises them to the model vocabulary in `estate-types.ts`, so the UI reads correctly; flipping the API keys is a backend change better made when the old subscription serializers go.
3. **Accounts are edited in a single-form dialog, not the wizard.** The 5-step flow is for services, as specified; a five-step modal for four fields would be worse.

---

## Phase 4 — delivered

`manage.py seed_estate_demo`, development only.

```bash
python manage.py seed_estate_demo           # idempotent
python manage.py seed_estate_demo --clear   # removes only what it created
python manage.py seed_estate_demo --force   # required outside DEBUG
```

Seeds **8 properties, 6 provider accounts, 26 services**. Re-running adds
nothing. Verified on the live database: `--clear` removed exactly its own 26
services, 8 properties and 6 accounts, leaving `terafort.com`, the real provider
account and all 10 catalog providers untouched.

**Demo rows are marked by a `[seed_estate_demo]` sentinel in `notes`.** A marker
beats a hardcoded name list because a renamed demo row is still removable, and
beats a dedicated column because three production models should not carry a
field that exists only for a dev command. The trade-off, documented in the
command: `--clear` will miss a row whose notes have been rewritten by hand.

`--clear` also **refuses to delete an account that has since acquired a real
service** — deleting it would either fail on the `PROTECT` or take the real
record with it. It reports which account it kept and why.

### Acceptance criteria — verified against the seeded data

| Criterion | Result |
|---|---|
| Timeline shows red / amber / neutral simultaneously | **3 / 5 / 6** |
| Accounts shows at least one red and one amber MFA badge | 1 critical, 1 warning, 2 muted, 4 ok |
| Property detail shows all 7 stack nodes, gaps included | every property renders 7 |
| At least one complete stack | `pixelforge-arena.example` — 7/7 |
| At least one genuine stack gap | 7 of 8 properties, 2–6 gaps each |
| ≥2 at-risk services | `quillbox.example`, `stellar-drift.example` |
| ≥2 orphans | design suite, issue tracker |
| All 8 service types | REGISTRAR·DNS·HOSTING·MAIL·CDN·TLS·ANALYTICS·SAAS |
| All 4 billing cycles | MONTHLY·YEARLY·USAGE·FREE |
| Fictional only | all domains `.example`, all logins `@example.invalid` |

22 tests in `test_estate_demo_seed.py`, covering the DEBUG guard, `--force`,
idempotency, and that `--clear` leaves real rows alone.

### Two deliberate additions beyond the brief's list

1. **SaaS attached to a property as well as orphaned.** With SaaS only ever orphaned, the property page's "other services" panel was empty on all eight properties and read as broken rather than unused. Two attached SaaS rows fix that.
2. **A service renewing in 6 days *with* auto-renew on.** Red on the timeline and deliberately not at-risk — the dataset has to show that "renews soon" and "at risk" are different questions, or the distinction cannot be judged from the demo.

### Consequence of the clean-drop decision

The estate endpoints read `Service`. Before this phase it had **0 rows** and
every screen showed an empty state. The demo seeder now fills it for
development; **the 4 original subscriptions were not restored** and remain only
in `~/it-command-backups/legacy-subscriptions-2026-07-29.json`. Re-entering the
real services is manual, and the demo data should be cleared first.
