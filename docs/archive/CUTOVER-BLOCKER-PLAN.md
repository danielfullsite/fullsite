# Cutover Blocker Plan — AMALAY

> Date: 2026-07-13
> Status: WAR ROOM PLANNING — no implementation
> Objective: Define the minimum closed operational loop required to remove Wansoft safely

---

## Architectural Conclusions (Registered)

**DASHBOARD / INTELLIGENCE DATA PATH DIVERGENCE**
Dashboard reads wansoft_daily + pos_orders. Intelligence reads ops_daily_live. They share zero data path. Fixing one does not fix the other.

**INVENTORY DEPLETION EXISTS; INVENTORY REPLENISHMENT DOES NOT**
Recipe-driven stock decrements fire on kitchen send. Manual count exists. No purchase/receiving lifecycle. Fullsite cannot increase inventory through the system. Stock can only go down.

**AGENT CAPABILITY OUTRAN AGENT GOVERNANCE**
24 agents scheduled and capable of notifying operators. 0 certified. 19 use wrong date semantics. 22 have no monitoring eligibility. Notification capability exceeds conclusion reliability.

---

## WORKSTREAM 1 — INVENTORY OPERATIONAL LOOP

### Physical operations trace

```
supplier delivery
→ receiving (WHO/WHEN/WHAT/HOW MUCH)     ← DOES NOT EXIST IN FULLSITE
→ inventory increase                       ← DOES NOT EXIST IN FULLSITE
→ recipe consumption (deduction on send)   ← EXISTS (with critical bugs)
→ inventory decrease                       ← EXISTS
→ waste/merma                              ← EXISTS (manual adjustment)
→ manual count                             ← EXISTS (stock override)
→ variance (counted vs system)             ← EXISTS (in CierreCajaWizard display)
→ correction                               ← EXISTS (manual stock update)
```

### Recipe deduction safety audit

| Risk | Severity | Evidence |
|---|---|---|
| **Blind stock overwrite** — `updateInventoryStock` PATCHes absolute value without conditional WHERE. No optimistic lock. Last write wins | **CRITICAL** | pos-data.ts:1633-1661. No `WHERE stock = old_value` guard |
| **Offline replay corrupts stock** — Two offline orders touching same ingredient queue absolute-value PATCHes. Replay applies stale base values. Example: stock=10, order A→8, order B→7 (from cached 10). Sync replays: A lands=8, B lands=7. Should be 5 | **CRITICAL** | pos-offline-db.ts:215-334. No conflict handling for inventory PATCHes. Only pos_orders POST has 409 handling |
| **Cancelled+not-prepared: deduction not reversed** — Item sent to kitchen but not yet prepared, then cancelled. Ingredients were deducted at send but not returned | **HIGH** | pos/page.tsx:2071-2073. voided=false, prepared=false → no reversal |
| **Cancelled+prepared: stock returned incorrectly** — Ingredients consumed by kitchen are returned to inventory on prepared cancellation. Overstates stock | **HIGH** | pos/page.tsx:2071-2073. voided=false, prepared=true → reverses full deduction |
| **Fuzzy deduction, exact reversal** — Deduction uses fuzzy name matching (>50% overlap). Reversal uses exact+alias only. Items matched fuzzily cannot be reversed | **MEDIUM** | pos-data.ts:1773 vs 1858-1860 |
| **KDS double-cancel race** — Two KDS terminals could cancel same item simultaneously. No UI lock after first cancel flag set | **MEDIUM** | cocina/page.tsx:248-265 |
| **Modifiers don't affect deductions** — "sin aguacate" still deducts avocado. "extra queso" doesn't add cheese | **MEDIUM** | pos-data.ts:1698-1820. items[].modificadores not read |
| **No server-side reconciliation** — All deductions are client-side fire-and-forget. No `reconcile_order_inventory` RPC exists | **INFO** | No RPC found in codebase |

### Minimum cutover inventory requirements

**MUST HAVE (P0):**

1. **Receiving UX** — AMALAY staff must be able to record: "received 20L leche from Proveedor X on Jul 14." Minimum fields: ingredient, quantity, supplier (optional), date. This is the only way to increase stock. Without it, inventory goes to zero within days.

