# Digital Estate — what to test, where, and what "correct" looks like

A walkthrough you can follow end to end in about 40 minutes. Every check names
the screen, the exact click, the real-world question it answers, and the result
that means it passed. Where a check can only be done at the database or the API,
that is said explicitly.

Backend: **398 tests pass**. Frontend: `tsc` clean, `eslint` clean, `next build`
passes.

---

## 0. Set up

```bash
cd itcommand_backend
./venv/bin/python manage.py migrate
./venv/bin/python manage.py seed_providers      # 10 providers, idempotent
./venv/bin/python manage.py seed_estate_demo    # 8 properties, 6 accounts, 26 services
```

Then start both servers and sign in as a superadmin.

The demo data is deliberately shaped so every state is on screen at once — red
*and* amber *and* neutral renewals, a complete stack *and* stacks with gaps, an
account with no MFA *and* one on SMS. If you only ever see one state, the screen
is not being exercised.

> **Everything seeded is fictional.** Domains end `.example`, logins
> `@example.invalid` — both reserved by RFC 6761 so they can never resolve.
> Run `seed_estate_demo --clear` before entering real services. It removes only
> its own rows, and refuses to delete an account that has since acquired a real
> service.

---

## 1. Dashboard — `/estate/dashboard`

**Real-world question:** *"What are we spending, and what is about to go wrong?"*

| # | Do this | Passes when |
|---|---|---|
| 1.1 | Look at the five KPI cards | **Total Monthly Spend** ≈ `PKR 142K`, **Active Services** 26, **Renewals in 30 Days** 8, **Accounts Missing MFA** 2 (red), **Orphan Services** 2 (amber) |
| 1.2 | Hover the spend figure | Tooltip shows the **exact** amount, e.g. `PKR 142,183.33` |
| 1.3 | Resize the window to 1280, 1440, 1920 px | The number is **never cut off**. No `PKR 142…`. It switches to compact form and drops a size — it does not truncate |
| 1.4 | `seed_estate_demo --clear`, reload | Orphan Services shows **0 in grey, not red**. Accounts Missing MFA shows **"All covered" in green** |

> **1.3 and 1.4 are the two that matter.** The previous build rendered
> `PKR 13,520.94` as `PKR 13…` — a number that reads as thirteen rupees. And a
> red zero teaches people that red means nothing.

### Renewals timeline

| # | Do this | Passes when |
|---|---|---|
| 1.5 | Look at the strip | **Red, amber and neutral labels are all visible together** (3 / 5 / 6 with demo data) |
| 1.6 | Find `stellar-drift.example` and `quillbox.example` | Both carry a **plug/slash icon** — auto-renew is off |
| 1.7 | Find `oldbrand-parked.example` (renews in 6 days) | Red on the strip, but **no plug icon** — it auto-renews. *"Renews soon" and "at risk" are different questions* |
| 1.8 | Hover any label | Tooltip: type, provider, renewal date, days, cost, property |
| 1.9 | Check the axis | Ticks read **Today / +30d / +60d / +90d** |
| 1.10 | Narrow the window | Labels **re-pack into more lanes** rather than overlapping |

### Charts

| # | Do this | Passes when |
|---|---|---|
| 1.11 | Spend by Provider donut | Segments in **each provider's own brand colour** (AWS orange, Cloudflare orange-red, Namecheap orange). Legend shows amount **and** percentage; they sum to ~100% |
| 1.12 | Spend by Category bars | One bar per service type present |
| 1.13 | `--clear`, add one single service, reload | **A one-line sentence appears instead of a one-segment donut.** A circle is not a comparison |

---

## 2. FX — the defect this module exists to stop

**Real-world question:** *"Is that total actually the total?"*

This is the single most important check in the document.

| # | Do this | Passes when |
|---|---|---|
| 2.1 | Add a service: cost `500`, currency `USD`, cycle Monthly | — |
| 2.2 | Settings → Integrations → remove any USD→PKR rate. Reload the dashboard | Total spend is captioned as **partial**, with an amber line: `USD 500.00 not included — no exchange rate yet.` The `500` is **visible**, not silently dropped |
| 2.3 | Check the donut | The USD-only provider is **still listed**, at 0.0% — dropping it would make the other shares look complete |
| 2.4 | Add a USD→PKR rate of 280. Reload | Total jumps by `PKR 140,000`, the amber line disappears, percentages re-spread |

