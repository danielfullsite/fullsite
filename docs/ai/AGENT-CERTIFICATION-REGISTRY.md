# Fullsite Agent Certification Registry

> Baseline audit: 2026-07-13
> Framework: AGENT-CERTIFICATION.md v1
> Status: FIRST AUDIT — no agent modifications
> Method: Read-only code inspection + production run evidence from Jul 12-13 field session

---

## Population Summary

| Category | Count |
|---|---|
| Operational agents (full pattern: client_config + log_run + Telegram + agent tables) | 24 |
| Producers (write ops_daily / wansoft_daily, not analytical agents) | 2 |
| Reporting scripts (periodic reports, not analytical) | 3 |
| Wansoft scrapers / sync tools | 13 |
| Infrastructure / monitoring | 3 |
| Delivery integrations | 3 |
| One-shot admin tools | 5 |
| Outreach / sales | 1 |
| Shared libraries (not agents) | 4 |
| **Total .py files** | **67** |
| **Scripts requiring certification** | **24 operational + 2 producers = 26** |

---

## Classification Key

| Status | Meaning |
|---|---|
| CERTIFIED | Meets all 8 production-agent criteria. Autonomous operation trusted. |
| PROVISIONALLY CERTIFIED | Core logic sound, known gaps documented. Output requires review. |
| BLOCKED | Cannot certify until specific prerequisite is resolved. |
| LEGACY | Depends on Wansoft data pipeline. Will be deprecated post-cutover. |
| EXPERIMENTAL | Early stage. Not scheduled or not production-critical. |
| NOT AN AGENT | Supporting script, library, tool, or scraper. No certification needed. |

---

## Shared Libraries — NOT AN AGENT

| Script | Purpose |
|---|---|
| agent_common.py | Shared sb_get, log_run, send_telegram |
| client_config.py | Client config from Supabase, get_tz |
| ops_aggregate.py | Canonical business-day primitives + revenue aggregation |
| audit_log.py | Security logging helper |

---

## Producers — Separate certification track

### pos_intraday_snapshot.py

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 2 | Reads pos_orders with canonical UTC bounds via get_business_day_bounds() |
| Business-date | 2 | Uses BIZ_TZ + BIZ_BOUNDARY from get_business_day_config(). Fails closed on missing config |
| Revenue recognition | 2 | status='cerrada' only. closed_at attribution |
| Field validation | 2 | Gate 2-3: row 952/954 reconciled against 9 source orders, $2,221 exact match |
| Idempotency | 2 | Gate 3: same-bucket rerun, row id unchanged, no duplicate |

**Status: CERTIFIED as producer.** Validated in Gates 1-3.

### pos_daily_aggregator.py

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 2 | Reads pos_orders with canonical UTC bounds |
| Business-date | 2 | Uses BIZ_TZ + BIZ_BOUNDARY. Aligned with snapshot primitive |
| Revenue recognition | 2 | status='cerrada' only |
| Field validation | 0 | **NEVER RUN SUCCESSFULLY.** Workflow disabled. No production cierre row exists |
| Cierre semantics | 0 | **BLOCKED** — no business-day finalization signal. record_type='cierre' requires finalization evidence that doesn't exist |

**Status: BLOCKED.** Code aligned but cannot certify without finalization semantics and a successful production run.

---

## Operational Agents — Certification Scores

### Scoring rubric (from AGENT-CERTIFICATION.md)

Each dimension 0-2. Max score 20.

| Score range | Classification |
|---|---|
| 0-9 | NOT CERTIFIED |
| 10-14 | PROVISIONAL |
| 15-18 | CERTIFIED |
| 19-20 | REFERENCE |

---

### LIVE INTRADAY AGENTS (query ops_daily_live for current business day)

