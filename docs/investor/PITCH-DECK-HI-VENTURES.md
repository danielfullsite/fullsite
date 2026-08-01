# Fullsite — Pitch Deck
## Hi Ventures | Julio 2026

---

## SLIDE 1 — COVER

**fullsite**

The restaurant that runs itself.

Pre-Seed | Julio 2026

---

## SLIDE 2 — THE PROBLEM

**Restaurants discover operational problems too late.**

- 80% of restaurants that open fail within 2 years globally
- The #1 cause is not bad food — it's invisible operational bleeding
- Waste, fraud, poor purchasing, labor inefficiency, menu mispricing
- By the time the owner sees the problem in a report, the money is already gone

---

## SLIDE 3 — CURRENT SOFTWARE

**POS systems record transactions. Then they wait.**

The restaurant must search for its own problems:

- Manual end-of-day reports
- Spreadsheet analysis
- Hire a specialist to extract insights from legacy software
- No cross-system correlation (sales × weather × inventory × labor × suppliers)

The dominant POS in Mexico (Wansoft) runs .NET 4.5 from 2007.

---

## SLIDE 4 — THE THESIS

**What if the restaurant's operating system watched continuously and surfaced problems before they became losses?**

Not a dashboard that waits to be opened.
Not a report that waits to be generated.

A system that observes every transaction, detects patterns across 36 analytical dimensions, and acts.

---

## SLIDE 5 — FULLSITE

**An operational intelligence layer built on top of a production-grade restaurant stack.**

Capture → Observe → Act

- **Capture:** Full POS, KDS, inventory, cash management, event stream — every operational signal in real time
- **Observe:** 36 autonomous analytical agents running against 915 days of operational history
- **Act:** Actionable insights delivered to the operator: what to buy, what to watch, what to change

The intelligence layer requires owning the data capture layer.
That's why we built the full stack.

---

## SLIDE 6 — WHY OWN THE CAPTURE LAYER

**We tried connecting to existing POS systems first.**

- Wansoft charges $10,000 MXN per integration + $500/month just for API access
- API quality is poor — no real-time events, no item-level granularity
- Every POS vendor is a gatekeeper between us and the operational data

We needed sub-second event granularity across POS, kitchen, inventory, and payments.

So we built the entire stack.

---

## SLIDE 7 — LIVE IN PRODUCTION

**Running at AMALAY Coffee & Market since July 8, 2026.**

| Component | Status |
|-----------|--------|
| POS (3 terminals) | Production |
| KDS (kitchen display) | Production |
| Print bridge (ticket/kitchen printers) | Production |
| Offline-first / recovery | Production |
| Fingerprint authentication | Production |
| Cash drawer integration | Production |
| Cash management / cortes de caja | Production |
| Canonical inventory reconciliation | Deployed |
| CFDI 4.0 (Facturama) | Built |
| Electron kiosk apps (Windows) | Compiled & deployed |

Hardware: runs on any device — Windows, Android, tablet, existing terminal.
Zero proprietary hardware dependency.

---

## SLIDE 8 — OPERATIONAL INTELLIGENCE

**36 analytical agents. Not chatbots — autonomous operational workflows.**

Three examples running in production:

**1. Purchase Predictor**
Every Monday: analyzes 30-day purchase history, explodes recipes into ingredient demand, projects 7-day need with 15% safety margin, groups by department and supplier. Operator reviews and approves.

**2. Anomaly Detector**
Compares real-time sales against historical day-of-week patterns. Detects when a metric deviates significantly — before the owner notices.

**3. Climate + Events**
Fetches 3-day weather forecast, cross-references with 90 days of sales history and a calendar of 40+ local events (holidays, paydays, school calendar, World Cup matches in Monterrey). Recommends menu adjustments.

Also built: fraud detection, waste analysis, menu engineering (stars/cows/dogs), staffing optimization, table rotation analysis, speed of service, upselling opportunities, supplier monitoring, cost variance detection, CRM recompra, and more.

---

## SLIDE 9 — THE QUESTION WE ARE PROVING

**Leonardo asked the right question:**

*"Where is the value that restaurants will pay for — not a fixed fee, but a variable tied to measurable outcomes?"*

We have candidates:

| Operational Outcome | Measurability | Estimated Impact | Willingness to Pay |
|---------------------|--------------|-----------------|-------------------|
| Waste / merma reduction | High (inventory + recipe data) | 2-5% of revenue | Proving |
| Fraud / theft detection | High (cancellation patterns) | 1-3% of revenue | Proving |
| Purchasing optimization | Medium (supplier + demand data) | 1-2% of COGS | Proving |
| Labor / staffing efficiency | Medium (schedule vs demand) | 3-8% of labor cost | Proving |
| Menu pricing / engineering | High (margin + volume data) | 1-3% of revenue | Proving |

The honest answer: we don't know yet which one becomes the wedge.

That's exactly what the pre-seed funds will prove.

---

## SLIDE 10 — AMALAY: OPERATIONAL VALIDATION

**AMALAY Coffee & Market — Monterrey, MX**

| Metric | Value | Source |
|--------|-------|--------|
| Annual revenue (2025) | $31.1M MXN | Verified from 363 days of daily records |
| YoY growth | +12% | 2024: $27.8M → 2025: $31.1M |
| 2026 YTD (190 days) | $15.7M MXN | Through July 10, 2026 |
| Daily average | $82K MXN | 915-day average |
| Active menu items | 522 | 43 categories |
| Canonical recipes | 178 active | 708 recipe lines, 1,050 ingredients |
| Suppliers | 241 | In system |
| Staff | 40 | Active |
| Historical data | 915 days | Migrated from Wansoft + Fullsite native |
| Fullsite POS live since | July 8, 2026 | Full operational cutover |

**Important:** AMALAY is the founder's family restaurant.
This is operational validation — NOT independent commercial validation.

---

## SLIDE 11 — WHAT'S DE-RISKED / WHAT'S OPEN

| De-risked | Open |
|-----------|------|
| Full POS + KDS + printing + offline | External willingness to pay |
| 36 analytical agents built and running | Which outcome becomes the wedge |
| 915 days of operational data depth | Deployment without founder present |
| Canonical inventory / recipe reconciliation engine | Repeatable installation (<30 min) |
| Server-authoritative mutation boundary | Second restaurant validation |
| Electron kiosk deployment | Team beyond solo founder |
| Hardware-agnostic architecture | Formal incorporation |

The product risk is substantially retired.
The commercial risk is entirely open.

---

## SLIDE 12 — BEACHHEAD

**ICP: Premium casual dining / brunch + café — Monterrey metro**

- $300K – $1.5M MXN monthly revenue
- 10-40 employees
- Owner-operator or small group
- Currently using Wansoft, SoftRestaurant, or manual systems
- Pain: can't extract operational intelligence from their current system

Estimated addressable in Monterrey: 600-900 restaurants matching this profile.

**Pipeline:**