> **Why:** the old build showed `PKR 1,200 / year` labelled *"total across all
> currencies"* while silently excluding a USD 500/month subscription — the
> larger of the two. A total that omits something must never claim to be whole.

---

## 3. Properties — `/estate/properties`

**Real-world question:** *"Which of our domains has a hole in its stack?"*

| # | Do this | Passes when |
|---|---|---|
| 3.1 | Look at the card grid | 8 cards, each with a **layer strip** of 7 chips |
| 3.2 | Find `pixelforge-arena.example` | **All 7 chips filled**, no gap count |
| 3.3 | Find `oldbrand-parked.example` | **1 filled, 6 dashed amber** — "6 gaps" |
| 3.4 | Scan the grid without reading numbers | The under-configured properties are **obvious from the chips alone.** That is the entire point of the strip |
| 3.5 | Confirm no chip says STORAGE / MONITORING / OTHER / SAAS | Only the **7 stack roles** can be a gap |

> **3.5 caught a real bug.** Those three rendered as permanent amber gaps on
> every property, because the stored settings list all ten pre-rework codes.
> Three gaps nobody can ever close is how people learn to ignore amber.

### Property detail — click `pixelforge-arena.example`

| # | Do this | Passes when |
|---|---|---|
| 3.6 | Look at the diagram | **7 connected nodes** in request order: Registrar → DNS → Hosting → Mail → CDN → TLS → Analytics |
| 3.7 | Each filled node | Provider chip, account email, renewal date with a colour dot, cost, **Open Console ↗**, **🔒 ••••••••** |
| 3.8 | Scroll to "Other services" | `crash reporting · pro` is listed **below the diagram, not as an eighth node** — SaaS holds no stack position |
| 3.9 | Open `stellar-drift.example` | Mail/CDN/TLS/Analytics render as **dashed empty nodes with "Attach service"** — drawn, not omitted |
| 3.10 | Click "Attach service" on the CDN gap | The wizard opens **pre-seeded** with that property and CDN |

> **3.9 is the design.** A gap you cannot see is a gap nobody fills.

---

## 4. Accounts — `/estate/accounts`

**Real-world question:** *"Who can get into our production infrastructure, and is it protected?"*

| # | Do this | Passes when |
|---|---|---|
| 4.1 | Look at the top of the table | A **red banner**: "1 account with no second factor, 1 never checked" |
| 4.2 | Check the row order | `domains@example.invalid` (**NONE**, red) is **first** — worst first, so the table opens on the thing that needs doing |
| 4.3 | Check the MFA badges | Red `None`, amber `SMS`, green `Security key` / `Authenticator app`, grey `Not recorded` — **all five visible at once** |
| 4.4 | Look at `hosting@example.invalid` | Grey `Not recorded`, **not** red. *"Nobody checked" is not "confirmed insecure"* |
| 4.5 | Click a row | It **expands inline** to list that account's services with cost and renewal |
| 4.6 | Click "Show them" in the banner | Filters to the accounts missing MFA |

---

## 5. Services — `/estate/services`

**Real-world question:** *"What are we paying for, and what is unattached?"*

| # | Do this | Passes when |
|---|---|---|
| 5.1 | Type `stellar` in search | Table narrows to that property's services. **One request, not one per keystroke** — it is debounced 300 ms |
| 5.2 | Click **Orphans only** | Exactly 2 rows: `design suite · 8 seats`, `issue tracker · team plan` |
| 5.3 | Click **Expiring soon** | Only services renewing inside 30 days |
| 5.4 | Click **Auto-renew off** | The two at-risk registrars |
| 5.5 | Toggle a row's auto-renew switch | It moves **immediately**, then the row refreshes from the server |
| 5.6 | Stop the backend, toggle again | The switch **snaps back** and an error toast appears. *The UI never keeps a value the database rejected* |
| 5.7 | On an orphan, pick a property from the inline dropdown | It attaches **without leaving the table** — the place you noticed the problem |
| 5.8 | Look at any Secret column cell | A masked **`••••••••`** button, never a password |

---

## 6. Credentials — the security check

**Real-world question:** *"Can someone read a password they should not, and would we know?"*