2. **Offline deduction safety** — The blind-overwrite PATCH must be replaced with delta-based or conditional logic. Two offline orders touching the same ingredient WILL corrupt stock during normal operation. This is not theoretical — it will happen the first busy Sunday with WiFi drops.

**SHOULD HAVE (P1):**

3. **Cancellation reversal correctness** — Fix the prepared/not-prepared logic inversion.

4. **Movement audit trail cleanup** — Use distinct movement types (deduction, reversal, waste, receiving, count) instead of generic "adjustment."

**POST-CUTOVER (V2):**

5. Modifier-based deduction adjustments
6. Server-side reconciliation RPC
7. Purchase order lifecycle
8. Supplier delivery scheduling
9. Automatic reorder triggers

### Minimum receiving UX design

```
[Recibir Inventario]

Ingrediente:  [dropdown — pos_ingredients]
Cantidad:     [number input]
Unidad:       [auto from ingredient]
Proveedor:    [dropdown — pos_suppliers] (optional)
Notas:        [text] (optional)

[Guardar]
```

Writes:
- PATCH `pos_inventory` SET `stock = stock + cantidad` (delta-based, NOT absolute)
- INSERT `pos_inventory_movements` with type='receiving'

Accessible from: `/pos/inventario` or hamburger menu in POS.
Auth: any staff with inventory permission.

---

## WORKSTREAM 2 — CANONICAL DASHBOARD DATA PATH

### Central question: How do dashboard and intelligence converge?

**Answer: NOT through ops_daily_live.**

ops_daily_live provides daily-grain aggregates. Dashboard needs:
- Ticket-level detail (ventas, cortes, historial)
- Per-mesero per-day breakdown
- Per-category per-day breakdown
- Intraday charts
- Cash movements
- Tips per payment method

These require `pos_orders` query-time aggregation, not pre-aggregated daily snapshots.

### Canonical source by metric grain

| Metric family | Required grain | Canonical source | Producer | Business-date primitive | Freshness |
|---|---|---|---|---|---|
| Daily sales aggregate | day | ops_daily_live | pos_intraday_snapshot | get_business_day_bounds | pipeline_fresh (45min) |
| Sales detail (tickets) | order | pos_orders | POS terminals | created_at / closed_at in business-day bounds | real-time |
| Mesero performance | order × mesero | pos_orders | POS terminals | closed_at in bounds | real-time |
| Category breakdown | order × item | pos_orders.items JSONB | POS terminals | closed_at in bounds | real-time |
| Tips | order | pos_orders.propina + pagos | POS terminals | closed_at in bounds | real-time |
| Cash movements | turno | pos_cierres + pos_turnos | CierreCajaWizard | turno.opened_at | on turno close |
| Inventory levels | ingredient | pos_inventory | deduction + receiving | point-in-time | real-time |
| Corte/cierre | turno | pos_cierres | CierreCajaWizard | cierre.fecha | on close |

### Convergence design

Dashboard and agents share the same source tables (pos_orders, pos_inventory) but at different grains:

- **Agents** consume ops_daily_live (pre-aggregated daily) for efficiency and canonical semantics
- **Dashboard** queries pos_orders directly for ticket-level detail

Both must use the same business-day bounds when filtering. Dashboard currently uses calendar date; agents use canonical business date. This must converge.

**Minimum convergence:**

1. Dashboard date pickers and "today" filters must use the same business-day boundary as agents
2. Dashboard aggregation functions (in `data.ts`) must filter by canonical [utc_start, utc_end) bounds on closed_at/created_at
3. A shared TypeScript utility `getBusinessDayBounds(fecha, timezone, boundary)` mirrors the Python primitive

This does NOT require dashboard to read ops_daily_live. It requires shared date semantics.

---

## WORKSTREAM 3 — CUTOVER BLOCKING SURFACES

### /cortes — Wansoft vs Fullsite gap analysis

| Feature | Wansoft source | Fullsite source | Gap |
|---|---|---|---|
| Daily sales/tickets/personas KPIs | wansoft_daily | pos_orders (fallback exists) | **NO GAP** — fallback works |
| Efectivo/tarjeta split | wansoft_daily.efectivo/tarjeta | pos_orders.pagos JSONB aggregation | **NO GAP** — fallback works |
| Corte de caja line items | wansoft_data cash_closing | pos_cierres | **GAP** — pos_cierres stores aggregates, not named line items. Missing: "Propinas en Efectivo", "Faltante/Sobrante" as separate named rows |
| Cash withdrawals | wansoft_data cash_withdrawals | pos_cash_movements (exists but no concept/name field) | **GAP** — anonymous movements vs named retiros |
| Bank deposits | wansoft_data bank_deposits | **DOES NOT EXIST** | **GAP** — no bank deposit tracking in Fullsite |
| Multi-turno reconciliation | Wansoft covers full business day | pos_cierres is per-turno | **MINOR GAP** — can aggregate multiple cierres for the day |

