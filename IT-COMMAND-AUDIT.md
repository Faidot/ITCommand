# IT Command — Codebase Audit

Read-only audit. No application code was executed, no database was opened, and no
external service was contacted. Every claim below is derived from source files in
this repository. Secrets are referenced by variable name and path only; no values,
records, or real data appear in this document.

Commit audited: `baa2bf3f` (branch `main`, working tree clean at start).

---

## 1. Stack

| Layer | What is used | Evidence |
|---|---|---|
| Backend language/runtime | Python; container image pins `python:3.12-slim` | [Dockerfile:2](itcommand_backend/Dockerfile:2) |
| Backend framework | Django `>=5.0.0` with Django REST Framework `>=3.14.0` | [requirements.txt:1](itcommand_backend/requirements.txt:1) |
| Database | PostgreSQL 16 in Docker; **SQLite is the fallback whenever `DB_NAME` is unset** | [docker-compose.yml:16](docker-compose.yml:16), [settings.py:98-117](itcommand_backend/itcommand_backend/settings.py:98) |
| ORM / query layer | Django ORM only. No raw SQL, no `cursor()`, no `RawSQL`, no `.extra()` anywhere in `core/` | verified by grep across `core/` |
| Auth library | `djangorestframework-simplejwt >=5.3.1` incl. `token_blacklist` | [settings.py:52-53](itcommand_backend/itcommand_backend/settings.py:52) |
| Crypto | `cryptography >=42.0.5` — Fernet for data at rest, RSA-3072 + PBKDF2 for vault sharing | [encryption.py](itcommand_backend/core/encryption.py), [vault_crypto.py](itcommand_backend/core/vault_crypto.py) |
| Model history | `django-simple-history >=3.5.0` (used on `KBArticle`) | [requirements.txt:11](itcommand_backend/requirements.txt:11), migration `0014` |
| Exports | `openpyxl` (XLSX), `reportlab` (PDF) | [requirements.txt:6-7](itcommand_backend/requirements.txt:6) |
| Frontend framework | Next.js `14.2.35` (App Router), React 18, TypeScript 5 | [package.json](itcommand_frontend/package.json) |
| Charting | `recharts ^3.8.1`; 3-D seating view uses `three` + `@react-three/fiber` + `@react-three/drei` | [package.json](itcommand_frontend/package.json) |
| Styling | Tailwind CSS 3.4 + shadcn/ui + Radix primitives + `class-variance-authority` | [package.json](itcommand_frontend/package.json) |
| State | `zustand ^5` (4 stores); no server-state library in use (see §12) | [src/store](itcommand_frontend/src/store) |
| Forms/validation | `react-hook-form` + `zod` + `@hookform/resolvers` | [package.json](itcommand_frontend/package.json) |
| Rich text | TipTap 3 (KB editor), `lowlight` for code highlighting | [package.json](itcommand_frontend/package.json) |
| Build tooling | `next build`; Docker multi-service build | [package.json:6](itcommand_frontend/package.json:6) |
| Test framework | Django `TestCase` (backend only) — 235 test functions across 14 `core/test_*.py` files. **No frontend test framework is installed.** | see §13 |
| Job/queue system | **None.** No Celery, no Redis, no broker. A long-running `manage.py run_automation` loop in its own container replaces it | [docker-compose.yml:68-78](docker-compose.yml:68), [settings.py:266-300](itcommand_backend/itcommand_backend/settings.py:266) |
| Cache | **No `CACHES` setting** → Django's default per-process `LocMemCache`. This is what DRF throttling counts in (see finding #5) | grep: no `CACHES` in settings.py |
| Packaging / deploy | Docker Compose: `postgres:16-alpine`, backend (Gunicorn, 3 workers), automation (same image, different entrypoint), frontend (Next.js), `nginx:1.27-alpine` as the single published port | [docker-compose.yml](docker-compose.yml), [entrypoint.sh](itcommand_backend/entrypoint.sh) |
| Static/media | WhiteNoise for static; uploads go through a signed-URL storage backend + nginx `X-Accel-Redirect` | [settings.py:64](itcommand_backend/itcommand_backend/settings.py:64), [storage.py](itcommand_backend/core/storage.py) |
| Browser extension | Chrome MV3 extension (vanilla JS, no build step) | [it-command-extension/manifest.json](it-command-extension/manifest.json) |

**End-of-life / version notes**

- Nothing is pinned to an EOL runtime: Python 3.12, Django 5.x, PostgreSQL 16, Node
  20 (implied by frontend Dockerfile), and Next.js 14.2.x are all supported lines.
- Next.js `14.2.35` is on the 14.x maintenance line rather than the current major.
  Not EOL, but two majors behind (15.x, 16.x exist).
- `lucide-react ^1.8.0` is unusual — the widely-published line is `0.x`. Whether this
  resolves to an intended package version is `UNKNOWN — could not determine from source`
  without inspecting the lockfile internals (out of scope per the request).
- Backend requirements use `>=` for every pin with no upper bound, so a rebuild can
  silently pull a new Django major. There is no `requirements.lock` / `pip freeze` file.

---

## 2. Repository map

```
/
├── docker-compose.yml            Full stack: db, backend, automation, frontend, nginx
├── deploy/nginx/default.conf     Single public entry point; routes /api, /admin, /static, /
├── .env                          Local secrets (gitignored — see §10)
├── .env.example                  Committed template, 40 variable names, no live values
├── DEPLOYMENT.md / FEATURES.md / README.md / ONBOARDING.md   Human docs
│
├── itcommand_backend/            Django project root
│   ├── Dockerfile, entrypoint.sh, .dockerignore
│   ├── db.sqlite3                Local dev DB (gitignored)
│   ├── db.sqlite3.bak-pre-00XX   5 backups — TRACKED IN GIT (finding #1)
│   ├── media/                    Uploaded avatars + bills (gitignored)
│   ├── itcommand_backend/        Settings, urls, wsgi/asgi
│   └── core/                     THE ENTIRE APPLICATION — one Django app
│       ├── models/               19 modules, ~75 concrete models
│       ├── views/                19 modules, ~60 viewsets/APIViews
│       ├── serializers/          16 modules
│       ├── migrations/           57 migrations (0001 → 0057)
│       ├── management/commands/  Automation commands (ping_check, renewals, FX, …)
│       ├── permissions.py        7 permission classes + has_role_permission()
│       ├── rbac.py               Module/action catalog + default role maps
│       ├── encryption.py         Org-wide Fernet wrapper (VAULT_ENCRYPTION_KEY)
│       ├── vault_crypto.py       RSA-3072 envelope crypto for vault sharing
│       ├── mixins.py             AuditLogMixin
│       ├── reports.py            1,675 lines: 24 summary/export endpoints
│       ├── subscription_alerts.py, brex.py, fx.py, discovery.py, lov.py, …
│       └── test_*.py             14 test modules
│
├── itcommand_frontend/           Next.js app
│   ├── src/app/(app)/            20 feature route groups, 66 page.tsx files
│   ├── src/app/login/            Unauthenticated login page
│   ├── src/components/           app-sidebar, top-bar, route-guard, ui/ (25 primitives),
│   │                             plus finance/, network/, seating/, vault/, reports/, extension/
│   ├── src/lib/                  api.ts (axios + interceptors), currency.ts,
│   │                             permissions.ts, sanitize-html.ts, data-sync.ts
│   ├── src/store/                authStore, vaultStore, settingsStore, splitScreenStore
│   └── src/hooks/                use-data-sync, use-bulk-selection, use-mobile, …
│
└── it-command-extension/         Chrome MV3 extension (background.js, content.js, popup.*)
```

**Where module boundaries actually sit**

- The apparent modularity (`models/assets.py`, `views/vault.py`, …) is *file* organisation
  inside a **single Django app**. There is one `core` app, one migration chain, one
  `AppConfig`. Nothing enforces the boundaries.
- `core/models/__init__.py` and `core/serializers/__init__.py` re-export everything, and
  most view modules do `from core.models import *` / `from core.serializers import *`
  ([views/users.py:13-14](itcommand_backend/core/views/users.py:13), [views/system.py:12-13](itcommand_backend/core/views/system.py:12)).
  Any model is reachable from any view; cross-module imports are invisible.
- Real coupling exists across the "modules": `models/finance.py` imports from
  `models/assets.py` and `models/vendors.py` ([models/finance.py:1-3](itcommand_backend/core/models/finance.py:1));
  procurement creates assets and expenses ([views/procurement.py:260](itcommand_backend/core/views/procurement.py:260), [:380](itcommand_backend/core/views/procurement.py:380));
  `notifications.py` reads Asset, Bill, Budget, Expense, Ticket, License in one function.
- The genuine boundary is the **RBAC module key** (`rbac_module` on a view, 17 keys in
  [rbac.py:28-46](itcommand_backend/core/rbac.py:28)). That is the only line the code
  actually defends.
- `reports.py` (1,675 lines) and `views/subscriptions.py` (1,267 lines) are the two
  places where "one file per module" has broken down.

---

## 3. Data model

~75 concrete models in one migration chain. Below they are grouped by domain; key
columns and relationships only.

### People & access

| Model | Purpose | Key columns | Relationships |
|---|---|---|---|
| `User` ([models/users.py:53](itcommand_backend/core/models/users.py:53)) | Custom `AbstractUser`, email login | `email` (unique), `full_name`, `role` (CharField 20), `is_active`, `avatar` (Image), `created_at` | FK `department`; self-FKs `manager`, `team_lead` |
| `Department` ([:8](itcommand_backend/core/models/users.py:8)) | Org unit | `name`, `code` (slug, unique, nullable) | FK `head`→User, self-FK `parent` |
| `Role` ([models/roles.py:6](itcommand_backend/core/models/roles.py:6)) | Named role + JSON permission map | `name`, `slug` (unique), `is_system`, `permissions` (JSON) | **No FK from `User.role` — it is a plain CharField joined by string** |
| `AuditLog` ([models/system.py:127](itcommand_backend/core/models/system.py:127)) | Mutation trail | `action`, `model_name`, `object_id` (CharField), `changes` (JSON), `ip_address`, `timestamp` | FK `user` (SET_NULL) |
| `Notification` ([:139](itcommand_backend/core/models/system.py:139)) | In-app inbox | `message`, `notification_type`, `is_read`, `link` | FK `user` (CASCADE) |
| `AppSettings` / `ListOfValues` / `Location` | Config, managed dropdowns, physical locations | `key`/`value`; `group`+`code`+`label`+`is_system` | LOV has `UniqueConstraint(group, code)` |

### Vault

| Model | Purpose | Key columns | Relationships |
|---|---|---|---|
| `VaultMasterPassword` ([models/vault.py:13](itcommand_backend/core/models/vault.py:13)) | Singleton (pk=1) org-wide unlock password | `password_hash` (PBKDF2 via `make_password`), `rotation_count`, `session_ttl_minutes` | FK `set_by` |
| `VaultUnlockSession` ([:42](itcommand_backend/core/models/vault.py:42)) | Short-lived unlock token | `token` = SHA-256 digest (unique, indexed), `expires_at`, `revoked`, `ip_address` | FK `user` (CASCADE) |
| `VaultUserKey` ([:176](itcommand_backend/core/models/vault.py:176)) | Per-user RSA-3072 keypair | `public_key_pem` (plaintext), **`encrypted_private_key`**, `kdf_salt`, `password_hash` | OneToOne `user` |
| `VaultCredential` ([:204](itcommand_backend/core/models/vault.py:204)) | A stored secret | **`encrypted_password`**, **`encrypted_totp_secret`**, **`encrypted_recovery_codes`**, **`encrypted_custom_fields`**, `visibility` (ORG/PRIVATE), `tags` (JSON), `reveal_count`, `rotation_due_at` | FK `workspace`, `created_by`, `last_revealed_by` |
| `VaultShare` ([:260](itcommand_backend/core/models/vault.py:260)) | One E2E share | **`sealed_secret`**, `reveal_count`, `last_revealed_at` | FK `credential` (CASCADE), `recipient` (CASCADE), `shared_by`; `unique_together(credential, recipient)` |
| `AccountWorkspace` ([:83](itcommand_backend/core/models/vault.py:83)) | SaaS account/platform record | `login_email`, `monthly_cost` (Decimal 10,2), `renewal_date`, `billing_cycle`, `seats` | FK `created_by`; reverse `credentials` |

### Assets, licenses, subscriptions

`AssetCategory`, `Asset`, `AssetMaintenance`, `AssetUnitAssignment`, `AssetNote`,
`AssetHistory` ([models/assets.py](itcommand_backend/core/models/assets.py));
`SoftwareProduct`, `SoftwareLicense`, `LicenseAssignment`, `LicenseRenewal`,
`LicenseAlert` ([models/licenses.py](itcommand_backend/core/models/licenses.py));
`Subscription`, `SubscriptionAssignment`, `SubscriptionRenewal`, `SubscriptionSettings`,
`SubscriptionCategoryBudget`, `SubscriptionAlertLog`
([models/subscriptions.py](itcommand_backend/core/models/subscriptions.py)).

Notable: `SoftwareLicense.encrypted_license_key` holds an org-Fernet ciphertext
([models/licenses.py:51](itcommand_backend/core/models/licenses.py:51)). `Subscription.cost`
is `DecimalField(14,2)` with a `MinValueValidator` and DB-level `CheckConstraint`s
(migration `0044`) — the best-defended money column in the codebase.

### Finance

`FinancialYear`, `BudgetCategory`, `IncomeSource`, `Budget`, `Expense`,
`PettyCashTransaction`, `DirectPayment`, `RecurringBill`, `BillPayment`, `Income`,
`ExpenseApprovalLog`, `RecurringIncome`, `Bill`
([models/finance.py](itcommand_backend/core/models/finance.py)). All monetary columns
here are `DecimalField(12,2)` or `(10,2)`.

### Other domains

- Helpdesk: `TicketCategory`, `SLAPolicy`, `Ticket`, `TicketComment`, `TicketAttachment`
- KB: `KBTag`, `KBCategory`, `KBArticle` (+ `simple_history`), `KBFeedback`
- Network: `NetworkLocation`, `NetworkDevice`, `IPAddressPool`, `NetworkDevicePort`,
  `NetworkNote`, `NetworkDeviceStatusLog`
- Discovery: `NetworkIntegration`, `NetworkScan`, `DiscoveredHost`
- Seating: `Office`, `Floor`, `Seat`, `SeatAssignment`, `FloorMapObject`
- Vendors: `Vendor`, `VendorContract`, `VendorPayment`, `VendorNote`
- Procurement: `PurchaseRequest`, `PurchaseRequestItem`, `PRApprovalLog`, `PRDocument`
- Onboarding: `ChecklistTemplate`, `ChecklistTemplateItem`, `OnboardingRecord`, `OnboardingTask`
- Integrations: `Integration`, `CalendarFeedToken`, `ExchangeRate`
- Payments: `PaymentCard`, `SubscriptionPayment`

### Explicit flags

**Money stored as float rather than integer minor units**

- No monetary column is a `FloatField` — every one is `DecimalField`. Good.
- But money is **computed** in float in several places, so rounding drift reaches the
  API response: `AccountWorkspace.annual_cost` does `float(self.monthly_cost) * 12`
  ([models/vault.py:136-146](itcommand_backend/core/models/vault.py:136)), and
  `AccountWorkspaceViewSet.stats` accumulates `monthly_total`/`annual_total` as Python
  floats ([views/vault.py:843-848](itcommand_backend/core/views/vault.py:843)).
- `SubscriptionPayment.match_score` is a `FloatField` ([models/payments.py:96](itcommand_backend/core/models/payments.py:96)) —
  a score, not money. Fine.
- `FloorMapObject.x/y/width/height/rotation/elevation` are floats ([models/seating.py:171-176](itcommand_backend/core/models/seating.py:171)) —
  geometry, correct choice.

**Timestamps without timezone**