| # | Do this | Passes when |
|---|---|---|
| 6.1 | Open DevTools → Network. Load `/estate/services` | Search the JSON for `password`, `secret`, `encrypted`. **Zero hits.** `vault_credential` is an id and a title only |
| 6.2 | Click **🔒 ••••••••** with the vault **locked** | Toast: *"Vault is locked. Unlock it from the Vault."* Nothing is copied |
| 6.3 | Unlock the vault, click again | Password copied. Toast says **"This reveal was logged"** |
| 6.4 | Check the audit trail (below) | A `REVEAL` row exists, naming the actor, credential and service |
| 6.5 | Check the same row's `changes` | It contains **no secret** |

```bash
./venv/bin/python manage.py shell -c "
from core.models import AuditLog
for r in AuditLog.objects.filter(action='REVEAL').order_by('-timestamp')[:5]:
    print(r.timestamp, r.user, r.model_name, r.object_id, r.changes, r.ip_address)"
```

> **Why this matters:** the Phase 0 audit found vault reads were **entirely
> unlogged**. `last_revealed_by` answered "who was last" and the next reveal
> overwrote it. `reveal_extras` — which decrypts TOTP seeds and recovery codes,
> the most dangerous endpoint — did not even bump the counter.

---

## 7. Add Service wizard

**Real-world question:** *"Can someone add a service without knowing everything up front?"*

| # | Do this | Passes when |
|---|---|---|
| 7.1 | Click **Add service** | 5 steps: Account → Type → Identifier → Billing → Property, with a progress bar |
| 7.2 | Click Continue on step 1 with nothing chosen | Error names **that step's** problem, not a 400 on the last screen |
| 7.3 | On step 1 choose **＋ New account** | Provider / login / auth / MFA appear inline |
| 7.4 | Step 2 | 8 type cards; the 7 stack roles are badged `stack` |
| 7.5 | Step 4, choose cycle **Usage-based** | A note appears: usage and free count as **zero** in monthly spend |
| 7.6 | Step 4, switch auto-renew **off** | An amber note warns it will become at-risk |
| 7.7 | Step 5, click **Skip and save** | It saves. Toast: *"It is unattached, so it counts as an orphan"* |
| 7.8 | Check `/estate/services?orphans=1` | The new service is there |

> **7.7 is deliberate.** An unattached service is a state this module exists to
> *count*, not to forbid. Refusing to save one just pushes people into
> inventing a fake property.

---

## 8. ⌘K palette

| # | Do this | Passes when |
|---|---|---|
| 8.1 | Press ⌘K (Ctrl+K) anywhere in `/estate` | Palette opens |
| 8.2 | Type `pixel` | The property appears; Enter opens its detail page |
| 8.3 | Type `domains@` | The account appears; Enter lands on Accounts **with the search pre-filled** |
| 8.4 | Choose "Show accounts missing MFA" | Accounts opens **already filtered** |
| 8.5 | Press **Esc** — including with focus outside the input | It closes |

---

## 9. Old URLs still work

**Real-world question:** *"What happens to the links in old tickets and emails?"*

Paste each into the address bar. Every one must **redirect**, never 404:

| Old URL | Lands on |
|---|---|
| `/licenses` | `/estate/dashboard` |
| `/licenses/list`, `/licenses/my`, `/licenses/42` | `/estate/services` |
| `/licenses/estate` | `/estate/dashboard` |
| `/licenses/estate/3` | `/estate/properties/3` |
| `/subscriptions`, `/subscriptions/9` | `/estate/services` |
| `/reports/licenses` | `/estate/dashboard` |

---

## 10. Permissions

**Real-world question:** *"Can a read-only role change anything?"*

| # | Do this | Passes when |
|---|---|---|
| 10.1 | Settings → Roles. Confirm the module list | **Digital Estate** is there; *Software Licenses* and *Software Subscriptions* are **gone** |
| 10.2 | Create a role with `estate: view` only. Sign in as it | Every estate screen loads |
| 10.3 | As that role, look for **Add service** / **Add account** | The buttons are **absent**, not present-and-failing |
| 10.4 | As that role, try the auto-renew toggle | Disabled |
| 10.5 | Create a role with **no** estate grant. Sign in | Digital Estate is absent from the sidebar; visiting `/estate/dashboard` is refused |

```bash
# The API is the real gate — the UI only reflects it.
curl -H "Authorization: Bearer <view-only-token>" \
     -X POST http://localhost:8000/api/estate/services/ -d '{}'
# expect: 403
```