**Cutover assessment:** /cortes can be rebuilt from Fullsite data for 80% of functionality. The KPI cards, daily table, efectivo/tarjeta split all survive via pos_orders fallback. The detailed corte line items (cash_closing breakdown) and bank deposits do NOT exist in Fullsite.

**Minimum cutover fix:** Repoint /cortes primary source from wansoft_daily to pos_orders aggregation (already exists as fallback). Accept loss of detailed corte line items and bank deposits. These are nice-to-have, not operational blockers — Eduardo confirmed AMALAY does manual cash counts regardless.

### /propinas — Wansoft vs Fullsite gap analysis

| Feature | Wansoft source | Fullsite source | Gap |
|---|---|---|---|
| Total propinas aggregate | wansoft_daily.propinas_total | pos_orders.propina SUM | **NO GAP** — pos_orders has propina field |
| Per-mesero tips | wansoft_tips / tips_raw | pos_orders GROUP BY mesero WHERE propina > 0 | **NO GAP** — Fullsite can derive per-mesero from order-level propina |
| Propina % (tips/ventas) | Wansoft computed | Can compute from pos_orders | **NO GAP** |
| Tip by payment method | Wansoft distinguishes | pos_orders.pagos can prorate (logic exists in pos/corte) | **MINOR GAP** — logic exists but not exposed in /propinas |
| **Propina capture at payment** | Wansoft terminal captures as part of card transaction | **pos_orders.propina defaults to 0** — no tip entry UI in Fullsite POS checkout | **CRITICAL GAP** — without tip entry at payment time, propina is always 0. The entire /propinas page will show $0 |

**Cutover assessment:** /propinas has a **CRITICAL GAP** — propina is never populated because there is no tip entry UI in the Fullsite POS payment flow. The data field exists (pos_orders.propina) and all aggregation logic exists, but the value is always 0 because the POS doesn't ask for it.

**Minimum cutover fix:** Add tip entry to the payment flow. After payment amount is entered, prompt: "Propina: $___" (optional, default 0). Write to pos_orders.propina. This unblocks the entire propinas pipeline.

---

## WORKSTREAM 4 — OPERATOR SAFETY

### 20 uncertified Telegram-capable agents

**2 UNGATED (send regardless of data quality):**
- daily_briefing — sends Groq-generated text even with empty data. Post-cutover: Wansoft stale → "Sin datos" briefing sent
- weekly_amalay — sends with 0 data days

**14 WELL-GATED (threshold-based sends):**
- Send only when meaningful threshold is crossed
- Low risk of misleading output during normal operations
- But: no provenance, no uncertainty, no monitoring eligibility

**4 SILENTLY DISABLED:**
- Have Telegram code but currently don't call it

### Minimum cutover safety boundary

**Recommended: CERTIFICATION ALLOWLIST**

```
TELEGRAM_CERTIFIED_AGENTS = [
    "auto86",           # factual: item out of stock
    "stock-alert",      # factual: below reorder point
    "config-validator",  # factual: config issue
    "reservas-pendientes", # factual: pending reservation
]
```

All other agents: continue running, continue persisting to agent_results/insights, but Telegram sends are suppressed. The `send_telegram` function in `agent_common.py` checks the allowlist before sending.

This is NOT certification. It is a notification safety boundary. The 4 allowlisted agents are factual/inventory-based and don't depend on business-day semantics or historical comparison.

**Why not a global kill switch?** Because the 4 factual agents are operationally useful from day 1. "Leche is out of stock" is valuable regardless of agent certification status.

**Why not shadow mode?** Because agents already persist to agent_results/insights. Shadow mode already exists — agent conclusions are stored in DB but only the 4 allowlisted agents can notify operators.

### daily_briefing and weekly_amalay specific fix