#### anomaly_detector.py — Score: 9/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 2 | ops_daily_live via get_today_kpis(business_date). Commit e0159cc |
| Business-date | 2 | get_current_business_date(CLIENT) derived once in main(), propagated. Commit e0159cc |
| Explainability | 1 | Emits message with observed/expected/deviation. Missing: cohort_dates not recorded, threshold not shown in output |
| Uncertainty | 0 | No coverage disclosure. No data quality block. No distinction between low-sample and representative |
| Actionability | 1 | Generic suggestions ("Revisar si hay factor externo"). Not specific who/urgency/evidence |
| Monitoring eligibility | 0 | No pre-open/post-close check. day_pct=0 at midnight causes full-day comparison. No operating-hours guard |
| Data quality | 0 | No data_quality block in output. No pipeline_fresh/coverage/representative metadata |
| Field validation | 2 | Gate 4: run 29232633790. Business_date=Jul 12 confirmed. DOW=Sunday confirmed. Source=Fullsite snapshot row 954 |
| Consistency | 1 | Uses canonical business_date. Historical DOW from same date. But historical queries ops_daily_history which may have different DOW data than ops_daily_live |
| Provenance | 0 | Does not record source row id, generated_at, or record_type in agent_runs |

**Status: NOT CERTIFIED (9/20).** Business-date semantics are correct post-fix. But no monitoring eligibility, no uncertainty handling, no provenance. The midnight anomalies from Gate 4 (class B distorted) demonstrate the monitoring eligibility gap.

#### close_predictor.py — Score: 6/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 2 | ops_daily_live via get_today_kpis(). Uses get_current_business_date |
| Business-date | 1 | get_current_business_date for KPI query. BUT main() still uses now_mx for historical DOW anchor (same bug as pre-fix anomaly_detector — not yet fixed in close_predictor main()) |
| Explainability | 1 | Shows projection with current/expected. Missing threshold, cohort dates |
| Uncertainty | 0 | No coverage or sample quality disclosure |
| Actionability | 0 | Projects a number. No recommended action |
| Monitoring eligibility | 0 | No operating-context check. Would project from 2 orders at 9am |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | Ran in Gate 4 workflow (success) but output not inspected or reconciled |
| Consistency | 1 | Canonical KPI query. But DOW anchor still from calendar date in main() |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (6/20).** BLOCKED by same DOW bug that anomaly_detector had pre-fix. main() derives today_str from calendar date for historical comparison.

#### proactive_alerts.py — Score: 6/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 2 | ops_daily_live with get_current_business_date |
| Business-date | 1 | KPI query uses canonical date. BUT dow variable still derived from now_mx.weekday() (calendar) for historical comparison |
| Explainability | 1 | Shows observed vs expected with percentages |
| Uncertainty | 0 | No coverage disclosure |
| Actionability | 1 | Some specific suggestions based on anomaly type |
| Monitoring eligibility | 0 | No operating-context guard |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN — no inspected production run |
| Consistency | 1 | Canonical KPI query but calendar DOW |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (6/20).** Same DOW calendar-date pattern as pre-fix anomaly_detector.

#### table_time_agent.py — Score: 7/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 2 | ops_daily_live + pos_orders with canonical UTC bounds. Commit e20cb18 |
| Business-date | 2 | get_current_business_date for KPI + canonical bounds for pos_orders |
| Explainability | 1 | Shows tickets/hour, turnover, comparison to historical |
| Uncertainty | 0 | No coverage or sample quality |
| Actionability | 0 | Informational report. No specific actions |
| Monitoring eligibility | 0 | No operating-context guard. calc_hours_open uses hardcoded open=8, close=22 |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN |
| Consistency | 1 | Canonical date/bounds. But hardcoded operating hours |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (7/20).**

#### upselling_agent.py — Score: 5/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 2 | ops_daily_live with get_current_business_date |
| Business-date | 1 | KPI query canonical. Historical comparison uses calendar DOW (not fixed in main) |
| Explainability | 1 | Shows mesero-level upselling opportunities |
| Uncertainty | 0 | No coverage |
| Actionability | 1 | Suggests specific upselling targets per mesero |
| Monitoring eligibility | 0 | No context guard |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | FAILED in Gate 4 runs (exit code 1). Error not investigated |
| Consistency | 0 | Calendar DOW + failed runs indicate unresolved issues |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (5/20).** Additionally has runtime failures in Gate 4 runs.

