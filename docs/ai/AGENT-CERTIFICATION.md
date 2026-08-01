# Fullsite Intelligence — Engineering Philosophy and Certification Framework

> Author: Daniel Ramonfaur + Claude
> Date: 2026-07-13
> Status: v2 DRAFT — architecture specification, no implementation
> Origin: AMALAY field session Jul 12-13, 2026. WAR ROOM.

---

## What This Document Is

This is not a checklist. It is the engineering philosophy for Fullsite's operational intelligence layer.

Fullsite's value is not the POS. Any POS captures sales. Fullsite's value is what happens AFTER the sale is captured — the intelligence that tells a restaurant operator what is happening, why it matters, and what to do about it.

That intelligence must be trustworthy. If it isn't, it's worse than no intelligence at all. A wrong alert at 3pm on a Saturday costs the operator's attention and erodes trust in the entire system. Five wrong alerts and the operator stops reading them. Then the system that was supposed to make the restaurant smarter has made it noisier.

This document defines what it means for Fullsite intelligence to be trustworthy.

---

## Architecture: Truth, Intelligence, Decision

Fullsite's operational stack has three layers. They are not interchangeable. Every component must know which layer it belongs to and must never cross into another.

```
┌─────────────────────────────────────┐
│         DECISION LAYER              │
│  "What should the operator do?"     │
│  Recommends. Prioritizes. Routes.   │
│  Never invents facts.               │
└──────────────┬──────────────────────┘
               │ consumes interpretations
┌──────────────▼──────────────────────┐
│      INTELLIGENCE LAYER             │
│  "What does this mean?"             │
│  Compares. Detects patterns.        │
│  Interprets. Expresses uncertainty. │
│  Never fabricates observations.     │
└──────────────┬──────────────────────┘
               │ consumes facts
┌──────────────▼──────────────────────┐
│     OPERATIONAL TRUTH LAYER         │
│  "What happened?"                   │
│  Observes. Aggregates. Records.     │
│  Never infers. Never interprets.    │
│  A number is either measured or     │
│  it does not exist.                 │
└─────────────────────────────────────┘
```

### Operational Truth Layer

Components: pos_orders, pos_turnos, pos_audit_log, pos_intraday_snapshot, pos_daily_aggregator, ops_daily, ops_daily_live.

This layer answers: what happened. $2,221 in sales. 9 closed orders. Last order closed at 9:08pm. These are facts. They come from database rows with timestamps.

Truth never infers. If an order was not closed, it does not exist in revenue. If a kitchen lifecycle event was not recorded, the preparation time is unknown — not zero, not estimated, UNKNOWN. The truth layer does not fill gaps. It reports what it measured and declares what it could not measure.

### Intelligence Layer

Components: anomaly-detector, close-predictor, speed-of-service, kitchen-quality, menu-engineering, staffing-optimizer, and all other analytical agents.

This layer answers: what does this mean. Sales are 30% below the Sunday average. Kitchen is slower today than last week. One mesero is significantly underperforming.

Intelligence interprets truth. It compares observations against baselines, detects deviations, identifies patterns. But it must never fabricate the observations it interprets. If the truth layer says "9 orders, $2,221" the intelligence layer works with exactly those numbers. It does not round, estimate, or adjust the raw facts — it interprets them.

Intelligence must also express uncertainty. "Sales are 30% below average based on 4 comparison Sundays" is intelligence. "Sales are low" is opinion. The difference is the evidence chain.

### Decision Layer

Components: proactive-alerts, actionable recommendations within agent outputs, future operator notification system.

This layer answers: what should the operator do. Investigate why dessert sales are zero. Reorder milk. Talk to the slow mesero.

Decisions consume interpretations and produce recommendations. A decision must never bypass the intelligence layer to act directly on raw data, and must never present a recommendation without the interpretation that justifies it.

"Reorder milk" requires: truth (2L in stock), intelligence (consumption rate 3L/day, reorder point 5L), decision (order today, quantity 10L). If any layer is missing, the recommendation is unjustified.

### Why separation matters