These must switch from wansoft_daily to pos_orders-based data BEFORE cutover. Otherwise they send stale/empty Groq briefings to operators daily.

**Minimum fix:** Add a source eligibility check at the top of each:
```python
if data_source == 'wansoft' and not wansoft_fresh:
    log_run("no_data", ..., skip_reason="wansoft_stale_post_cutover")
    sys.exit(0)
```

Or better: migrate their data source to the same pos_orders fallback the dashboard uses.

---

## BLOCKER TABLE

| Blocker | Can corrupt truth? | Can mislead operator? | Can stop operation? | Severity | Minimum fix | Evidence to close |
|---|---|---|---|---|---|---|
| **No receiving UX** — inventory can only decrease | YES — stock reaches 0, deductions continue (clamped) | YES — auto86/stock agents report everything as out-of-stock | NO — POS still takes orders | **P0** | Receiving form: ingredient + quantity → delta PATCH + movement log | Staff can receive inventory without developer help |
| **Offline deduction blind overwrite** — two offline orders corrupt stock | YES — stock value wrong after sync | YES — inventory reports incorrect levels | NO — POS still takes orders | **P0** | Delta-based deduction or conditional PATCH with conflict detection | Test: 2 offline orders on same ingredient sync correctly |
| **Propina capture missing** — no tip entry in POS payment | NO | YES — /propinas shows $0 always | NO | **P0** | Tip input field in payment flow. Write to pos_orders.propina | Tip entered at payment appears in /propinas |
| **daily_briefing sends stale** — Groq writes "Sin datos" briefing post-cutover | NO | YES — operator receives meaningless daily briefing | NO | **P1** | Source eligibility check or migrate to pos_orders | Briefing contains current Fullsite data after cutover |
| **/cortes reads wansoft_data** — cash_closing, withdrawals, deposits freeze | NO | YES — page shows frozen Wansoft data | NO | **P1** | Repoint to pos_orders/pos_cierres aggregation. Accept loss of bank deposits detail | /cortes shows current Fullsite data |
| **/propinas reads wansoft_tips** — tips table freezes | NO | YES — shows stale tip data | NO | **P1** | Repoint to pos_orders.propina aggregation | /propinas shows current Fullsite tips |
| **Dashboard calendar-date semantics** — "today" is calendar date not business date | NO | YES — wrong day's data shown at midnight | NO — cosmetic at midnight only | **P1** | Shared TS business-day utility matching Python primitive | Dashboard "hoy" matches agent "hoy" across midnight |
| **Cancellation reversal logic inverted** — prepared items incorrectly restored | YES — stock overstated after prepared cancellation | NO | NO | **P1** | Fix prepared/not-prepared reversal branches | Prepared cancel does not restore stock; unprepared cancel does |
| **Agent Telegram allowlist** — 20 uncertified agents can notify | NO | YES — misleading conclusions can reach operator | NO | **P1** | Certification allowlist in send_telegram | Only factual agents can send Telegram |
| **weekly_amalay sends stale** — sends with 0 data post-cutover | NO | YES | NO | **P1** | Same as daily_briefing | Weekly report contains Fullsite data |
| **Modifier deduction gap** — "sin aguacate" still deducts avocado | YES — stock slightly inaccurate | NO | NO | **POST** | Modifier→ingredient mapping | Modifiers affect deduction |
| **Dashboard/Intelligence data path divergence** | NO | POTENTIALLY — different numbers for same metric | NO | **POST** | Shared TS business-day utility | Dashboard and agents show same "today" |
| **Agent fleet business-date propagation** — 19 agents use calendar date | NO | YES — wrong comparisons at midnight | NO | **POST** | Propagate canonical primitive to 19 agents | All agents use canonical business date |
| **KDS item lifecycle persistence** — localStorage only | NO | NO | NO | **POST** | Persist item status to DB | Kitchen speed metrics available |
| **Purchase order lifecycle** — no PO/receiving workflow | YES — stock accuracy degrades over weeks | NO | NO | **POST** | Full PO/receiving/reconciliation module | Receiving form is sufficient for cutover |

---

## ADVERSARIAL REVIEW — P0 RECLASSIFICATION

### Reclassification 1: CANCELLATION REVERSAL → P0

**Exact behavior per scenario:**