#### speed_of_service.py — Score: 11/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 2 | pos_orders with canonical UTC bounds on created_at. Audit events by order_id correlation |
| Business-date | 2 | get_current_business_date + get_business_day_bounds. Single derivation |
| Explainability | 1 | Shows total_mins, mesero comparison, slow platillos. Missing threshold documentation |
| Uncertainty | 2 | Kitchen coverage denominator explicit (X/Y). Degradation with reason. audit_fetch_complete flag |
| Actionability | 1 | Identifies slow orders/meseros. Generic "investigate" level |
| Monitoring eligibility | 0 | No operating-context guard |
| Data quality | 2 | Full quality block: eligible_total, kitchen_eligible, non_kitchen, coverage, audit_complete, lifecycle counters |
| Field validation | 1 | Jul 12 dry-run tests PASS (20/20). No live production dispatch yet |
| Consistency | 1 | Canonical dates/bounds. Kitchen eligibility by station routing. But platillo_times from items without category verification |
| Provenance | 0 | No source row recording |

**Status: PROVISIONALLY CERTIFIED (11/20).** Best-scored agent due to kitchen lifecycle quality framework. But no live production run and no monitoring eligibility.

---

### HISTORY-ONLY AGENTS (query ops_daily_history for past ranges)

These agents compare historical windows (7-30 days). Cross-midnight DOW risk is lower but present.

#### antifraud_agent.py — Score: 4/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 1 | ops_daily_history. No canonical date primitive. Uses now(MX_TZ) - timedelta |
| Business-date | 0 | Calendar date for all window calculations |
| Explainability | 1 | Shows cancellation/discount patterns with percentages |
| Uncertainty | 0 | No coverage |
| Actionability | 1 | Identifies suspicious patterns. Names meseros |
| Monitoring eligibility | 0 | No context guard |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN |
| Consistency | 1 | Uses ops_daily_history consistently. But calendar dates |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (4/20).**

#### kitchen_quality_agent.py — Score: 4/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 1 | ops_daily_history + wansoft_kpis. Mixed sources |
| Business-date | 0 | Calendar date |
| Explainability | 1 | Shows cancellation rates vs baseline |
| Uncertainty | 0 | No coverage |
| Actionability | 1 | Identifies problem platillos |
| Monitoring eligibility | 0 | No context guard |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN |
| Consistency | 0 | Mixes ops_daily_history + wansoft_kpis (dual source, potential divergence) |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (4/20).**

#### menu_engineering.py — Score: 4/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 1 | ops_daily_history. Calendar dates |
| Business-date | 0 | Calendar date |
| Explainability | 1 | BCG matrix classification with revenue/popularity axes |
| Uncertainty | 0 | No sample size disclosure |
| Actionability | 1 | Classifies platillos as star/cow/puzzle/dog with implications |
| Monitoring eligibility | 1 | Weekly agent, runs during business hours. Low cross-midnight risk |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN |
| Consistency | 0 | Calendar dates |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (4/20).**

#### staffing_optimizer.py — Score: 4/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 1 | ops_daily_history |
| Business-date | 0 | Calendar date |
| Explainability | 1 | Shows staffing recommendations with data |
| Uncertainty | 0 | No coverage |
| Actionability | 2 | Specific: which days need more/fewer staff, who to schedule |
| Monitoring eligibility | 1 | Weekly, runs during hours |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN |
| Consistency | 0 | Calendar dates |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (4/20).**

#### tips_analyzer.py — Score: 3/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 1 | ops_daily_history |
| Business-date | 0 | Calendar date |
| Explainability | 1 | Shows per-mesero tip analysis |
| Uncertainty | 0 | No coverage |
| Actionability | 1 | Identifies meseros with low tips |
| Monitoring eligibility | 0 | No context guard |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN |
| Consistency | 0 | Calendar dates |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (3/20).**

#### waste_detector.py — Score: 3/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 1 | ops_daily_history + pos_recipes |
| Business-date | 0 | Calendar date |
| Explainability | 1 | Shows purchase vs consumption analysis |
| Uncertainty | 0 | No coverage |
| Actionability | 1 | Identifies waste sources |
| Monitoring eligibility | 0 | No context guard |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN |
| Consistency | 0 | Calendar dates |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (3/20).**

#### supplier_monitor.py — Score: 3/20

Same pattern as waste_detector. Calendar dates, no coverage, no provenance.

**Status: NOT CERTIFIED (3/20).**