When these layers blur, failures become invisible:

- An agent that infers a missing observation (truth violation) will produce plausible but wrong intelligence
- An agent that recommends without interpreting (skipping intelligence) will produce confident but unexplainable decisions
- An agent that presents interpretations as facts (intelligence pretending to be truth) will erode trust when the interpretation turns out wrong

Every Fullsite agent must declare which layer it operates in. Most agents span intelligence + decision. None should span truth + intelligence — that's the producer's job.

---

## Truthfulness Principles

These are not rules. They are principles discovered through building and breaking Fullsite's operational stack. They were learned the hard way — from field sessions, midnight debugging, and orders that appeared in the wrong business day.

They apply to every component of Fullsite Intelligence, not just agents.

### 1. Server version must come from server

When a client stores a timestamp locally and the server generates a different one via trigger, the client's version is wrong. The server is the source of truth for server-generated values. This principle extends beyond timestamps: any value that the server computes (totals, status, generated_at) must be read back from the server after write, never assumed from the client's pre-write state.

*Origin: conflict false-positive bug (c29e75e). Frontend stored client-generated updated_at; server trigger generated a different one. Every subsequent conflict check failed.*

### 2. One canonical business day

A business day is not a calendar date. It is defined by a timezone-aware boundary (e.g., 05:00 local) stored in client configuration. Every component that attributes an event to a business day — producers, agents, views, displays — must use the same canonical primitive. Two implementations of "what day is it" will eventually diverge.

*Origin: snapshot used 5am boundary, aggregator used midnight. An order closed at 1am local appeared in Jul 12 snapshots but was excluded from the Jul 12 aggregator. STOP-THE-LINE.*

### 3. Shared primitives over duplicated logic

If two components need the same calculation, the calculation must exist once. Not "equivalent implementations in two files." Once. In a shared module. With tests. The second implementation will drift — not today, but after the third maintenance edit that touches one file but not the other.

*Origin: get_business_date() exists in ops_aggregate.py. anomaly_detector.py had its own strftime-based date derivation. They diverged after midnight.*

### 4. Coverage is a fact; confidence is an interpretation

"7 of 9 kitchen-eligible orders have lifecycle data" is a fact. "We are 78% confident in the kitchen speed metric" is an interpretation that implies statistical rigor that doesn't exist. Report coverage. Let the consumer decide whether the coverage is sufficient for their decision.

*Origin: speed-of-service kitchen metrics. 0/6 kitchen orders had lifecycle data. Calling this "low confidence" obscures the operational reality: the KDS wasn't used for those orders.*

### 5. Unknown is better than wrong

When data is missing, the correct answer is "unknown" — not zero, not estimated, not interpolated. A restaurant operator who sees "kitchen time: unknown (KDS data unavailable)" knows to check the KDS. An operator who sees "kitchen time: 0 min" thinks the kitchen is impossibly fast.

*Origin: kitchen lifecycle audit. Orders without status_changed audit events could have had kitchen_mins silently set to null and averaged away, producing a "confident" metric from incomplete data.*

### 6. Every conclusion must be reconstructable

An operator (or a debugging engineer) must be able to take any agent output and trace it backward to the source rows that produced it. This requires: the observation, the comparison cohort (with exact dates), the expected value, the deviation, the threshold, and the reasoning. If any link is missing, the conclusion cannot be verified.

*Origin: anomaly-detector emitted "4 anomalies" without recording which historical dates it compared against. When the DOW was wrong (comparing Sunday data against Monday baseline), there was no way to detect the error from the output alone.*

### 7. A missing observation is different from a negative observation

"Zero dessert sales" and "dessert sales data unavailable" are completely different signals. The first means customers didn't order dessert. The second means the measurement system didn't capture dessert orders. Agents must distinguish between observed-zero and not-observed.

*Origin: category anomaly for "Postres: $0 vs promedio $8,083". This was observed-zero (no desserts in 9 test orders), which is different from "dessert tracking broken." But the agent cannot distinguish them from the aggregate alone — it needs the truth layer to declare coverage.*