- `USE_TZ = True` ([settings.py:148](itcommand_backend/itcommand_backend/settings.py:148)) and
  `TIME_ZONE` is env-driven, so all ~130 `DateTimeField`s are timezone-aware
  (`timestamptz` on PostgreSQL). No naive-datetime columns found.
- `DateField` columns (renewal dates, expiry dates, fiscal boundaries) are date-only by
  design. `Ticket.save` mixes `timezone.now()` with SLA hours correctly
  ([models/helpdesk.py:88-92](itcommand_backend/core/models/helpdesk.py:88)).

**Missing foreign key constraints**

- `User.role` → `Role.slug` is a **string join with no FK**
  ([models/users.py:64](itcommand_backend/core/models/users.py:64) vs [models/roles.py:16](itcommand_backend/core/models/roles.py:16)).
  Deleting a role is guarded in the API ([views/roles.py:34-47](itcommand_backend/core/views/roles.py:34))
  but nothing stops a direct DB write, a `Role` rename, or a fixture load from orphaning
  every user on that slug. `has_role_permission` fails closed in that case
  ([permissions.py:16-18](itcommand_backend/core/permissions.py:16)), which turns the
  inconsistency into a silent total lockout rather than an error.
- `User.ROLE_CHOICES` lists only 4 roles ([models/users.py:54-59](itcommand_backend/core/models/users.py:54))
  while `rbac.DEFAULT_ROLES` seeds 7 ([rbac.py:113-121](itcommand_backend/core/rbac.py:113)).
  The serializer deliberately bypasses the choice validation
  ([serializers/users.py:45-46](itcommand_backend/core/serializers/users.py:45)), so the
  model-level `choices` is decorative.
- `AuditLog.object_id` is a `CharField` pointing at an arbitrary `model_name` — a
  deliberate generic reference, unenforceable, and it dangles after the target row is
  deleted.
- `AppSettings.key` / `ListOfValues.code` are consumed as enums by application logic
  with no referential integrity to the rows that use them.

**Missing indexes on `WHERE` / `JOIN` / `ORDER BY` columns**

Composite indexes exist on `Asset`, `Subscription`, `SubscriptionPayment`,
`ExchangeRate`, `SubscriptionAlertLog`, `DiscoveredHost`. Gaps that are actually hit by
query paths in this codebase:

| Table | Unindexed column(s) | Where it hurts |
|---|---|---|
| `core_auditlog` | `timestamp`, `user_id`, `action`, `model_name` | Default ordering is `-timestamp` and all three filters are exposed as query params ([views/system.py:453-472](itcommand_backend/core/views/system.py:453)). This table only grows. |
| `core_notification` | `user_id`, `is_read`, `created_at` | Every poll filters `user=…, is_read=False` and orders by `-created_at` ([notifications.py:28-33](itcommand_backend/core/notifications.py:28)) |
| `core_vaultcredential` | `visibility`, `created_by_id`, `is_favorite`, `created_at`, `category`, `is_shared` | The scoping filter `Q(visibility='ORG') \| Q(created_by=user)` plus `order_by('-is_favorite','-created_at')` runs on every vault list ([views/vault.py:390](itcommand_backend/core/views/vault.py:390), [:408](itcommand_backend/core/views/vault.py:408)) |
| `core_ticket` | `status`, `priority`, `requester_id`, `assigned_to_id`, `due_date` | All are exposed filters; `Meta.ordering = ['-created_at']` ([views/helpdesk.py:105-138](itcommand_backend/core/views/helpdesk.py:105)) |
| `core_expense` | `status`, `financial_year_id`, `category_id`, `expense_date` | Aggregated per budget in a loop ([notifications.py:76-82](itcommand_backend/core/notifications.py:76)) and across all report endpoints |
| `core_licenseassignment` | `user_id`, `is_active` | `filter(user_id=…, is_active=True)` ([views/licenses.py:504](itcommand_backend/core/views/licenses.py:504)) |
| `core_seatassignment` | `user_id`, `is_active` | `filter(user_id=…, is_active=True)` ([views/seating.py:415](itcommand_backend/core/views/seating.py:415)) |
| `core_vaultshare` | `recipient_id` | `filter(recipient=user)` on every shared-with-me read ([views/vault.py:549](itcommand_backend/core/views/vault.py:549)) |

(Django auto-indexes FK columns on PostgreSQL, so `user_id`-style gaps above are
partially covered; the ordering and status/boolean columns are not.)

**Soft-delete columns not consistently filtered**

There is no `deleted_at`/`is_deleted` convention. Instead 16 models carry `is_active`,
used inconsistently:

- `User.is_active` is the soft delete for users ([views/users.py:185-188](itcommand_backend/core/views/users.py:185)),
  but `UserViewSet.get_queryset` returns **all** users including deactivated ones
  ([views/users.py:123](itcommand_backend/core/views/users.py:123)); only the frontend
  decides whether to show them. Reports and every `FK→User` display path likewise
  include deactivated accounts.
- `VaultCredentialViewSet.shareable_users` *does* filter `is_active=True`
  ([views/vault.py:457](itcommand_backend/core/views/vault.py:457)), but existing
  `VaultShare` rows for a deactivated user are never touched (see §7).
- `SoftwareLicense`/`LicenseAssignment.is_active` is filtered in the license dashboard
  and assignment reads, but `AssetCategory.is_active`, `IncomeSource.is_active`,
  `TicketCategory.is_active`, `Vendor.is_active`, `Seat.is_active` are filtered only
  where a specific view remembered to.
- `Location.is_active` filtering is opt-in via a query param
  ([views/system.py:440-445](itcommand_backend/core/views/system.py:440)).

**Columns holding encrypted or sensitive material**

| Column | Kind |
|---|---|
| `VaultCredential.encrypted_password`, `.encrypted_totp_secret`, `.encrypted_recovery_codes`, `.encrypted_custom_fields` | Fernet, org key |
| `VaultShare.sealed_secret` | RSA-OAEP-wrapped Fernet envelope, per recipient |
| `VaultUserKey.encrypted_private_key`, `.kdf_salt`, `.password_hash` | PBKDF2-derived Fernet ciphertext; PBKDF2 hash |
| `VaultMasterPassword.password_hash` | Django PBKDF2 hash |
| `VaultUnlockSession.token` | SHA-256 digest of the bearer token |
| `SoftwareLicense.encrypted_license_key` | Fernet, org key |
| `Integration.encrypted_api_key` | Fernet, org key ([models/integrations.py:109](itcommand_backend/core/models/integrations.py:109)) |
| `CalendarFeedToken.token` | **Plaintext bearer credential** — it *is* the auth for an unauthenticated endpoint ([models/integrations.py:171](itcommand_backend/core/models/integrations.py:171)) |
| `PaymentCard.last_four` | Truncated PAN (not full card data) |
| `User.password` | Django PBKDF2 hash (framework default) |
| `VaultCredential.notes`, `AccountWorkspace.notes`, `.login_email` | **Plaintext** free-text next to a secret — a natural place for users to paste secondary credentials |

---

## 4. Route and API inventory

Everything is mounted under `/api/` ([itcommand_backend/urls.py:19](itcommand_backend/itcommand_backend/urls.py:19)).
DRF defaults are `JWTAuthentication` + `IsAuthenticated`
([settings.py:203-209](itcommand_backend/itcommand_backend/settings.py:203)), so any
route not listed as unauthenticated below requires a valid Bearer access token before
its own permission class runs.

**How to read the "Role required" column:** `HasModulePermission` resolves the caller's
`Role.permissions[module][action]`, where `action` is `view` for GET/HEAD/OPTIONS and
`add`/`edit`/`delete` for writes ([permissions.py:90-122](itcommand_backend/core/permissions.py:90)).
`SUPERADMIN` bypasses unconditionally. Default grants per seeded role are in
[rbac.py:69-121](itcommand_backend/core/rbac.py:69) but are admin-editable at runtime,
so the module/action pair — not a fixed role name — is the real requirement.

### Explicit paths

| Method | Path | Handler | Auth middleware | Role required |
|---|---|---|---|---|
| POST | `/api/auth/login/` | [views/users.py:29](itcommand_backend/core/views/users.py:29) | `AllowAny` + `login` throttle | **none** |
| POST | `/api/auth/logout/` | [views/system.py:20](itcommand_backend/core/views/system.py:20) | `IsAuthenticated` | any |
| GET | `/api/auth/me/` | [views/users.py:55](itcommand_backend/core/views/users.py:55) | `IsAuthenticated` | any |
| PUT | `/api/auth/me/` | [views/users.py:62](itcommand_backend/core/views/users.py:62) | `IsAuthenticated` | self, safe fields only |
| PUT | `/api/auth/profile/` | [views/users.py:245](itcommand_backend/core/views/users.py:245) | `IsAuthenticated` | self |
| POST | `/api/auth/password/` | [views/users.py:256](itcommand_backend/core/views/users.py:256) | `IsAuthenticated` | self |
| POST | `/api/auth/token/refresh/` | simplejwt `TokenRefreshView` | token-only | valid refresh token |
| POST | `/api/token/`, `/api/token/refresh/` | simplejwt ([urls.py:17-18](itcommand_backend/itcommand_backend/urls.py:17)) | `AllowAny` (framework default) | **none** |
| GET | `/api/search/` | [search.py:8](itcommand_backend/core/search.py:8) | `IsAuthenticated` | per-module, scoped inside handler |
| GET | `/api/dashboard/` | [reports.py:397](itcommand_backend/core/reports.py:397) | `HasModulePermission` | `dashboard.view` |
| GET/PUT | `/api/settings/` | [views/system.py:385](itcommand_backend/core/views/system.py:385) | `IsAuthenticated` (GET) / `IsSuperadmin` (PUT) | any / SUPERADMIN |
| GET/POST | `/api/lov/` | [views/system.py:266](itcommand_backend/core/views/system.py:266) | `IsAuthenticated` (plain GET) / `IsSuperadmin` (`?manage=1`, POST) | any / SUPERADMIN |
| PUT/DELETE | `/api/lov/values/<pk>/` | [views/system.py:348](itcommand_backend/core/views/system.py:348) | `IsSuperadmin` | SUPERADMIN |
| GET/PUT | `/api/integrations/` | [views/system.py:130](itcommand_backend/core/views/system.py:130) | `IsSuperadmin` | SUPERADMIN |
| POST | `/api/integrations/test/` | [views/system.py:196](itcommand_backend/core/views/system.py:196) | `IsSuperadmin` | SUPERADMIN |
| GET/PATCH/POST | `/api/calendar/me/` | [views/calendar.py:56](itcommand_backend/core/views/calendar.py:56) | `IsAuthenticated` | self |
| GET | `/api/calendar/<token>.ics` | [views/calendar.py:17](itcommand_backend/core/views/calendar.py:17) | **`AllowAny`, `authentication_classes = []`** | **none — URL token is the credential** |
| GET | `/api/media/<path>` | [views/media.py:20](itcommand_backend/core/views/media.py:20) | **`AllowAny`** | **none — signed `?token=` is the credential** |
| GET | `/api/finance/dashboard/` | [views/system.py:34](itcommand_backend/core/views/system.py:34) | `HasModulePermission` | `finance.view` |
| GET | `/api/finance/cost-overview/` | [views/finance.py:575](itcommand_backend/core/views/finance.py:575) | `HasModulePermission` | `finance.view` |
| GET | `/api/reports/{financial,asset,helpdesk,license,procurement,vendor,seating,network,onboarding,kb,user}-summary/` | [reports.py:138](itcommand_backend/core/reports.py:138), [:271](itcommand_backend/core/reports.py:271), [:677](itcommand_backend/core/reports.py:677), [:754](itcommand_backend/core/reports.py:754), [:819](itcommand_backend/core/reports.py:819), [:898](itcommand_backend/core/reports.py:898), [:966](itcommand_backend/core/reports.py:966), [:1013](itcommand_backend/core/reports.py:1013), [:1083](itcommand_backend/core/reports.py:1083), [:1148](itcommand_backend/core/reports.py:1148), [:1201](itcommand_backend/core/reports.py:1201) | `HasModulePermission` | `reports.view` |
| GET | `/api/reports/master-user/` | [reports.py:1406](itcommand_backend/core/reports.py:1406) | `HasModulePermission` | `reports.view` |
| GET | `/api/reports/export/{financial,assets,helpdesk,licenses,procurement,vendors,network,seating,onboarding,kb,users,master-user}/` | [reports.py:326](itcommand_backend/core/reports.py:326), [:362](itcommand_backend/core/reports.py:362), [:1431](itcommand_backend/core/reports.py:1431), [:1454](itcommand_backend/core/reports.py:1454), [:1475](itcommand_backend/core/reports.py:1475), [:1498](itcommand_backend/core/reports.py:1498), [:1530](itcommand_backend/core/reports.py:1530), [:1548](itcommand_backend/core/reports.py:1548), [:1567](itcommand_backend/core/reports.py:1567), [:1587](itcommand_backend/core/reports.py:1587), [:1606](itcommand_backend/core/reports.py:1606), [:1623](itcommand_backend/core/reports.py:1623) | `HasModulePermission` | `reports.view` |
| GET | `/api/helpdesk/dashboard/` | [views/helpdesk.py:294](itcommand_backend/core/views/helpdesk.py:294) | `HasModulePermission` | `helpdesk.view` |
| GET | `/api/licenses/user/<user_id>/` | [views/licenses.py:491](itcommand_backend/core/views/licenses.py:491) | `IsAuthenticated` + inline check | self, or `licenses.view` |
| GET | `/api/licenses/dashboard/` | [views/licenses.py:511](itcommand_backend/core/views/licenses.py:511) | `HasModulePermission` | `licenses.view` |
| GET | `/api/onboarding/dashboard/` | [views/onboarding.py:136](itcommand_backend/core/views/onboarding.py:136) | `HasModulePermission` | `onboarding.view` |
| GET | `/api/seating/stats/` | [views/seating.py:384](itcommand_backend/core/views/seating.py:384) | `HasModulePermission` | `seating.view` |
| GET | `/api/seating/users/<user_id>/seat/` | [views/seating.py:402](itcommand_backend/core/views/seating.py:402) | `IsAuthenticated` + inline check | self, or `seating.view` |
| GET | `/api/procurement/dashboard/` | [views/procurement.py:472](itcommand_backend/core/views/procurement.py:472) | `HasModulePermission` | `procurement.view` |
| POST | `/api/network/scan/` | [views/discovery.py:273](itcommand_backend/core/views/discovery.py:273) | `HasModulePermission` | `network.edit` (POST, non-create) |
| GET | `/api/network/discovery-options/` | [views/discovery.py:389](itcommand_backend/core/views/discovery.py:389) | `HasModulePermission` | `network.view` |
| GET | `/api/network/{dashboard,topology,lookup,export}/` | [views/network.py:224](itcommand_backend/core/views/network.py:224), [:322](itcommand_backend/core/views/network.py:322), [:438](itcommand_backend/core/views/network.py:438), [:476](itcommand_backend/core/views/network.py:476) | `HasModulePermission` | `network.view` |
| GET | `/api/kb/dashboard/`, `/api/kb/suggest/` | [views/kb.py:208](itcommand_backend/core/views/kb.py:208), [:241](itcommand_backend/core/views/kb.py:241) | `HasModulePermission` | `kb.view` |
| GET | `/api/vault/master/status/` | [views/vault.py:67](itcommand_backend/core/views/vault.py:67) | `VaultAccessPermission` | `vault.view` |
| POST | `/api/vault/master/set/` | [views/vault.py:97](itcommand_backend/core/views/vault.py:97) | `IsSuperadmin` | SUPERADMIN + account password |
| POST | `/api/vault/unlock/` | [views/vault.py:151](itcommand_backend/core/views/vault.py:151) | `VaultAccessPermission` + `vault_unlock` throttle | `vault.view` + master password |
| POST | `/api/vault/lock/` | [views/vault.py:183](itcommand_backend/core/views/vault.py:183) | `VaultAccessPermission` | `vault.view` |
| GET | `/api/vault/generate-password/` | [views/vault.py:197](itcommand_backend/core/views/vault.py:197) | `VaultUnlockedPermission` | `vault.view` + unlocked |
| GET | `/api/vault/personal/status/` | [views/vault.py:266](itcommand_backend/core/views/vault.py:266) | `VaultUnlockedPermission` | `vault.view` + unlocked |
| POST | `/api/vault/personal/setup/` | [views/vault.py:279](itcommand_backend/core/views/vault.py:279) | `VaultUnlockedPermission` | as above |
| POST | `/api/vault/personal/change-password/` | [views/vault.py:308](itcommand_backend/core/views/vault.py:308) | `VaultUnlockedPermission` | as above + current personal pw |
| POST | `/api/vault/personal/reset/` | [views/vault.py:344](itcommand_backend/core/views/vault.py:344) | `VaultUnlockedPermission` | as above + account password |