#### crm_recompra_agent.py — Score: 2/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 0 | wansoft_daily directly. No canonical layer |
| Business-date | 0 | Calendar date |
| Explainability | 1 | Shows customer patterns |
| Uncertainty | 0 | No coverage |
| Actionability | 1 | Identifies at-risk customers |
| All other dimensions | 0 | |

**Status: NOT CERTIFIED (2/20). LEGACY — depends entirely on Wansoft data.**

---

### INVENTORY / CONFIG AGENTS (query pos_inventory, not ops_daily)

#### auto86_agent.py — Score: 5/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 1 | pos_inventory + pos_recipes directly (appropriate — not an ops_daily consumer) |
| Business-date | 0 | Calendar date for logging |
| Explainability | 1 | Shows which items are 86'd and why |
| Uncertainty | 0 | No coverage |
| Actionability | 2 | Very specific: "X is out of stock because ingredient Y is at 0" |
| Monitoring eligibility | 1 | Runs every 2 hours during service. Appropriate cadence |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN |
| Consistency | 0 | Calendar dates |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (5/20).**

#### stock_alert_agent.py — Score: 5/20

Same pattern as auto86. Specific actionability. No quality framework.

**Status: NOT CERTIFIED (5/20).**

#### inventory_auto_order.py — Score: 5/20

Same pattern. Good actionability (specific reorder quantities). No quality framework.

**Status: NOT CERTIFIED (5/20).**

#### config_validator.py — Score: 5/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 1 | pos_inventory + pos_menu. Appropriate sources |
| Business-date | 0 | Calendar date |
| Explainability | 2 | Lists specific config issues with evidence |
| Uncertainty | 0 | No coverage |
| Actionability | 2 | Very specific: "menu item X has no recipe configured" |
| Monitoring eligibility | 0 | No context guard |
| Data quality | 0 | No quality metadata |
| Field validation | 0 | NOT PROVEN |
| Consistency | 0 | Calendar dates |
| Provenance | 0 | No source recording |

**Status: NOT CERTIFIED (5/20).**

#### cost_variance_agent.py — Score: 4/20

Calendar dates, no quality framework, no provenance. Good actionability for price changes.

**Status: NOT CERTIFIED (4/20).**

#### purchase_predictor.py — Score: 3/20

Wansoft-derived data. Calendar dates. No quality framework.

**Status: NOT CERTIFIED (3/20). LEGACY.**

---

### REPORTING / PERIODIC

#### daily_briefing.py — Score: 3/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 0 | wansoft_daily + wansoft_kpis directly. No canonical layer |
| Business-date | 0 | date.today() — calendar date |
| Explainability | 1 | Summarizes previous day's data |
| Uncertainty | 0 | No coverage |
| Actionability | 1 | Highlights top items and reservations |
| All other dimensions | 0-1 | |

**Status: NOT CERTIFIED (3/20). LEGACY — entirely Wansoft-derived.**

#### weekly_summary.py — Score: 2/20

Wansoft-derived. Calendar dates. No quality framework.

**Status: NOT CERTIFIED (2/20). LEGACY.**

#### weekly_amalay.py — Score: 2/20

Same. Wansoft-derived legacy report.

**Status: NOT CERTIFIED (2/20). LEGACY.**

---

### META-AGENT

#### hermes_agent.py — Score: 3/20

| Dimension | Score | Evidence |
|---|---|---|
| Canonical source | 0 | Reads agent_results/wansoft_daily. No canonical layer |
| Business-date | 0 | Calendar date |
| Explainability | 1 | Audits agent runs and identifies failures |
| Actionability | 1 | Suggests improvements per agent |
| All other dimensions | 0-1 | |

**Status: NOT CERTIFIED (3/20). EXPERIMENTAL.** Meta-agent that audits other agents. Cannot certify until the agents it audits are certified.

---

### WANSOFT MONITORING

#### wansoft_staleness.py — Score: 3/20

Checks wansoft_kpis freshness. Calendar date. No quality framework. Will be deprecated post-cutover.

**Status: NOT CERTIFIED (3/20). LEGACY.**

---

## Certification Matrix