### 8. Operational context precedes statistical interpretation

A statistical deviation is not an anomaly if the operational context explains it. $2,221 at 1am is not "93% below Sunday average" — it's "the restaurant closed 3 hours ago and this is the final total for a field testing session." The same number at 4pm on a normal Sunday IS an anomaly. Context determines whether a deviation is signal or noise.

*Origin: anomaly-detector at 01:36 local compared field-test partial data against full-day Sunday baseline. Mathematically correct. Operationally meaningless.*

### 9. Producers and consumers must share semantics

If the snapshot producer defines a business day as [05:00, next 05:00) and an agent consumer defines "today" as the calendar date, they will disagree about which orders belong to today. Semantic alignment is not optional. It is not "nice to have." It is a correctness requirement.

*Origin: the entire business-date divergence arc. Producer wrote fecha=Jul 12 at 00:30 local. Agent queried fecha=Jul 13 because it used calendar date. Agent got no_data. The pipeline was healthy. The semantics were broken.*

### 10. Never silently degrade

When an agent cannot produce its full analysis — missing data, stale pipeline, insufficient sample — it must say so explicitly. Not by omitting the metric. Not by returning a partial result without labeling it partial. Explicit degradation: "Kitchen timing unavailable: 0/6 kitchen-eligible orders with KDS lifecycle data." The operator knows what they're not seeing and why.

*Origin: speed-of-service could have silently omitted the kitchen section when no audit data existed, making the output look complete when it was partial.*

### 11. Infrastructure correctness before AI reasoning

No amount of intelligent analysis fixes a wrong input. If the business-date attribution is wrong, every agent that reads it produces wrong conclusions from correct reasoning. Fix the plumbing before optimizing the analytics.

*Origin: the timezone bug in pos_daily_aggregator was a plumbing issue. It would have caused every downstream agent to analyze the wrong day's data. We caught it before any agent consumed the wrong data — but only because we traced the full provenance chain before activating agents.*

### 12. Field validation beats synthetic testing

A test with mock data proves the code handles the mock correctly. A test with production data on physical hardware in a real restaurant proves the system works. Every critical path — business-date attribution, snapshot production, agent consumption, ops_daily_live eligibility — was validated with real Jul 12 orders from real AMALAY terminals. The bugs found in the field (printer schema, loadStations wrapper, conflict false positive) were invisible in code review.

*Origin: the entire Jul 12 field session. 20 incidents, 4 regressions from generalization, 2 business-date divergences — none predicted by synthetic testing.*

---

## What Is a Production Agent?

A production agent is one that has earned the right to emit conclusions that operators act on.

It is not merely an agent that runs without errors. It is not an agent that produces output. It is an agent that meets every one of these criteria:

**1. Uses exclusively canonical sources.** It reads from ops_daily_live, ops_daily_history, or pos_orders through canonical business-day bounds. It does not query raw tables with ad-hoc date filters. It does not compute its own aggregates from pos_orders when an aggregate already exists in the canonical layer.

**2. Shares semantics with the platform.** Its definition of business day, revenue, ticket, kitchen order, station, coverage, and freshness is identical to every other agent's. It imports these definitions from shared primitives. It does not reimplement them.

**3. Declares the quality of its data.** Every run records: pipeline freshness, data freshness, coverage, sample size, and any degradation. An operator or engineer reading the output can assess whether the analysis is based on sufficient evidence without re-running the agent.

**4. Explains every conclusion.** Every finding includes: what was observed, what it was compared against (with exact comparison dates), what was expected, how far the observation deviated, what threshold was applied, and why the conclusion follows. No finding stands alone without its evidence chain.

**5. Expresses uncertainty when warranted.** When coverage is low, sample is small, or instrumentation is incomplete, the agent says so using the standard vocabulary. It does not present thin evidence as confident analysis. It does not hide gaps behind omission.

**6. Evaluates monitoring eligibility.** Before emitting conclusions, the agent verifies: is there source data? Is the pipeline fresh? Is the sample representative? Is the current time within a meaningful operating context? If any check fails, the agent defers or degrades explicitly — it does not emit a confident conclusion from inappropriate context.

