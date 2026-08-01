# Fullsite Technologies — Investment Committee Memo

**Date:** July 22, 2026
**Stage:** Pre-seed / Pre-revenue
**Sector:** Vertical AI SaaS — Restaurant Operations
**Geography:** Mexico (Monterrey), LatAm expansion thesis
**Founder:** Daniel Ramonfaur (solo founder)
**Ask:** TBD
**RFC:** FTE260611P18 (registered June 2026)

---

## Executive Summary

Fullsite is building an AI-native operating system for restaurants, starting with a POS that replaces legacy systems (Wansoft/NetSilver) and layering intelligence on top of transactional data. The founder has spent 3+ months doing deep reverse engineering of the incumbent (Wansoft, ~20 years in market, 104 employees) and has built a functional product currently running in shadow mode at one restaurant (AMALAY Coffee & Market, Monterrey).

The company has zero revenue, one pilot site, no co-founder, and no employees. However, it has an unusually deep product, an exceptionally well-documented knowledge base, and a founder executing at a pace that suggests either extraordinary capability or unsustainable burn.

**Recommendation: CONDITIONAL YES at $2-3M cap SAFE, $150-250K check.** Conditional on finding a co-founder and signing 3 paying customers within 6 months.

---

## 1. Technology Assessment

### What exists today

| Component | Status | Quality | Replication Cost |
|-----------|--------|---------|-----------------|
| POS (Next.js + Supabase) | Functional, 30+ features | Good — touch-optimized, dark mode, modifiers, split, KDS | $200-300K |
| Dashboard | 17 pages, Wansoft parity for analytics | Good — multi-tenant aware | $100-150K |
| AI Agents | 16 agents operational 24/7 (anomaly, predictor, antifraud, tips, etc.) | Unique — no competitor has this | $150-200K |
| Electron App | Installed on 3 terminals at AMALAY, print bridge, fingerprint | Working but fragile (no offline boot) | $50-75K |
| Multi-tenant Infrastructure | 93 tables, 194 RLS policies, client isolation | Architecturally sound, some gaps (QA report: 58 bugs, 2 CRITICAL) | $75-100K |
| Migration Pipeline | Wansoft → Fullsite (categories, units, validators, dry-run) | Designed, not yet executed end-to-end | $50-75K |
| Schema/Migrations | 8 SQL files, 5,469 lines, 100% match vs production | Professional grade | $25-50K |

**Total replication cost: $650K-$950K**

This is not a prototype. This is a product with real complexity — modifier levels, station routing, inventory deduction, offline sync, thermal printing. The architecture (Next.js + Supabase + Vercel + Electron) is modern and horizontally scalable.

### Technical risks
- **5,158-line POS monolith** (pos/page.tsx) — will need decomposition
- **No offline boot** — Electron loads from Vercel URL; restaurant can't operate without internet to start
- **58 certified bugs** (2 CRITICAL, 13 HIGH) — found through rigorous QA with adversarial validation
- **Single point of failure on Wansoft cookie** for data pipeline (64% of analytics blocked when cookie expires)
- **No automated tests** — all validation has been manual or via QA agents

### Technical strengths
- **AI agents are genuinely differentiated** — 16 autonomous agents monitoring operations 24/7. No restaurant POS in Mexico has this.
- **Multi-tenant from day 1** — most competitors bolt this on later
- **Event sourcing shadow mode** operational since June 12
- **QA process** (8 parallel agents, adversarial validation, confidence scoring) shows engineering maturity unusual for a solo founder

**Technical score: 7.5/10** — Impressive breadth for a solo founder. Depth needs work in reliability, testing, and offline.

---

## 2. Intellectual Property

This is where Fullsite is genuinely unusual for its stage.

### Wansoft Reverse Engineering
- **POS Bible:** ~1,100 lines, 25 sections, every flow documented with screenshots and physical tickets
- **Strategy Bible:** 918 lines, 211 "caminitos" (paths) through the Wansoft portal
- **Architecture Report:** 608 lines, deep analysis of Wansoft's .NET/SQL Server stack
- **Data Model:** 302 lines, extracted from actual database backup (1.78 GB)
- **Backoffice Knowledge:** 232 lines of operational knowledge
- **Caja Spec:** 523 lines from live terminal captures

**Total: ~3,700+ lines of structured competitive intelligence.**

This is not a feature comparison spreadsheet. This is a deep understanding of WHY a system that survived 20 years makes every decision it makes. It includes business rules, fraud prevention logic, edge cases, permission models, and operational workflows that took Wansoft decades to discover.