| Agent | Score | Status | Blocker |
|---|---|---|---|
| pos_intraday_snapshot | N/A | **CERTIFIED** (producer) | — |
| pos_daily_aggregator | N/A | **BLOCKED** (producer) | No finalization signal |
| speed_of_service | 11/20 | **PROVISIONAL** | No live run, no monitoring eligibility |
| anomaly_detector | 9/20 | **NOT CERTIFIED** | No monitoring eligibility, no uncertainty, no provenance |
| table_time_agent | 7/20 | **NOT CERTIFIED** | No monitoring eligibility, no uncertainty |
| close_predictor | 6/20 | **NOT CERTIFIED** | DOW bug in main(), no monitoring eligibility |
| proactive_alerts | 6/20 | **NOT CERTIFIED** | DOW bug in main(), no monitoring eligibility |
| upselling_agent | 5/20 | **NOT CERTIFIED** | DOW bug, runtime failures in Gate 4 |
| auto86_agent | 5/20 | **NOT CERTIFIED** | No quality framework |
| stock_alert_agent | 5/20 | **NOT CERTIFIED** | No quality framework |
| inventory_auto_order | 5/20 | **NOT CERTIFIED** | No quality framework |
| config_validator | 5/20 | **NOT CERTIFIED** | No quality framework |
| antifraud_agent | 4/20 | **NOT CERTIFIED** | Calendar dates, no quality framework |
| kitchen_quality | 4/20 | **NOT CERTIFIED** | Mixed sources, calendar dates |
| menu_engineering | 4/20 | **NOT CERTIFIED** | Calendar dates |
| staffing_optimizer | 4/20 | **NOT CERTIFIED** | Calendar dates |
| cost_variance | 4/20 | **NOT CERTIFIED** | Calendar dates |
| tips_analyzer | 3/20 | **NOT CERTIFIED** | Calendar dates |
| waste_detector | 3/20 | **NOT CERTIFIED** | Calendar dates |
| supplier_monitor | 3/20 | **NOT CERTIFIED** | Calendar dates |
| daily_briefing | 3/20 | **LEGACY** | Wansoft-only |
| hermes_agent | 3/20 | **EXPERIMENTAL** | Meta-agent, depends on fleet |
| purchase_predictor | 3/20 | **LEGACY** | Wansoft-derived |
| crm_recompra | 2/20 | **LEGACY** | Wansoft-only |
| weekly_summary | 2/20 | **LEGACY** | Wansoft-only |
| weekly_amalay | 2/20 | **LEGACY** | Wansoft-only |

---

## Score Distribution

| Range | Count | Classification |
|---|---|---|
| 19-20 (REFERENCE) | 0 | — |
| 15-18 (CERTIFIED) | 0 | — |
| 10-14 (PROVISIONAL) | 1 | speed_of_service |
| 0-9 (NOT CERTIFIED) | 23 | All others |

**Certified agents: 0.**
**Provisionally certified: 1** (speed_of_service).
**Blocked producers: 1** (pos_daily_aggregator).
**Legacy: 6** (Wansoft-dependent, will be deprecated).

---

## Fleet-Wide Semantic Audit

### How many independently derive current date/time?

**19 of 24 operational agents** use `datetime.now(MX_TZ).strftime("%Y-%m-%d")` or `date.today()` for current-day logic. Only 5 use the canonical `get_current_business_date()` (anomaly_detector, close_predictor, proactive_alerts, upselling_agent, table_time_agent) — and of those, close_predictor, proactive_alerts, and upselling_agent still have a SECOND calendar-date derivation in main() for DOW/historical use.

**Only 2 agents** (anomaly_detector, speed_of_service) derive the business date correctly as a single snapshot propagated to all consumers within a run.

### How many query ops_daily directly vs ops_daily_live?

| Source | Agent count |
|---|---|
| ops_daily_live (current day) | 5 |
| ops_daily_history (historical) | 9 |
| wansoft_daily directly | 6 |
| pos_orders directly | 2 |
| pos_inventory/recipes | 5 |
| External (Wansoft API, weather) | 3 |

### How many use Wansoft-derived data?

**10 agents** read from wansoft_daily, wansoft_kpis, or wansoft_waiter_categories. 6 of these are exclusively Wansoft-dependent (LEGACY classification).

