# IT Command — Subscriptions → "Digital Estate" rebuild

> **How to use this file**
> 1. Copy `Digital_Estate_v2_dc.html` and `support.js` into `docs/reference/` in the repo
> 2. Save this file at the repo root as `SUBSCRIPTIONS-REBUILD.md`
> 3. `git checkout -b feature/digital-estate`
> 4. Run `claude` and paste:
>    `Read SUBSCRIPTIONS-REBUILD.md and start with Phase 0. Do not write code until I approve the Phase 0 report.`

---

## What we are building

The existing Software & Subscriptions module tracks **cost**. It answers "what do we
pay for?" It cannot answer:

- Which of our domains/apps has an incomplete infrastructure stack?
- What are we paying for that isn't attached to anything we own?
- Which provider account holds this service, who owns that account, and does it have MFA?
- What renews in the next 30 days that does **not** have auto-renew on?

This rebuild reframes subscriptions as a **digital estate**: a graph of
`Property → Service → Provider Account → Provider`, layered by infrastructure role.

`docs/reference/Digital_Estate_v2_dc.html` is a standalone mockup of the target
information architecture. **Read it for concepts and layout only.** Its dark palette,
inline styles, and `x-dc` component system are NOT to be copied — this module must be
indistinguishable from the rest of IT Command.

---

## Hard constraints

1. **Extend, do not replace.** `Subscription`, `SubscriptionAssignment`,
   `SubscriptionRenewal`, `SubscriptionSettings`, `SubscriptionCategoryBudget` and
   `SubscriptionAlertLog` keep working. Every existing row stays valid and visible.
   No parallel "digital estate" module sitting beside the old one.
2. **Additive migrations only.** New models and nullable fields. No drops, no renames,
   no data-destructive operations. Show me every migration before running it.
3. **Existing UI stays.** The Overview / Licenses / Subscriptions tab structure remains.
   This work adds tabs and enriches the Subscriptions tab.
4. **Styling comes from the codebase**, not from the reference file: Tailwind +
   shadcn/ui primitives in `src/components/ui/`, existing card/table/badge patterns,
   light theme, existing sidebar and top-bar. Match the current
   Software & Subscriptions page.
5. **Currency goes through `lib/currency.ts`.** No inline formatting anywhere.
6. **Every new DRF view sets `rbac_module`.** No exceptions — the permission class
   currently fails open when it is missing.
7. **Every new mutating view calls `self.log_action(...)`** via `AuditLogMixin`.
8. **No new dependency** without asking me first.

---

## Phase 0 — Read and report. Write no code.

Before proposing anything, read and summarise:

- `core/models/subscriptions.py`, `core/views/subscriptions.py` (1,267 lines),
  `core/serializers/` subscription modules
- `core/models/vault.py` — specifically `AccountWorkspace`
- `core/models/finance.py` — `Expense`, `Budget`, `BudgetCategory`, `RecurringBill`,
  `FinancialYear`
- `core/models/vendors.py` — `Vendor`, `VendorContract`
- `core/models/integrations.py` — `Integration`, `ExchangeRate`
- `core/fx.py`, `core/subscription_alerts.py`, `core/rbac.py`
- `itcommand_frontend/src/app/(app)/` — the software/subscriptions route group
- `docs/reference/Digital_Estate_v2_dc.html`

Then produce a written report covering:

1. **Model deltas** — what the Digital Estate concept needs that we don't have, and for
   each: extend an existing model or add a new one? Justify each choice.
2. **`AccountWorkspace` decision.** It already holds `login_email`, `monthly_cost`,
   `renewal_date`, `billing_cycle`, `seats` and links to vault credentials — which
   overlaps the "provider account" concept substantially. Recommend one:
   (a) reuse it directly, (b) add a new `ProviderAccount` and relate the two,
   (c) something else. Give the trade-off, don't just pick.
3. **How `Subscription` currently reaches Finance**, if at all. Is there an existing
   `Expense` link, or is subscription spend invisible to the budget?
4. **How the FX path works today**, and exactly why the Subscriptions page shows
   `PKR 1,200 / year` as "total across all currencies" while excluding a USD 500/mo
   subscription. File and line.
5. **Migration plan** — ordered list, each one reversible.
6. **Risks** — anything in the 1,267-line viewset that will fight this change.

Stop there and wait for my approval.

---

## Phase 1 — Data model

### New models