**7. Recommends within operational scope.** Every actionable finding specifies: what to do, why, who should do it, and how urgent it is. Recommendations are grounded in the evidence. The agent does not suggest actions the operator cannot take, and does not emit alerts for situations that are normal and expected.

**8. Has been validated with field evidence.** The agent has been run against real production data — not just synthetic tests — and its output has been reconciled against source truth. The reconciliation is documented: which source rows, which aggregate, which output, whether they match.

An agent that meets all eight criteria is production-grade. An agent that meets some is provisional. An agent that meets few is experimental.

The goal is not to certify agents quickly. The goal is to certify them correctly.

---

## Framework Sections

### 1. Data Provenance

Every number an agent emits must be traceable to its source rows.

Every agent run must record:

| Field | Description |
|---|---|
| `source_view` | Which view/table the agent read |
| `source_fecha` | Which business date was queried |
| `source_record_type` | snapshot, cierre, cierre_wansoft |
| `source_system` | fullsite, wansoft |
| `source_generated_at` | Pipeline timestamp of the source row |
| `source_data_freshness` | Last real event timestamp in the source |
| `source_rows` | How many underlying records the source aggregated |

Agents do not need to re-query pos_orders to verify the aggregate. They trust the canonical layer. But they must record WHICH canonical row they consumed.

When an agent is wrong, the first question is not "what's wrong with the logic?" It's "what source did it read?" Provenance answers that question.

### 2. Canonical Semantics

Concepts that appear in multiple agents must have ONE definition, ONE implementation, and ZERO local reimplementations.

**Must be centralized:**

| Concept | Canonical source |
|---|---|
| Business date | `ops_aggregate.get_business_date()` |
| Current business date | `ops_aggregate.get_current_business_date()` |
| Business day bounds | `ops_aggregate.get_business_day_bounds()` |
| Client timezone | `clients.timezone` via `get_business_day_config()` |
| Business day boundary | `clients.business_day_start_local` |
| Revenue recognition | `status='cerrada'`, enforced by producers |
| Pipeline freshness | `ops_daily_live.pipeline_fresh` |
| Data freshness | `ops_daily.data_freshness` |
| Station routing | `pos_orders.items[].station` |
| Kitchen eligibility | At least one item with `station='cocina'` |

**May be agent-specific:** anomaly thresholds, comparison windows, alert severity, display formatting.

**The rule:** if you're writing a date calculation, timezone conversion, or revenue filter inside an agent, stop. It belongs in the shared layer.

### 3. Data Quality Vocabulary

Agents must use a shared vocabulary. No agent invents its own terms.

| Term | Meaning |
|---|---|
| `pipeline_fresh` | Source produced by a recent pipeline run |
| `pipeline_stale` | Source exists but produced too long ago |
| `data_fresh` | Last real operational event is recent |
| `data_quiet` | No recent events, but pipeline is healthy (normal after close) |
| `representative` | Sample large and diverse enough for the conclusion |
| `insufficient_evidence` | Data exists but sample too small |
| `missing_instrumentation` | Data model cannot capture what we need |
| `degraded` | Agent produces partial output, not full analysis |
| `no_data` | No source data exists for the query |
| `coverage` | Fraction of eligible entities with sufficient data |

Critical distinction: `data_quiet` is not `pipeline_stale`. A restaurant closed at 10pm with no new orders at 1am is operating normally. The pipeline is healthy. The data is simply quiet.

### 4. Monitoring Eligibility

Not every moment is appropriate for operational monitoring.

Before emitting conclusions, an agent evaluates:

1. Is there source data for the business date? NO → `no_data`, defer.
2. Is the source pipeline fresh? NO → `pipeline_stale`, degrade or defer.
3. Is the sample representative? NO → `insufficient_evidence`, emit with caveat or defer.
4. Is the current time within meaningful operating context? `pre_open` → defer. `operating` → full emit. `quiet_period` → emit with temporal context.
5. If comparing intraday against full-day historical: adjust for time-of-day progress explicitly.

