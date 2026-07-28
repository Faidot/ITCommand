# Digital Estate — what to test

Five phases, 5 commits, on branch `feat/digital-estate-phase-1`.
Backend: **420 tests pass**. Frontend: tsc clean, lint clean, build passes.

Everything below is manual verification the automated tests *cannot* do — layout,
wiring, and the high-consequence behaviour you should see with your own eyes.

---

## 0. Setup — run this first

Nothing has touched your database yet. Six migrations are waiting.

```bash
cd itcommand_backend && ./venv/bin/python manage.py migrate core
```

```bash
cd itcommand_backend && ./venv/bin/python manage.py seed_estate && ./venv/bin/python manage.py seed_lovs
```

Then start both servers as you normally do.

**Rollback if anything looks wrong:** `manage.py migrate core 0057` returns you to
the pre-estate schema. All six migrations are additive and reversible.

---

## 1. The five-minute smoke test

| # | Do this | Expect |
|---|---|---|
| 1 | Go to **Software & Subscriptions** | Five tabs: Overview · Licenses · Subscriptions · **Estate** · **Accounts** |
| 2 | Click **Estate** | Empty state: one line of copy and two buttons. Not a wall of zeros. |
| 3 | **Add property** → `example.com`, kind Corporate | Card appears with a layer strip of 7 dashed amber chips |
| 4 | Click **Accounts** → **Add account** → AWS, `root@example.com`, MFA "None" | Red banner: *"1 account with no second factor"* |
| 5 | Back to **Estate** → **Add service** → property `example.com`, layer Registrar, the AWS account, cost 1200 PKR yearly, renewal in ~20 days, auto-renew **off** | Card shows 6 gaps, Registrar chip now filled |
| 6 | Look at the KPI row | **At risk = 1** in red. **Orphans = 0** in *neutral*, not red |
| 7 | Click the property card | Layer-by-layer stack. The 6 missing layers are **visible empty slots** with "Attach service" — not omitted |

---

## 2. The thing this feature exists to fix — test this properly

The original defect: *"PKR 1,200/year labelled 'total across all currencies' while
excluding a USD 500/mo subscription."*

1. Add a second service: **USD 500, monthly**, on any property.
2. Go to **Estate**.

**You should see:**
- The headline caption reads **"Partial spend — 1 of 2 currencies converted"** — *not* "Total across all currencies"
- An amber line beneath: **"USD 500.00 not included — no exchange rate yet."**
- The property card shows a small **"partial cost"** warning

3. Now go to **Settings → Integrations**. The **Exchange rates** panel is the first thing on the page.
4. It should list USD as missing, showing **what the gap is worth** (USD 500.00/month).
5. Type `280` into the inline box next to USD and save.
6. Return to **Estate**.

**You should see:** the caption flips to **"Total spend, all currencies converted"**, the
amber line is gone, and the number jumps to include the USD.

That round trip — the page that reported the gap now leads to the fix, and the fix
closes it — is the single most important thing to verify.

---

## 3. Settings actually drive the reports

**Settings → Digital Estate** (superadmin only).

| Change | Then check | Expect |
|---|---|---|
| Remove **Mail** from tracked layers → Save | Estate tab | Gap count drops by one per property; Mail chip disappears from every strip |
| Add **Monitoring** → Save | Estate tab | Gap count rises; Monitoring appears as a dashed chip |
| Drag **TLS** to the top (up arrow) | Property detail | The stack renders TLS first |
| Set warning window to **60** | Estate KPIs | A renewal 40 days out now counts as At risk |
| Set urgent window to **90**, warning **30** | — | Refuses to save: *"red cannot be wider than amber"* |

**The one to watch:** turn off a layer that has a service on it. The empty slot
should vanish, but **the service must still be visible** on the property detail,
marked as an untracked layer. If money disappears when you change a setting, that
is a bug — tell me.

---

## 4. Finance linkage — the high-blast-radius part