| Scenario | Physical reality | Expected inventory | Actual code behavior | Stock delta | Classification |
|---|---|---|---|---|---|
| Item cancelled before send to kitchen | Nothing consumed | No change | No change (item excluded from deduction) | CORRECT | OK |
| Item cancelled after send, NOT prepared | Ingredients deducted at send, not consumed | Reverse deduction (return to stock) | **NO reversal fires** (Branch C: voided=false, prepared=false → no reverseIngredientDeduction call) | WRONG — stock understated | **TRUTH CORRUPTION** |
| Item cancelled after send, prepared (waste) | Ingredients consumed (waste) | No reversal (ingredients were used) | **Reversal fires** (Branch B: voided=false, prepared=true → reverseIngredientDeduction) | WRONG — stock overstated | **TRUTH CORRUPTION** |
| Item voided (error, never made) | Ingredients deducted at send, not consumed | Reverse deduction | Reversal fires correctly | CORRECT | OK |
| Full order cancelled | All sent items should reverse | Reverses items in sentItemIds | CORRECT for sent items | CORRECT | OK |
| KDS cancel (cocina page) | Ingredients returned to stock | Inline reversal | Fires correctly BUT no double-cancel guard — can reverse twice | MEDIUM RISK | Monitor |
| Cancel during offline | Queued as absolute PATCH | Should be conditional | Blind overwrite, same ingredient → stale base | CRITICAL | Same as offline deduction bug |

**Why P0:** A normal Day-1 operation — cashier cancels an unsent-but-prepared item, or cancels a sent-but-not-yet-prepared item — silently corrupts stock. This is not edge case; it is the standard cancellation workflow. Over a day with 5-10 cancellations, stock accuracy drifts materially.

**Minimum surgical fix:**
- Branch B (prepared=true): REMOVE reverseIngredientDeduction call. Ingredients were consumed as waste. Log waste movement instead.
- Branch C (prepared=false): ADD reverseIngredientDeduction call. Ingredients were deducted but not consumed. Return to stock.

**Acceptance test:** Cancel a prepared chilaquiles → stock does NOT increase. Cancel an unprepared chilaquiles → stock increases by recipe quantity.

### Reclassification 2: AGENT NOTIFICATION SAFETY → P0

**First 24 hours post-cutover Telegram audit:**

In the first 24 hours, **11 misleading Telegram messages** would reach Daniel and Monica from uncertified agents consuming stale Wansoft data:

| Time | Agent | Risk |
|---|---|---|
| 7:00am | daily_briefing | Reports Jul 10 Wansoft data as "yesterday's" — LLM prompt explicitly says "don't flag as stale" |
| 8:00am | stock_alert | Jul 10 inventory snapshot — inaccurate stock levels |
| 9:00am | weekly_amalay | Partial week (4/7 days) presented as weekly report |
| 9:00am | weekly_summary | Same partial week, different format |
| 2:00pm | proactive_alerts | Fullsite day-1 vs Wansoft baseline — false "VENTAS BAJAS" |
| 2:50pm | wansoft_mesero | If Wansoft accessible: wrong POS data entirely |
| 4:00pm | proactive_alerts | Second false alert |
| 10:30pm | wansoft_mesero | Cierre report from wrong POS |
| 11:00pm | wansoft_mega | Scrapes Wansoft, contaminates wansoft_daily |
| 11:15pm | wansoft_browser | Same |
| 11:00pm | wansoft_deep | Same |

Additionally, the Wansoft scrapers at 11pm would **write stale/conflicting data to wansoft_daily** — contaminating the source that the dashboard reads.

**Why P0:** Automatically surfaces known-unreliable conclusions to operator. Wansoft scrapers can contaminate the truth layer. This meets the P0 definition: "automatically surface a known-unreliable conclusion to an operator."

**Minimum surgical fix:** Two actions:

**Action A: Notification allowlist** — modify `send_telegram` in `agent_common.py`:

```python
CERTIFIED_NOTIFICATION_AGENTS = {
    "auto86", "config-validator", "reservas-pendientes",
    "wansoft-staleness", "uptime-monitor", "smoke-test",
    "speed_of_service",
}

def send_telegram(msg, chat_ids, agent_id=None):
    if agent_id and agent_id not in CERTIFIED_NOTIFICATION_AGENTS:
        print(f"[notification] Suppressed for uncertified agent {agent_id}")
        return 0
    # ... existing send logic
```