An agent must never emit "sales are 70% below average" at 9am with 2 orders without time-of-day adjustment. It must never report "pipeline stale" when the restaurant is simply closed.

### 5. Explainability

Every finding includes:

| Field | Example |
|---|---|
| `observation` | "Ventas a las 4pm: $28,500" |
| `comparison_cohort` | "Promedio ultimos 4 domingos a esta hora" |
| `cohort_dates` | ["2026-07-05", "2026-06-28", "2026-06-21", "2026-06-14"] |
| `expected` | "$32,100 (avg $55K x 58% day progress)" |
| `deviation` | "-11.2%" |
| `threshold` | "Alert at +/-25%" |
| `conclusion` | "Ventas dentro de rango normal para domingo" |
| `evidence_basis` | "4 comparison days, 45 orders, pipeline fresh" |

Even simple agents follow this pattern. A stock alert: observation (2L), threshold (reorder at 5L), conclusion (below reorder), action (order 10L), basis (stock updated 2 hours ago).

### 6. Uncertainty

| Level | When to use |
|---|---|
| `definitive` | Complete, verified data for a closed business day |
| `high_coverage` | Most relevant data present, minor gaps |
| `moderate_coverage` | Meaningful sample, significant gaps |
| `low_coverage` | Data exists but thin sample |
| `insufficient` | Cannot form reliable conclusion |
| `unknown` | Cannot determine data quality |

Never use standalone confidence numbers ("85% confident"). Always state the denominator ("based on 7 of 9 eligible orders"). When degraded, state what IS available, not just what isn't.

### 7. Cross-Agent Consistency

Agents analyzing overlapping domains must not contradict each other from the same source data.

Invariants:
- Same source, same number. All agents reading ops_daily_live for the same fecha see the same ventas_dia.
- Same date, same DOW. All agents derive business_date from the same primitive.
- Same vocabulary. "Kitchen order" has one definition across all agents.
- Documented divergence. When agents legitimately use different cohorts (created_at vs closed_at eligibility), the difference is documented in the agent.

Implementation: shared source layer, shared primitives, shared vocabulary, and certification review — not runtime cross-validation.

### 8. Actionability

Every output answers: what should the operator do?

| Level | Example |
|---|---|
| `investigate` | "Cancelaciones arriba del promedio. Verificar platillo agotado." |
| `act` | "Leche en 2L, consumo 3L/dia. Ordenar hoy." |
| `monitor` | "Ticket promedio bajando 3 semanas. No es anomalia todavia." |
| `acknowledge` | "Dia dentro de parametros normales." |

Every action specifies: what, why, who, urgency, evidence. No action without the interpretation that justifies it.

### 9. Learning

Three types of operational memory (conceptual, not implementation):

**Baseline memory.** Historical patterns that define "normal." Sunday average ventas, kitchen time per dish, typical operating hours. Derived from data, updated as data accumulates. Per-client, per-DOW, per-metric.

**Exception memory.** Known events that explain anomalies. "Jul 12 was field testing." "Jun 15 was a private event." Prevents the same known anomaly from triggering repeatedly.

**Threshold memory.** Learned sensitivity per metric. If an agent generates 20 false positives per week, its threshold needs adjustment. Based on operator feedback: acknowledged vs dismissed.

### 10. Agent Scorecard

| Dimension | 0 — Failing | 1 — Partial | 2 — Certified |
|---|---|---|---|
| **Canonical source** | Queries raw tables, skips canonical layer | Uses canonical layer but has local date/filter logic | Canonical layer exclusively, no reimplementation |
| **Business-date semantics** | Calendar date or hardcoded timezone | Canonical primitive but secondary date derivation | Single business_date derived once, propagated to all |
| **Explainability** | Conclusion without inputs | Some inputs but missing cohort or threshold | Full evidence chain: observation → cohort → deviation → conclusion |
| **Uncertainty** | All outputs definitive regardless of coverage | Acknowledges low data without quantifying | Coverage denominator stated, standard vocabulary, explicit degradation |
| **Actionability** | States what happened, not what to do | Generic "investigate" | Specific action: who, what, why, urgency, evidence |
| **Monitoring eligibility** | Emits regardless of context | Checks data existence but not sample quality | Full eligibility: pipeline, sample, operating context |
| **Data quality metadata** | No quality information | Some fields | Full block: pipeline_fresh, coverage, representative, degraded |
| **Field validation** | Never tested with real data | Single scenario | Production data, reconciled provenance |
| **Consistency** | Different semantics than peer agents | Mostly consistent, some local definitions | All shared concepts from primitives, divergences documented |
| **Provenance** | No record of source consumed | Records table but not row/freshness | Full chain: view, row id, generated_at, record_type |

