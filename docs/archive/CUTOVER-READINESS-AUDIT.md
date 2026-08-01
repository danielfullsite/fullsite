# Cutover Readiness Audit — Operator Surface Evidence Map

> Date: 2026-07-13
> Scope: Inventory truth, dashboard truth, operator surface tracing
> Method: Read-only code inspection
> Status: BASELINE AUDIT

---

## 1. Dashboard Data Source Map

### Architecture finding

**No dashboard page reads from ops_daily, ops_daily_live, or ops_daily_history.**

The canonical operational layer we built and validated (Gates 1-4) is consumed ONLY by agents. The dashboard reads directly from `wansoft_daily` (primary) with `pos_orders` fallback.

### Page-by-page sources

| Route | Primary source | Fallback | Agent output | ops_daily |
|---|---|---|---|---|
| `/` (dashboard) | wansoft_daily | pos_orders (30d) | agent_runs (widget) | NO |
| `/ventas` | wansoft_daily | pos_orders | NO | NO |
| `/reportes` | wansoft_daily | pos_orders | NO | NO |
| `/reportes/ingresos` | wansoft_daily | pos_orders (365d) | NO | NO |
| `/tendencias` | wansoft_daily | pos_orders (365d) | NO | NO |
| `/propinas` | wansoft_daily | pos_orders | NO | NO |
| `/cortes` | wansoft_daily | pos_orders | NO | NO |
| `/meseros` | wansoft_daily | pos_orders | NO | NO |
| `/proveedores` | pos_suppliers | — | NO | NO |
| `/recetas` | pos_recipes_old | — | NO | NO |
| `/seguridad` | none (static) | — | NO | NO |
| `/agentes` | — | — | agent_runs | NO |
| `/pos/turno` | pos_orders + pos_turnos | — | NO | NO |
| `/pos/historial` | pos_orders | — | NO | NO |
| `/pos/cocina` | pos_orders (KDS) | — | NO | NO |
| `/pos` | pos_orders + pos_menu | — | NO | NO |

### Dashboard truth assessment

**If Wansoft stops receiving transactions tomorrow:**

| Surface | Remains truthful? | Why |
|---|---|---|
| `/` dashboard today widget | **PARTIALLY** — falls back to pos_orders for last 7 days. Historical will show stale Wansoft data | pos_orders fallback exists but historical gap begins |
| `/ventas` | **YES for Fullsite data** — pos_orders fallback active. Wansoft deep-scraper data (cancellations, voids, courtesies) goes stale | Primary metrics survive, detail tables freeze |
| `/reportes` | Same as /ventas | |
| `/tendencias` | **DEGRADED** — historical charts show Wansoft data up to cutover, then pos_orders. Transition point visible as a gap or change in data density | |
| `/propinas` | **DEGRADED** — wansoft_tips table goes stale. pos_orders has propina field but dashboard may not aggregate it the same way | |
| `/cortes` | **DEGRADED** — cash_closing, cash_withdrawals from Wansoft freeze. Fullsite CierreCajaWizard writes to pos_cierres but /cortes page reads wansoft_data, not pos_cierres | |
| `/meseros` | **YES** — meseros JSONB comes from wansoft_daily but pos_orders fallback generates equivalent mesero aggregation | |
| `/proveedores` | **YES** — reads pos_suppliers (Fullsite-native) | |
| `/recetas` | **YES** — reads pos_recipes_old (Fullsite-native) | |
| `/pos/*` | **YES** — all POS pages read pos_orders, pos_menu, pos_turnos (Fullsite-native) | |
| `/agentes` | **YES** — reads agent_runs (Fullsite-native) | |

---

## 2. Agent Output → Operator Surface Trace

### Agent persistence destinations

| Destination | Agents writing | Dashboard consumer | Operator-visible? |
|---|---|---|---|
| `agent_runs` | ALL 24 agents | `/agentes` page, `/` main dashboard widget | YES — shows run status, last execution time |
| `agent_results` | 17 agents (UPSERT by agent_id + fecha) | **NONE** — no dashboard page reads agent_results | NO via dashboard. YES via Telegram |
| `agent_insights` | 14 agents (INSERT, never overwritten) | **NONE** — no dashboard page reads agent_insights | NO via dashboard. YES via Telegram |
| Telegram | 20 agents send messages | N/A (external channel) | YES — directly to operator phones |

### Critical finding

**agent_results and agent_insights are NOT consumed by any dashboard page.** These tables grow indefinitely but are only visible through:
1. Telegram messages (real-time, during the agent run)
2. Direct Supabase queries (manual, by engineers)

The `/agentes` page shows only `agent_runs` (execution status), NOT the conclusions/insights the agents produced.

### Operator surface classification