### Operational Knowledge
- **Eduardo sessions:** Multiple field sessions with a restaurant manager who configured Wansoft for years. His knowledge of anti-fraud, permissions, workflows, and operational edge cases is encoded in documentation.
- **ICP Playbook:** 850 lines, 3 ICPs, competitive analysis, customer journey, expansion strategy
- **Najera Playbook:** Complete extraction of a $40K growth program (57 pages, 4 modules, 9 revenue pillars)
- **Customer #2 Acceptance Criteria:** 28 verifiable criteria, 9 failure scenarios

### Moat Assessment
The combination of Wansoft reverse engineering + Eduardo's operational expertise + AI agents creates a knowledge moat that would take any competitor 12-18 months to replicate, assuming they could even get access to a Wansoft installation and an experienced operator willing to share knowledge.

**IP score: 9/10** — Exceptional for stage. This is the company's strongest asset.

---

## 3. Distribution

### Current state
- **AMALAY (paying):** $2K/month, Daniel's family restaurant. Revenue is real but not arm's length.
- **Pipeline:** Grupo Galeria (multi-unit), Kali, OUM (prospect from Eduardo). None confirmed.
- **Eduardo de la Garza:** Ex-Wansoft commercial director who built their sales team from 2 to 35. Currently helping Daniel with AMALAY. Not on payroll or cap table. Potential first hire for commercial.
- **Susy Gonzalez:** Ex-Wansoft/Parrot. Bi-weekly mentor. Knows the industry deeply.
- **Kalina Hadzhitodorova:** Ex-Rappi/Uber/Amazon/Stanford. Advisor prospect. GTM insights.

### GTM strategy
- Target: restaurants in Monterrey with $500K-$5M annual revenue, currently on Wansoft or manual
- Price: $1,999/month (recently resolved — was a blocker)
- Onboarding goal: <30 minutes from zero to first order
- Sales channel: landing → Telegram → prospect tracking → demo

### Distribution risks
- **Zero proven sales capability** — all current traction is family/network
- **No outbound machine** — no SDR, no sequences, no pipeline tracking
- **Monterrey-only** — geographic concentration risk
- **Wansoft switching cost** — restaurants resist change; "Wansoft works, why switch?"

**Distribution score: 3/10** — Weakest area. Product is ahead of distribution by a wide margin.

---

## 4. Founder Assessment

### Daniel Ramonfaur

**Strengths:**
- **Execution speed is extraordinary.** In 3 months: built a full POS, 17-page dashboard, 16 AI agents, Electron app, print bridge, fingerprint integration, migration pipeline, 93-table schema. This is the output of a 5-person team.
- **Technical depth is real.** Not a no-code founder. Understands architecture, databases, RLS, event sourcing, offline sync. Makes sound technical decisions (Supabase over Firebase, Next.js over React SPA, Electron for desktop).
- **Product obsession.** Eduardo feedback session notes show Daniel thinks about UX at the pixel level ("font size 10%", "grid not plano", "items sent = not editable"). This is founder-product-fit.
- **Intellectual honesty.** The QA process included adversarial validation — Daniel asked the system to refute its own findings. 3 bugs were eliminated as false positives. This level of rigor is rare.
- **Domain access.** Owns a restaurant, has the incumbent's system running in the same building, has the ex-commercial director of the competitor helping for free. This is an unfair advantage.

**Weaknesses:**
- **Solo founder risk is the #1 concern.** Building everything alone means: no accountability partner, no complementary skills, single bus factor, harder to fundraise, unsustainable pace.
- **Commercial capability unproven.** Daniel is a builder, not a seller. Has not closed a single arm's-length customer. The Najera Playbook extraction suggests awareness of this gap but no evidence of execution.
- **Potential scope creep.** The breadth of the system (POS + dashboard + agents + migration + Electron + offline + inventory + CFDI) is impressive but risky. A focused competitor could win a narrower wedge faster.
- **Co-founder search stalled.** Evaluated Mike (5/10), Hugo (3/10), Carlos Lopez (part-time only). No committed co-founder after months of searching. This is a yellow flag.

**Founder score: 7/10** — Strong builder, unproven seller. Solo founder risk is material but mitigable.

---

## 5. Market

### Mexico Restaurant POS
- ~600,000 restaurants in Mexico
- POS penetration estimated at 15-25% (mostly in cities)
- Market dominated by: Wansoft/NetSilver (legacy, 104 employees), Parrot (VC-backed, shrinking -7% headcount), Clip (payments first, POS second), SoftRestaurant, Nacional Soft
- No dominant AI-native player exists