### Router-generated resources

Each row covers the standard `list`/`create`/`retrieve`/`update`/`partial_update`/`destroy`
routes at `/api/<prefix>/` and `/api/<prefix>/<pk>/`, registered in
[core/urls.py:44-105](itcommand_backend/core/urls.py:44).

| Prefix | ViewSet (file:line) | Auth middleware | Role required | Custom actions |
|---|---|---|---|---|
| `departments` | [views/users.py:69](itcommand_backend/core/views/users.py:69) | `HasModulePermission` | `departments.*` | `bulk_delete` → `IsAdminOrSuperadmin` ([:98](itcommand_backend/core/views/users.py:98)) |
| `users` | [views/users.py:122](itcommand_backend/core/views/users.py:122) | `UserManagementPermission` | GET `users.view`; writes ADMIN/SUPERADMIN | `create`/`reset_password` → `IsAdminOrSuperadmin` ([:127](itcommand_backend/core/views/users.py:127), [:232](itcommand_backend/core/views/users.py:232)); `bulk_delete` ([:190](itcommand_backend/core/views/users.py:190)) |
| `roles` | [views/roles.py:12](itcommand_backend/core/views/roles.py:12) | `ReadOnlyViewerOrHigher` | **GET: any authenticated user**; writes ADMIN/SUPERADMIN | `catalog` ([:28](itcommand_backend/core/views/roles.py:28)) |
| `asset-categories` | [views/assets.py:22](itcommand_backend/core/views/assets.py:22) | `HasModulePermission` | `settings.*` | — |
| `assets` | [views/assets.py:29](itcommand_backend/core/views/assets.py:29) | `HasModulePermission` | `assets.*` | `bulk_delete`, `assign_unit`, `return_unit/<id>`, `maintenance`, `unit_assignments`, +3 ([:91-298](itcommand_backend/core/views/assets.py:91)) — several pinned to `IsAdminOrSuperadmin` |
| `asset-notes` | [views/assets.py:349](itcommand_backend/core/views/assets.py:349) | `HasModulePermission` | `assets.*` | — |
| `vault/credentials` | [views/vault.py:389](itcommand_backend/core/views/vault.py:389) | `VaultUnlockedPermission` + `HasModulePermission` | `vault.*` + unlocked | `reveal`, `reveal_extras`, `reveal_shared`, `share`, `unshare`, `shares`, `shared_with_me`, `shareable_users`, `toggle_favorite`, `duplicate`, `bulk_action`, `stats`, `match`, `tags` ([:451-779](itcommand_backend/core/views/vault.py:451)) |
| `vault/workspaces` | [views/vault.py:782](itcommand_backend/core/views/vault.py:782) | `VaultUnlockedPermission` + `HasModulePermission` | `vault.*` + unlocked | `mark_renewed`, `credentials`, `stats` ([:817-864](itcommand_backend/core/views/vault.py:817)) |
| `finance/years`, `finance/categories`, `finance/sources` | [views/finance.py:79](itcommand_backend/core/views/finance.py:79), [:95](itcommand_backend/core/views/finance.py:95), [:101](itcommand_backend/core/views/finance.py:101) | `HasModulePermission` | `settings.*` | — |
| `finance/budgets` | [views/finance.py:113](itcommand_backend/core/views/finance.py:113) | `HasModulePermission` | `finance.*` | `clone` ([:129](itcommand_backend/core/views/finance.py:129)) |
| `finance/expenses` | [views/finance.py:174](itcommand_backend/core/views/finance.py:174) | `HasModulePermission` | `finance.*` | `approve`, `reject`, `export`, `upload` ([:207-268](itcommand_backend/core/views/finance.py:207)) |
| `finance/income` | [views/finance.py:357](itcommand_backend/core/views/finance.py:357) | `HasModulePermission` | `finance.*` | `export`, `upload` ([:377](itcommand_backend/core/views/finance.py:377), [:394](itcommand_backend/core/views/finance.py:394)) |
| `finance/recurring-income` | [views/finance.py:532](itcommand_backend/core/views/finance.py:532) | `HasModulePermission` | `finance.*` | `receive` ([:541](itcommand_backend/core/views/finance.py:541)) |
| `finance/petty-cash`, `/direct-payments`, `/recurring-bills`, `/bill-payments`, `/bills` | [views/finance.py:452](itcommand_backend/core/views/finance.py:452), [:461](itcommand_backend/core/views/finance.py:461), [:474](itcommand_backend/core/views/finance.py:474), [:483](itcommand_backend/core/views/finance.py:483), [:564](itcommand_backend/core/views/finance.py:564) | `HasModulePermission` | `finance.*` | — |
| `audit-logs` | [views/system.py:453](itcommand_backend/core/views/system.py:453) | `IsSuperadmin` | SUPERADMIN, read-only | — |
| `notifications` | [notifications.py:11](itcommand_backend/core/notifications.py:11) | `IsAuthenticated` | any (own rows only) | `read` ([:107](itcommand_backend/core/notifications.py:107)) |
| `locations` | [views/system.py:432](itcommand_backend/core/views/system.py:432) | `HasModulePermission` | `settings.*` | — |
| `helpdesk/categories`, `helpdesk/sla-policies` | [views/helpdesk.py:61](itcommand_backend/core/views/helpdesk.py:61), [:69](itcommand_backend/core/views/helpdesk.py:69) | `HasModulePermission` | `settings.*` | — |
| `helpdesk/tickets` | [views/helpdesk.py:77](itcommand_backend/core/views/helpdesk.py:77) | `HasModulePermission` | `helpdesk.*`; non-managers see only own | `assign`, `status`, `comments`, `attachments` ([:145-273](itcommand_backend/core/views/helpdesk.py:145)) |
| `licenses/products` | [views/licenses.py:143](itcommand_backend/core/views/licenses.py:143) | `HasModulePermission` | `licenses.*` | — |
| `licenses` | [views/licenses.py:165](itcommand_backend/core/views/licenses.py:165) | `HasModulePermission` | `licenses.*` | `key`, `assign`, `revoke/<user_id>`, `assignments`, `bulk_delete`, `renewals`, `renew`, `suggest_next_expiry`, `process_auto_renewals` — most `IsAdminOrSuperadmin` ([:213-467](itcommand_backend/core/views/licenses.py:213)) |
| `onboarding/*` (4 prefixes) | [views/onboarding.py:14](itcommand_backend/core/views/onboarding.py:14), [:29](itcommand_backend/core/views/onboarding.py:29), [:35](itcommand_backend/core/views/onboarding.py:35), [:110](itcommand_backend/core/views/onboarding.py:110) | `HasModulePermission` | `onboarding.*` | 3 detail actions ([:23](itcommand_backend/core/views/onboarding.py:23), [:96](itcommand_backend/core/views/onboarding.py:96), [:102](itcommand_backend/core/views/onboarding.py:102)) |
| `seating/*` (5 prefixes) | [views/seating.py:65](itcommand_backend/core/views/seating.py:65), [:77](itcommand_backend/core/views/seating.py:77), [:151](itcommand_backend/core/views/seating.py:151), [:297](itcommand_backend/core/views/seating.py:297), [:371](itcommand_backend/core/views/seating.py:371) | `HasModulePermission` | `seating.*` | 9 detail actions ([:71-362](itcommand_backend/core/views/seating.py:71)) |
| `vendors`, `vendors/contracts`, `vendors/payments`, `vendors/notes` | [views/vendors.py:22](itcommand_backend/core/views/vendors.py:22), [:162](itcommand_backend/core/views/vendors.py:162), [:189](itcommand_backend/core/views/vendors.py:189), [:206](itcommand_backend/core/views/vendors.py:206) | `HasModulePermission` | `vendors.*` | `bulk_delete` + 4 read actions ([:55-155](itcommand_backend/core/views/vendors.py:55)) |
| `procurement/requests` | [views/procurement.py:34](itcommand_backend/core/views/procurement.py:34) | `HasModulePermission` | `procurement.*` | 10 actions incl. `create-assets`, `convert-to-expense`, `documents`, `items` ([:118-430](itcommand_backend/core/views/procurement.py:118)) |
| `network/locations`, `network/devices`, `network/ip-pools` | [views/network.py:40](itcommand_backend/core/views/network.py:40), [:47](itcommand_backend/core/views/network.py:47), [:188](itcommand_backend/core/views/network.py:188) | `HasModulePermission` | `network.*` | `set-status`, `status-history`, `bulk-update`, `ports`, `notes`, `usage` ([:116-194](itcommand_backend/core/views/network.py:116)) |
| `network/integrations` | [views/discovery.py:104](itcommand_backend/core/views/discovery.py:104) | `HasModulePermission` | `network.*` | `test` ([:115](itcommand_backend/core/views/discovery.py:115)) |
| `network/discovered` | [views/discovery.py:134](itcommand_backend/core/views/discovery.py:134) | `HasModulePermission` | `network.*`, read-only VS | `ignore`, `reset`, `promote` ([:158-173](itcommand_backend/core/views/discovery.py:158)) |
| `network/scans` | [views/discovery.py:266](itcommand_backend/core/views/discovery.py:266) | `HasModulePermission` | `network.view`, read-only | — |
| `kb/categories`, `kb/tags`, `kb/articles` | [views/kb.py:35](itcommand_backend/core/views/kb.py:35), [:42](itcommand_backend/core/views/kb.py:42), [:56](itcommand_backend/core/views/kb.py:56) | `HasModulePermission` | `kb.*` | `history`, `restore/<version_id>`, `feedback`, +1 ([:145-189](itcommand_backend/core/views/kb.py:145)) |
| `subscriptions` | [views/subscriptions.py:201](itcommand_backend/core/views/subscriptions.py:201) | `HasModulePermission` | `subscriptions.*` | `assign`, `revoke/<user_id>`, `assignments`, + bulk/export/renewal actions ([:352-1263](itcommand_backend/core/views/subscriptions.py:352)) |

### Unauthenticated routes

Only four endpoints are reachable with no session. This is the complete list.

| Method | Path | Handler | What guards it instead |
|---|---|---|---|
| POST | `/api/auth/login/` | [views/users.py:29](itcommand_backend/core/views/users.py:29) | Credentials; `ScopedRateThrottle` scope `login` at 10/min — but see finding #5 (per-process counter, so the real ceiling is ~10 × worker count and it resets on restart). No account lockout. |
| POST | `/api/token/` and `/api/token/refresh/` | simplejwt views, [itcommand_backend/urls.py:17-18](itcommand_backend/itcommand_backend/urls.py:17) | Credentials / a valid refresh token. **`/api/token/` is a second, undocumented login endpoint with no throttle at all**, and it is not the one the frontend uses. It expects `USERNAME_FIELD` (= `email`) and issues the same token pair. Rate-limiting `/api/auth/login/` does not limit this route. |
| POST | `/api/auth/token/refresh/` | simplejwt, [core/urls.py:114](itcommand_backend/core/urls.py:114) | A valid refresh token. Duplicate mount of the same view. |
| GET | `/api/calendar/<token>.ics` | [views/calendar.py:17](itcommand_backend/core/views/calendar.py:17) | A 64-char unguessable `CalendarFeedToken`, `authentication_classes = []`. Deliberate (calendar clients cannot send a JWT). Returns 404 identically for wrong and disabled tokens, checks `user.is_active`, is user-rotatable, and its content is filtered to what the user's role may view ([calendar_feed.py](itcommand_backend/core/calendar_feed.py)). The token is stored in plaintext and is a permanent bearer credential until rotated; there is no throttle on this route. |
| GET | `/api/media/<path>?token=…` | [views/media.py:20](itcommand_backend/core/views/media.py:20) | A `django.core.signing` token (HMAC over `SECRET_KEY`) carrying the file path, with `max_age = PROTECTED_MEDIA_URL_TTL` (default 3600 s). **The token is not bound to a user, IP, or session** — anyone who obtains the URL can fetch the file for the remainder of the TTL. Tokens are minted by the storage backend for every serialized `FileField`, so they end up in API responses, browser history, and referrer headers. See findings #7 and #3. |

Note that `/admin/` (Django admin) is proxied publicly by nginx
([deploy/nginx/default.conf:47-49](deploy/nginx/default.conf:47)). It is not
"unauthenticated" — it enforces `is_staff` + a session — but it is an additional
password-authenticated surface on the same origin, with its own login form outside the
JWT throttles, and it exposes `VaultCredential`, `Integration`, and `User` row editing
to any `is_staff` account ([admin.py:62](itcommand_backend/core/admin.py:62), [:271](itcommand_backend/core/admin.py:271), [:21](itcommand_backend/core/admin.py:21)).

---

## 5. Authentication and session handling

### Login, end to end

1. Frontend posts `{email, password}` to `/api/auth/login/`
   ([views/users.py:34-53](itcommand_backend/core/views/users.py:34)).
2. `LoginSerializer` validates shape only ([serializers/users.py:112-114](itcommand_backend/core/serializers/users.py:112)).
3. `django.contrib.auth.authenticate(email=…, password=…)` runs against the custom user
   model (`USERNAME_FIELD = 'email'`, [models/users.py:86](itcommand_backend/core/models/users.py:86)).
4. Failure → generic `401 "Invalid email or password."` (no user enumeration).
   Inactive → `403`.
5. Success → `RefreshToken.for_user(user)` produces an access + refresh pair
   ([views/users.py:21-26](itcommand_backend/core/views/users.py:21)), returned in the
   response body alongside the serialized user (including the resolved permission map).
6. Frontend stores **both tokens in `localStorage`**
   ([store/authStore.ts:38-40](itcommand_frontend/src/store/authStore.ts:38)); an axios
   request interceptor attaches `Authorization: Bearer <access>`
   ([lib/api.ts:93-99](itcommand_frontend/src/lib/api.ts:93)).
7. On reload, `loadFromStorage()` validates the token by calling `/api/auth/me/`
   ([store/authStore.ts:59-77](itcommand_frontend/src/store/authStore.ts:59)).

### Password hashing

Django's default hasher chain — **PBKDF2-HMAC-SHA256** with Django 5's iteration count
and a per-password random salt. `AUTH_PASSWORD_VALIDATORS` is the stock four:
similarity, min-length (8, the Django default — not raised), common-password, numeric-only
([settings.py:123-136](itcommand_backend/itcommand_backend/settings.py:123)).
No `PASSWORD_HASHERS` override, so no Argon2/bcrypt and no custom iteration count.

Note the asymmetry: account passwords accept 8 characters with no complexity rules,
while vault master/personal passwords require 12 characters plus upper/lower/digit/symbol
([views/vault.py:38-54](itcommand_backend/core/views/vault.py:38)).

### Session mechanism