| Surface | Source | Can show uncertified conclusions? | Labeled with quality/provenance? |
|---|---|---|---|
| **Telegram (operator phone)** | 20 agents send directly | **YES** — all 20 uncertified agents can send Telegram | **NO** — no provenance, no coverage, no uncertainty in messages |
| **`/` dashboard agent widget** | agent_runs table | **NO** — shows only run status (success/error/no_data), not conclusions | N/A |
| **`/agentes` page** | agent_runs table | **NO** — shows execution metadata only | N/A |
| **`/ventas`, `/reportes`, etc.** | wansoft_daily + pos_orders | **NO** — these read raw data, not agent conclusions | N/A |

---

## 3. Telegram Notification Risk Map

### Agents that can reach AMALAY operators via Telegram

**20 agents send Telegram messages.** Classified by data quality gating:

#### WELL-GATED (send only when meaningful threshold crossed)

| Agent | Condition | Risk |
|---|---|---|
| anomaly_detector | Only when priority="critical" (high-severity anomaly) | LOW — skips on ventas=0 or <2 historical days |
| antifraud_agent | Only when risk_score > 50 | LOW — requires 3+ days history |
| auto86_agent | Only when zero_stock items exist | LOW — factual: item is out of stock |
| config_validator | Only when config issues found | LOW — factual: config is wrong |
| cost_variance_agent | Only when price changes detected | LOW |
| crm_recompra_agent | Only when significant drops detected | LOW — requires 14+ days |
| hermes_agent | Only when critical/high issues in agent fleet | LOW |
| proactive_alerts | Only when threshold breaches detected | LOW — skips without data |
| purchase_predictor | Only when recommendations exist | LOW |
| reservas_pendientes | Only when pending reservations exist | LOW — factual |
| speed_of_service | Only when insights or ordenes > 0 | LOW |
| stock_alert_agent | Only when alerts > 0 | LOW — factual |
| uptime_monitor | Only when failures detected | LOW |
| wansoft_staleness | Only when Wansoft data is stale | LOW |

#### UNGATED (send on every run regardless of data quality)

| Agent | Risk | Detail |
|---|---|---|
| **daily_briefing** | **HIGH** — sends Groq-generated text even when all source data is empty. "Sin datos disponibles" briefing reaches operators | Runs at 7am daily. Post-cutover with stale Wansoft, will send empty/stale briefings |
| **weekly_amalay** | **MEDIUM** — sends weekly report even with 0 days of data. Groq acknowledges gaps in text but message still fires | Runs Monday 9am |
| **inventory_auto_order** | **LOW** — sends either alert or "all OK" confirmation. By design, not misleading | |
| **ticket_detail_scraper** | **LOW** — sends scraper results. Post-cutover: Wansoft scraping stops, agent errors before send | |

#### AGENTS WITH TELEGRAM DEFINED BUT CURRENTLY NOT SENDING

These 10 agents define `send_telegram` but the code path that calls it is currently disabled or conditional on flags that are never set:

close_predictor, climate_events, kitchen_quality, menu_engineering, staffing_optimizer, supplier_monitor, table_time_agent, tips_analyzer, upselling_agent, waste_detector

These agents persist to `agent_results` and `agent_insights` only. Their conclusions do NOT currently reach operators via Telegram.

---

## 4. Stale/Superseded Output Risk

### Can stale agent results still surface?

| Table | Staleness risk | Detail |
|---|---|---|
| `agent_runs` | LOW — shows last execution, naturally refreshes per run | If an agent stops running (workflow disabled), last run stays visible but is obviously dated |
| `agent_results` | **MEDIUM** — UPSERT by fecha means old date rows persist forever. A result from Jun 15 is still queryable | No dashboard reads this table. Risk is only if a future dashboard is built without date filtering |
| `agent_insights` | **HIGH** — INSERT only, never overwritten, no TTL. Insights from 3 months ago coexist with today's. No archival mechanism | Same as above — no dashboard reads it. But growing unboundedly |
| Telegram | **NONE** — messages are transient. Cannot be "superseded" in the chat | Once sent, it's in the chat history. An incorrect alert followed by a correction is two separate messages |

### Can superseded/invalid outputs surface?

The main risk: `agent_insights` accumulates without deduplication. If the anomaly_detector runs 3 times on the same day, it creates 3 × N insights. The UPSERT on `agent_results` handles this for that table, but insights pile up.

**No dashboard currently surfaces these.** The risk becomes real when/if a dashboard page or notification system reads `agent_insights` without date/deduplication filtering.

---

## 5. Inventory Truth Assessment

### If Wansoft stops receiving transactions tomorrow