### How many implement their own freshness logic?

**0 agents** implement freshness logic. No agent checks pipeline_fresh before consuming ops_daily_live. The view handles it, but agents don't verify or record the freshness state.

### How many have no monitoring eligibility?

**22 of 24.** Only menu_engineering and staffing_optimizer get partial credit for being weekly agents that run during business hours (low cross-midnight risk by schedule, not by design).

### How many silently treat missing as zero?

**NOT PROVEN for most agents.** Without inspecting every aggregation path per agent, this cannot be determined from inventory alone. However, the general pattern is that agents consume ops_daily aggregates where missing orders are simply absent from the sum — which is correct (a missing cerrada order is not revenue). The risk is in category-level analysis: "Postres: $0" could be observed-zero or missing-category.

**Known instance:** anomaly_detector Gate 4 — "Postres: $0 vs promedio $8,083" flagged as anomaly. This was observed-zero (no desserts ordered), not missing data. But the agent cannot distinguish them.

### How many emit conclusions without denominator/coverage?

**23 of 24.** Only speed_of_service provides explicit coverage denominators (kitchen_data_coverage: X/Y, quality counters).

### How many write alerts/results that surface operationally?

**All 24** send Telegram messages. 20+ write to agent_insights or agent_results tables. Any output from these agents can reach the operator.

### How many are scheduled today?

| Schedule | Agents |
|---|---|
| Hourly (2pm, 4pm, 6pm MX) | anomaly_detector, close_predictor, upselling_agent |
| Daily (7am, 3pm, 7pm MX) | config_validator, kitchen_quality, table_time_agent |
| Daily (other times) | daily_briefing, climate_events, auto86, stock_alert, inventory_auto_order, speed_of_service, intraday_sales, wansoft_staleness |
| Weekly | antifraud, tips_analyzer, menu_engineering, staffing_optimizer, supplier_monitor, waste_detector, weekly_summary, weekly_amalay, crm_recompra, purchase_predictor |
| Manual only | hermes_agent |

**All 24 operational agents are scheduled.** They run automatically on cron. Their outputs reach operators via Telegram.

---

## Top 10 Fleet-Wide Semantic Risks

### 1. Calendar-date business-day divergence (19 agents)

19 agents derive "today" from calendar date. Between midnight and 05:00 local, they query the wrong business day. This affects KPI queries, historical DOW anchors, and display dates.

### 2. Zero monitoring eligibility (22 agents)

No agent evaluates whether its analysis is contextually appropriate. At 9am with 2 orders, agents would emit "sales 95% below average" without time-of-day adjustment. At 1am post-close, agents compare partial data against full-day baselines.

### 3. No provenance recording (24 agents)

No agent records which source row it consumed. When an agent emits a wrong number, there is no audit trail to trace the source.

### 4. No uncertainty expression (23 agents)

Agents present all outputs as definitive regardless of sample size, coverage, or data quality. An analysis from 2 orders carries the same weight as one from 200.

### 5. DOW anchor calendar-date bug (3 agents fixed, 3 still broken)

close_predictor, proactive_alerts, and upselling_agent have the canonical KPI query fixed but still derive historical DOW from calendar datetime in main(). The same class of bug as anomaly_detector pre-fix (e0159cc).

### 6. Wansoft/Fullsite dual-source inconsistency (4 agents)

kitchen_quality, crm_recompra, hermes, and wansoft_query read from both Wansoft and Fullsite sources. Post-cutover, Wansoft data stops updating. These agents will silently produce stale comparisons.

### 7. Hardcoded operating hours (5+ agents)

open_hour=8, close_hour=22 hardcoded in anomaly_detector, close_predictor, table_time_agent, and others. Not from client config. Cannot be changed per-client without code modifications.

### 8. No data quality metadata in output (23 agents)

Operator receives alerts without knowing: how many orders the analysis is based on, whether the pipeline is fresh, or whether the sample is representative.

### 9. All agents emit to Telegram without gating (24 agents)

Every agent sends Telegram messages on every successful run. There is no severity gate, no operator fatigue management, no deduplication of repeated alerts across runs.

### 10. Silent degradation (unknown count)