---

## 11. Money is never a float

**Real-world question:** *"Will the totals drift?"*

| # | Do this | Passes when |
|---|---|---|
| 11.1 | Network tab → `/api/estate/dashboard/` | Every money value is a **quoted string**: `"142183.33"`, never `142183.33` |
| 11.2 | Add a service at `PKR 100` **Yearly**. Check its row | Monthly shows `8.33`; the **yearly still shows `100.00`**, not `99.96` |

> **11.2:** deriving yearly from the rounded monthly is how a figure someone was
> actually invoiced turns into one they were not. JSON floats cannot represent
> `0.01` exactly, which is why money crosses the wire as a string.

---

## 12. Automated tests — what covers what

`cd itcommand_backend && ./venv/bin/python manage.py test core` → **398 tests**.

| File | Tests | What it protects |
|---|---|---|
| `test_estate_api.py` | 66 | Provider/account/property CRUD, N+1 guards, vault-title masking, stack and gap endpoints |
| `test_estate_service.py` | 44 | `monthly_equivalent` per cycle **asserting Decimal not float**; orphan and at-risk at the exact boundaries; stack gaps at 0 / partial / complete; SaaS never closes a gap |
| `test_estate_phase2.py` | 42 | **FX with a missing rate populates `unconverted`**; **403 without `estate.view`** on every endpoint; **a reveal writes an AuditLog row** — plus that an ungated reveal is still 403 *and* writes nothing |
| `test_estate_settings.py` | 40 | Layer configuration drives the reports; the exchange-rate surface closes the FX loop |
| `test_estate.py` | 27 | Taxonomy order, provider/account/property model rules |
| `test_estate_demo_seed.py` | 22 | The DEBUG guard, `--force`, idempotency, and that `--clear` leaves real rows alone |
| `test_calendar_feed.py` | 22 | Service renewals in the ICS feed, correctly escaped |
| `test_brex.py` | 21 | Card charges match the right service; a tie matches nothing |
| `test_finance_estate.py` | 19 | Committed is never added to booked; unconvertible currencies reported; usage/free commit nothing |
| `test_automation.py` | 9 | A retired command named in `.env` is skipped, not retried every cycle |

### The boundary cases worth knowing about

The ones where an off-by-one would be invisible in the UI:

- **exactly 30 days out, auto-renew off** → at risk. **31 days** → not.
- **renewing today** → at risk. **yesterday** → not (lapsed is a different problem, and a different number).
- **`AT_RISK` set by hand** → at risk regardless of dates. A human's judgement outranks arithmetic.
- **`PKR 100` yearly** → `8.33`/month and `100.00`/year — not `99.96`.
- **cancelled or expired service on a layer** → that layer is still a **gap**. A registrar that lapsed is not a registrar.
- **usage-based or free** → contributes **zero** to monthly spend. A guess inside a total is worse than a zero.

---

## 13. Known gaps — do not report these as bugs

| What | Why |
|---|---|
| No per-user seat assignment | A Service is bought through a provider account, not assigned to a person. The Master Report's licence/subscription sections were removed rather than shown empty |
| No renewal → Expense automation | The write path was deleted with the subscriptions module. `EstateSettings.create_expense_on_renewal` exists, defaulted **off**, for when it is rebuilt |
| No alerting on renewals | `subscription_alerts.py` and its scheduled command are gone. The estate has no alerting pipeline yet |
| Enabling Storage or Monitoring in Settings does **not** make its absence a gap | They are non-stack types. Only the 7 stack roles form the chain a request travels through |
| Account edits use a single-form dialog, not the wizard | The 5-step flow is for services. Five steps for four fields would be worse |
| Five `db.sqlite3.bak-pre-*` files tracked in git | Flagged in the Phase 0 audit, never actioned. They contain live vault ciphertext |

---

## 14. Rollback

```bash
# Undo the model drop. Restores the SCHEMA and the RBAC keys — not the rows.
./venv/bin/python manage.py migrate core 0068

# Undo everything back to before the estate rework.
./venv/bin/python manage.py migrate core 0064
```

> ⚠️ **`migrate` backwards does not restore data.** `DeleteModel` cannot.
> Row recovery comes from `~/it-command-backups/` — the pre-migration snapshots
> and the JSON dump — and nowhere else. Both reverse paths were executed rather
> than assumed, but what they bring back is empty tables.