| System | Data continues flowing? | Source | Truthful? |
|---|---|---|---|
| pos_orders | YES | Fullsite POS terminals | YES — orders created/closed directly |
| pos_turnos | YES | Fullsite POS turn management | YES |
| pos_cierres | YES | CierreCajaWizard | YES |
| pos_inventory | PARTIALLY | Last sync from Wansoft cutover_inventory_sync | **DEGRADES** — stock levels only updated by POS recipe deductions, not Wansoft counts |
| pos_menu_items | YES | Already Fullsite-native | YES |
| pos_recipes_old | YES | Already Fullsite-native | YES |
| pos_suppliers | YES | Already Fullsite-native | YES |
| pos_ingredients | YES | Already Fullsite-native | YES |
| wansoft_daily | **STOPS** | Wansoft scraper | **FREEZES** at last scrape date |
| wansoft_kpis | **STOPS** | Wansoft real-time scraper | **FREEZES** |
| wansoft_data | **STOPS** | Wansoft deep scraper | **FREEZES** |
| wansoft_waiter_categories | **STOPS** | Wansoft ticket scraper | **FREEZES** |
| ops_daily | PARTIALLY | pos_intraday_snapshot (if activated) | YES for Fullsite data. No cierre yet |
| ops_daily_live | PARTIALLY | View over ops_daily | YES when snapshot is fresh |

### Inventory-specific truth

| Inventory concept | Current source | Post-cutover source | Gap |
|---|---|---|---|
| Stock levels | pos_inventory (synced from Wansoft) | pos_inventory (updated by recipe deductions on order close) | Physical count reconciliation must be manual until inventory count feature exists |
| Reorder points | pos_inventory.reorder_point | Same | Truthful — persisted in Fullsite |
| Recipes/ingredients | pos_recipes_old + pos_ingredients | Same | Truthful — Fullsite-native |
| Supplier info | pos_suppliers | Same | Truthful — Fullsite-native |
| Purchase history | Wansoft only | **NO SOURCE** | Gap — Fullsite has no purchase order / receiving module |

---

## 6. Final Cutover Questions

### Q1: If Wansoft stops tomorrow, does Fullsite inventory remain physically truthful?

**YES with caveats.**

- Stock levels: truthful at last-synced values, then decremented by recipe deductions on each cerrada order. Will drift from physical reality without periodic manual counts.
- Recipes, ingredients, suppliers, reorder points: fully Fullsite-native, remain truthful.
- Purchase orders / receiving: **NOT IN FULLSITE**. No way to record incoming inventory. Stock will decrease but never increase through the system.

### Q2: Which dashboard surfaces remain truthful?

| Surface | Truthful? |
|---|---|
| POS (`/pos`, `/pos/cocina`, `/pos/turno`, `/pos/historial`) | **YES** — Fullsite-native |
| `/proveedores` | **YES** — Fullsite-native |
| `/recetas` | **YES** — Fullsite-native |
| `/seguridad` | **YES** — static content |
| `/agentes` | **YES** — agent_runs is Fullsite-native |
| `/` dashboard (today widget) | **PARTIALLY** — pos_orders fallback works for current data. Historical shows frozen Wansoft |
| `/ventas` | **PARTIALLY** — primary metrics from pos_orders fallback. Detail tables (cancellations, voids, courtesies) freeze |
| `/tendencias` | **DEGRADED** — historical charts show Wansoft up to cutover, then gap |
| `/propinas` | **DEGRADED** — wansoft_tips table freezes |
| `/cortes` | **DEGRADED** — reads wansoft_data, not pos_cierres |
| `/meseros` | **PARTIALLY** — pos_orders fallback generates mesero data |
| `/reportes` | **PARTIALLY** — same as /ventas |

### Q3: Which uncertified agent conclusions can still reach AMALAY operators?

**20 agents can send Telegram to operators. All are uncertified (0 CERTIFIED in the fleet).**

| Risk | Agents | Detail |
|---|---|---|
| **HIGH** | daily_briefing | Sends Groq text even with empty/stale data. Post-cutover: will send stale Wansoft briefings or "Sin datos" |
| **MEDIUM** | weekly_amalay | Sends with 0 data days acknowledged in text |
| **LOW but uncertified** | anomaly_detector, antifraud, auto86, config_validator, cost_variance, crm_recompra, hermes, proactive_alerts, purchase_predictor, reservas_pendientes, speed_of_service, stock_alert, uptime_monitor, wansoft_staleness | Well-gated (threshold-based sends) but uncertified (no provenance, no uncertainty, no monitoring eligibility) |
| **DISABLED Telegram** | close_predictor, climate_events, kitchen_quality, menu_engineering, staffing_optimizer, supplier_monitor, table_time, tips_analyzer, upselling, waste_detector | Write to agent_results/insights only. Do NOT currently reach operators |

### Summary risk statement

**The operator notification channel (Telegram) is connected to 20 uncertified agents.** 14 of these are well-gated (threshold-based, unlikely to send misleading messages during normal operations). 2 are ungated (daily_briefing, weekly_amalay) and will send stale/empty content post-cutover. 4 are infrastructure scrapers that send run summaries to Daniel only.

**The dashboard does NOT surface agent conclusions.** It reads wansoft_daily/pos_orders directly. Post-cutover, dashboard truth degrades on historical/detail surfaces but POS and current-day operations remain truthful via pos_orders fallback.

**ops_daily (the canonical operational layer) is consumed by agents only, not by any dashboard page.** This means the entire investment in canonical business-day semantics, snapshot production, and ops_daily_live views serves the intelligence layer exclusively. The dashboard has a completely separate data path.