Uncertified agents continue running and persisting. Shadow mode by default.

**Action B: Disable Wansoft scraper workflows** — prevent wansoft_daily contamination:

```bash
gh workflow disable "Wansoft Deep Scraper" --repo danielfullsite/fullsite
gh workflow disable "Wansoft Browser Scraper" --repo danielfullsite/fullsite
gh workflow disable "Wansoft Mega Scraper" --repo danielfullsite/fullsite
gh workflow disable "Wansoft Daily Mesero Report" --repo danielfullsite/fullsite
gh workflow disable "Intraday Sales Report" --repo danielfullsite/fullsite
gh workflow disable "Ticket Detail Scraper" --repo danielfullsite/fullsite
```

**Acceptance test:** Run any uncertified agent → agent_runs logged, agent_results/insights written, Telegram NOT sent. Wansoft scraper workflows disabled.

### Reclassification 3: DAY-1 CASH CLOSE → CONFIRMED P1

**Full close workflow trace:**

| Step | Fullsite capability | Evidence |
|---|---|---|
| Opening fund | Turno opens with fondo_inicial (PIN-gated by role) | TurnoGate.tsx lines 173-229 |
| Cash sales accumulation | pos_orders with pagos JSONB, efectivo/tarjeta/transferencia classified | CierreCajaWizard.tsx lines 85-142 |
| Cash tips | pos_orders.propina exists BUT always 0 (no capture UI — separate P0) | pos-data.ts line 1127 |
| Deposits/withdrawals | pos_cash_movements table with turno_id | CierreCajaWizard.tsx line 133 |
| Expected cash | fondo_inicial + efectivo_ventas + depositos - retiros computed correctly | Line 147 |
| Declared cash | 4-step wizard: bill count → coin count → system comparison → PIN approve | Lines 339-566 |
| Difference | totalContado - efectivoEsperado with color-coded display | Line 148 |
| Close persistence | Writes pos_cierres (full detail) + patches pos_turnos (closed_at) | Lines 201-231 |
| Receipt/print | Browser print (window.open + window.print). NOT bridge print | Lines 255-302 |
| Manager review next morning | /pos/turno shows HistorialCierres (last 10). /pos/corte shows full Wansoft-style report | turno/page.tsx:228-286, corte/page.tsx |

**Assessment:** The physical close workflow is complete. The cashier can: count bills, count coins, compare against system, explain differences, print receipt, close with manager approval. All data persists to pos_cierres.

**The gap is not the close itself — it's the review surface.** /cortes (the dashboard page for management review) reads wansoft_data, not pos_cierres. But /pos/corte (the POS manager corte page) reads pos_orders directly by turno_id and shows the full report. Management CAN review closes via /pos/corte on cutover day.

**Why P1 not P0:** The cashier can close correctly. Management can review via /pos/corte. The /cortes dashboard page shows frozen Wansoft data — this is operational degradation, not operational failure. The close workflow itself works.

---

## FINAL P0 LIST

### P0-1: Receiving UX

| Field | Detail |
|---|---|
| Exact failure | Inventory can only decrease. No UI to record deliveries |
| Trigger | First supplier delivery post-cutover |
| Blast radius | All inventory tracking. auto86 and stock_alert agents. Menu availability |
| Minimum fix | Form: ingredient + quantity + optional supplier → delta PATCH pos_inventory + INSERT pos_inventory_movements(type='receiving') |
| Acceptance tests | 1. Receive 20L leche → stock increases by 20. 2. auto86 no longer flags leche as 86'd. 3. Movement logged with type='receiving' |
| Rollback | Delete receiving movements, restore stock to pre-receiving value |
| Dependencies | None |

### P0-2: Offline deduction safety

| Field | Detail |
|---|---|
| Exact failure | Two offline orders on same ingredient → blind-overwrite PATCH corrupts stock |
| Trigger | WiFi drop during busy service with multiple tables ordering same ingredient |
| Blast radius | Stock accuracy for every shared ingredient. Cascades to auto86/stock alerts |
| Minimum fix | Replace absolute-value PATCH with delta RPC: `UPDATE pos_inventory SET stock = GREATEST(0, stock - $delta) WHERE ingredient_id = $id RETURNING stock` |
| Acceptance tests | 1. Two orders offline touching leche. Sync both. Stock = original - sum(deductions). 2. Offline replay does not double-deduct |
| Rollback | Revert to absolute PATCH (pre-existing behavior) |
| Dependencies | Supabase RPC or PATCH with conditional logic |