| Property | Value |
|---|---|
| Type | Stateless JWT (`rest_framework_simplejwt`) |
| Access token lifetime | 60 minutes ([settings.py:219](itcommand_backend/itcommand_backend/settings.py:219)) |
| Refresh token lifetime | 7 days ([settings.py:220](itcommand_backend/itcommand_backend/settings.py:220)) |
| Rotation | `ROTATE_REFRESH_TOKENS = True`, `BLACKLIST_AFTER_ROTATION = True` ([:221-222](itcommand_backend/itcommand_backend/settings.py:221)) |
| Storage | `localStorage` (both tokens) — readable by any script on the origin |
| Signing key | `SECRET_KEY` (simplejwt default), HS256 |
| Revocation | Yes, but only for **refresh** tokens: `/api/auth/logout/` blacklists the presented refresh token ([views/system.py:22-32](itcommand_backend/core/views/system.py:22)). An **access token cannot be revoked** — it stays valid for up to 60 min. Deactivating a user does cut access, because simplejwt's `get_user` rejects inactive users. |

### Presence / absence checklist

| Control | State | Evidence |
|---|---|---|
| MFA / 2FA | **Absent.** The vault can *store* other systems' TOTP secrets, but IT Command itself has no second factor. | no TOTP verification path in `core/` |
| Rate limiting | Partial. `login` 10/min, `vault_unlock` 5/min, `vault_reveal` 30/min ([settings.py:210-214](itcommand_backend/itcommand_backend/settings.py:210)), applied via explicit `ScopedRateThrottle` on 4 views. **No `DEFAULT_THROTTLE_CLASSES`**, so every other endpoint is unthrottled, and `/api/token/` bypasses the login limit entirely. Counters live in per-process `LocMemCache`. |
| Account lockout | **Absent.** No failed-attempt counter, no lock field, no backoff. |
| Password reset (self-service) | **Absent.** No "forgot password" route, no email token flow. Recovery is admin-driven: `POST /api/users/<pk>/reset_password/` generates a 12-char temp password and **returns it in the HTTP response body** ([views/users.py:232-243](itcommand_backend/core/views/users.py:232)); same for user creation ([:161-165](itcommand_backend/core/views/users.py:161)). No `must_change_password` flag forces rotation at next login. |
| Session invalidation on password change | **Absent.** `ChangePasswordView` calls `set_password` + `save` and nothing else ([views/users.py:259-268](itcommand_backend/core/views/users.py:259)). Existing access tokens (≤60 min) and all outstanding refresh tokens (≤7 days) keep working, so a stolen session survives the password change that was meant to kill it. Same for admin `reset_password`. Vault unlock sessions are also untouched. |
| CSRF protection | `CsrfViewMiddleware` is installed ([settings.py:68](itcommand_backend/itcommand_backend/settings.py:68)) and `CSRF_TRUSTED_ORIGINS` is env-driven — this protects `/admin/`. The API is JWT-over-header with no cookie auth, so classic CSRF does not apply to `/api/`. |
| Secure cookie flags | `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS` all default to **off/0** and must be set per-environment ([settings.py:187-194](itcommand_backend/itcommand_backend/settings.py:187)). `SECURE_PROXY_SSL_HEADER` trusts `X-Forwarded-Proto` unconditionally ([:182](itcommand_backend/itcommand_backend/settings.py:182)). `HttpOnly`/`SameSite` are Django defaults (`HttpOnly` on, `SameSite=Lax`) — but irrelevant to the JWT, which is in `localStorage` by choice. |
| `DEBUG` default | **`True`** ([settings.py:24](itcommand_backend/itcommand_backend/settings.py:24)). A deployment that forgets `DEBUG=False` serves tracebacks with settings and SQL. |

---

## 6. Authorisation model

### Roles

Roles are database rows (`Role`, seeded by migration `0038`), not code constants. Each
holds a JSON map `{module: {view, add, edit, delete}}` over the 17 modules in
[rbac.py:28-46](itcommand_backend/core/rbac.py:28). `User.role` stores the slug as a
string. Admins can create additional roles and edit any role's map at runtime, so the
table below is the **seeded default**, not a guarantee.

| Slug | System | Default capability ([rbac.py:69-121](itcommand_backend/core/rbac.py:69)) |
|---|---|---|
| `SUPERADMIN` | yes | Unconditional bypass in code — `has_role_permission` returns `True` before any lookup ([permissions.py:13-14](itcommand_backend/core/permissions.py:13)); `Role.effective_permissions` also forces full access ([models/roles.py:32-37](itcommand_backend/core/models/roles.py:32)). Sole holder of: vault master password set/rotate, integrations (API keys), LOV management, settings writes, audit-log reads. |
| `ADMIN` | yes | `full_permissions()` on all 17 modules, plus user management writes. Cannot assign or reset SUPERADMIN accounts ([serializers/users.py:100-110](itcommand_backend/core/serializers/users.py:100), [views/users.py:235-239](itcommand_backend/core/views/users.py:235), [permissions.py:142-143](itcommand_backend/core/permissions.py:142)). |
| `MANAGER` | yes | view+add+edit (no delete) on assets, licenses, subscriptions, vendors, procurement, network, kb, helpdesk, onboarding, seating, **vault**, finance; view-only on dashboard/reports/users/departments. |
| `VIEWER` | yes | `view` only on 12 modules. |
| `HR` | no | view+add+edit on users, departments, onboarding, seating; view on dashboard, kb. |
| `ACCOUNTS` | no | view+add+edit on finance, subscriptions, vendors, procurement, reports; view on assets, dashboard. |
| `EMPLOYEE` | no | view dashboard/kb/assets; view+add helpdesk. |

### How checks are enforced

Three layers, in this order:

1. **Global default** — `DEFAULT_PERMISSION_CLASSES = (IsAuthenticated,)`
   ([settings.py:207-209](itcommand_backend/itcommand_backend/settings.py:207)). Nothing
   is public unless a view opts out.
2. **Declarative middleware-style** — `HasModulePermission` on the view plus an
   `rbac_module` attribute. It maps method → action and delegates to
   `has_role_permission` ([permissions.py:75-122](itcommand_backend/core/permissions.py:75)).
   This is the dominant pattern: ~45 of ~60 views use it. Its action mapping is careful:
   custom `POST` actions default to `edit` rather than `add`, `bulk_delete`/`bulk_action
   {action:'delete'}` map to `delete`, and a view can override per-action via
   `rbac_action_permissions`.
3. **Per-handler and inline** — `IsSuperadmin`, `IsAdminOrSuperadmin`,
   `UserManagementPermission`, `VaultAccessPermission`, `VaultUnlockedPermission`, and
   hand-written `if` checks inside handlers. Also *queryset scoping*, which is the real
   row-level control: vault visibility ([views/vault.py:408](itcommand_backend/core/views/vault.py:408)),
   ticket self-service ([views/helpdesk.py:94-96](itcommand_backend/core/views/helpdesk.py:94)),
   procurement, KB visibility, and global search
   ([search.py](itcommand_backend/core/search.py)).

**The important failure mode of layer 2:** `HasModulePermission.has_permission` returns
`True` when the view has no `rbac_module`
([permissions.py:97-99](itcommand_backend/core/permissions.py:97)). Opt-in, fail-open.
Every current view that lists `HasModulePermission` does set `rbac_module`, so nothing
is broken today — but adding a viewset and forgetting one attribute silently grants it
to every authenticated user, with no test or lint catching it.

### Routes / handlers with no authorisation check beyond authentication

These require a valid token but perform **no role or permission check at all**:

| Route | Handler | Exposure |
|---|---|---|
| `GET /api/roles/` and `/api/roles/<pk>/`, `GET /api/roles/catalog/` | [views/roles.py:21](itcommand_backend/core/views/roles.py:21) via `ReadOnlyViewerOrHigher` (SAFE_METHODS → unconditional `True`, [permissions.py:37-38](itcommand_backend/core/permissions.py:37)) | Any authenticated user, including `EMPLOYEE`, reads the full permission matrix of every role — a map of exactly which roles can reach which modules. Reconnaissance value, not direct data loss. |
| `GET /api/settings/` | [views/system.py:379-421](itcommand_backend/core/views/system.py:379) | Any authenticated user. Deliberately limited to a 4-key `PUBLIC_KEYS` allowlist for non-superadmins — correctly implemented. |
| `GET /api/lov/` (without `?manage=1`) | [views/system.py:275-279](itcommand_backend/core/views/system.py:275) | Any authenticated user reads all dropdown vocabularies. Low sensitivity, intentional. |
| `GET /api/auth/me/`, `PUT /api/auth/me/`, `PUT /api/auth/profile/`, `POST /api/auth/password/` | [views/users.py:55](itcommand_backend/core/views/users.py:55), [:245](itcommand_backend/core/views/users.py:245), [:256](itcommand_backend/core/views/users.py:256) | Self-only by construction (`request.user` is the target). `ProfileUpdateSerializer` restricts writable fields to `full_name, avatar, designation, bio` ([serializers/users.py:122-125](itcommand_frontend/../itcommand_backend/core/serializers/users.py:122)), so role/`is_active` self-escalation is blocked. Correct. |
| `/api/notifications/*` (full `ModelViewSet`) | [notifications.py:11-13](itcommand_backend/core/notifications.py:11) | `IsAuthenticated` only, but `get_queryset` is hard-scoped to `user=request.user` and `perform_create` forces `user=request.user` ([:17-19](itcommand_backend/core/notifications.py:17)), so PUT/PATCH/DELETE can only touch own rows. Covered by a test. Correct. |

### IDOR analysis — resources fetched by ID

I traced every handler that resolves an object from a client-supplied identifier. Findings:

**Properly guarded** (listed because the guard is non-obvious and worth preserving):

- All router viewsets resolve objects through `get_object()` → `filter_queryset(get_queryset())`.
  Where `get_queryset` is scoped, the detail route inherits the scope. This is what keeps
  `PRIVATE` vault credentials, other people's tickets, and unpublished KB articles out of
  reach by guessed ID ([views/vault.py:402-408](itcommand_backend/core/views/vault.py:402),
  [views/helpdesk.py:92-96](itcommand_backend/core/views/helpdesk.py:92)).
- `bulk_action` on vault credentials re-derives its target set from `self.get_queryset()`
  rather than from raw IDs ([views/vault.py:672](itcommand_backend/core/views/vault.py:672)) —
  a deliberate and correct choice, with a regression test
  ([test_security_scoping.py:232](itcommand_backend/core/test_security_scoping.py:232)).
- `reveal_shared` looks up by `(credential_id, recipient=request.user)`, so a non-recipient
  gets 404 ([views/vault.py:558](itcommand_backend/core/views/vault.py:558)).
- `share`/`unshare`/`shares` add an ownership check on top of the queryset scope
  ([views/vault.py:445-449](itcommand_backend/core/views/vault.py:445)).
- `GET /api/licenses/user/<user_id>/` and `GET /api/seating/users/<user_id>/seat/` both
  compare against `request.user.id` before falling back to a module permission
  ([views/licenses.py:496-501](itcommand_backend/core/views/licenses.py:496),
  [views/seating.py:405-412](itcommand_backend/core/views/seating.py:405)).
- `UserManagementPermission.has_object_permission` blocks an ADMIN from writing to
  ADMIN/SUPERADMIN rows ([permissions.py:134-145](itcommand_backend/core/permissions.py:134)),
  and `validate_role` blocks ADMIN→SUPERADMIN promotion
  ([serializers/users.py:100-110](itcommand_backend/core/serializers/users.py:100)). Both
  have tests.

**Weak or absent object-level checks:**

| Location | Issue |
|---|---|
| `GET /api/media/<path>?token=…` ([views/media.py:20-35](itcommand_backend/core/views/media.py:20)) | The signature authorises **the path, not the caller**. This is the one true IDOR-class gap: a signed URL forwarded, logged, or leaked via `Referer` grants any anonymous party read access to that file for up to `PROTECTED_MEDIA_URL_TTL`. Bill scans, contract PDFs, and ticket attachments all flow through it. |
| `bulk_delete` on departments ([views/users.py:106-116](itcommand_backend/core/views/users.py:106)), users ([:206-226](itcommand_backend/core/views/users.py:206)), licenses, vendors, assets | These loop over client IDs with `Model.objects.get(pk=pk)` — bypassing any queryset scoping. Acceptable today because each is pinned to `IsAdminOrSuperadmin`, who can reach every row anyway; it becomes a hole the moment one of these is opened to a narrower role. |
| `PurchaseRequestViewSet.manage_items` / `manage_documents` ([views/procurement.py:415](itcommand_backend/core/views/procurement.py:415), [:430](itcommand_backend/core/views/procurement.py:430)) | The parent PR is scoped via `get_object()`, but the nested item/document identifiers inside the request body are `UNKNOWN — could not determine from source` without reading the full 553-line handler; the pattern (`serializer.save(pr=pr, …)`) suggests the parent is bound correctly on create. Worth a targeted read. |
| `AccountWorkspaceViewSet.credentials` ([views/vault.py:825-834](itcommand_backend/core/views/vault.py:825)) | Re-applies the visibility filter manually rather than reusing `VaultCredentialViewSet.get_queryset`. It is currently equivalent, but it is a second copy of a security-critical predicate that can drift. |

---

## 7. Password vault — deep dive

The vault is implemented. There are two distinct crypto systems layered on one another,
and the distinction is the whole story.

### Where does encryption happen — browser or server?

**Server.** There is no cryptography in the frontend at all — no WebCrypto, no
`crypto.subtle`, no JS crypto library in `package.json`. The browser sends the plaintext
password as an ordinary JSON field (`password`, `totp_secret`, `recovery_codes`,
`custom_fields`) and the DRF serializer encrypts it:

```
VaultCredentialSerializer.create → encrypt_value(password) → encrypted_password
```
[serializers/vault.py:104-118](itcommand_backend/core/serializers/vault.py:104), calling
[encryption.py:16-20](itcommand_backend/core/encryption.py:16).

The RSA sealing for shares also happens server-side
([views/vault.py:498](itcommand_backend/core/views/vault.py:498) → [vault_crypto.py:77-89](itcommand_backend/core/vault_crypto.py:77)).

### Where does decryption happen — browser or server?

**Server**, in all three reveal paths:

- `reveal` → `decrypt_value(credential.encrypted_password)` ([views/vault.py:594](itcommand_backend/core/views/vault.py:594))
- `reveal_extras` → three `decrypt_value` calls ([views/vault.py:613-618](itcommand_backend/core/views/vault.py:613))
- `reveal_shared` → `decrypt_private_key(...)` then `open_with_private_key(...)`
  ([views/vault.py:571-574](itcommand_backend/core/views/vault.py:571))

Each returns the plaintext in the JSON response body.

### Can the server process read plaintext vault contents at any point?

**Yes — for every credential in the vault, including `PRIVATE` ones.**

Proof path 1 — ordinary reveal of an `ORG` credential:

```
GET /api/vault/credentials/<id>/reveal/
  views/vault.py:591  reveal()
  views/vault.py:594  password = decrypt_value(credential.encrypted_password)
  encryption.py:22-26 decrypt_value → get_cipher() → Fernet(os.getenv('VAULT_ENCRYPTION_KEY'))
  views/vault.py:600  return Response({'password': password, ...})
```

Proof path 2 — this is the important one. `PRIVATE` credentials are documented as
end-to-end, unreadable by "not other managers, not a superadmin, not anyone holding the
org key or the DB" ([vault_crypto.py:16-17](itcommand_backend/core/vault_crypto.py:16)).
That claim does not hold, because the org-key ciphertext is **retained** and the share
payload is **built from it in server memory**:

```
POST /api/vault/credentials/<id>/share/
  views/vault.py:483  plaintext = build_secret_payload(credential)
  views/vault.py:231-243 build_secret_payload:
        payload['password']        = decrypt_value(credential.encrypted_password)
        payload['totp_secret']     = decrypt_value(credential.encrypted_totp_secret)
        payload['recovery_codes']  = decrypt_value(credential.encrypted_recovery_codes)
        payload['custom_fields']   = decrypt_value(credential.encrypted_custom_fields)
  views/vault.py:498  sealed = seal_for_public_key(plaintext, recipient_public_key)
```

and the same happens on every owner edit, via `reseal_shares`
([views/vault.py:246-260](itcommand_backend/core/views/vault.py:246), called from
`perform_update` at [:443](itcommand_backend/core/views/vault.py:443)).