Scoring: 0-9 NOT CERTIFIED. 10-14 PROVISIONAL. 15-18 CERTIFIED. 19-20 REFERENCE.

---

## Appendix: Lessons from AMALAY RC1 → RC2

These are not bug reports. They are the architectural principles Fullsite discovered through building, deploying, breaking, and fixing its operational stack in the field.

A year from now, someone will ask why a particular rule exists. This appendix is the answer.

### Business-day semantic drift

Two producers computed business day differently. One used a 5am boundary (snapshot). One used midnight (aggregator). Both were "correct" in isolation. Together, they attributed the same order to different dates.

**Principle born:** One canonical business day. One primitive. One config. Zero local implementations. Test with a 1am order.

### Producer/consumer semantic drift

The snapshot producer wrote fecha=2026-07-12 using business-day semantics. The anomaly-detector queried ops_daily_live for fecha=2026-07-13 using calendar-date semantics. The pipeline was healthy. The data existed. The query returned empty.

**Principle born:** Producers and consumers must share semantics. Importing the same function is not a suggestion — it is the mechanism that prevents drift.

### Over-generalization regression

The original POS app had hardcoded printer stations. It worked. The generalization to dynamic printers.json introduced three bugs in one day: wrapper parsing, array printer support, and an unrecognized printer type. Each was a reasonable generalization. Together, they broke printing.

**Principle born:** Generalization earns its complexity in the field, not in code review. The old simple thing worked. The new general thing must work at least as well before shipping. Schema validation for dynamic config is not optional.

### Server timestamps vs client timestamps

The POS frontend stored a client-generated timestamp as the order's "version." The server auto-update trigger generated a different timestamp. Every subsequent conflict check detected a false positive.

**Principle born:** Server version must come from server. After any write that triggers server-side effects, read back the server's values. Never assume the client's pre-write state matches post-write reality.

### Infrastructure correctness before AI reasoning

The business-date attribution bug would have caused every downstream agent to analyze the wrong day's data. The agents' logic was correct. The input was wrong. No amount of anomaly detection sophistication compensates for receiving yesterday's data labeled as today's.

**Principle born:** Fix the plumbing before optimizing the analytics. Validate the canonical layer end-to-end (producer → view → consumer) before activating intelligent consumers.

### Field validation beats synthetic testing

Twenty incidents in one field session. Four regressions from generalization. Two business-date divergences. A printer that wasn't shared. A standalone bridge occupying a port. None of these were visible in code review or synthetic tests. All were immediately obvious when a real mesero pressed a button on a real terminal connected to a real printer.

**Principle born:** An agent that passes synthetic tests is an agent that handles synthetic scenarios. A production agent is one that has been validated against production data on production infrastructure. The gap between these two is where trust lives.

### Single-date-snapshot invariant

The anomaly-detector derived the current business date twice: once in main() for display, once in get_today_kpis() for querying. At the exact 05:00 boundary, the two derivations could return different dates. The KPI query would fetch Jul 13 data while the historical comparison anchored on Jul 12.

**Principle born:** Derive the current business date ONCE per agent run. Pass it explicitly to every consumer within the run. No second clock observation. A string snapshot of the business date eliminates boundary races by construction.

### Operational context is not statistical context

$2,221 in revenue compared against a $132,000 Sunday average produces a 98% negative deviation. Mathematically true. Operationally meaningless — the data was from a field testing session after normal hours. The agent cannot know this from the numbers alone.