Without inspecting every code path, it is unknown how many agents silently omit sections when data is unavailable versus explicitly stating the omission. The framework requires explicit degradation; the current fleet's behavior is NOT PROVEN.

---

## Shared Primitives Missing

| Primitive | Who needs it | Status |
|---|---|---|
| get_current_business_date() | All 24 agents | EXISTS in ops_aggregate.py. Adopted by 5. 19 remaining |
| get_business_day_bounds() | 2 direct-order agents | EXISTS. Adopted by 2 |
| get_monitoring_context() | All 24 agents | DOES NOT EXIST |
| get_client_operating_hours() | 5+ agents | DOES NOT EXIST (hardcoded 8/22) |
| record_provenance() | All 24 agents | DOES NOT EXIST |
| data_quality_block() | All 24 agents | DOES NOT EXIST (only speed_of_service has manual implementation) |
| shared_baselines | 10+ comparison agents | DOES NOT EXIST |

---

## Duplicate Logic Clusters

| Logic | Agents with independent implementation |
|---|---|
| "Today" date derivation | 19 agents: `datetime.now(MX_TZ).strftime("%Y-%m-%d")` |
| Historical same-DOW selection | 4: anomaly_detector, close_predictor, proactive_alerts, climate_events |
| Operating hours (open=8, close=22) | 3+: anomaly_detector, close_predictor, table_time_agent |
| Mesero filtering (is_mesero) | 6: anomaly, antifraud, staffing, tips, upselling, menu_engineering |
| Telegram message formatting | 24 agents (each has its own format function) |
| Agent run logging | 20+ agents via log_run (standardized — this is a SUCCESS) |

---

## Recommended Certification Order

Based on operational impact and current score:

| Priority | Agent | Current score | Key gap | Effort |
|---|---|---|---|---|
| 1 | anomaly_detector | 9 | Monitoring eligibility + provenance | Medium |
| 2 | close_predictor | 6 | DOW fix (same pattern as anomaly fix) + monitoring | Low-Medium |
| 3 | proactive_alerts | 6 | DOW fix + monitoring | Low-Medium |
| 4 | speed_of_service | 11 | Live production run + monitoring eligibility | Low |
| 5 | table_time_agent | 7 | Monitoring eligibility + provenance | Medium |
| 6 | auto86_agent | 5 | Quality framework (but low business-date risk — inventory agent) | Low |
| 7 | stock_alert_agent | 5 | Same as auto86 | Low |
| 8 | config_validator | 5 | Quality framework | Low |
| 9 | upselling_agent | 5 | DOW fix + investigate runtime failure | Medium |
| 10 | kitchen_quality | 4 | Source alignment + calendar dates | Medium |

---

## Final Question

**If AMALAY operates normally tomorrow, which Fullsite agents would you trust to autonomously surface conclusions to the operator?**

### TRUST (with caveats):

**None.**

No agent scores CERTIFIED (15+). The highest-scoring agent (speed_of_service, 11/20) has never run in production.

### PROVISIONALLY TRUST (output should be reviewed before acting):

**anomaly_detector** — IF run during business hours (10am-8pm) when calendar date = business date and day_pct > 0.1. The business-date fix is validated. The DOW fix is validated. The source is proven Fullsite. But monitoring eligibility is absent, so pre-open and post-close runs will produce distorted output.

### DO NOT TRUST YET:

**close_predictor, proactive_alerts, upselling_agent** — have the DOW calendar-date bug in main() that anomaly_detector had before fix e0159cc. Until the same single-date-snapshot pattern is applied, historical comparisons at midnight use the wrong day-of-week.

**All other agents** — insufficient quality framework. Outputs are plausible but not verifiable from the output alone. No provenance, no coverage, no uncertainty expression.

### SAFE TO RUN (low risk even uncertified):

**auto86_agent, stock_alert_agent, config_validator** — these are inventory/config agents that don't depend on business-day semantics for their core function. "Leche is out of stock" is a fact that doesn't need time-of-day adjustment. They are operationally useful even without certification, though their quality metadata should eventually be added.

**reservas_pendientes** — checks upcoming reservations. Calendar date is appropriate (reservations are by calendar date, not business date). Low risk.