### Vertical AI SaaS
- Global trend: horizontal AI tools commoditizing; vertical AI capturing value
- Restaurant vertical AI is early — Toast just launched AI agents in US
- Mexico is 3-5 years behind US in restaurant tech adoption
- First-mover advantage is real if execution follows

### TAM/SAM/SOM
- TAM: 600K restaurants × $24K/year = $14.4B (Mexico)
- SAM: 50K restaurants (cities, $500K+ revenue, tech-ready) × $24K = $1.2B
- SOM (Year 1): 10-50 restaurants × $24K = $240K-$1.2M ARR

### Market score: 7/10 — Large market, weak competition, timing is right. But Mexico execution is harder than US (lower willingness to pay, longer sales cycles, cash-heavy economy).

---

## 6. Risks — Brutally Honest

### Company-killing risks
1. **Solo founder burns out.** Daniel is operating at a pace that is not sustainable for 12+ months. If he stops, everything stops. No one else can maintain the codebase.
2. **Can't close customers.** If AMALAY remains the only customer for 6+ months, the thesis is dead. Family restaurant revenue is not product-market fit.
3. **Wansoft fights back.** Wansoft has 104 employees and decades of relationships. If they modernize (unlikely but possible) or if they actively block migration (more likely), switching becomes harder.
4. **Capital runway.** No disclosed fundraise. Personal burn rate unknown. If Daniel needs income before reaching revenue, the company dies.

### Serious risks
5. **No co-founder.** Makes fundraising harder, reduces optionality, increases fragility.
6. **Technical debt accumulating.** 58 bugs, 5K-line monolith, no automated tests. At some point this slows development to a crawl.
7. **Offline dependency.** If a restaurant's internet goes down and Fullsite can't operate, word spreads fast in a small market.
8. **Wansoft cookie dependency.** 64% of analytics blocked when cookie expires. This is not a production-grade data pipeline.
9. **Eduardo is not committed.** He's helping for free, not on payroll, not on cap table. If he stops, Daniel loses his most valuable domain expert.

### Manageable risks
10. **Multi-tenant security.** 2 CRITICAL bugs in RLS. Fixable in days, but must be fixed before Customer #2.
11. **Mexico market dynamics.** Restaurants are price-sensitive, cash-heavy, change-resistant. Requires patience and local relationships.

---

## 7. Comparables

| Company | Stage at comparable point | Revenue | Product | Valuation | Notes |
|---------|--------------------------|---------|---------|-----------|-------|
| **Toast** (2013) | Pre-seed, 1 restaurant pilot | $0 | Basic POS | ~$2M | Went on to $30B+ market cap |
| **Olo** (2005-2010) | Years of slow growth, few customers | <$1M | Online ordering only | ~$5M | Took 15 years to IPO at $3.6B |
| **Parrot** (2018) | Seed, MX market | ~$0 | POS for LatAm restaurants | ~$3-5M | Raised $12M Series A, now shrinking |
| **MarginEdge** (2015) | Pre-seed, 1 restaurant | $0 | Invoice processing | ~$1-2M | Raised $45M total, restaurant back-office |
| **SpotOn** (2017) | Seed | <$1M | POS + payments | ~$5M | Now valued at $3.6B |
| **Lunchbox** (2019) | Pre-seed | $0 | Online ordering for restaurants | ~$2-3M | Raised $70M total |

**Pattern:** Most successful restaurant tech companies started with 0-1 customers and a narrow wedge. Toast started with a single restaurant in Boston. The difference between success and failure was always distribution, not product.

**Fullsite vs comparables at same stage:**
- Product: **ahead** of most at pre-seed (broader, more features, AI agents)
- Revenue: **behind** (should have 3-5 paying customers by now)
- Team: **behind** (solo founder vs typical 2-3 co-founders)
- Knowledge: **far ahead** (no comparable has 3,700 lines of competitor reverse engineering)
- Distribution: **behind** (no sales machine)

---

## 8. Valuation Scenarios

### Scenario 1: Liquidation Value — $50-100K
If Daniel stops tomorrow, what are the assets worth?
- Codebase: minimal value without the founder (custom Next.js app, no one else can maintain)
- IP/documentation: $25-50K to a competitor who wants the Wansoft knowledge
- Domain (fullsite.mx): $5-10K
- Supabase data: minimal
- **Total: $50-100K**

### Scenario 2: Technology/IP Value — $500K-$1M
What would it cost a well-funded competitor to replicate everything Fullsite has built?
- Codebase replication: $650-950K (6-12 months, 3-4 engineers)
- Wansoft reverse engineering: $200-300K (3+ months of dedicated access + Eduardo relationship)
- AI agents: $150-200K (unique, no template to copy)
- Operational knowledge base: $100-150K (field research, SOPs, edge cases)
- **Total: $1.1-1.6M replacement cost → $500K-$1M fair value (discount for single-founder risk)**