### P0-3: Propina capture

| Field | Detail |
|---|---|
| Exact failure | pos_orders.propina is always 0 — no tip entry UI in payment flow |
| Trigger | First tipped order on cutover day |
| Blast radius | /propinas dashboard shows $0 forever. CierreCajaWizard propinas=$0. Tips analysis agents return empty |
| Minimum fix | Optional tip input field after payment amount in handlePayment. Write to pos_orders.propina |
| Acceptance tests | 1. Cobrar with $50 tip → pos_orders.propina=50. 2. /propinas shows $50. 3. CierreCajaWizard propinas total includes $50 |
| Rollback | Remove tip input field. propina defaults to 0 |
| Dependencies | None |

### P0-4: Cancellation reversal correctness

| Field | Detail |
|---|---|
| Exact failure | Prepared cancellation returns ingredients to stock (should be waste). Unprepared cancellation does NOT return ingredients (should return) |
| Trigger | First item cancellation on cutover day |
| Blast radius | Stock accuracy for cancelled items. 5-10 cancellations/day × recipe ingredients |
| Minimum fix | Swap Branch B and C in handleCancelItem: prepared=true → log waste, NO reversal. prepared=false → reverseIngredientDeduction |
| Acceptance tests | 1. Cancel prepared chilaquiles → stock unchanged, waste movement logged. 2. Cancel unprepared chilaquiles → stock increases by recipe qty, reversal movement logged |
| Rollback | Revert conditional branches |
| Dependencies | None |

### P0-5: Agent notification safety boundary

| Field | Detail |
|---|---|
| Exact failure | 11 misleading Telegram messages in first 24 hours. Wansoft scrapers contaminate wansoft_daily |
| Trigger | First scheduled agent run post-cutover |
| Blast radius | Operator trust. wansoft_daily data integrity |
| Minimum fix | A: Notification allowlist in agent_common.py send_telegram. B: Disable 6 Wansoft scraper workflows |
| Acceptance tests | 1. Uncertified agent runs → logged, no Telegram sent. 2. Wansoft scrapers disabled in GitHub. 3. Certified agents (auto86, config-validator) still send normally |
| Rollback | Remove allowlist check. Re-enable workflows |
| Dependencies | None |

---

## RECOMMENDED IMPLEMENTATION ORDER

```
P0-5  Agent notification safety     (30 min — allowlist + workflow disable)
P0-4  Cancellation reversal         (1 hour — swap two branches + tests)
P0-3  Propina capture               (2 hours — UI field + write + tests)
P0-1  Receiving UX                  (3 hours — form + delta PATCH + movement log)
P0-2  Offline deduction safety      (4 hours — RPC design + implementation + offline tests)
```

P0-5 first because it's zero-code-risk (allowlist + disable), prevents Day-1 noise.
P0-4 before P0-1 because it's a smaller fix that affects the same inventory system.
P0-3 is independent.
P0-1 requires receiving form design.
P0-2 is the most complex (RPC + offline sync changes).

---

## CUTOVER P1 — First week

6. /cortes repoint to pos_orders/pos_cierres (management can review via /pos/corte on Day 1)
7. /propinas repoint to pos_orders.propina aggregation
8. daily_briefing migrate to pos_orders source or add staleness gate
9. weekly_amalay same
10. Dashboard business-date convergence (TypeScript utility matching Python primitive)

## POST-CUTOVER

11-20. Agent fleet certification, modifier deductions, KDS persistence, purchase lifecycle, bank deposits, etc.

---

## Scope discipline statement

We are not building the perfect inventory platform before AMALAY.

We are proving: a restaurant can open, take orders, send to kitchen, close the register, receive inventory, capture tips, correctly handle cancellations, and operate without misleading operator notifications — all without Wansoft.

The 5 P0 blockers are the minimum. P0-5 (notification safety) and P0-4 (cancellation reversal) are same-day fixes. P0-3 (propina) and P0-1 (receiving) are small UI additions. P0-2 (offline deduction) is the most complex but affects only the inventory sync path.

Everything else improves the experience but does not block the removal of Wansoft.