```
Provider                  Catalog of service providers. Seeded, admin-editable.
  name, slug, brand_color, console_url, logo_initial, is_active
  → optional FK to Vendor (a provider may already exist as a Vendor)

ProviderAccount           A login at a provider. (Pending the Phase 0 decision above.)
  FK provider, login_email, auth_method, mfa_method, FK owner→User,
  FK vault_credential→VaultCredential (nullable), notes, is_active
  auth_method: PASSWORD | SSO | API_KEY | IAM | OTHER
  mfa_method:  APP | KEY | SMS | NONE | UNKNOWN

DigitalProperty           Something we own: a domain, app, or site.
  name (unique), kind, FK owner→User, FK department, notes, is_active
  kind: MOBILE_GAME | APP | MARKETING | CORPORATE | STUDIO | INFRA | PARKED | OTHER
```

### Extend `Subscription` — all nullable, all additive

```
FK provider_account   → ProviderAccount   (null=True, blank=True)
FK digital_property   → DigitalProperty   (null=True, blank=True)   # null == orphan
service_layer         CharField(choices=SERVICE_LAYERS, null=True, blank=True)
identifier            CharField(255, blank=True)   # "zone: tapquest.gg", "ecs-prod · ap-south-1"
auto_renew            BooleanField(default=True)
console_url           URLField(blank=True)
```

`SERVICE_LAYERS`, in stack order:
`REGISTRAR, DNS, HOSTING, MAIL, CDN, TLS, ANALYTICS, STORAGE, MONITORING, OTHER`

Put the ordering in one place (`core/estate.py`) — the frontend must not hardcode it.

### Derived properties on `Subscription`

- `is_orphan` → `digital_property_id is None`
- `is_at_risk` → `not auto_renew and renewal within 30 days`
- `monthly_equivalent` → normalise by `billing_cycle`, **`Decimal` throughout**

⚠️ Do not repeat the float bug from `AccountWorkspace.annual_cost`. Money stays
`Decimal` end to end and is quantised once at serialisation.

### Indexes — add in the same migration

```
Subscription:     (digital_property, service_layer)
                  (provider_account, status)
                  (auto_renew, renewal_date)
                  (status, renewal_date)
DigitalProperty:  (is_active, kind)
ProviderAccount:  (provider, is_active)
```

### Seeding

A `manage.py seed_estate` command that is **idempotent** (`get_or_create`) and creates
the provider catalog only — AWS, Cloudflare, Google, Namecheap, GoDaddy, Hostinger,
DigitalOcean, Vercel, Firebase, Sentry. No fake accounts, properties, or services.

---

## Phase 2 — Backend API

New viewsets, each with `rbac_module = 'subscriptions'` and `AuditLogMixin`:

```
GET/POST/PATCH/DELETE  /api/estate/providers/
GET/POST/PATCH/DELETE  /api/estate/accounts/
GET/POST/PATCH/DELETE  /api/estate/properties/
```

Read-only aggregation endpoints:

```
GET /api/estate/overview/
    kpis, spend by provider, spend by layer, renewal timeline (next 90d),
    orphan count, at-risk count, stack-gap count

GET /api/estate/properties/<pk>/stack/
    the 7+ layers for this property, each either the bound Subscription or a gap marker

GET /api/estate/gaps/
    every property with a missing layer, plus every orphaned subscription
```

### Rules

- All money aggregation in `Decimal`, via ORM `Sum()` — not a Python loop.
- **Fix the FX truncation.** When a currency has no rate, the response must still
  return the converted subset **and** an explicit `unconverted` block listing the
  excluded currencies and amounts. The frontend must be able to render
  "PKR 1,200 + USD 500 (unconverted)" rather than silently dropping the larger figure.
  A total that omits an item must never be labelled "total across all currencies".
- Bulk endpoints must not use `qs.delete()` — route through an audited path.
- Never serialise a vault credential's secret. `provider_account.vault_credential`
  exposes id and name only; revealing stays on the existing vault reveal endpoints
  with their own unlock gate.

### Tests — required, not optional

- `monthly_equivalent` for every billing cycle, asserting `Decimal` not `float`
- orphan and at-risk detection at the boundary conditions
- stack-gap computation for a property with 0, some, and all layers
- FX aggregation with a missing rate — asserts the `unconverted` block is populated
- permission tests: a role without `subscriptions.view` gets 403 on every new endpoint

---

## Phase 3 — Frontend

Extend the existing Software & Subscriptions page. Tabs become:

`Overview · Licenses · Subscriptions · Estate · Accounts`

### Estate tab

1. **KPI row** — Monthly spend · Properties · Services · Stack gaps · Orphans · At risk.
   Colour by severity using the existing badge variants: gaps amber, orphans amber,
   at-risk red, zero states neutral. Do not render a red zero.
2. **Property cards.** One per property: name, kind badge, owner, monthly cost, and a
   **layer strip** — one chip per layer, filled when present and outlined when a gap.
   This is the centrepiece; give it the visual weight.