Setting `visibility='PRIVATE'` changes only *listing* visibility
([views/vault.py:408](itcommand_backend/core/views/vault.py:408)) — it never removes
`encrypted_password`. So possession of the database plus `VAULT_ENCRYPTION_KEY` yields
plaintext for **100% of vault entries**, private included. The RSA layer adds a real
second control against *other application users* (a manager cannot read a private
credential through the API), but not against the server, the DB, or the env.

Additionally, `reveal_shared` receives the recipient's **personal vault password in the
request body** ([views/vault.py:567](itcommand_backend/core/views/vault.py:567)) and
reconstructs the private key in server memory ([:571-573](itcommand_backend/core/views/vault.py:571)).
So even the E2E path routes the KDF input through the server on every single reveal.

### Cipher and mode; KDF and parameters

| Layer | Primitive | Parameters |
|---|---|---|
| Data at rest (all credentials, license keys, integration API keys) | **Fernet** — AES-128-CBC + PKCS7 padding, HMAC-SHA256 for authentication, from a 32-byte key split 16/16 | [encryption.py:14](itcommand_backend/core/encryption.py:14). **No KDF** — the raw key is read from the environment. |
| Private-key wrapping | Fernet, key derived by **PBKDF2-HMAC-SHA256** | 200,000 iterations, 16-byte random salt (`os.urandom`), 32-byte output, base64url-encoded to a Fernet key — [vault_crypto.py:29](itcommand_backend/core/vault_crypto.py:29), [:50-53](itcommand_backend/core/vault_crypto.py:50), [:60](itcommand_backend/core/vault_crypto.py:60) |
| Share envelope | **RSA-3072, OAEP with MGF1-SHA256 and SHA-256**, wrapping a fresh random Fernet data key per seal | [vault_crypto.py:30](itcommand_backend/core/vault_crypto.py:30), [:82-88](itcommand_backend/core/vault_crypto.py:82) |
| Master password | Django `make_password` → PBKDF2-HMAC-SHA256 | [models/vault.py:27-32](itcommand_backend/core/models/vault.py:27) |
| Personal password (verification only) | Django `make_password` | [models/vault.py:194-198](itcommand_backend/core/models/vault.py:194) |
| Unlock token | 36-byte `secrets.token_urlsafe`, stored as SHA-256 digest | [models/vault.py:56-70](itcommand_backend/core/models/vault.py:56) |

Notes on parameters: Fernet's AES-128-CBC is dated but sound. 200k PBKDF2-SHA256
iterations is at the low end of current guidance for a password-derived key (OWASP
suggests ≥600k for PBKDF2-SHA256) and no memory-hard KDF (Argon2id/scrypt) is used —
material because the derived key protects an RSA private key at rest. The unlock-token
digest is a bare SHA-256 with no HMAC key; acceptable for a 288-bit random token
(offline dictionary attack is infeasible), unlike a password.

### Where does the encryption key come from, and where is it stored?

`VAULT_ENCRYPTION_KEY`, read via `os.getenv` after `load_dotenv` of
`itcommand_backend/.env` ([encryption.py:6-14](itcommand_backend/core/encryption.py:6)).
In Docker it is injected from the compose `.env` file into the container environment
([docker-compose.yml:37](docker-compose.yml:37)). It therefore lives, in plaintext, in:
the `.env` file on the host, the container's environment (visible to anything that can
read `/proc/1/environ` or run `docker inspect`), and every process image of the backend
and automation containers. No KMS, no HSM, no envelope encryption, no key rotation
mechanism, no key versioning on the ciphertext (a rotated key silently turns every
`decrypt_value` into a caught exception — see `Integration.get_api_key` swallowing it at
[models/integrations.py:135-141](itcommand_backend/core/models/integrations.py:135)).

`get_cipher()` is called fresh on **every** encrypt/decrypt, re-reading the env each time —
minor overhead, but it also means the key is never cached and a mid-run env change takes
effect immediately.

### Per-user key, or one shared key?

**Both, at different layers:**

- **One shared org key** (`VAULT_ENCRYPTION_KEY`) encrypts every credential, license key
  and integration API key, system-wide. There is no per-user, per-workspace, or
  per-credential key derivation.
- **One shared org master password** (`VaultMasterPassword`, singleton pk=1,
  [models/vault.py:34-36](itcommand_backend/core/models/vault.py:34)). Every vault user
  types the *same* password to unlock. It is only an access gate — it participates in no
  key derivation whatsoever. Rotating it revokes all unlock sessions
  ([views/vault.py:141](itcommand_backend/core/views/vault.py:141)) but re-encrypts nothing,
  because it never encrypted anything. A departing employee who knew it means everyone
  must be told a new one.
- **A genuine per-user keypair** (`VaultUserKey`, RSA-3072) exists, but *only* for the
  sharing envelope — never for primary storage.

### How does sharing work without exposing the sharer's key?

It does not need the sharer's key at all, which is the elegant part:

1. Owner calls `POST /vault/credentials/<id>/share/` with `recipient_ids`
   ([views/vault.py:468-513](itcommand_backend/core/views/vault.py:468)).
2. Server rebuilds the plaintext payload **from the org key**, not from the sharer's
   personal key ([:483](itcommand_backend/core/views/vault.py:483)).
3. For each recipient with a `VaultUserKey`, it hybrid-seals the payload to that
   recipient's *public* key and stores one `VaultShare` row
   ([:498-502](itcommand_backend/core/views/vault.py:498)).
4. Recipients without a personal key are skipped with a reason
   ([:493-497](itcommand_backend/core/views/vault.py:493)).
5. Unless `make_private=false`, the credential flips to `visibility='PRIVATE'`
   ([:508-510](itcommand_backend/core/views/vault.py:508)).
6. The recipient later posts their personal password to `reveal_shared`, the server
   decrypts their private key in memory and opens the envelope
   ([:571-574](itcommand_backend/core/views/vault.py:571)).

So no sharer key is exposed — but only because the *server's* org key substitutes for it.
Sharing is authorised by `_require_owner`, which also admits ADMIN/SUPERADMIN
([:445-449](itcommand_backend/core/views/vault.py:445)); in practice they cannot exercise
it on someone else's private credential because `get_object()` filters it out first.

### Are vault reads written to the audit log, or only writes?

**Neither, for the vault.** This is worse than the question anticipates.

- **Reads are not logged.** `reveal`, `reveal_extras`, and `reveal_shared` write only
  denormalised counters on the row itself — `last_revealed_at`, `last_revealed_by`,
  `reveal_count` ([views/vault.py:595-598](itcommand_backend/core/views/vault.py:595)),
  and `share.last_revealed_at`/`reveal_count` ([:579-581](itcommand_backend/core/views/vault.py:579)).
  No `AuditLog` row is created, so there is **no history** — only "who looked last".
  Reveal number 500 overwrites the record of reveal 499. `match`, `stats`, and `tags`
  (which enumerate credential metadata for the browser extension) log nothing at all.
- **Writes are not logged either.** `VaultCredentialViewSet` inherits `AuditLogMixin`
  but **overrides `perform_create` and `perform_update` without calling `log_action`**
  ([views/vault.py:437-443](itcommand_backend/core/views/vault.py:437) vs
  [mixins.py:27-38](itcommand_backend/core/mixins.py:27)). Creating or editing a
  credential — including replacing a password — produces no audit entry. Only
  `perform_destroy` survives from the mixin, so **DELETE is the single audited vault
  operation**. `duplicate` and `bulk_action` (which can delete in bulk via
  `qs.delete()`, bypassing `perform_destroy` entirely, [:678](itcommand_backend/core/views/vault.py:678))
  are also unlogged.

For contrast, license-key reveal *is* audited ([views/licenses.py:218](itcommand_backend/core/views/licenses.py:218)),
which shows the intent existed.

### What happens to a shared entry when a user is deactivated?

**Nothing.** There is no signal, no override, no cleanup:

- Deactivation is a soft delete (`is_active = False`,
  [views/users.py:185-188](itcommand_backend/core/views/users.py:185)). The `User` row
  survives, so `VaultShare.recipient` (CASCADE) never fires and every `sealed_secret`
  addressed to that person remains in the database indefinitely, still openable with
  their personal password.
- Their `VaultUserKey` — public key, wrapped private key, salt — is retained.
- `VaultUnlockSession` rows are not revoked on deactivation.
- Practical effect: access is cut *today*, because simplejwt rejects inactive users at
  authentication, and `shareable_users` filters `is_active=True` so they receive no new
  shares ([views/vault.py:457](itcommand_backend/core/views/vault.py:457)). But
  reactivating the account — or restoring it from a backup — silently restores plaintext
  access to every credential ever shared with them. Nothing in the offboarding path
  prompts the owner to re-key or unshare, and nothing surfaces "N credentials are still
  sealed to a deactivated account".
- The owner is not notified either. `shares` still lists the deactivated recipient with
  no status flag ([views/vault.py:538-543](itcommand_backend/core/views/vault.py:538)).

---

## 8. Audit logging

### What triggers an entry

One mechanism: `AuditLogMixin` ([mixins.py:5-42](itcommand_backend/core/mixins.py:5)),
mixed into a viewset, firing on the three DRF write hooks:

| Hook | Action string | Notes |
|---|---|---|
| `perform_create` | `CREATE` | also backfills `created_by` if the model has it |
| `perform_update` | `UPDATE` | stores the **new** representation only — no before/after diff (the code says so at [mixins.py:36](itcommand_backend/core/mixins.py:36)) |
| `perform_destroy` | `DELETE` | logged before the delete; `changes` is `None` |

Plus one manual call: `REVEAL_KEY` for license keys
([views/licenses.py:218](itcommand_backend/core/views/licenses.py:218)).

### Fields captured

`user` (FK, SET_NULL), `action`, `model_name`, `object_id` (string), `changes` (JSON),
`ip_address`, `timestamp` ([models/system.py:127-137](itcommand_backend/core/models/system.py:127)).

- **Actor IP: yes.** `get_client_ip` reads `X-Forwarded-For[0]` and falls back to
  `REMOTE_ADDR` ([mixins.py:6-12](itcommand_backend/core/mixins.py:6)). Note it trusts
  the *first* value in a client-supplied header with no trusted-proxy count, so the
  logged IP is spoofable by any client that sets `X-Forwarded-For`. nginx does append
  the real IP ([deploy/nginx/default.conf:38](deploy/nginx/default.conf:38)), but the
  code takes index 0, i.e. the attacker's value.
- **User agent: no.** Not captured anywhere.
- **Request ID / correlation: no.**
- `changes` holds `serializer.data`, i.e. the serialized *representation*. DRF excludes
  `write_only` fields from `.data`, so plaintext passwords and license keys do **not**
  land in the audit table — good, and load-bearing.

### Which actions are covered

Viewsets that mix in `AuditLogMixin`: assets (3), users, departments, roles, locations,
finance (11 viewsets), helpdesk (3), licenses (2), subscriptions, discovery (3),
vault (2, partially — see below).

### Which are not — the gaps that matter

| Not logged | Why |
|---|---|
| **Vault credential create/update** | `VaultCredentialViewSet` overrides both hooks without logging ([views/vault.py:437-443](itcommand_backend/core/views/vault.py:437)) |
| **Every vault read/reveal** | no `log_action` in `reveal`, `reveal_extras`, `reveal_shared`, `match`, `stats`, `tags` |
| **Vault share / unshare** | `share` and `unshare` create and destroy access grants with no entry ([views/vault.py:468](itcommand_backend/core/views/vault.py:468), [:516](itcommand_backend/core/views/vault.py:516)) |
| **Vault master password set/rotate** | `VaultMasterSetView` writes no audit row ([views/vault.py:97](itcommand_backend/core/views/vault.py:97)) — the single most privileged vault operation |
| **Vault unlock / lock, failed unlock attempts** | only `VaultUnlockSession.ip_address` records a successful unlock; failures leave no trace anywhere |
| **Personal-key setup / change / reset** | `VaultPersonalResetView` destroys every incoming share ([views/vault.py:367-368](itcommand_backend/core/views/vault.py:367)) and logs nothing |
| **Login, logout, failed logins** | no audit hook in `LoginView`/`LogoutView` |
| **Password change and admin password reset** | [views/users.py:256](itcommand_backend/core/views/users.py:256), [:232](itcommand_backend/core/views/users.py:232) — neither logs |
| **All `bulk_delete` / `bulk_action` endpoints** | they call `qs.delete()` or `Model.objects.get(...).delete()` directly, bypassing `perform_destroy`: users, departments, assets, licenses, vendors, vault, network `bulk-update` |
| **Role permission-map edits** | `RoleViewSet` has the mixin, so CREATE/UPDATE/DELETE *are* logged — but an ADMIN editing a role's JSON map is recorded only as the post-change state, with no diff of which grants were added |
| **Settings and integration writes** | `SettingsView.put` ([views/system.py:425-431](itcommand_backend/core/views/system.py:425)) and `IntegrationsView` ([views/system.py:130](itcommand_backend/core/views/system.py:130)) — including setting an API key — write no audit row |
| **Everything done through `/admin/`** | Django's own `LogEntry` covers it, but it is a separate table not surfaced in `/api/audit-logs/` |
| **Read access generally** | no module logs reads. For finance, users, and reports exports this means bulk data extraction is invisible. |
| **Automation-driven changes** | management commands mutate rows outside any request; `AuditLogMixin` early-returns without a `request` ([mixins.py:15-16](itcommand_backend/core/mixins.py:15)) |

### Can the application role `UPDATE` or `DELETE` audit rows?

**Yes.**

- Via the API: no. `AuditLogViewSet` is a `ReadOnlyModelViewSet` restricted to
  `IsSuperadmin` ([views/system.py:453-456](itcommand_backend/core/views/system.py:453)),
  and `AuditLog` is **not** registered in the Django admin (confirmed by inspecting all
  `@admin.register` calls in [admin.py](itcommand_backend/core/admin.py)).
- Via the ORM / database: yes, unconditionally. `AuditLog` is a plain model with no
  `save()`/`delete()` override, no append-only constraint, no trigger, and no separate
  DB role. The app connects as `DB_USER` — the same PostgreSQL superuser-ish owner that
  runs migrations ([docker-compose.yml:19-20](docker-compose.yml:19),
  [entrypoint.sh:8](itcommand_backend/entrypoint.sh:8)) — so any code path, any
  `manage.py shell`, or any SQL injection (none found, but still) can rewrite or truncate
  the log. There is no retention policy, no off-box shipping, and no integrity chaining.

---

## 9. Input handling

### How request bodies are validated

- **The dominant, correct path:** DRF `ModelSerializer` with `serializer.is_valid()`.
  16 serializer modules cover the model surface, with field-level validators on
  `Subscription.cost`/`currency` ([models/subscriptions.py:52-63](itcommand_backend/core/models/subscriptions.py:52)),
  `ExchangeRate` currency codes, and `validate_role`
  ([serializers/users.py:100](itcommand_backend/core/serializers/users.py:100)). DB-level
  `CheckConstraint`s back some of it (migrations `0042`, `0044`).
- **The gap: custom `@action` handlers.** Roughly 80 custom actions read
  `request.data.get(...)` directly with hand-rolled checks and no serializer. Quality
  varies from careful to absent:
  - Careful: `bulk_action` validates `ids` is a non-empty list and category values
    against `CATEGORY_CHOICES` ([views/vault.py:667-690](itcommand_backend/core/views/vault.py:667));
    `share` type-checks `recipient_ids` ([:479](itcommand_backend/core/views/vault.py:479));
    `session_ttl_minutes` is int-cast and range-clamped ([:131-137](itcommand_backend/core/views/vault.py:131)).
  - Unvalidated: `SettingsView.put` iterates arbitrary `request.data` keys and writes each
    to `AppSettings` with no allowlist, no type check, and no length limit
    ([views/system.py:425-431](itcommand_backend/core/views/system.py:425)) — superadmin-only,
    but it lets a typo create silent config rows.
  - `MyCalendarFeedView.patch` filters `include` against a known list — correct
    ([views/calendar.py:94-96](itcommand_backend/core/views/calendar.py:94)).
  - `finance/expenses/upload` hand-parses an `entries` JSON string with a try/except
    ([views/finance.py:283-292](itcommand_backend/core/views/finance.py:283)) and then
    trusts each entry's shape.