| Stage | Detail |
|-------|--------|
| Production | AMALAY (founder's restaurant) |
| LOI (non-binding) | Grupo Galeria — operates Dunkin Mexico, Carl's Jr, BWW, IHOP |
| Active conversations | 3 independent restaurants in evaluation |

---

## SLIDE 13 — BUSINESS MODEL

**Today: $1,999 MXN/month per location**

- Additional terminal: +$499 MXN/month
- Installation: $0 (BYOD — bring your own hardware)
- No long-term contract
- 78% cheaper than Wansoft in year 1 ($34K vs $155K MXN)

**Tomorrow: the variable**

Toast generates $6.15B in revenue. 81% comes from payments and lending — not software.
The SaaS fee is the wedge. The real business model is transactional.

Possible paths:
- Embedded payments (basis points on every transaction)
- Performance-based pricing (% of savings from waste/fraud reduction)
- Supplier marketplace / GPO (group purchasing)
- Lending / payroll integration

We are not pretending to have this figured out.
The pre-seed proves which model the market accepts.

---

## SLIDE 14 — COMPETITION

**Fragmented market. Weak incumbents. No real AI.**

| Competitor | Restaurants | Price | AI | Weakness |
|-----------|------------|-------|-----|----------|
| SoftRestaurant | 42,000+ | $500-$1,500/mo | No | Legacy, no intelligence |
| Wansoft (Clip) | ~2,000 | $2,499 license + SaaS | No | .NET 4.5 from 2007, closed API |
| Parrot | 1,500+ | $1,800-$2,800/mo | No | Best delivery aggregation, no AI |
| Clip POS | Large | Free + 3.6% tx | No | Payment-first, basic POS |
| Calisto AI | ~100 | Unknown | Yes | AI layer only, no full POS |
| Fudo | Growing | From $360/mo | Partial | WhatsApp AI, not full ops |

Fullsite is the only system that owns the complete capture-to-intelligence pipeline.

---

## SLIDE 15 — FOUNDER

**Daniel Ramonfaur**
Founder & CEO

- Built the entire Fullsite stack — POS, KDS, inventory, reconciliation engine, 36 AI agents, data pipeline, print bridge, offline architecture
- Deep restaurant operations domain from AMALAY
- Solo execution velocity: from zero to production in 3 months

**Domain Advisor**
Eduardo de la Garza — 13 years leading Wansoft's commercial operation. Product and go-to-market advisory.

**Hiring with this round:**
- CTO / Technical Co-founder — eliminate founder dependency, own architecture
- CCO / Head of Sales — prove repeatable sales process, build pipeline

**Cap table:** Daniel Ramonfaur — 100%

---

## SLIDE 16 — THE ASK

**$500K USD Pre-Seed**

Post-money SAFE — $5M USD cap
Standard YC terms

**Use of funds (18 months):**

| Allocation | Amount | Purpose |
|-----------|--------|---------|
| Team | $250K | CTO + Sales hire |
| Product | $100K | Deployment automation, multi-tenant, mobile |
| Go-to-market | $100K | Monterrey beachhead: 10-15 restaurants |
| Operations / legal | $50K | Incorporation, IP, compliance |

**Two risks eliminated:**

1. **Commercial validation** — prove external willingness to pay with 10-15 paying restaurants
2. **Founder dependency** — build a 3-person core that can deploy without Daniel

---

## SLIDE 17 — 18-MONTH MILESTONES

| Month | Milestone |
|-------|-----------|
| 3 | CTO hired. 3 restaurants deployed. Repeatable install process documented |
| 6 | 5 paying restaurants. $10K MXN MRR. First measurable operational outcome published |
| 9 | 10 restaurants. Sales hire producing independently. Deployment <30 min without founder |
| 12 | 15 restaurants. $30K MXN MRR. Identify the variable pricing wedge from real data |
| 18 | Seed-ready. Repeatable unit economics proven. YC W27 application submitted |

These are targets, not commitments.

---

## SLIDE 18 — CLOSING

**The product is built.**

**The question is whether restaurants will pay for operational intelligence.**

**That's what we're proving next.**

fullsite.mx
daniel@fullsite.mx

---

## APPENDIX A — TECHNOLOGY DEPTH

- **Stack:** Next.js 15, Supabase (PostgreSQL), Vercel, Claude API
- **POS:** PWA + Electron kiosk, runs on any hardware
- **Offline-first:** IndexedDB queue with conflict resolution, revision-aware optimistic concurrency
- **Inventory:** Canonical recipe versioning, R1 reconciliation engine with prevalidation-before-mutation, deterministic target locking, conservation-before-convenience (no stock clamping), pinned historical treatment immutability
- **Security:** Server-side mutation authority (3-state sale authority gate), SECURITY DEFINER privileged RPCs, anon/authenticated cannot mutate inventory directly
- **Data pipeline:** 915 days of Wansoft data migrated via Playwright scraping + API extraction + JSONB parsing
- **Event store:** Shadow-mode append-only event stream live since June 2026

## APPENDIX B — AGENT INVENTORY

36 autonomous analytical agents with 4,800+ cumulative production executions:

Anomaly Detector, Anti-Fraud, Auto-86, Climate+Events, Close Predictor, Config Validator, Cost Variance, CRM Recompra, Daily Briefing, Hermes (Intelligence Router), Intraday Sales, Inventory Auto-Order, Kitchen Quality, Menu Engineering, Menu Gap Analysis, Orchestrator, POS Aggregator, POS Snapshot, Proactive Alerts, Purchase Predictor, Reservas Pendientes, Smoke Test, Speed of Service, Staffing Optimizer, Stock Alert, Supplier Monitor, Table Time, Ticket Detail, Tips Analyzer, Upselling, Uptime Monitor, Waste Detector, Weekly Report, Weekly Summary, Wansoft Query, Wansoft Staleness.

## APPENDIX C — GRUPO GALERIA LOI

Non-binding Letter of Intent with Grupo Galeria (operates Dunkin Mexico, Carl's Jr, BWW, IHOP).
Intent to evaluate Fullsite through pilots in selected locations within 6 months.
Board member: Monica Garcia Pons.
Status: unsigned, under discussion.