This is where I was most careful, and where you should be most suspicious.

### 4a. Confirm nothing writes by default

1. Renew any subscription (**Subscriptions → a row → Renew**).
2. Check **Finance → Expenses**.

**Expect: no new expense.** The response should say *"Expense creation on renewal is
switched off in Subscription settings."*

### 4b. Turn it on deliberately

1. **Subscriptions → Settings** (gear) → the **amber-bordered Finance block** at the bottom.
2. Enable *"Raise a pending expense when a renewal is recorded"*.
3. Give a subscription a **budget category**, make sure a **financial year is active**.
4. Renew it.

**Expect:**
- One expense, status **PENDING** — not approved
- **Finance → Budget** shows *no change* to consumed budget (only APPROVED counts)
- **Settings → Audit log** has a `CREATE / Expense` row saying `source: subscription_renewal`

### 4c. The refusals — try to make it misbehave

| Try | Expect |
|---|---|
| Renew a subscription with **no budget category** | No expense; message says why |
| Renew a **USD** subscription with no USD rate | **No expense.** Must not book USD 500 as PKR 500 |
| Renew the same subscription twice to the same date | Exactly **one** expense, not two |
| Deactivate the financial year, then renew | No expense; message says why |

In every case the **renewal itself must still succeed** — the expiry date moves. A
finance problem must never leave a subscription looking expired.

### 4d. Recurring bill

1. On a subscription: **create recurring bill** (POST `/subscriptions/<id>/create-recurring-bill/`).
2. Check **Finance → Recurring bills**.

**Expect:** one bill, `auto_post` **off**, linked to the subscription. Call it twice →
still one bill. As a user with subscriptions rights but **not** finance rights → 403.

3. Now **delete the subscription**. The bill must **survive** with its amount intact.

### 4e. Cost Overview

**Finance → Cost Overview** now carries `subscriptions` (by property, by layer,
orphaned), `budget_impact`, and `vendor_subscription_spend`.

**Check the arithmetic:** `budget_impact` shows *allocated*, *booked* and
*subscription_commitment* as three separate numbers. They must **never** be summed —
a renewal already booked as an expense would be counted twice. `remaining_after_commitment`
is allocated − booked − commitment, and may legitimately be negative.

Also confirm `grand_total_cost` did **not** change when you added subscriptions.

---

## 5. Security spot-checks

| Check | Expect |
|---|---|
| Log in as a role **without** `subscriptions.view` | Estate and Accounts tabs 403 |
| Log in as a role with `subscriptions` but not `finance` | Cost Overview 403; create-recurring-bill 403 |
| Link a provider account to a **private** vault credential owned by someone else | Title shows **"Restricted"**, never the real title |
| Search the Accounts page HTML for `encrypted_password` | Not present anywhere |
| **Settings → Integrations →** AWS / Cloudflare | Labelled *"Stored for later — no sync yet"*, **no "Run now" button** |
| Save an AWS key, then re-open | Shows "key present" but never the value back |

---

## 6. Known gaps — not bugs, just not built

- **No frontend tests exist.** No framework is installed. Nothing guards the UI against
  regression, unlike the 420 backend tests. Worth its own decision.
- **No CI.** Nothing runs those 420 tests automatically.
- **Layer chips are one colour**, not per-provider like the mockup — the `stacks`
  endpoint returns no provider per layer row. One-line backend change if you want it.
- **Property detail route is `/licenses/estate/<id>`**, not `/software/estate/...` —
  there is no `/software` route in this app.
- **No shared filter-bar component** was reused because none exists; I built a local one.
- **Discovery sync is not built** — AWS/Cloudflare credentials are stored and inert.

---

## 7. If something is wrong

Tell me the step number. Everything is reversible:

```bash
cd itcommand_backend && ./venv/bin/python manage.py migrate core 0057
```

```bash
git revert d2167467 f28f1dfe 175df19b 18113705 f7ca2cac
```