### Raw SQL built by string concatenation

**None.** Verified by grep across all of `core/`: no `.raw(`, no `connection.cursor()`,
no `RawSQL`, no `.extra()`. Every query goes through the ORM with parameterised
placeholders. SQL injection risk is effectively nil.

### Dangerous sinks

| Sink | Status |
|---|---|
| `dangerouslySetInnerHTML` | **One occurrence**, and it is guarded: [kb/articles/[slug]/page.tsx:124](itcommand_frontend/src/app/(app)/kb/articles/[slug]/page.tsx:124) renders `sanitizedContent`, produced by [lib/sanitize-html.ts](itcommand_frontend/src/lib/sanitize-html.ts). That sanitiser is genuinely good: tag allowlist, per-tag attribute allowlist, `on*` stripping, drop-with-contents for `script`/`svg`/`iframe`/`style`/`form`, URL scheme checks that strip control characters before comparing, `data:` only for a few image types, `rel=noopener noreferrer` forced on `target=_blank`, and `class` on `<code>` restricted to `/^language-[a-z0-9_-]+$/`. Residual risks: it is **client-side only** (nothing sanitises on write, so the DB stores raw attacker HTML and any other consumer — an export, a future SSR render, the extension — is unprotected), it silently returns `""` during SSR, and it relies on `DOMParser` semantics rather than a maintained library. |
| `v-html` | N/A (React, not Vue) |
| `eval` / `new Function` | **None** in backend or frontend `src/`. |
| Shell commands | `subprocess.run` in three places — [discovery.py:118](itcommand_backend/core/discovery.py:118) (`ping`), [discovery.py:150](itcommand_backend/core/discovery.py:150) (`arp`), [management/commands/ping_check.py:30](itcommand_backend/core/management/commands/ping_check.py:30) (`ping`). All use **argument lists, never `shell=True`**, and interpolate only values coerced with `str()` on an IP from `ipaddress`-parsed input or a model `GenericIPAddressField`. No command injection. |
| File paths | `protected_media` takes a `<path:path>` URL segment but never trusts it: the path must match the HMAC-signed value in the token before use ([views/media.py:33-36](itcommand_backend/core/views/media.py:33)), and `default_storage.exists()`/`open()` are confined to `MEDIA_ROOT`. Traversal is blocked because a forged path invalidates the signature. `quote(path, safe='/')` is applied to the `X-Accel-Redirect` header. Correct. |
| Redirect targets | No `redirect()` on user input; no `next=` parameter handling. The SPA does client-side routing only. |
| SSRF | `POST /api/network/scan/` and `POST /api/network/integrations/<id>/test/` make outbound requests to operator-supplied addresses ([views/discovery.py:273](itcommand_backend/core/views/discovery.py:273), [:115](itcommand_backend/core/views/discovery.py:115)) and `Integration.base_url` is a user-set URL contacted by the notifier. Internal network scanning **is the feature**, gated on `network.edit`, with a host-count limit ([discovery.py:100-107](itcommand_backend/core/discovery.py:100)). Worth naming as accepted risk rather than a defect. |

### File upload handling

Five upload targets: `User.avatar` (`avatars/`), `TicketAttachment.file`
(`ticket_attachments/%Y/%m/`), `Bill.document` (`bills/%Y/%m/`), `PRDocument.document`
(`procurement/`), `VendorContract.document` (`contracts/`).

| Control | State |
|---|---|
| Type / extension check | **Absent.** No `FileExtensionValidator`, no `content_type` inspection, no magic-byte check anywhere. `TicketAttachment` takes `request.FILES.get('file')` and saves it unconditionally ([views/helpdesk.py:283-289](itcommand_backend/core/views/helpdesk.py:283)); `PRDocument` goes straight through a serializer with no file validator ([views/procurement.py:424-427](itcommand_backend/core/views/procurement.py:424)); the finance bill upload does the same ([views/finance.py:294-300](itcommand_backend/core/views/finance.py:294)). `User.avatar` is an `ImageField`, so Pillow at least verifies it decodes as an image — the only de facto type check in the system. |
| Size limit | **Application-level: absent.** The only ceiling is nginx `client_max_body_size 25M` ([deploy/nginx/default.conf:32](deploy/nginx/default.conf:32)), which does not apply if the backend is reached directly, and Django's default `DATA_UPLOAD_MAX_MEMORY_SIZE` (2.5 MB) governs only in-memory parsing, not total file size. No per-model or per-endpoint limit, no quota. |
| Filename handling | Django's `FileSystemStorage` sanitises and de-duplicates names. Original names are not preserved separately, so no path-traversal vector via filename. |
| Storage location | Local disk at `MEDIA_ROOT` ([settings.py:160](itcommand_backend/itcommand_backend/settings.py:160)), mounted as the `media_volume` Docker volume. `/media/` is hard-404'd by nginx ([default.conf:63](deploy/nginx/default.conf:63)) and the real bytes live behind an `internal;` location ([:66-70](deploy/nginx/default.conf:66)) — a genuinely good design. Note `itcommand_backend/media/` is gitignored but **untracked files exist on this host** under `media/avatars` and `media/bills`. |
| Served from the same origin? | **Yes.** `/api/media/...` is served by the same nginx server block on the same host and port as the SPA ([default.conf:41-70](deploy/nginx/default.conf:41)). Combined with the missing type check, `Content-Type` guessed from the *attacker-chosen extension* ([views/media.py:39](itcommand_backend/core/views/media.py:39)), and no `Content-Disposition: attachment` on the `X-Accel-Redirect` branch ([:41-43](itcommand_backend/core/views/media.py:41)), an uploaded `.html` or `.xhtml` is returned as `text/html` and executes in the application's origin. `X-Content-Type-Options: nosniff` is set ([:55](itcommand_backend/core/views/media.py:55), [default.conf:69](deploy/nginx/default.conf:69)) — it prevents *sniffing* but not a correctly-declared `text/html`. There is no `Content-Security-Policy` header anywhere in the stack to contain it. Since the JWT lives in `localStorage`, script in this origin reads it. See finding #3. |

---

## 10. Secrets and configuration

### How config is loaded

Two mechanisms, which is itself a wrinkle:

1. `python-decouple`'s `config()` in `settings.py`
   ([settings.py:9](itcommand_backend/itcommand_backend/settings.py:9)) — reads
   `os.environ` first, then a `.env` beside `manage.py`. Typed via `cast=bool/int/_csv`.
2. `python-dotenv`'s `load_dotenv()` + `os.getenv` in
   [encryption.py:6-11](itcommand_backend/core/encryption.py:6), loading
   `itcommand_backend/.env` explicitly. This is why `VAULT_ENCRYPTION_KEY` is the one
   secret not read through `settings.py`, and why it is absent from `settings.py`
   entirely. In Docker the compose `.env` is injected as container environment
   ([docker-compose.yml:37](docker-compose.yml:37), [:72](docker-compose.yml:72)), so both
   mechanisms resolve — but a bare-metal run needs the file in the *backend* directory,
   while compose reads it from the *repo root*. Two files, same names, easy to desync.

### Every secret the app expects (variable names only)

| Variable | Read at | Hardcoded default? |
|---|---|---|
| `SECRET_KEY` | [settings.py:21](itcommand_backend/itcommand_backend/settings.py:21) | **Yes** — an insecure placeholder string. Signs JWTs *and* protected-media URLs. |
| `VAULT_ENCRYPTION_KEY` | [encryption.py:11](itcommand_backend/core/encryption.py:11) | No — raises `ValueError` if unset. Good. |
| `DB_PASSWORD` | [settings.py:106](itcommand_backend/itcommand_backend/settings.py:106) | **Yes** — empty string |
| `DB_USER` | [settings.py:105](itcommand_backend/itcommand_backend/settings.py:105) | Yes — `postgres` |
| `DB_NAME` | [settings.py:98](itcommand_backend/itcommand_backend/settings.py:98) | Yes — empty, and **empty silently switches the whole app to SQLite** |
| `DB_HOST`, `DB_PORT` | [settings.py:107-108](itcommand_backend/itcommand_backend/settings.py:107) | Yes — `localhost`, `5432` |
| `EMAIL_HOST_PASSWORD` | [settings.py:259](itcommand_backend/itcommand_backend/settings.py:259) | Yes — empty |
| `EMAIL_HOST_USER` | [settings.py:258](itcommand_backend/itcommand_backend/settings.py:258) | Yes — empty |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`, `EMAIL_USE_SSL`, `EMAIL_BACKEND`, `DEFAULT_FROM_EMAIL` | [settings.py:249-262](itcommand_backend/itcommand_backend/settings.py:249) | Yes |
| `DEBUG` | [settings.py:24](itcommand_backend/itcommand_backend/settings.py:24) | **Yes — `True`** |
| `ALLOWED_HOSTS` | [settings.py:34](itcommand_backend/itcommand_backend/settings.py:34) | Yes — localhost only |
| `CORS_ALLOWED_ORIGINS` | [settings.py:230](itcommand_backend/itcommand_backend/settings.py:230) | Yes — localhost:3000/3001 |
| `CSRF_TRUSTED_ORIGINS` | [settings.py:239](itcommand_backend/itcommand_backend/settings.py:239) | Yes — empty |
| `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS`, `SECURE_HSTS_PRELOAD` | [settings.py:187-194](itcommand_backend/itcommand_backend/settings.py:187) | **Yes — all off / 0** |
| `TIME_ZONE` | [settings.py:144](itcommand_backend/itcommand_backend/settings.py:144) | Yes — UTC |
| `PROTECTED_MEDIA_URL_TTL`, `PROTECTED_MEDIA_USE_X_ACCEL` | [settings.py:173-178](itcommand_backend/itcommand_backend/settings.py:173) | Yes — 3600 s; X-Accel on when `DEBUG=False` |
| `AUTOMATION_*` (7 vars), `PING_CHECK_INTERVAL_SECONDS`, `FINANCE_REPORT_DAY` | [settings.py:266-300](itcommand_backend/itcommand_backend/settings.py:266) | Yes — non-secret tuning |
| `GUNICORN_WORKERS`, `GUNICORN_TIMEOUT` | [entrypoint.sh:14-15](itcommand_backend/entrypoint.sh:14) | Yes — 3, 120 |
| `HTTP_PORT` | [docker-compose.yml:100](docker-compose.yml:100) | Yes — 80 |
| `NEXT_PUBLIC_API_URL` | [lib/api.ts:6](itcommand_frontend/src/lib/api.ts:6), [docker-compose.yml:84](docker-compose.yml:84) | Yes — `/api` (build arg) / `http://localhost:8000/api` (client fallback). Not a secret — it is baked into the browser bundle. |

Third-party integration credentials (Brex, network vendors, webhooks, notification
providers) are **not** environment variables — they are stored per-provider in
`Integration.encrypted_api_key` in the database, set through the superadmin-only
`/api/integrations/` endpoint ([models/integrations.py:109](itcommand_backend/core/models/integrations.py:109),
[views/system.py:130](itcommand_backend/core/views/system.py:130)).

### Secrets with a hardcoded default

`SECRET_KEY` is the one that matters — a fixed, publicly-known placeholder that will be
used if the variable is missing, and it signs both JWTs and media URLs. `DEBUG=True` and
the six `SECURE_*`/cookie flags defaulting to off are the same class of problem: the
default posture is development, so a deployment that omits any of them is silently
insecure rather than failing to start. `VAULT_ENCRYPTION_KEY` is the counter-example done
right — it hard-fails when absent.

### Secrets committed to the repo

- **No secret values are committed.** `.env` is untracked (confirmed against
  `git ls-files`), and `.env.example` is a template. I read `.env` only to enumerate the
  12 variable names it defines: `SECRET_KEY`, `VAULT_ENCRYPTION_KEY`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD`, `DEBUG`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`,
  `CSRF_TRUSTED_ORIGINS`, `NEXT_PUBLIC_API_URL`, `GUNICORN_WORKERS`, `HTTP_PORT`. **No
  value from that file appears anywhere in this document.**
- **But five database snapshots are tracked**:
  `itcommand_backend/db.sqlite3.bak-pre-0046`, `-0049`, `-0050`, `-0051`, `-0053`
  (confirmed via `git ls-files`). `.gitignore` covers `*.sqlite3` and `*.sqlite` but not
  the `.bak-pre-NNNN` suffix, so these slipped past it. I did **not** open them. By
  schema, files of this kind at those migration points would contain `core_user` rows
  with password hashes and emails, `core_vaultcredential` rows with org-Fernet
  ciphertext, `core_vaultuserkey` rows, `core_auditlog`, and every finance/ticket table.
  See finding #1.

### Is `.env` gitignored?

Yes, thoroughly — `.env`, `.env.*`, `**/.env`, `**/.env.*`, with an explicit
`!.env.example` re-inclusion ([.gitignore:13-18](.gitignore:13)). The backend
`.dockerignore` also excludes `.env`, `.env.*`, `db.sqlite3`, `*.sqlite3`, `media/`, and
`.git/` ([itcommand_backend/.dockerignore](itcommand_backend/.dockerignore)) — so the
tracked `.bak-pre-*` files are excluded from the image build too, by the `*.sqlite3`
rule... actually no: `db.sqlite3.bak-pre-0046` matches neither `db.sqlite3` nor
`*.sqlite3`. **They are copied into the container image** by `COPY . .`
([Dockerfile:24](itcommand_backend/Dockerfile:24)).

---

## 11. Dependencies

### Frontend (`itcommand_frontend/package.json`)

- **40 runtime dependencies, 8 dev dependencies.**
- **Lockfile: committed** (`package-lock.json` present).
- Notes:
  - `next 14.2.35` / `eslint-config-next 14.2.35` — exact-pinned, on a maintained but
    two-majors-behind line.
  - `eslint ^8` — ESLint 8 reached end of standard support; 9.x is current. Dev-only.
  - `three ^0.171.0` with `@react-three/fiber ^8.18.0` and `@react-three/drei ^9.122.0` —
    fiber 8 is the React 18 line, consistent; fiber 9 exists for React 19.
  - `lucide-react ^1.8.0` — the published line for this package is `0.x`. Either this is
    a different package than assumed or a version that does not exist as expected;
    `UNKNOWN — could not determine from source` without lockfile inspection.
  - `radix-ui ^1.4.3` (the umbrella package) is installed **alongside** two individual
    `@radix-ui/react-*` packages — duplicate surface, one of the two patterns is redundant.
  - `shadcn ^4.3.1` is the CLI/scaffolding tool, declared as a **runtime** dependency
    rather than a dev dependency.
  - **`@tanstack/react-query ^5.99.2` is declared but never imported** — zero occurrences
    of `useQuery`/`useMutation` in `src/`. Dead weight in the bundle graph, and a strong
    hint that server-state management was intended and never adopted (see §12).
  - Nothing here is deprecated or unmaintained in an obvious way.

### Backend (`itcommand_backend/requirements.txt`)

- **13 direct requirements** (plus transitive deps, which are not enumerated because no
  lockfile exists).
- **No lockfile is committed** — no `requirements.lock`, no `pip freeze` output, no
  Poetry/uv/pipenv manifest. Every pin is `>=` with no upper bound, so two builds of the
  same commit can install different major versions of Django. This is the single biggest
  dependency-hygiene gap in the repo.
- `python-decouple` and `python-dotenv` are **both** present, doing overlapping jobs
  (see §10). `python-decouple` and `python-dotenv` are also unpinned entirely (no version
  specifier at all).
- Nothing is deprecated or EOL: Django 5.x, DRF 3.14+, simplejwt 5.3+, `cryptography`
  42+, `Pillow`, `whitenoise` 6.6+, `gunicorn` 21.2+, `psycopg2-binary` 2.9.9+ are all
  current lines.