3. **Renewal timeline**, next 90 days. The reference file's lane-packing algorithm is
   at `Digital_Estate_v2_dc.html` in the `timeline` computation — read it, then
   reimplement in React. Colour by urgency: <7d red, <30d amber, else muted.
4. **Filters** — layer, provider, property, "at risk only", "no auto-renew only".
   Reuse the existing filter-bar component from the Subscriptions tab.
5. **Gaps panel** — properties missing layers, and orphaned services, each row linking
   to the fix.

### Accounts tab

Table of provider accounts: provider chip, login email, auth method, **MFA badge**,
owner, service count, linked vault credential, console link.

⚠️ MFA badge colouring: `NONE` red, `SMS` amber, `APP`/`KEY` green, `UNKNOWN` muted.
An account with no MFA holding production infrastructure is the single most useful
thing this tab surfaces — make it impossible to miss.

### Property detail

Route `/software/estate/[property]`. Layer-by-layer stack with the bound service,
provider, account, cost, renewal, and auto-renew state per layer. Gaps rendered as
explicit empty slots with an "attach service" action — not omitted.

### Add-service flow

The reference uses a 5-step wizard. Match the **existing** IT Command dialog pattern
instead — if the codebase uses a single-form dialog elsewhere, use that. Consistency
with the app beats fidelity to the mockup. Fields: property, layer, provider account,
identifier, cost + currency + cycle, renewal date, auto-renew, console URL.

### Frontend rules

- Currency via `lib/currency.ts` only.
- Create `lib/date.ts` mirroring `lib/currency.ts` and use it here. Do not add a 29th
  file with inline date formatting.
- Follow the data-fetching pattern already used in this route group. Do not introduce
  react-query for this feature alone — that is a separate decision.
- Loading skeletons and empty states for every panel. An empty state gets one line of
  copy and an action, never a bare `0`.

---

## Phase 4 — Settings and integrations

Everything configurable goes into **Master Settings**, as one-time setup. Nothing
configurable lives on the Estate page itself.

Add a **Master Settings → Digital Estate** section:

- **Providers** — CRUD the catalog, brand colour, console URL
- **Layers** — enable/disable which layers this org tracks, and their order
- **Alert thresholds** — renewal warning windows (default 30/7 days), alert on
  auto-renew off, alert on new orphan
- **Property kinds** — manage via the existing `ListOfValues` mechanism rather than a
  hardcoded enum, if `lov.py` supports it cleanly

Add to **Master Settings → Integrations** (existing `Integration` model, one-time config):

- **Exchange rates** — this is where the FX gap gets fixed. Surface which currencies are
  in use with no rate, and let the admin set one. The Subscriptions page currently tells
  the user to go to Settings → Integrations for this; make that path actually work.
- Provider API keys for future auto-discovery (AWS, Cloudflare) — store the field and
  the encrypted key via the existing `Integration.encrypted_api_key` path. **Do not build
  the sync itself in this phase.** Config only.

⚠️ Any new secret uses the existing `encrypt_value` path. Never a plain `CharField`.

---

## Phase 5 — Finance linkage

This is why the module earns its place. Wire subscriptions into the money system:

1. **`Subscription` → `BudgetCategory`** — nullable FK, so subscription spend rolls into
   the existing budget view instead of living in a silo.
   
2. **`Subscription` → `Vendor`** — nullable FK. If a provider is already a `Vendor`,
   link them so vendor spend reflects subscription cost.
3. **Renewal → `RecurringBill`.** Propose the design before building: should an active
   subscription with a renewal date generate or update a `RecurringBill`, or should the
   two stay independent with a soft link? Recommend one, with the trade-off. Do not
   auto-create financial records without my approval.
4. **Expense attribution** — when a renewal is recorded, can it create an `Expense`
   against the linked `BudgetCategory` and `FinancialYear`? Design first, build second.
5. Extend the **Cost Overview** page to include subscription spend by property and by
   layer, using the same `Decimal` aggregation.

⚠️ Anything that writes to a finance table is high-blast-radius. Propose, get approval,
then build — and every such write goes through `AuditLogMixin`.

---

## Out of scope

Do not build: provider API auto-discovery/sync, DNS or WHOIS lookups, certificate
expiry scanning, or anything that makes an outbound network call. Configuration
surface only.

---

## Working agreement

- One phase per session. `/clear` between phases.
- `git diff` and a commit at the end of each phase.
- Show every migration before running it; `sqlmigrate` output for anything non-trivial.
- Run `manage.py test` before declaring a phase done. If there is no CI yet, say so
  rather than assuming tests ran.
- If the reference mockup and the IT Command codebase conflict on styling, the
  codebase wins every time. Flag the conflict, don't silently pick.