**Principle born:** Operational context precedes statistical interpretation. Before calculating deviations, determine whether the comparison is meaningful. Time of day, operating hours, known exceptions, and sample representativeness are not optional metadata — they are prerequisites for interpretation.

---

## Top 10 Platform Improvements

Improvements that increase quality across ALL agents simultaneously. Not agent-specific fixes.

### 1. Shared baselines table

**Why:** Every comparison agent independently queries ops_daily_history, selects dates, and computes averages. Duplicated computation, potential divergence.

**Benefit:** One precomputed baseline per client per DOW per metric. All agents read the same number.

**Blast radius:** Read-only for agents. One new producer. Incremental adoption.

**Complexity:** Medium.

**Priority:** HIGH.

### 2. Run-level provenance record

**Why:** When an agent is wrong, we cannot currently trace which source row it consumed.

**Benefit:** Every agent run records source view, row id, generated_at, record_type. Post-hoc debugging becomes trivial.

**Blast radius:** Additive — new fields in existing log_run() call.

**Complexity:** Low.

**Priority:** HIGH.

### 3. Monitoring eligibility primitive

**Why:** Agents at 1am compared partial data against full-day averages without time-of-day adjustment.

**Benefit:** Shared function that returns operating context and day progress. Agents defer or adjust based on context.

**Blast radius:** Read-only helper. Incremental adoption.

**Complexity:** Low-Medium. Requires client operating hours in config.

**Priority:** HIGH.

### 4. Agent test harness (dry-run mode)

**Why:** Testing requires: deploy, dispatch via GitHub Actions, wait, manually inspect. No local iteration.

**Benefit:** `python agent.py --dry-run --date=2026-07-12` reads real data, skips writes and Telegram. Enables rapid iteration.

**Blast radius:** Additive flag per agent. No production behavior changes.

**Complexity:** Low per agent.

**Priority:** HIGH.

### 5. Business-date propagation to remaining agents

**Why:** 5 live agents fixed. 9 history agents still use calendar date for window calculations.

**Benefit:** Complete elimination of calendar/business-date divergence.

**Blast radius:** ~15 agents, 1-2 lines each.

**Complexity:** Low per agent, medium total.

**Priority:** MEDIUM.

### 6. Client operating hours in config

**Why:** Multiple agents hardcode open=8, close=22. If hours change, every agent needs independent update.

**Benefit:** One config change propagates to all agents.

**Blast radius:** Config column + agent reads. Same pattern as business_day_start_local.

**Complexity:** Low.

**Priority:** MEDIUM.

### 7. Pipeline health monitor

**Why:** If snapshot producer stops, agents get no_data without alert. Nobody knows until someone checks.

**Benefit:** Dedicated monitor alerting when pipeline hasn't produced within expected cadence.

**Blast radius:** Additive. One new workflow.

**Complexity:** Low.

**Priority:** MEDIUM-HIGH.

### 8. Unified agent output schema

**Why:** Each agent formats output differently. No standard structure for observation/comparison/action.

**Benefit:** Unified dashboard, cross-agent checks, automated quality scoring.

**Blast radius:** All agents need migration. Can be incremental.

**Complexity:** Medium.

**Priority:** MEDIUM.

### 9. Exception/annotation system

**Why:** Jul 12 was field testing. Agent correctly flagged low sales. The anomaly is expected and not actionable.

**Benefit:** Agents consult exceptions before emitting anomalies. Reduces alert fatigue.

**Blast radius:** Additive table. Agents adopt incrementally.

**Complexity:** Low-Medium.

**Priority:** LOW-MEDIUM.

### 10. Kitchen lifecycle persistence

**Why:** KDS item-level progress lives in localStorage. Lost on restart or if POS closes order first.

**Benefit:** Enables kitchen speed metrics, preparation time per dish, bottleneck detection.

**Blast radius:** KDS frontend + DB schema + agent consumption.

**Complexity:** Medium-High.

**Priority:** MEDIUM — blocked by KDS adoption rate.