### Scenario 3: Strategic Acquisition Value — $1.5-$3M
If Clip, Parrot, or a payments company wanted to acquire Fullsite for the technology + Wansoft migration playbook:
- Technology: $500K-$1M
- Wansoft customer migration playbook: $500K-$1M (this is the real strategic value — a proven path to migrate Wansoft's installed base)
- Eduardo relationship + operational knowledge: $250-500K
- Daniel as acqui-hire (12-month retention): $250-500K
- **Total: $1.5-$3M**

### Scenario 4: Venture-Backed Pre-Seed Valuation — $2-4M cap
Standard pre-seed SAFE terms for a company with:
- Functional product (ahead of most pre-seed)
- One pilot customer (behind — should have 3-5)
- Large addressable market ($1.2B SAM in Mexico)
- AI-native thesis (hot sector)
- Solo founder (discount)
- Deep domain knowledge (premium)
- No revenue (standard for pre-seed)

**Comparable pre-seed caps in LatAm (2025-2026): $2-5M**

Fullsite would be at the lower end due to solo founder + zero arm's-length customers, but above floor due to product maturity and AI differentiation.

**Fair pre-seed cap: $2-3M for a $150-250K SAFE.**

---

## 9. Investment Decision

### Would I invest?

**Conditional YES.**

### Why yes:
1. **The founder is building at 5x the pace of a typical solo founder.** The output of the last 3 months is genuinely impressive. This person can ship.
2. **The knowledge moat is real.** 3,700 lines of Wansoft reverse engineering + Eduardo's operational expertise + AI agents = something no competitor has or can easily replicate.
3. **The market timing is right.** Wansoft is aging (2007 .NET stack), Parrot is shrinking, Toast hasn't entered Mexico. There's a window.
4. **AI-native restaurant POS is an inevitable category.** Someone will build this. Daniel has a 3-month head start and deeper domain knowledge than anyone else attempting it in Mexico.
5. **The Wansoft migration playbook is a wedge.** If Fullsite can prove it can migrate a Wansoft restaurant in <30 minutes with zero data loss, the sales pitch writes itself: "Everything you have, but better, cheaper, and with AI."

### Why conditional:
1. **Must find a co-founder within 6 months.** Ideally commercial (to complement Daniel's technical strength). Eduardo is the obvious candidate but needs to commit formally.
2. **Must sign 3 paying customers within 6 months.** Not family. Not friends. Arm's-length restaurants that choose Fullsite over alternatives and pay $1,999/month.
3. **Must fix the CRITICAL bugs before scaling.** The 2 CRITICAL security issues (credentials_vault RLS, api-auth fallback) and the offline boot dependency are non-negotiable before Customer #2.

### At what valuation:
**$2.5M cap SAFE, $200K check.**

### What would double the valuation in 12 months:
1. **5+ paying customers** with <5% monthly churn → proves PMF → $5-6M cap
2. **Co-founder joins** (ideally with commercial or operational background) → reduces risk → +$1M to cap
3. **Wansoft migration proven** end-to-end (shadow day passes equivalence test) → proves wedge → +$500K
4. **Monthly revenue reaches $15-20K ARR** → proves willingness to pay → $5-8M cap for seed round
5. **AI agents produce measurable ROI for a customer** (documented: "Fullsite's AI detected $X in fraud" or "saved Y hours/week") → proves differentiation → +$1-2M to cap

### What I'd tell Daniel:
Stop building features. Start selling. Your product is 6 months ahead of your distribution. Every week you spend adding features instead of closing customers, the gap widens. The next 90 days should be: fix the 3 critical bugs, run the Wansoft shadow test, migrate AMALAY, and spend 50% of your time on outbound sales. If you can show me 3 paying customers and a co-founder by January 2027, I'll lead your seed round at $5-8M.

---

## Appendix: Key Metrics to Track

| Metric | Current | Target (6 months) | Target (12 months) |
|--------|---------|-------------------|---------------------|
| Paying customers | 1 (family) | 5 (arm's length) | 15-20 |
| MRR | $2K | $10-15K | $30-40K |
| Monthly churn | N/A | <5% | <3% |
| Onboarding time | Unknown | <30 min | <15 min |
| Bugs (CRITICAL/HIGH) | 2/13 | 0/0 | 0/0 |
| Co-founder | No | Yes | Yes |
| NPS | Unknown | >50 | >60 |
| Wansoft migrations completed | 0 | 3 | 10 |
| AI agent ROI documented | 0 | 1 case study | 3 case studies |