- Per the audit brief, `npm audit` / `pip-audit` were not run.

---

## 12. Frontend

### Component organisation

Next.js App Router. A single authenticated route group `src/app/(app)/` holds 20 feature
directories (assets, vault, finance, helpdesk, subscriptions, network, seating, …) across
**66 `page.tsx` files**, plus a standalone `src/app/login/`. Shared chrome lives in
`src/components/` — `app-sidebar`, `top-bar`, `bottom-nav`, `footer-bar`,
`route-guard`, `error-boundary`, `split-screen-container`, `theme-provider` — with 25
shadcn/Radix primitives in `components/ui/` and five feature-specific folders
(`finance/`, `network/`, `seating/`, `vault/`, `reports/`, `extension/`).

Pages are large and self-contained: a typical feature page owns its own fetch calls,
local state, dialogs, table, and filters rather than composing from a shared
data-table/CRUD abstraction. That is why 66 pages need very few shared components.

### State management

Four `zustand` stores, each with a clear job:

| Store | Holds | Persistence |
|---|---|---|
| [authStore.ts](itcommand_frontend/src/store/authStore.ts) | user + permission map, `isAuthenticated`, `isLoading` | JWTs in `localStorage`; store itself is memory-only and rehydrates via `/auth/me` |
| [vaultStore.ts](itcommand_frontend/src/store/vaultStore.ts) | unlock token + expiry | `sessionStorage` (correctly narrower than the JWT's `localStorage` — the vault token dies with the tab) |
| [settingsStore.ts](itcommand_frontend/src/store/settingsStore.ts) | company name, default currency, fiscal year start | fetched from `/api/settings/` |
| [splitScreenStore.ts](itcommand_frontend/src/store/splitScreenStore.ts) | the two-pane layout state | memory |

Client-side permission gating mirrors the backend map in
[lib/permissions.ts](itcommand_frontend/src/lib/permissions.ts) — `can(user, module, action)`
fails closed when `permissions` is absent, and `moduleForPath` maps 18 route prefixes to
module keys for `route-guard.tsx`. The file's own comment correctly states the backend
remains the source of truth.

### Data fetching

Hand-rolled. One shared axios instance in [lib/api.ts](itcommand_frontend/src/lib/api.ts)
with:

- a **request interceptor** attaching `Authorization: Bearer …` and, when a live vault
  token exists, `X-Vault-Token` ([:92-108](itcommand_frontend/src/lib/api.ts:92));
- a **response interceptor** that mirrors the sliding vault-session expiry into
  `sessionStorage`, reconciling via `/vault/master/status/` when a protected vault call
  did not echo an expiry ([:20-121](itcommand_frontend/src/lib/api.ts:20)) — a genuinely
  thoughtful piece of work, including a single-flight guard and a swallowed reconciliation
  failure so it cannot turn a success into an error;
- a cross-pane change broadcast (`emitDataChange` / `use-data-sync`) so the other
  split-screen panel refreshes without a reload ([:117-121](itcommand_frontend/src/lib/api.ts:117)).

Consumption is `useEffect` + `useState` in **75 files**. There is no query cache, no
request deduplication, no stale-while-revalidate, no retry policy, and no shared
invalidation — `@tanstack/react-query` is installed but unused (§11). The
`emitDataChange` bus is the ad-hoc replacement for cache invalidation.

### Errors and loading states

- **Errors:** a class-based `ErrorBoundary` ([components/error-boundary.tsx](itcommand_frontend/src/components/error-boundary.tsx))
  catches render-time crashes and shows a fallback with a reset button; it also
  `console.error`s. Async/API errors are handled per-call-site, predominantly with
  `sonner` toasts. There is no central axios error handler that maps 401/403/5xx to a
  consistent user-facing message, so consistency depends on each of the 75 fetch sites.
  No error reporting/telemetry service is wired up.
- **Loading:** per-component `isLoading` booleans and skeletons. No Next.js `loading.tsx`
  suspense boundaries were found, so navigation-level loading is handled inside pages.

### Currency and date formatting

- **Currency is centralised, and well.** [lib/currency.ts](itcommand_frontend/src/lib/currency.ts)
  exposes `formatMoney(amount, currency?, {compact, decimals})`, a `useMoney()` hook bound
  to the settings store, and `useCurrencyCode()`. It uses `Intl.NumberFormat`, falls back
  to `CODE 1,234.56` on an invalid ISO code instead of throwing, and coerces
  non-finite input to 0. Records that carry their own currency (subscriptions, vendor
  contracts) pass it explicitly; everything else inherits the company setting. 12 files
  still call `toLocaleString`/`Intl.NumberFormat` inline — mostly chart axis
  formatters and counts — so the centralisation is ~90% complete.
- **Dates are scattered.** 28 files import `date-fns` directly or call
  `toLocaleDateString` inline. There is **no** `lib/date.ts` equivalent to
  `lib/currency.ts`: no shared format constants, no single place to change how a date
  renders, and no locale/timezone policy. Given the backend returns timezone-aware
  ISO strings, this is where display inconsistencies will accumulate.

---

## 13. Testing and CI

### What exists

- **Backend: 235 test functions across 14 files**, all Django `TestCase`. Roughly by area:
  subscriptions 789 lines + alerts 448 + renewals 327 + assignments 275 + bulk actions 244
  (the subscriptions module is by far the best-tested thing in the repo);
  `test_security_scoping.py` (321 lines, 5 tests) covering helpdesk/procurement
  self-service scoping, KB visibility, vault visibility + bulk-action scope reuse, and
  global-search scoping; `test_security_permissions.py` (166 lines, 8 tests) covering the
  role-JSON gate, ADMIN→SUPERADMIN escalation via both create and update, the
  last-superadmin and self-deactivation guards, admin password-reset boundaries, and
  notification ownership; plus `test_network_discovery.py`, `test_brex.py`,
  `test_fx.py`, `test_calendar_feed.py`, `test_lov.py`, `test_reports_subscriptions.py`,
  `test_protected_media.py` (68 lines — signed-URL validation), `test_automation.py`.
- `core/tests.py` is a 3-line stub.

### Modules with no tests

Assets, finance (every one of the 13 finance models — budgets, expenses, approvals,
bills, petty cash, income), helpdesk, licenses, KB, onboarding, seating, vendors,
procurement, users/departments CRUD, notifications generation, `reports.py` (all 24
endpoints, 1,675 lines), `search.py` beyond scoping, and the whole
`itcommand_frontend/` — **zero frontend tests, and no test framework installed** (no
Jest, no Vitest, no Playwright, no `test` script in `package.json`).

### CI

**None.** No `.github/` directory, no workflow files, no `.gitlab-ci.yml`, no Jenkinsfile,
no pre-commit config. Nothing runs the 235 tests automatically; `next lint` and
`manage.py test` are manual.

### Would tests catch a regression in auth or vault crypto?

**Auth — partially.** The privilege boundaries are genuinely covered:
`test_security_permissions.py` would fail if ADMIN→SUPERADMIN escalation reopened, if the
role-JSON gate stopped being enforced on safe methods, or if the last-superadmin guard
regressed. What is **not** covered: login itself (no test posts to `/api/auth/login/`),
throttling behaviour, token lifetime/rotation/blacklist, logout, password change, and the
undocumented `/api/token/` endpoint. A regression that, say, dropped the `is_active`
check at login or broke refresh-token blacklisting would ship silently.

**Vault crypto — no.** This is the sharpest gap in the test suite.
`test_security_scoping.py::VaultVisibilityTests` covers *visibility* (who can list and
bulk-act on what), and it is good. But there is **no test anywhere** that:

- round-trips `encrypt_value`/`decrypt_value`;
- round-trips `seal_for_public_key`/`open_with_private_key`;
- verifies `encrypt_private_key`/`decrypt_private_key` or that a wrong personal password
  raises;
- verifies `reveal`, `reveal_extras`, or `reveal_shared` return the right plaintext;
- verifies `reseal_shares` keeps shares readable after an owner edit — the highest-risk
  code path in the vault, since a silent failure there leaves recipients with a stale
  secret and no error;
- verifies the master-password unlock/session/slide/revoke lifecycle;
- verifies that a non-recipient gets 404 from `reveal_shared`.

Swapping the cipher, changing the KDF iteration count, breaking the JSON envelope shape,
or silently degrading `reseal_shares` to a no-op would all pass the suite. The broad
`except (InvalidToken, ValueError, Exception)` at
[views/vault.py:575](itcommand_backend/core/views/vault.py:575) makes such a failure
present as a generic 500 rather than a crash, further reducing the chance of noticing.

---

## 14. Findings

| # | Severity | Area | Finding | Evidence | Fix sketch |
|---|----------|------|---------|----------|------------|
| 1 | **Critical** | Secrets / data exposure | Five SQLite database snapshots are tracked in git. `.gitignore` covers `*.sqlite3` but not the `.bak-pre-NNNN` suffix, so full application databases — user rows and password hashes, vault ciphertext and per-user wrapped RSA keys, audit log, finance and ticket data — are in every clone and in the container image (`COPY . .` doesn't exclude them either). | `git ls-files` → `itcommand_backend/db.sqlite3.bak-pre-{0046,0049,0050,0051,0053}`; [.gitignore:29](.gitignore:29); [Dockerfile:24](itcommand_backend/Dockerfile:24); [.dockerignore](itcommand_backend/.dockerignore) | Treat as a disclosure: rotate `SECRET_KEY`, `VAULT_ENCRYPTION_KEY`, `DB_PASSWORD`, every vault credential and integration key, and force password resets. Purge from history (`git filter-repo`), force-push, invalidate old clones. Add `db.sqlite3*` and `*.bak*` to both ignore files, and a pre-commit hook that rejects files with a SQLite magic header. |
| 2 | **Critical** | Vault crypto | "End-to-end" private credentials are not end-to-end. `encrypted_password` (org Fernet key) is retained for every credential regardless of `visibility`, and the share payload is rebuilt by decrypting it in server memory on every share and every owner edit. DB + `VAULT_ENCRYPTION_KEY` therefore yields plaintext for 100% of the vault, contradicting the documented guarantee. | [vault_crypto.py:16-17](itcommand_backend/core/vault_crypto.py:16) (the claim); [views/vault.py:231-243](itcommand_backend/core/views/vault.py:231) `build_secret_payload`; [:483](itcommand_backend/core/views/vault.py:483), [:246-260](itcommand_backend/core/views/vault.py:246) `reseal_shares`; [serializers/vault.py:107](itcommand_backend/core/serializers/vault.py:107) | Either (a) correct the documentation and stop claiming E2E, or (b) make it true: encrypt in the browser under a per-user key, never send plaintext to the server, drop `encrypted_password` for `PRIVATE` rows, and re-seal client-side (which means the owner's browser must hold the payload to re-share — accept that UX cost deliberately). Interim: move the org key behind a KMS so DB access alone is insufficient. |
| 3 | **High** | Uploads / XSS | Uploaded files have no type, extension, or magic-byte validation and are served from the application's own origin with `Content-Type` guessed from the attacker-chosen extension, with no `Content-Disposition: attachment` on the X-Accel path and no CSP anywhere. An uploaded `.html` executes as script in the app origin, where it can read the JWT out of `localStorage`. | No validator on any of 5 upload paths — [views/helpdesk.py:283-289](itcommand_backend/core/views/helpdesk.py:283), [views/procurement.py:424](itcommand_backend/core/views/procurement.py:424), [views/finance.py:294](itcommand_backend/core/views/finance.py:294); `mimetypes.guess_type` at [views/media.py:39](itcommand_backend/core/views/media.py:39); headers at [:41-55](itcommand_backend/core/views/media.py:41); token in `localStorage` at [store/authStore.ts:38](itcommand_frontend/src/store/authStore.ts:38) | Allowlist extensions and verify magic bytes per model; force `Content-Disposition: attachment` and a fixed safe `Content-Type` for non-image downloads; add a `Content-Security-Policy` (and ideally serve media from a separate origin/subdomain); move the JWT to an `HttpOnly` cookie or at least accept the residual risk explicitly. |
| 4 | **High** | Audit logging | The vault is effectively unaudited. `VaultCredentialViewSet` overrides `perform_create`/`perform_update` without calling `log_action`, so creating or changing a password logs nothing; no reveal path writes an `AuditLog` row (only overwritable counters on the row); share/unshare, master-password rotation, unlock, failed unlock, and personal-key reset all log nothing. `DELETE` via `perform_destroy` is the only audited vault action, and `bulk_action`'s `qs.delete()` bypasses even that. | [views/vault.py:437-443](itcommand_backend/core/views/vault.py:437) vs [mixins.py:27-38](itcommand_backend/core/mixins.py:27); [:591-605](itcommand_backend/core/views/vault.py:591); [:678](itcommand_backend/core/views/vault.py:678); [:97](itcommand_backend/core/views/vault.py:97); contrast [views/licenses.py:218](itcommand_backend/core/views/licenses.py:218) | Call `self.log_action(...)` in the overridden hooks; add explicit audit rows for every reveal (with credential id, not the secret), share/unshare, unlock success **and** failure, master-password rotation, and personal-key reset; route bulk deletes through a logged path. |
| 5 | **High** | Rate limiting | Throttle counters live in Django's default per-process `LocMemCache` (no `CACHES` configured) while Gunicorn runs 3 workers, so `login` 10/min is really ~30/min and resets on every restart. There is no `DEFAULT_THROTTLE_CLASSES`, so only 4 views are throttled at all — and `/api/token/`, a second fully-functional login endpoint, has no throttle. Combined with no account lockout and no MFA, online password guessing is largely unimpeded. | no `CACHES` in [settings.py](itcommand_backend/itcommand_backend/settings.py); rates at [:210-214](itcommand_backend/itcommand_backend/settings.py:210); [entrypoint.sh:14](itcommand_backend/entrypoint.sh:14); [itcommand_backend/urls.py:17](itcommand_backend/itcommand_backend/urls.py:17) | Add a shared cache (Redis) and point `DEFAULT_THROTTLE_CLASSES`/rates at it; either remove `/api/token/` or give it the `login` scope; add failed-attempt tracking with lockout/backoff keyed on account *and* IP; put MFA on the roadmap for SUPERADMIN and vault users at minimum. |
| 6 | **High** | Session management | Changing a password does not invalidate sessions. `ChangePasswordView` and the admin `reset_password` call `set_password`+`save` and nothing else, so all outstanding access tokens (≤60 min) and refresh tokens (≤7 days) keep working, as do vault unlock sessions. The one action a user takes after suspecting compromise does not end the attacker's session. | [views/users.py:259-268](itcommand_backend/core/views/users.py:259); [:240-243](itcommand_backend/core/views/users.py:240); no session teardown; access tokens are unrevocable by design ([settings.py:218-224](itcommand_backend/itcommand_backend/settings.py:218)) | On password change/reset: blacklist all `OutstandingToken`s for the user, revoke their `VaultUnlockSession` rows, and add a `password_changed_at` claim check (or a per-user token version) so surviving access tokens are rejected. |
| 7 | **High** | Access control | Signed media URLs authorise a *path*, not a *caller*. `/api/media/<path>?token=…` is `AllowAny` and the HMAC covers only the file path with a 1-hour TTL, so any leaked, forwarded, proxy-logged, or `Referer`-exposed URL grants anonymous read access to bill scans, contracts, and ticket attachments for the remainder of the window. | [views/media.py:18-36](itcommand_backend/core/views/media.py:18); [storage.py:15-22](itcommand_backend/core/storage.py:15); `Cache-Control: private` only at [:54](itcommand_backend/core/views/media.py:54) | Bind the signature to the requesting user (include `user_id` in the payload and compare to `request.user`), require authentication on the endpoint, and shorten the TTL to minutes. Keep the existing path-signature check as defence in depth. |
| 8 | Medium | Configuration | Every security-hardening setting defaults to the insecure value: `DEBUG=True`, `SECRET_KEY` has a known placeholder default, and `SECURE_SSL_REDIRECT`/`SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE`/`SECURE_HSTS_SECONDS` are off/0. An omitted variable yields a silently insecure production deploy rather than a startup failure. Separately, an unset `DB_NAME` silently switches the app to SQLite. | [settings.py:21](itcommand_backend/itcommand_backend/settings.py:21), [:24](itcommand_backend/itcommand_backend/settings.py:24), [:100-117](itcommand_backend/itcommand_backend/settings.py:100), [:187-194](itcommand_backend/itcommand_backend/settings.py:187) | Default `DEBUG=False`; make `SECRET_KEY` and `DB_NAME` required (raise like `VAULT_ENCRYPTION_KEY` does); default the `SECURE_*` flags to `not DEBUG`; add a `manage.py check --deploy` gate to the entrypoint. |
| 9 | Medium | Vault design | The vault gate is one shared org-wide master password that every vault user types, and it participates in no key derivation — it is purely an access flag. Rotating it re-encrypts nothing, and a departing employee who knew it forces an out-of-band announcement to everyone. Meanwhile account passwords need only 8 characters with no complexity rules while vault passwords need 12 with four classes. | [models/vault.py:13-39](itcommand_backend/core/models/vault.py:13) (singleton pk=1); [views/vault.py:159-180](itcommand_backend/core/views/vault.py:159); [:38-54](itcommand_backend/core/views/vault.py:38) vs [settings.py:123-136](itcommand_backend/itcommand_backend/settings.py:123) | Replace the shared master password with a per-user vault unlock derived from the user's own personal password (which already exists as `VaultUserKey.password_hash`), and raise `MinimumLengthValidator` for account passwords to match the vault's bar. |
| 10 | Medium | Vault crypto | The E2E reveal path sends the recipient's personal vault password to the server in the request body on every single reveal, and the server reconstructs the RSA private key in memory. The one secret that is supposed to never reach the server crosses it routinely, so a compromised process can harvest personal passwords and unwrap private keys at will. | [views/vault.py:567-574](itcommand_backend/core/views/vault.py:567); design intent at [vault_crypto.py:11-17](itcommand_backend/core/vault_crypto.py:11) | Move private-key unwrapping and envelope opening into the browser (WebCrypto): ship `encrypted_private_key` + `kdf_salt` + `sealed_secret` to the client and derive/decrypt there. If that is out of scope, document that the E2E property does not hold against the server and drop the claim. |
| 11 | Medium | Reliability / performance | `NotificationViewSet.get_queryset` **writes rows on GET**: it scans assets, recurring bills, budgets (with a per-budget aggregate query in a loop), and overdue tickets, running an existence check and insert per candidate. Every notification poll from every user does this. GET is non-idempotent, the work is O(records) per request, and concurrent polls can double-insert. | [notifications.py:22-105](itcommand_backend/core/notifications.py:22), loop with per-iteration `Notification.objects.filter(...).exists()` and per-budget `aggregate` at [:76-82](itcommand_backend/core/notifications.py:76) | Move generation into the existing `run_automation` container as a scheduled command; make the endpoint a pure read. The `?generate=false` escape hatch already exists — invert the default and then delete the generator from the request path. |
| 12 | Medium | Error handling | Crypto and integration failures are swallowed by broad `except Exception`, so a rotated/corrupt key, a malformed envelope, or a `reseal_shares` regression presents as a generic 500 or an empty string rather than a diagnosable error. `except (InvalidToken, ValueError, Exception)` is also redundant in a way that suggests the intent was narrower. | [views/vault.py:575-577](itcommand_backend/core/views/vault.py:575), [:603-605](itcommand_backend/core/views/vault.py:603), [:619-621](itcommand_backend/core/views/vault.py:619); [models/integrations.py:135-141](itcommand_backend/core/models/integrations.py:135) | Catch specific exceptions, log with context (credential id, key version, exception type) before returning the generic message to the client, and add a key-version prefix to ciphertext so a rotation mismatch is distinguishable from corruption. |
| 13 | Medium | Offboarding | Deactivating a user leaves every `VaultShare` sealed to them, plus their `VaultUserKey`, in the database indefinitely, and does not revoke their `VaultUnlockSession` rows. Access is cut today (simplejwt rejects inactive users) but reactivation — or a DB restore — silently restores plaintext access to every credential ever shared with them. Owners are never told, and `shares` lists the deactivated recipient with no status flag. | [views/users.py:185-188](itcommand_backend/core/views/users.py:185) (soft delete); `VaultShare.recipient` CASCADE never fires ([models/vault.py:268](itcommand_backend/core/models/vault.py:268)); [views/vault.py:538-543](itcommand_backend/core/views/vault.py:538) | On deactivation: revoke unlock sessions, delete the user's `VaultShare` rows (or mark them revoked), and surface a "shared with N deactivated users — rotate these credentials" warning to owners. |
| 14 | Medium | Data model | `User.role` references `Role.slug` as a plain string with no foreign key. A role rename, a direct DB write, or a fixture load orphans every user on that slug — and because `has_role_permission` fails closed, the result is a silent, total loss of access rather than an error. The model's own `ROLE_CHOICES` lists 4 roles while 7 are seeded, and the serializer deliberately bypasses that validation. | [models/users.py:64](itcommand_backend/core/models/users.py:64) vs [models/roles.py:16](itcommand_backend/core/models/roles.py:16); [permissions.py:16-18](itcommand_backend/core/permissions.py:16); [models/users.py:54-59](itcommand_backend/core/models/users.py:54) vs [rbac.py:113-121](itcommand_backend/core/rbac.py:113); [serializers/users.py:45-46](itcommand_backend/core/serializers/users.py:45) | Add a real FK (`User.role_ref → Role`, `on_delete=PROTECT`), migrate the string values across, keep the slug as a denormalised read column if convenient, and delete the stale `ROLE_CHOICES`. |
| 15 | Medium | Indexing | High-traffic filter/order columns are unindexed on tables that only grow: `AuditLog.timestamp` (default `-timestamp` ordering plus three exposed filters), `Notification(user, is_read, created_at)` (polled constantly), `VaultCredential(visibility, created_by, is_favorite, created_at)` (the scoping predicate on every vault list), `Ticket(status, priority, due_date)`, `Expense(status, financial_year, category)`. | [views/system.py:453-472](itcommand_backend/core/views/system.py:453); [notifications.py:28-33](itcommand_backend/core/notifications.py:28); [views/vault.py:390](itcommand_backend/core/views/vault.py:390), [:408](itcommand_backend/core/views/vault.py:408); [views/helpdesk.py:105-138](itcommand_backend/core/views/helpdesk.py:105) | Add composite `Meta.indexes` matching the actual predicates — the pattern already used well on `Subscription` and `Asset` (migrations `0044`, `0019`). Add a retention/partitioning plan for `AuditLog`. |
| 16 | Medium | Auditability | `AuditLog` rows can be updated or deleted by the application role. The API is read-only and the model is not in the Django admin, but there is no append-only constraint, no trigger, no separate restricted DB role, no integrity chaining, and no off-box shipping — the app connects as the same user that runs migrations. The logged IP is also taken from `X-Forwarded-For[0]`, which is client-controlled and therefore spoofable. | [models/system.py:127-137](itcommand_backend/core/models/system.py:127); [views/system.py:453-456](itcommand_backend/core/views/system.py:453); [docker-compose.yml:19-20](docker-compose.yml:19); [mixins.py:6-12](itcommand_backend/core/mixins.py:6) | Grant the app role `INSERT`+`SELECT` only on `core_auditlog` (via a migration `GRANT`/`REVOKE` or a `BEFORE UPDATE OR DELETE` trigger), ship logs to an external sink, and derive the client IP from a trusted-proxy count rather than index 0. |
| 17 | Medium | Testing / CI | There is no CI at all, and no test would catch a vault-crypto regression: nothing round-trips `encrypt_value`/`decrypt_value` or the RSA envelope, nothing exercises `reveal`/`reveal_shared`, and nothing verifies `reseal_shares` keeps shares readable after an owner edit — the highest-risk path in the vault, whose failure is masked by finding #12. Auth boundary tests are good; login, throttling, and token lifecycle are untested. The entire frontend has no test framework installed. | no `.github/`, no workflow files; 235 tests across [core/test_*.py](itcommand_backend/core) with no crypto round-trip; no `test` script in [package.json](itcommand_frontend/package.json) | Add a CI workflow running `manage.py test` + `next lint` on every push. Add crypto round-trip tests (encrypt/decrypt, seal/open, wrong-password rejection, `reseal_shares` before/after) and reveal-path tests including the non-recipient 404. |
| 18 | Medium | Dependencies | No backend lockfile, and every `requirements.txt` pin is an unbounded `>=` (two entries have no specifier at all). Two builds of the same commit can install different Django majors. `python-decouple` and `python-dotenv` both ship, doing overlapping config work through two different code paths that read two different `.env` locations. | [requirements.txt](itcommand_backend/requirements.txt); [settings.py:9](itcommand_backend/itcommand_backend/settings.py:9) vs [encryption.py:6-11](itcommand_backend/core/encryption.py:6) | Generate and commit a lockfile (`pip-compile`/`uv lock`) and pin with `==`/`~=`. Pick one config library — `decouple` is already used everywhere else — and read `VAULT_ENCRYPTION_KEY` through `settings.py` like every other secret. |
| 19 | Low | Data consistency | Money is computed in Python floats on the vault/workspace cost path even though it is stored as `Decimal`, so the values returned by the API can drift from the stored figures. | [models/vault.py:136-146](itcommand_backend/core/models/vault.py:136); [views/vault.py:843-848](itcommand_backend/core/views/vault.py:843) | Keep it in `Decimal` end to end (`Decimal('12') * monthly_cost`, `Sum()` aggregates instead of a Python loop) and quantise once at the serialisation boundary. |
| 20 | Low | Data consistency | `bulk_action`'s `share_on`/`share_off` flip `VaultCredential.is_shared` without creating or removing any `VaultShare` row, so the flag can claim a credential is shared when nothing is sealed to anyone — and `share_off` leaves live shares intact while advertising the opposite. | [views/vault.py:683-686](itcommand_backend/core/views/vault.py:683) vs [:505-511](itcommand_backend/core/views/vault.py:505), [:525-528](itcommand_backend/core/views/vault.py:525) | Drop the two bulk ops (sharing needs recipients, so it can't be a bulk toggle) or make `share_off` delete the underlying shares. Better: derive `is_shared` from `shares.exists()` instead of storing it. |
| 21 | Low | Information disclosure | Any authenticated user, including the most restricted role, can read every role's full permission matrix via `GET /api/roles/` — `ReadOnlyViewerOrHigher` returns `True` unconditionally for safe methods. Useful reconnaissance for choosing a target account. | [permissions.py:33-39](itcommand_backend/core/permissions.py:33); [views/roles.py:21](itcommand_backend/core/views/roles.py:21) | Return name/slug/label only to callers without `settings.view`, and reserve the `permissions` map for admins. |
| 22 | Low | Account provisioning | Admin-generated temporary passwords are returned in the HTTP response body on user creation and password reset, and no `must_change_password` flag forces rotation at first login — so a temp password can live indefinitely and lands in any proxy log or browser cache that captures response bodies. | [views/users.py:161-165](itcommand_backend/core/views/users.py:161), [:240-243](itcommand_backend/core/views/users.py:240) | Email the temp password (or a one-time set-password link) instead of returning it, add a `must_change_password` field enforced by middleware, and expire it after N days. |
| 23 | Low | Frontend consistency | `@tanstack/react-query` is a declared dependency with zero usage; data fetching is 75 files of hand-rolled `useEffect` with an ad-hoc `emitDataChange` event bus standing in for cache invalidation. Date formatting is likewise scattered across 28 files with no `lib/date.ts`, unlike the well-centralised `lib/currency.ts`. | [package.json](itcommand_frontend/package.json) vs zero `useQuery` matches in `src/`; [lib/api.ts:117-121](itcommand_frontend/src/lib/api.ts:117); [lib/currency.ts](itcommand_frontend/src/lib/currency.ts) as the counter-example | Either adopt react-query (and delete the event bus) or remove the dependency. Add a `lib/date.ts` mirroring `lib/currency.ts` and migrate the 28 call sites. |
| 24 | Low | Defence in depth | `HasModulePermission` returns `True` when a view has no `rbac_module` — the RBAC layer is opt-in and fails **open**. Every current view sets it, so nothing is broken today, but adding a viewset and forgetting one attribute silently exposes it to every authenticated user, and no test or lint catches that. | [permissions.py:97-99](itcommand_backend/core/permissions.py:97) | Fail closed: raise (or deny) when `rbac_module` is missing, and add a test that walks the URLconf asserting every DRF view either declares `rbac_module` or appears on an explicit allowlist. |

---

## 15. Open questions

Things I could not determine from source, and what would resolve each:

1. **Are the tracked `db.sqlite3.bak-pre-*` files real data or fixtures?** I deliberately
   did not open them, so I cannot confirm what they contain. Severity of finding #1 hinges
   on this. *Need:* the author's confirmation of provenance, or a row-count/table check
   run by someone authorised to look.
2. **Is `SECRET_KEY` actually set in every deployed environment, or is the insecure default
   in use anywhere?** *Need:* the deployed environment's variable set (names + set/unset
   status only), or a `manage.py check --deploy` output from production.
3. **Has `VAULT_ENCRYPTION_KEY` ever been rotated, and does any ciphertext in the live DB
   predate a rotation?** Ciphertext carries no key version, and `Integration.get_api_key`
   swallows decryption failure, so a partial rotation would be invisible. *Need:* a
   count of rows where `decrypt_value` raises, run in a maintenance window.
4. **Which `PROTECTED_MEDIA_USE_X_ACCEL` branch runs in production?** It defaults to
   `not DEBUG`, and the two branches set different response headers (finding #3 is worse
   on the X-Accel branch, which omits `Content-Disposition`). *Need:* the production
   value, or a `curl -I` against a real signed media URL.
5. **`lucide-react ^1.8.0`** — is this the intended package/version? The published line is
   `0.x`. *Need:* the resolved entry from `package-lock.json` (lockfile internals were
   out of scope here).
6. **Do `PurchaseRequestViewSet.manage_items` / `manage_documents` bind nested item and
   document IDs to the parent PR on update and delete?** The parent is scoped correctly
   via `get_object()`, and the create path passes `pr=pr`, but the PUT/DELETE branches are
   inside a 553-line module I read only in part. *Need:* a close read of
   [views/procurement.py:415-470](itcommand_backend/core/views/procurement.py:415), or a
   test that tries to mutate another PR's item by ID.
7. **Is `/admin/` intended to be publicly reachable in production?** nginx proxies it
   unconditionally, and any `is_staff` account there can edit `VaultCredential` and
   `Integration` rows directly, bypassing the vault unlock gate and every audit hook.
   *Need:* the intended access policy, plus a count of accounts with `is_staff=True`.
8. **Is there any deployment automation, backup, or monitoring outside this repo?** There
   is no CI, no backup script, and no healthcheck beyond the compose socket probes.
   `DEPLOYMENT.md` (17 KB) documents a manual procedure. *Need:* to know whether an
   external pipeline, cron, or monitoring stack exists that the repo doesn't show.
9. **What is the intended threat model for the vault?** Findings #2 and #10 are only
   defects relative to the guarantee the docstring makes. If the real requirement is
   "protect against other application users and casual DB access", the current design
   largely meets it and the fix is documentation. *Need:* an explicit statement of what
   the vault is meant to protect against.
10. **Is the browser extension's host list intentional?** `manifest.json` pins three
    hardcoded dev hosts including a private LAN IP, requests `<all_urls>` content-script
    injection, and stores the JWT plus vault session in `chrome.storage.local`.
    *Need:* whether this is shipped to users or dev-only, and the intended production
    host permissions.
