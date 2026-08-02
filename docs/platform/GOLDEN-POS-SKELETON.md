# Golden POS Skeleton

> **Status:** Living document — update incrementally, never rewrite wholesale.  
> **Owner:** Platform Engineering  
> **Created:** 2026-07-31  
> **Last Updated:** 2026-07-31  
> **Related:** `GOLDEN-SKELETON.md` (PR gate), `docs/feos/OVERVIEW.md`, `docs/architecture/SYSTEM-ARCHITECTURE.md`

---

## Platform North Star

> **Fullsite es la plataforma operacional autónoma para restaurantes — el sistema que se administra a sí mismo.**

El objetivo no es construir un POS mejor que Wansoft.  
El objetivo no es un Dashboard más completo que Toast.  
El objetivo es que los restaurantes no necesiten administrar software.

Un restaurante en Fullsite define sus reglas una vez — su menú, su equipo, sus políticas. Después, la plataforma opera, monitorea, certifica, recupera y optimiza de forma continua, sin intervención.

**El restaurante del futuro en Fullsite:**

- Abre sin que nadie configure nada el día de apertura.
- Recibe una alerta cuando la impresora va a fallar, antes de que falle.
- Ve su food cost en tiempo real, con recomendaciones ya calculadas.
- Tiene un agente que ajusta su inventario antes de un stockout.
- Tiene un estado digital completo: cada terminal, KDS, impresora, agente, queue y certificación — visibles desde FEOS.
- Cuando algo falla, el sistema intenta resolverlo solo. Si no puede, escala con contexto completo.

**Toda decisión de diseño, arquitectura o priorización se evalúa contra esta visión.**

---

## Platform Philosophy

Fullsite no es un POS. No es un Dashboard. No es FEOS.

**Fullsite es una plataforma operacional para restaurantes** — un sistema que se administra a sí mismo, donde las personas únicamente definen reglas, objetivos y excepciones.

Cada decisión de diseño, arquitectura o implementación debe responder estas 10 preguntas:

| # | Pregunta | Si la respuesta es "No"... |
|---|---|---|
| Q-01 | ¿Es 100% clonable para cualquier restaurante? | Es deuda de clonabilidad — documenta y convierte en FEOS backlog |
| Q-02 | ¿Es 100% multi-tenant sin excepción? | Es hardcode — elimina o mueve a config en DB |
| Q-03 | ¿Puede administrarse desde FEOS sin tocar código? | Es config atrapada en código — mueve a FEOS |
| Q-04 | ¿Puede automatizarse completamente? | Documenta el gap en §Zero Human Operations |
| Q-05 | ¿Puede operar 24/7 sin intervención humana? | Diseña para resiliencia, no para soporte |
| Q-06 | ¿Puede monitorearse en tiempo real? | Agrega observability antes de cerrar el módulo |
| Q-07 | ¿Puede certificarse automáticamente? | Agrega al módulo Auto-Certification de FEOS |
| Q-08 | ¿Puede recuperarse solo de fallos? | Diseña self-healing antes de declarar production-ready |
| Q-09 | ¿Puede ser administrado por IA? | El agente existe, ¿tiene los datos para actuar? |
| Q-10 | ¿Escala a 1,000 restaurantes sin cambiar código? | No escala — rediseña desde el contrato |

**Si la respuesta a cualquier pregunta es "no":** documenta el gap, crea el item en FEOS backlog, y define el criterio de aceptación. El gap no es un fallo — es un item del roadmap de la plataforma.

---

## 0. Golden Skeleton Family

The Golden Skeleton is not a single document. It is a family of four canonical blueprints that evolve together and share the same design goals.

| Document | Status | Scope |
|---|---|---|
| **Golden POS Skeleton** (this) | Active | Terminal app — orders, kitchen, caja, inventory, staff |
| **Golden Dashboard Skeleton** | Stub — to be created | Management layer — analytics, finance, admin, agents |
| **Golden FEOS Skeleton** | Stub — to be created | Control plane — config, provisioning, monitoring, automation |
| **Golden Foundation Skeleton** | Stub — to be created | Shared infrastructure — offline engine, bridge, printer, auth, multi-tenant DB |

**Rule:** Every capability that ships must belong to exactly one skeleton. No capability lives in two skeletons.

---

## 1. Design Goals

These goals are permanent. Every PR, ADR, and design decision in Fullsite is evaluated against them. A decision that violates a design goal requires a documented exception.

| # | Goal | Definition |
|---|---|---|
| G-01 | **100% clonable** | Any restaurant can be provisioned without touching source code. |
| G-02 | **100% multi-tenant** | No row, query, or constant belongs to a specific client by default. |
| G-03 | **Offline-first** | Core POS operations work indefinitely without internet. Data reconciles on reconnect. |
| G-04 | **LAN-first** | Kitchen display, printers, and terminals communicate over LAN. Cloud is for sync, not for operations. |
| G-05 | **FEOS-ready** | Every configurable aspect of the platform has a FEOS module that will eventually own it. No dead-end configuration. |
| G-06 | **AI-ready** | Every operational data point is observable by agents. Every alert has a structured response path. |
| G-07 | **Zero hardcodes** | No client name, category slug, RFC, phone number, or staff name exists in source code. |
| G-08 | **Zero client-specific logic** | No `if client_id === 'amalay'` branch anywhere in the platform. Feature differences live in feature flags. |
| G-09 | **Zero manual provisioning** | A new restaurant goes from contract to operational in one automated flow, with no SSH, no SQL console, no manual config editing. |
| G-10 | **Enterprise-ready** | Audit log, RLS, role-based access, and data isolation that passes SOC 2 review. |
| G-11 | **Wansoft reliability as minimum baseline** | Every module the platform shares with Wansoft must match or exceed Wansoft's operational reliability. Regressing below Wansoft is a P0. |
| G-12 | **Modern SaaS architecture** | Multi-tenant DB, feature flags by plan, config in DB not code, automated CI/CD. |

---

## 2. Platform Lifecycle

Every feature — regardless of domain — must pass through this pipeline before General Availability. Features can exist at any stage; their stage determines what they can claim.

```
IDEA → ARCH → ADR → IMPL → CERT → AMALAY → SKELETON → FEOS → AUTO → AI → GA
```

| Stage | Definition | Exit Criterion |
|---|---|---|
| **IDEA** | Concept defined, problem understood | Written one-pager |
| **ARCH** | Architecture decided, contracts drafted | Architecture doc in `docs/architecture/` |
| **ADR** | Decision recorded with alternatives and rationale | ADR in `docs/adr/` |
| **IMPL** | Code exists and passes tests | PR merged, tests green |
| **CERT** | Smoke-tested in staging, offline certified if applicable | Certification doc in `docs/certifications/` |
| **AMALAY** | Running in production, battle-tested | 30+ days live with zero P0 regressions |
| **SKELETON** | Capability extracted to platform, zero AMALAY-specific code | Listed in this document, no hardcodes |
| **FEOS** | Control plane module owns configuration | FEOS module accepts declarative config |
| **AUTO** | Provisioning and monitoring fully automated | Runbook eliminated for this module |
| **AI** | Agent monitors, predicts, and responds | Agent in `agents/` with verified outcomes |
| **GA** | Available to all clients without restriction | Feature flag removed, default enabled |

---

## 3. Platform Maturity Model

Every restaurant on Fullsite moves through these levels. Every module must declare what level it enables and what level is required for it to function.

| Level | Name | Definition | What Fullsite Enables |
|---|---|---|---|
| **L1** | **Installs** | Restaurant provisions and runs the app for the first time. POS takes an order. | Terminal provisioning, menu setup wizard, first order flow |
| **L2** | **Operates** | Restaurant runs day-to-day without external help. Staff trained, caja works, reports readable. | Turno/corte, kitchen routing, printer bridge, offline queue |
| **L3** | **Self-certifies** | Restaurant verifies its own operational readiness. Runs certification checks before each service. | Auto-Certification module in FEOS, offline smoke tests |
| **L4** | **Self-heals** | Restaurant recovers from failures without operator intervention. Printer jams re-queue. Sync gaps fill. | Recovery queue, auto-reconnect, FEOS Observability Hub alerts |
| **L5** | **Self-optimizes** | Restaurant improves performance using AI insights without external analysis. Menu, staffing, cost. | Menu Engineering, Staffing Optimizer, Food Cost agent |
| **L6** | **Self-operates** | Restaurant handles scheduling, procurement, and staff allocation with minimal human intervention. | Supplier agent, reorder automation, predictive staffing |

**Current AMALAY level:** Between L3 and L4 depending on the module.  
**Target for GA:** Every client reaches L3 within 30 days of installation.

---

## 4. Platform Scores

### 4.1 Platform Readiness Score

Scores reflect multi-tenant deployment readiness, not feature completeness. A module at 100% means it ships to a new client with zero manual intervention and zero AMALAY-specific code.

| Module | Score | Blocking Issues | Maturity Level | Last Updated |
|---|---|---|---|---|
| POS Core (orders, tables, caja) | **99%** | AMALAY category slugs in pos-constants.ts | L4 | 2026-07-31 |
| Offline Engine (IDB, sync, outbox) | **93%** | KDS sync CODE ONLY — pending smoke test | L4 | 2026-07-31 |
| KDS (kitchen display, routing) | **91%** | AMALAY station routing as default | L3 | 2026-07-31 |
| Staff & Auth (PIN, fingerprint, roles) | **88%** | Hardcoded mesero fallback in client-config.ts | L3 | 2026-07-31 |
| Inventory (stock, recipes, food cost) | **82%** | 17 SQL tables with DEFAULT 'amalay' | L2 | 2026-07-31 |
| Dashboard Analytics | **78%** | Real-time gaps, no multi-tenant agent data | L2 | 2026-07-31 |
| Finance (corte, conciliacion, CFDI) | **73%** | CFDI requires RFC per client (config, not code) | L2 | 2026-07-31 |
| AI & Agents (26 agents) | **65%** | Agents need more evidence loop, FP calibration | L2 | 2026-07-31 |
| Provisioning | **38%** | Mostly manual — no automated flow end-to-end | L1 | 2026-07-31 |
| FEOS (control plane) | **12%** | Architecture defined, implementation minimal | L1 | 2026-07-31 |

**Update rule:** When a blocking issue is resolved, update score and date. Never inflate a score without evidence.

---

### 4.2 Platform Autonomy Score

Readiness measures completeness. Autonomy measures self-management. A module can be 100% ready and 5% autonomous — that means it works perfectly but requires a human for every operation.

**Autonomy scale:**

| Level | Range | Meaning |
|---|---|---|
| Manual | 0–20% | No automation — every action requires a human |
| Assisted | 21–40% | Automation exists but must be human-initiated each time |
| Hybrid | 41–60% | System handles routine cases; human handles exceptions |
| Supervised | 61–80% | System handles almost everything; human reviews summaries |
| Autonomous | 81–100% | System self-manages; humans define rules and exceptions only |

**Platform goal:** 70%+ average autonomy across all modules within 12 months. Every FEOS module implemented adds 5–15% to the modules it owns.

| Module | Score | Bottleneck | Path to +20% | Last Updated |
|---|---|---|---|---|
| Offline Engine | **80%** | Conflict resolution requires operator decision | Automated conflict resolution; notify only on ambiguous cases | 2026-07-31 |
| POS Core | **70%** | Station config and category routing need one-time manual setup | FEOS Kitchen Manager: drag-drop routing, zero code | 2026-07-31 |
| KDS | **65%** | New station = code change + redeploy | FEOS Kitchen Manager: add station name → instant | 2026-07-31 |
| Agents / AI | **55%** | FP threshold calibration and outcome tagging are manual | Self-calibrating thresholds based on confirmed outcomes | 2026-07-31 |
| Staff & Auth | **50%** | Role assignment and biometric enrollment are manual | FEOS Staff Manager guided onboarding + enrollment wizard | 2026-07-31 |
| Printing | **45%** | Manual IP entry on setup; manual restart on printer jam | mDNS auto-discovery; print queue auto-drains on reconnect | 2026-07-31 |
| Inventory Tracking | **40%** | Reorder and receiving are manual; count requires human action | Auto-reorder alerts with approval flow; guided receiving via OC match | 2026-07-31 |
| Backup & Recovery | **30%** | Supabase auto-backup exists but restoration and DR are manual | Automated restore verification; FEOS DR wizard | 2026-07-31 |
| Health Monitoring | **15%** | Alerts exist but no automated recovery or escalation | FEOS Observability Hub: auto-restart, escalation paths | 2026-07-31 |
| Kitchen Config | **10%** | Routing rules live in code; any change needs a deploy | FEOS Kitchen Manager: rules in DB, zero deploy | 2026-07-31 |
| Provisioning | **5%** | Entire flow is manual: SQL, Supabase dashboard, config.json | FEOS Installer: name + plan → everything automated in <5min | 2026-07-31 |
| Certification | **5%** | Manual checklist walkthrough per installation | FEOS Auto-Certification: post-provisioning suite runs automatically | 2026-07-31 |
| FEOS | **5%** | Architecture defined, implementation minimal | FEOS implementation is the autonomy roadmap | 2026-07-31 |

---

## Zero Human Operations

**Goal:** Every release reduces the number of operations that require human intervention. When an operation reaches 90%+ automation, it moves to "archived" state — no longer tracked here.

**Tracking rule:** The `Auto%` column reflects today's reality, not the target. Never inflate.

| ID | Operation | Current State | Target State | FEOS Module | Auto% | Human Remaining |
|---|---|---|---|---|---|---|
| ZHO-01 | Create restaurant | SQL + Supabase dashboard manually | FEOS wizard: name + plan → tenant created | Restaurant Manager | 5% | Sign contract |
| ZHO-02 | Create admin user | Manual Supabase invite | FEOS IAM: email → invite → access granted | IAM | 10% | Enter email |
| ZHO-03 | Add team member | Manual SQL insert in client_users | FEOS IAM: invite by role | IAM | 10% | Select role + enter email |
| ZHO-04 | Multi-user org / teams | Does not exist | FEOS IAM Groups | IAM | 0% | Approve members |
| ZHO-05 | Provision terminal | onboard_client.py + manual config.json edit | FEOS Installer: terminal boots, downloads config | Installer & Provisioning | 15% | Connect to LAN |
| ZHO-06 | Configure printers | Manual IP entry in config.json | mDNS auto-discovery + FEOS Printer Manager | Printer Manager | 10% | Select paper format |
| ZHO-07 | Configure kitchen routing | Edit lib/settings.ts + redeploy | FEOS Kitchen Manager: drag categories to stations | Kitchen Manager | 10% | Assign categories to stations |
| ZHO-08 | Register fingerprints | Physical enrollment on terminal, manual | FEOS Staff Manager guided enrollment flow | Staff Manager | 0% | Physical touch required (permanent) |
| ZHO-09 | Add KDS station | Edit pos-constants.ts + redeploy | FEOS Kitchen Manager: add name → instant deploy | Kitchen Manager | 5% | Name the station |
| ZHO-10 | Update routing rules | Edit code + redeploy | FEOS Kitchen Manager UI — zero deploy | Kitchen Manager | 10% | Drag categories |
| ZHO-11 | Update terminal app | Manual Electron release + user installs | FEOS Auto-Update: silent in maintenance window | Terminal Manager | 20% | Approve maintenance window |
| ZHO-12 | Rotate secrets / tokens | Manual GitHub Secrets + Supabase dashboard | FEOS IAM: auto-rotation on schedule | IAM | 5% | Approve rotation event |
| ZHO-13 | Restart failing service | SSH or TeamViewer | FEOS Observability Hub auto-restart + alert | Observability Hub | 5% | Acknowledge alert |
| ZHO-14 | Health checks | Manual monitoring, no real-time view | FEOS Observability Hub: heartbeat + agent alerting | Observability Hub | 15% | Respond to P0 alerts |
| ZHO-15 | Certify installation | Manual checklist walkthrough per install | FEOS Auto-Certification: suite runs post-provisioning | Auto-Certification | 10% | Approve cert report |
| ZHO-16 | Toggle feature flags | Manual JSON edit in Supabase clients table | FEOS Feature Flags UI: click toggle | Feature Flags | 15% | Click toggle |
| ZHO-17 | Enable / create agents | Edit GitHub Actions YAML + commit | FEOS Agent Manager: enable per restaurant | Agent Manager | 20% | Select agents to enable |
| ZHO-18 | View logs / observability | Raw Supabase query or GitHub Actions logs | FEOS Observability Hub: structured log viewer | Observability Hub | 10% | View dashboard |
| ZHO-19 | Recover stuck offline queue | Manual IDB inspection + reset | Auto-drain on reconnect; alert on conflict only | Offline Platform | 60% | Acknowledge conflict |
| ZHO-20 | Database backup | Supabase automatic but unverified | Verified nightly backup + weekly restore test | FEOS / Supabase | 40% | Review backup health report |
| ZHO-21 | Database restoration | Manual Supabase point-in-time restore | FEOS DR wizard: select window + confirm | FEOS DR | 0% | Confirm restore window |
| ZHO-22 | Deploy new version | Manual Vercel dashboard or CLI | CI/CD: auto-deploy to staging → manual prod approval | FEOS CI/CD | 40% | Approve prod promotion |
| ZHO-23 | Onboard / train staff | Daniel or Eduardo on-site | AI onboarding wizard + AI Coach | FEOS + Agent | 10% | Complete wizard |
| ZHO-24 | Change plan / features | Manual JSON edit in Supabase | FEOS Restaurant Manager: select plan → applied | Restaurant Manager | 15% | Select plan |
| ZHO-25 | Seed default data for new client | Manual SQL execution | FEOS Installer: auto-seed on provisioning | Installer | 5% | Approve seed schema |

**Current manual operation count: 25**  
**Target: ≤5 operations requiring human intervention by end of FEOS Phase 2**

---

## 5. Capability Matrix

Capabilities are the unit of the platform — not screens, not modules. A restaurant doesn't buy "the orders page"; it buys the ability to take, modify, split, and replay orders.

**Column legend:**
- **P** — Platform: included in every installation, no flag required
- **FLG** — Feature flag: gated by `clients.features` or plan
- **FEOS** — Control plane: FEOS module will own configuration of this capability
- **AGT** — Agent: an AI agent monitors or handles this capability
- **OFFL** — Offline: works without internet connection
- **CERT** — Requires certification before client use
- **WS** — Wansoft parity: `✓` at/above, `~` partial, `✗` below
- **Owner** — Single responsible system

### 5.1 Orders

| Capability | P | FLG | FEOS | AGT | OFFL | CERT | WS | Owner | Acceptance Criteria |
|---|---|---|---|---|---|---|---|---|---|
| Take Order | ✓ | — | — | — | ✓ | ✓ | ✓ | POS | <1s registration, works offline |
| Modify Item | ✓ | — | — | — | ✓ | ✓ | ✓ | POS | Modifier change persists before print |
| Add Note | ✓ | — | — | — | ✓ | — | ✓ | POS | Note routes to KDS |
| Split Order | ✓ | — | — | — | ✓ | — | ~ | POS | N-way split, each printable |
| Merge Tables | ✓ | — | — | — | ✓ | — | ✗ | POS | Merge preserves full audit trail |
| Transfer Table | ✓ | — | — | — | ✓ | — | ~ | POS | Transfer logged, assigned mesero updated |
| Apply Discount | ✓ | — | FEOS | AGT | ✓ | — | ✓ | POS | Discount catalog from DB, not code |
| Cancel Item | ✓ | — | FEOS | AGT | ✓ | — | ✓ | POS | Cancellation reason required, logged |
| Cancel Order | ✓ | — | FEOS | AGT | ✓ | — | ✓ | POS | Manager auth required above threshold |
| Refund | ✓ | — | — | — | — | — | ✓ | POS | Creates credit note, audit entry |
| Print Pre-ticket | ✓ | — | FEOS | — | ✓ | — | ✓ | POS + Local Server | Prints to correct station, <3s |
| Print Final Ticket | ✓ | — | FEOS | — | ✓ | ✓ | ✓ | POS + Local Server | Reprints survive restart |
| Offline Queue | ✓ | — | — | — | ✓ | ✓ | ~ | Offline Platform | Orders queue, sync on reconnect, 0 loss |
| Replay | ✓ | — | — | — | ✓ | ✓ | ✗ | Offline Platform | Idempotent replay from event log |
| KDS Route | ✓ | — | FEOS | — | ✓ | ✓ | ✓ | Local Server | Item reaches station in <100ms |
| Audit Log | ✓ | — | FEOS | AGT | ✓ | — | ✓ | Platform | Every state change recorded, immutable |

### 5.2 Inventory

| Capability | P | FLG | FEOS | AGT | OFFL | CERT | WS | Owner | Acceptance Criteria |
|---|---|---|---|---|---|---|---|---|---|
| Track Stock | ✓ | — | — | AGT | ✓ | — | ✓ | Platform | Weighted avg cost, real-time balance |
| Receive Inventory | ✓ | — | — | — | ✓ | — | ✓ | Dashboard | Links to OC, updates cost_per_unit |
| Physical Count | ✓ | — | — | — | ✓ | — | ✓ | POS | Offline count, syncs on reconnect |
| Record Waste | ✓ | — | — | AGT | ✓ | — | ✓ | POS | Waste reason required, immutable ledger |
| Transfer Between Locations | ✓ | — | — | — | — | — | ✓ | Dashboard | Both sides logged simultaneously |
| Reorder Alert | ✓ | — | FEOS | AGT | — | — | ~ | Agent | Alert fires before stockout, not after |
| Recipe Costing | ✓ | — | — | AGT | — | — | ✓ | Platform | Auto-updates food cost % on cost change |
| Production Recording | ✓ | — | — | — | ✓ | — | ✓ | POS | Deducts ingredients per recipe |
| Purchase Order | ✓ | — | — | AGT | — | — | ✓ | Dashboard | Multi-supplier, approval optional |
| Food Cost % | ✓ | — | — | AGT | — | — | ~ | Platform | Real-time %, not end-of-day |

### 5.3 Kitchen & KDS

| Capability | P | FLG | FEOS | AGT | OFFL | CERT | WS | Owner | Acceptance Criteria |
|---|---|---|---|---|---|---|---|---|---|
| Display Orders | ✓ | — | FEOS | — | ✓ | ✓ | ✓ | Local Server | <100ms from order to KDS display |
| Route by Station | ✓ | — | FEOS | — | ✓ | ✓ | ~ | Local Server | Routing rules in DB, no redeploy |
| Acknowledge Item | ✓ | — | — | — | ✓ | — | ✓ | Local Server | Ack propagates to POS in real-time |
| Order Timer | ✓ | — | — | AGT | ✓ | — | ~ | Local Server | Alert at configured threshold |
| 86 Item | ✓ | — | — | — | ✓ | — | ✓ | POS | Item hides from POS immediately |
| Batch Print | ✓ | — | FEOS | — | ✓ | ✓ | ✓ | Local Server | Batch reprints survive power cycle |
| Multi-station | ✓ | — | FEOS | — | ✓ | ✓ | ✓ | FEOS | Add station = config only, no code |

### 5.4 Staff & Auth

| Capability | P | FLG | FEOS | AGT | OFFL | CERT | WS | Owner | Acceptance Criteria |
|---|---|---|---|---|---|---|---|---|---|
| Register Staff | ✓ | — | FEOS | — | — | — | ✓ | FEOS / Dashboard | Staff active within 1 min of creation |
| PIN Authentication | ✓ | — | — | — | ✓ | ✓ | ✓ | Local Server | <2s auth, works offline |
| Fingerprint Auth | ✓ | — | — | — | ✓ | ✓ | ✗ | Local Server | <1s biometric, PIN fallback |
| Role-Based Permissions | ✓ | — | FEOS | — | ✓ | — | ~ | Platform | Configurable per role, not per person |
| Attendance Tracking | ✓ | — | — | AGT | ✓ | — | ✓ | Platform | Clock-in/out from fingerprint or PIN |
| Shift Tracking | ✓ | — | — | — | ✓ | — | ✓ | POS | Turno tied to mesero, not terminal |
| Sales by Staff | ✓ | — | — | AGT | — | — | ✓ | Dashboard | Real-time, by period |
| Tips Tracking | ✓ | — | — | AGT | — | — | ~ | Dashboard | Per-mesero, per-service |

### 5.5 Finance

| Capability | P | FLG | FEOS | AGT | OFFL | CERT | WS | Owner | Acceptance Criteria |
|---|---|---|---|---|---|---|---|---|---|
| Corte Z | ✓ | — | — | — | ✓ | ✓ | ✓ | POS | Full corte in <30s, audit complete |
| Cash Reconciliation | ✓ | — | — | AGT | ✓ | — | ✓ | POS | Difference flagged with reason |
| Payment Methods | ✓ | — | FEOS | — | ✓ | — | ✓ | Dashboard | Methods seeded on provisioning, config in DB |
| CFDI Facturación | — | FLG | — | — | — | — | ✗ | Platform | Requires RFC config, not code change |
| P&L / Estado Resultados | ✓ | — | — | — | — | — | ✗ | Dashboard | Auto-generated from POS data |
| Supplier Reconciliation | ✓ | — | — | AGT | — | — | ~ | Dashboard | OC vs invoice vs receipt match |
| Multi-payment Split | ✓ | — | — | — | ✓ | — | ~ | POS | Cash + card + transfer in one ticket |
| Cuentas por Cobrar | ✓ | — | — | — | — | — | ~ | Dashboard | Credit tracked, age visible |

### 5.6 Offline

| Capability | P | FLG | FEOS | AGT | OFFL | CERT | WS | Owner | Acceptance Criteria |
|---|---|---|---|---|---|---|---|---|---|
| Order Queue | ✓ | — | — | — | ✓ | ✓ | ~ | Offline Platform | 8h no internet, 0 lost orders |
| Menu Cache | ✓ | — | — | — | ✓ | ✓ | ✓ | Offline Platform | Menu loads <500ms from IDB |
| Conflict Detection | ✓ | — | — | — | ✓ | ✓ | ✗ | Offline Platform | Stale write detected, operator notified |
| Sync on Reconnect | ✓ | — | — | — | ✓ | ✓ | ~ | Offline Platform | Full sync in <60s after reconnect |
| Idempotent Replay | ✓ | — | — | — | ✓ | ✓ | ✗ | Offline Platform | Duplicate submit = same result |
| Offline Indicator | ✓ | — | — | — | ✓ | — | ✗ | POS | Visible status at all times |
| Print Queue Persistence | ✓ | — | — | — | ✓ | ✓ | ~ | Local Server | Print jobs survive power cycle |

### 5.7 Provisioning

| Capability | P | FLG | FEOS | AGT | OFFL | CERT | WS | Owner | Acceptance Criteria |
|---|---|---|---|---|---|---|---|---|---|
| Create Tenant | — | — | FEOS | — | — | — | ✗ | FEOS | Client row + schema + seed in <5min automated |
| Deploy App | — | — | FEOS | — | — | — | ✗ | FEOS | Vercel deploy triggered by FEOS, not manual |
| Terminal Config | ✓ | — | FEOS | — | — | — | ✗ | FEOS | Config generated by FEOS, downloaded to terminal |
| Seed Defaults | — | — | FEOS | — | — | — | ✗ | FEOS | Payment methods, units, settings on creation |
| Certify Installation | — | — | FEOS | — | — | ✓ | ✗ | FEOS | Auto-cert runs after provisioning, report generated |
| Monitor Health | — | — | FEOS | AGT | — | — | ✗ | FEOS | Heartbeat, alert on silence |
| Update Terminal | — | — | FEOS | — | — | — | ✗ | FEOS | Auto-update in maintenance window |

---

## 6. Desired State

Each module must answer: **what does FEOS take over and what human intervention remains?**

### 6.1 Printer Configuration

| Stage | Today (manual) | Desired State (automated) | Human intervention |
|---|---|---|---|
| Detect | Admin enters IP manually | mDNS auto-discovery via Local Server | Replace physical hardware only |
| Configure | Edit config.json on terminal | FEOS Printer Manager pushes config | Select paper format and station |
| Certify | None | Auto-certify on successful test print | Approve before going live |
| Monitor | None — failures are silent | Heartbeat + alert on silence | Acknowledge critical alert |
| Recover | Manual restart | Print queue auto-drains on reconnect | None |

### 6.2 New Restaurant Provisioning

| Stage | Today | Desired State | Human intervention |
|---|---|---|---|
| Create tenant | Manual SQL + Supabase dashboard | FEOS wizard: name + plan → creates everything | Sign contract |
| Configure app | Edit env vars + Vercel deploy | FEOS triggers Vercel deploy automatically | Select plan features |
| Provision terminal | onboard_client.py + config.json manual | FEOS generates config, terminal downloads on first boot | Connect terminal to LAN |
| Seed defaults | Manual SQL seed | Automated: payment methods, units, settings | None |
| Certify | None | FEOS runs certification suite, issues cert | Walk through checklist once |
| Train | Daniel trains on-site | Interactive onboarding wizard + AI guide | Complete onboarding wizard |
| Go live | Daniel authorizes | FEOS unlocks production features after cert | Press "Go Live" in FEOS |

### 6.3 KDS Station Addition

| Stage | Today | Desired State | Human intervention |
|---|---|---|---|
| Add station | Edit pos-constants.ts, redeploy | FEOS Kitchen Manager: add station name | Name the station |
| Configure routing | Edit settings.ts defaults | FEOS drag-and-drop routing UI | Assign categories to station |
| Provision terminal | Install Electron, edit config.json | FEOS generates terminal config, downloads on boot | Connect device to LAN |
| Certify latency | None | Auto-cert: test order → measure KDS arrival | Approve if <100ms |
| Monitor | None | FEOS alerts if KDS stops acknowledging | Investigate hardware |

---

## 7. Wansoft Benchmark

**Rule:** No module that exists in both platforms can regress below Wansoft's operational reliability. This benchmark is permanent — it does not expire when we "surpass" Wansoft.

| Module | Fullsite Current | Wansoft | Gap | Decision | Acceptance Criteria |
|---|---|---|---|---|---|
| Order Entry | Web POS, LAN, offline-capable | Dedicated Windows app, local DB | Ahead on offline, behind on desktop UX | Match UX, keep offline advantage | <1s order, works 8h offline |
| KDS Display | WebSocket LAN <100ms | Hardware KDS display, dedicated | Behind on hardware reliability | Achieve software parity + persistence | <100ms routing, survives power cycle |
| Offline Orders | IDB + outbox queue, idempotent | Local SQL server (always-on) | Behind (Wansoft never goes offline) | Exceed: IDB + replay + conflict detect | 8h operation, 0 data loss, idempotent |
| Thermal Printing | Bridge :7717, TCP/USB, queue persistence | Direct driver, auto-reconnect | Partial parity | Match: auto-reconnect, offline queue | Prints survive restart, queue persists |
| Inventory Count | Web form + IDB cache | Dedicated module with barcode scanner | Behind on barcode | Match: barcode + offline count | Scan → update <500ms, works offline |
| Staff Authentication | PIN + biometric fingerprint | PIN only | Ahead | Maintain biometric | <2s auth, biometric optional |
| Corte Z | Wizard + audit log | Dedicated workflow | Parity | Maintain | <30s, full audit, reprint available |
| Reporting | Real-time dashboard + AI | End-of-day reports | Ahead | Maintain + extend with AI | Real-time + 15+ AI insights/week |
| Recipe Management | Web form + Excel import | Dedicated module | Parity | Match + add bulk import | <5min to add full recipe BOM |
| Purchase Orders | Web form, multi-supplier | Full OC module with approval | Parity | Match + add approval flow | OC → receipt → inventory update |
| Food Cost | Real-time % by dish | End-of-day summary | Ahead | Maintain + improve accuracy | Live % on every ticket |
| Staff Scheduling | None (manual) | Basic schedule view | Behind | Build in FEOS | Weekly schedule, shift alerts |
| Agents / AI | 26+ autonomous agents | Zero AI | Far ahead | Maintain advantage | 15+ verified insights/week per client |
| CFDI | Facturapi integration | Native CFDI | Partial parity | Match | CFDI 4.0 from POS in <30s |

---

## 8. Module Audit

Ownership taxonomy:
- **POS** — POS terminal app
- **Dashboard** — Management web app
- **Platform** — Shared infrastructure (offline, bridge, auth)
- **Local Server** — Electron local server :7717
- **FEOS** — Control plane (current or future)
- **Agent** — AI agent layer
- **Config** — Determined by per-restaurant configuration in DB

### 8.1 POS Terminal — Module Registry

| Module | Route | Lifecycle Stage | Data at Min.0 | Owner | AMALAY Debt |
|---|---|---|---|---|---|
| Order Screen | `/pos` | AMALAY | Empty — requires menu | POS | Category slugs in pos-constants.ts |
| Floor Plan | `/pos/plano` + `/pos/mesas` | AMALAY | Default 16 tables | POS | None |
| Order History | `/pos/historial` | AMALAY | Empty | POS | None |
| Audit Log | `/pos/auditoria` | AMALAY | Empty | Platform | `pos_audit_log` DEFAULT 'amalay' |
| QR Menu | `/pos/qr` + `/menu/[mesa]` | AMALAY | Auto-generated | POS | None |
| Customer Display | `/pos/cliente` | AMALAY | Requires branding config | POS | None |
| KDS | `/pos/kds` | AMALAY (CODE ONLY offline) | Empty | Local Server | AMALAY as default station |
| Cocina View | `/pos/cocina` | AMALAY | Empty | Dashboard | AMALAY category filters hardcoded |
| Bar Station | `/pos/barra` | AMALAY | Config-dependent | Config | None |
| Auto 86 | `/auto86` | AMALAY | Empty | POS | None |
| Turno | `/pos/turno` | AMALAY | Requires ≥1 staff | POS | None |
| Corte Z | `/pos/corte` | AMALAY | Requires open turno | POS | CierreCajaWizard no offline fallback |
| Inventory (quick) | `/pos/inventario` | AMALAY | Empty | POS | SQL DEFAULT 'amalay' |
| Physical Count | `/pos/inventario-fisico` | AMALAY | Requires ingredients | POS | None |
| Waste Log | `/pos/merma` | AMALAY | Empty | POS | SQL DEFAULT 'amalay' |
| Recipes | `/pos/recetas` | AMALAY | Empty | Dashboard | SQL DEFAULT 'amalay' |
| Purchase Orders | `/pos/compras` + `/pos/orden-compra` | AMALAY | Requires suppliers | Dashboard | SQL DEFAULT 'amalay' |
| Supplier Invoices | `/pos/recepcion-factura` + `/pos/facturas-proveedor` | AMALAY | Empty | Dashboard | None |
| Food Cost | `/pos/food-cost` | AMALAY | N/A until recipes exist | Platform | None |
| Staff Mgmt | `/pos/staff` | AMALAY | Empty | FEOS | Hardcoded mesero fallback in client-config.ts |
| Staff Analytics | `/pos/staff-analytics` | AMALAY | Empty | Dashboard | None |
| Fingerprint | `/pos/huella` | AMALAY | No enrollments | Local Server | None |
| Attendance | `/pos/asistencia` | AMALAY | Empty | Platform | None |
| Facturación CFDI | `/pos/facturacion` | AMALAY | Requires RFC config | Platform | Requires RFC per client (config, not debt) |
| Delivery | `/pos/delivery` | IMPL | Requires delivery config | Platform | None |
| Panadería | `/pos/panaderia` | AMALAY | **AMALAY ONLY** | AMALAY | Full route — needs feature flag guard |
| Market Inventory | `/pos/inventario-market` | AMALAY | **AMALAY ONLY** | AMALAY | Needs `posTienda` feature flag guard |

### 8.2 Dashboard — Module Registry (abbreviated)

| Module | Route | Stage | Min.0 State | Owner |
|---|---|---|---|---|
| Dashboard Principal | `/` | AMALAY | KPIs at zero | Dashboard |
| Ventas | `/ventas` | AMALAY | Empty | Dashboard |
| Meseros | `/meseros` | AMALAY | Empty until first turno | Dashboard |
| Platillos | `/platillos` | AMALAY | Empty | Dashboard |
| Tendencias | `/tendencias` | AMALAY | Requires 7+ days | Dashboard |
| Inventario Real | `/inventario-real/*` | AMALAY | Empty until ingredients loaded | Dashboard |
| Estado de Resultados | `/estado-resultados` | AMALAY | Empty | Dashboard |
| Conciliación | `/conciliacion` | AMALAY | Empty | Dashboard |
| AI Chat | `/chat` | AMALAY | Immediate | Agent |
| Agentes (26+) | `/agentes/*` | AMALAY | Enabled on provisioning | Agent |
| Configuración | `/configuracion` | IMPL | Requires restaurant data | → FEOS |
| Sucursales | `/sucursales` | IMPL | Requires restaurant data | → FEOS |
| Seguridad | `/seguridad` | IMPL | — | → FEOS |
| Certificados | `/certificados` | IMPL | — | → FEOS |
| Mission Control | `/mission-control` | IMPL | — | → FEOS |

---

## 9. AMALAY Debt Registry

Specific locations where AMALAY-specific code exists in the platform. Each item must be resolved before the module reaches the SKELETON stage.

### Integration Tenant Resolution Rule (formalizado 2026-08-01)

Applies to ALL current and future delivery integrations (Uber Eats, Rappi, DiDi, and any future provider):

```
provider_store_id
      ↓
integration_store_mappings (DB lookup)
      ↓
client_id

If mapping not found → FAIL CLOSED:
  - DLQ / quarantine (no retry to live orders)
  - audit log entry with correlation_id
  - ZERO fallback to any tenant (including AMALAY)
```

No integration may hardcode a `client_id`. No integration may use a request header as the primary tenant resolver. The `integration_store_mappings` table is the single source of truth.

| ID | Location | Type | Description | Fix | Priority | Depends On |
|---|---|---|---|---|---|---|
| D-01 | `lib/client-config.ts` FALLBACKS.amalay | Hardcode | 11 mesero names, RFC AFO200806JI0, phone 8115324371, address | Replace with empty generic fallback. No client data in code. | P0 | — |
| D-02 | `lib/client-config.ts` EMAIL_MAP | Hardcode | `'ramonfaur.daniel@gmail.com' → 'amalay'` | Remove. Use `client_users.client_id` as source of truth. Error on miss. | P0 | — |
| D-03 | `lib/settings.ts` `pos.station_routing` default | Hardcode | Default routing includes `mkt-amalay`, `mkt-vitaminas`, `mkt-regalos` | Clean default to generic cocina/barra only. AMALAY routes in DB. | P0 | P1-D03 migration (salva routing AMALAY en DB primero) |
| D-04 | `lib/pos-constants.ts` STATION_CATEGORIES | Hardcode | Same mkt-* slugs in category routing constants | Remove mkt-* entries. Routing from DB per client. | P0 | D-03 (misma migración) |
| D-05 | `lib/pos-data.ts` comment + MARKET_CATEGORIES | Hardcode | Top comment: "AMALAY real menu". MARKET_CATEGORIES has mkt-* slugs | Remove comment. MARKET_CATEGORIES from DB groups. | P1 | FEOS Menu Module |
| D-06 | `lib/pos-constants.ts` BAKERY_CATEGORIES | Hardcode | Bakery category slugs for AMALAY's bakery section | Convert to feature flag `pos.bakery_station` with configurable categories | P1 | — |
| D-07 | `app/pos/panaderia/page.tsx` | AMALAY route | Bakery production display — AMALAY only | Add `if (!config.features.pos?.bakery_station) redirect('/pos')` | P1 | D-06 |
| D-08 | `app/pos/inventario-market/page.tsx` | AMALAY route | Retail market inventory — AMALAY only | Add `if (!config.features.posTienda) redirect('/pos')` | P1 | D-06 |
| D-09 | 17 SQL tables + `reservaciones` | SQL default | `client_id TEXT DEFAULT 'amalay'` (17 POS tables + tabla `reservaciones`) | Apply `004_remove_amalay_defaults.sql`. Agregar `reservaciones` al script. Verify all INSERTs explicit. | P0 | Auditoría previa de todos los INSERTs (verificar que pasan `client_id` explícitamente antes de correr) |
| D-10 | `cloudflare/delivery-worker/src/index.ts:60,91,122` | Hardcode | `client_id: 'amalay'` en los 3 parsers de webhook (Uber, Rappi, Didi) | Resolución de tenant por lookup DB: `provider_store_id → integration_store_mappings → client_id`. Fail-closed si no existe mapping: DLQ + audit log con `correlation_id`. Nunca fallback a AMALAY ni a ningún otro tenant. | P0 | Tabla `integration_store_mappings` (DDL + seed mapping AMALAY) |
| D-11 | `dashboard-app/src/app/api/chat/route.ts:765` + `api/voice/route.ts:392` | Hardcode | Lista de meseros AMALAY hardcodeada en contexto de IA | Leer desde `pos_staff WHERE client_id = current_client` en tiempo real. | P0 | `pos_staff` table con `client_id` (existe) |
| D-12 | `agents/reviews-manager/worker/src/lib/groq-api.ts:32,46,50` | Hardcode | `hola@cafeamalay.com` hardcodeado en lógica de escalación de reseñas | Leer email de escalación desde `clients.support_email` o config del cliente. | P0 | `clients.support_email` column (P1-D12 migration) |
| D-13 | `electron-kds/main.js:57` | Hardcode | URL de Supabase auth hardcodeada (`qjiomlvudfmzuvqvhwpk`) | Leer desde variable de entorno `SUPABASE_URL` — fallo explícito si ausente. | P1 | `SUPABASE_URL` en entorno Electron |
| D-14 | `dashboard-app/src/lib/roles.ts:28` | Hardcode | `'ramonfaur.daniel@gmail.com' → 'dueño'` fallback de rol | Eliminar. Roles vienen exclusivamente de `client_users.role`. | P1 | — |
| D-15 | `cloudflare/orquestador-worker/src/lib/claude-api.ts:5-39` | Hardcode | SYSTEM_PROMPT con contexto de negocio AMALAY (Mónica, Plaza Duendes, horarios) | Cargar contexto desde `clients` table en runtime. Prompt genérico + datos del cliente. | P1 | `clients.display_name` (existe) |
| D-16 | `.github/scripts/client_config.py:21` (y 9+ scripts Python) | Default | `get_client()` retorna `'amalay'` si `CLIENT_ID` no está en env | Eliminar default. Requerir `CLIENT_ID` env var. Fallo explícito si ausente. | P1 | `CLIENT_ID` env var por workflow en GitHub Secrets |
| D-17 | `api/integrations/uber-eats/webhook/route.ts:64`, `auth/initiate/route.ts:24`, `auth/callback/route.ts:121` | Default / Fallback silencioso | Tres rutas Next.js de Uber Eats defaultean a `'amalay'`. La de callback es crítica: tokens OAuth se guardan bajo tenant equivocado si el state falla. | Requerir `NEXT_PUBLIC_DEFAULT_CLIENT_ID` explícito; throw en callback si state es inválido, sin fallback. | P1 | `NEXT_PUBLIC_DEFAULT_CLIENT_ID` en Vercel del proyecto del cliente |
| D-18 | `dashboard-app/src/app/api/agents/cron/route.ts:22` | Default | `process.env.NEXT_PUBLIC_DEFAULT_CLIENT_ID \|\| 'amalay'` — cron de agentes IA corre para AMALAY si env var ausente | Requerir env var. Retornar 400 si ausente — nunca defaultear a un cliente específico. | P1 | `NEXT_PUBLIC_DEFAULT_CLIENT_ID` en Vercel del proyecto del cliente |
| D-19 | `dashboard-app/src/app/api/backup/route.ts:8` | Hardcode | `BACKUP_ADMINS = Set(['ramonfaur.daniel@gmail.com', 'monica@fullsite.mx'])` — endpoint de backup solo accesible por 2 personas | Leer admins desde `client_users WHERE role = 'dueño' AND client_id = current_client`. | P1 | `client_users` table con roles (existe) |
| D-20 | Schema SQL: tabla `amalay_reservaciones` | Schema debt | Tabla dedicada AMALAY sin `client_id` — existe en migraciones aunque el código ya usa `reservaciones` genérica | Eliminar tabla + triggers + vistas + constraints de `amalay_reservaciones` en nueva migración. | P1 | D-09 migration (conveniente correr después de limpiar defaults) |
| D-21 | `src/lib/pos-config.ts:28` | Default | SSR fallback `typeof window === 'undefined' ? 'amalay' : clientId` — durante render server-side el POS carga config de AMALAY por ~100ms | Retornar `null` y mostrar loading. Eliminar `'amalay'` como valor literal de fallback. | P0 | — |
| D-22 | `src/app/encuestas/page.tsx:150` | Default | `getActiveClientSlug() : 'amalay'` — client_id de encuestas escribe `'amalay'` durante SSR | Cambiar a `\|\| ''`. Validar que clientId no sea vacío antes de persistir la encuesta. | P0 | — |
| D-23 | `src/app/api/health/route.ts:16,22` | Assumption | Health check consulta `wansoft_daily` sin verificar si el cliente usa wansoft — reporta `status: 'error'` (falso negativo) para clientes con `data_source='fullsite'` | Verificar `clients.data_source` antes de consultar `wansoft_daily`. Omitir check si no aplica. | P0 | `clients.data_source` (existe) |
| D-24 | `src/app/api/prospect/route.ts:59` | Hardcode | `chat_id: '7654040494'` — leads de cualquier cliente (formularios, demos) notifican al Telegram personal de Daniel sin routing por cliente | Leer `chat_id` desde `clients.telegram_chat_id`. Silencio si el campo está vacío. | P0 | `clients.telegram_chat_id` column (DDL si no existe) |
| D-25 | `src/components/pos/CierreCajaWizard.tsx:388` | Hardcode | `<h2>AMALAY</h2>` hardcodeado en el bloque de ticket impreso del corte Z | Reemplazar con `config.display_name` leído desde `usePosConfig()` | P0 | `usePosConfig()` (existe) |
| D-26 | `src/app/pos/mesas/page.tsx:37-90,736` + `src/lib/pos-data.ts:1265` | Hardcode | FLOOR_TABLES (~70 líneas) + WALLS_MAP con coordenadas AMALAY + `_cid() === 'amalay'` gatea la vista Plano. Cliente nuevo ve el plano del restaurante de AMALAY. | Mover a tabla `pos_floor_plans` + feature flag `pos.floor_plan`. Deferred a FEOS Kitchen Manager. GAP-D de OCS-P2.5.7. | P2 (deferred) | `pos_floor_plans` table + Restaurant Layout Engine (FEOS) |
| D-27 | `src/app/lealtad/page.tsx:83` | Hardcode | `program_name: 'AMALAY Rewards'` — cliente nuevo ve "AMALAY Rewards" en su programa de lealtad | Leer desde `` `${config.display_name} Rewards` `` o campo `clients.loyalty_program_name` | P1 | `clients.display_name` (existe) |
| D-28 | `src/app/inventario-real/orden-compra/page.tsx:114,662` | Hardcode | `*Orden de Compra - AMALAY*` en plantilla WhatsApp/email a proveedores — proveedor recibe mensaje con nombre incorrecto | Reemplazar con `config.display_name` | P1 | `usePosConfig()` (existe) |
| D-29 | `src/app/api/chat/route.ts:385,390` | Hardcode | Mapa de normalización de platillos con aliases AMALAY-específicos (`'TAQUITOS AMALAY' → 'TACOS DE RIB EYE'`) — chat IA normaliza incorrectamente para otro cliente | Eliminar entradas AMALAY-específicas. Fuzzy search handles remaining aliases. | P0 | — |
| D-30 | `src/components/PredictionWidget.tsx:6` | Assumption | Distribución horaria hardcodeada modelada en patrón brunch/café de AMALAY — predicciones intraday incorrectas para otro tipo de restaurante | Calcular distribución desde historial real de `pos_orders` por cliente, por hora del día, rolling 30d | P1 | `pos_orders` con timestamps (existe) |
| D-31 | `api/chat`, `api/voice`, `api/coach`, `api/inventory/predict`, `api/contabilidad/polizas`, `app/contabilidad`, `app/nomina` | Assumption | `wansoft_daily` y `wansoft_kpis` consultadas en 7+ rutas sin filtro `client_slug` consistente. Nota en `agents/finance.ts:9`: "tablas globales sin client_id". Cliente nuevo sin Wansoft ve datos vacíos o de AMALAY. | Implementar OCM v0.1 como capa de abstracción. Rutas leen del OCM, no directo de `wansoft_daily`. OCM decide fuente según `data_source`. | P1 | OCM v0.1 (`docs/architecture/OCM.md`) |
| D-32 | `src/app/pos/layout.tsx:270` | Hardcode | `FINGERPRINT_URL = 'http://127.0.0.1:7718'` — servicio de huella digital no configurable (análogo al bridge URL antes de commit `1718bab`) | Implementar `getFingerprintUrl()` + `setFingerprintUrl()` en `src/lib/fingerprint-url.ts`. UI en `pos/configuracion`. | P1 | — |
| D-33 | `src/app/reservar/page.tsx` | AMALAY route | Página de reservaciones 100% hardcodeada: espacios (terraza/jardín/salón con capacidades AMALAY), horarios, paquetes de menú AMALAY, teléfono 8115324371, branding. No reutilizable. | Convertir a reservation engine configurable (espacios desde `reservation_spaces` en DB) o guard con `features.reservaciones`. Refactor de feature. | P1 | `reservation_spaces` table (DDL) + RestaurantConfig |
| D-34 | `src/app/api/contabilidad/polizas/route.ts:551` | Hardcode | `RFC="XXXXXXXXXXXX"` placeholder en XML de pólizas contables — no se lee RFC fiscal del cliente desde config | Leer `rfc` desde `clients` table o config fiscal del cliente. 30min. | P1 | `clients.rfc` column (verificar si existe; DDL si no) |

**SQL migration:**

```sql
-- 004_remove_amalay_defaults.sql
-- Verify every INSERT passes client_id explicitly before applying.
ALTER TABLE pos_orders               ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_audit_log            ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_inventory            ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_inventory_movements  ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_ingredients          ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_recipes              ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_purchase_orders      ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_sessions             ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_inventory_products   ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE pos_customers            ALTER COLUMN client_id DROP DEFAULT;
ALTER TABLE agent_runs               ALTER COLUMN client_id DROP DEFAULT;

ALTER TABLE pos_orders               ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE pos_audit_log            ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE pos_inventory            ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE pos_ingredients          ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE pos_recipes              ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE pos_sessions             ALTER COLUMN client_id SET NOT NULL;
```

### Definition of Done — Universal (aplica a todo D-xx)

Un D-xx se marca CLOSED cuando se cumplen **los 6 criterios simultáneamente**. No hay excepciones por urgencia ni por tamaño del fix.

| # | Criterio | Verificación objetiva |
|---|---|---|
| DoD-1 | **grep = 0** | Comando de grep de la tabla inferior devuelve 0 hits. Si el tipo es SQL/migration: consulta en Supabase confirma ausencia. |
| DoD-2 | **Tests PASS** | `cd dashboard-app && npx jest --passWithNoTests` — suite completa, 0 regresiones. Para scripts Python: `python -m pytest` si existen tests. |
| DoD-3 | **Smoke PASS** | `python3 scripts/smoke_test_nomada.py` — el paso relevante para ese D-xx pasa sin error. |
| DoD-4 | **Evidencia** | P0: screenshot o log que demuestra operación funcional en NÓMADA-MINI (no en AMALAY). P1: output del grep + número de tests. Migration: `\d+ tabla` en Supabase confirma DDL aplicado. |
| DoD-5 | **Commit** | SHA identificable en git. Mensaje: `fix(GS-D{XX}): {descripción concisa}`. Co-Authored-By incluido. |
| DoD-6 | **Docs actualizados** | (a) Fila en tabla P1 Execution Progress → DONE + SHA. (b) Closure Registry grep ejecutado y en 0. (c) Si requirió migración SQL: archivo en `scripts/sql/migrations/` archivado. |

"Parece arreglado" no cierra ningún D-xx. Solo evidencia objetiva. El pipeline de certificación universal aplica.

---

### Closure Registry (congelado 2026-08-02)

| ID | DoD-1 grep → esperado 0 | DoD-4 evidencia funcional |
|---|---|---|
| D-01 | `grep -n "AFO200806JI0\|8115324371\|Omar Aguilera" lib/client-config.ts` | — |
| D-02 | `grep -n "ramonfaur.daniel@gmail.com" lib/client-config.ts` | Login con email no-AMALAY resuelve client_id desde `client_users` |
| D-03 | `grep -n "mkt-amalay\|mkt-vitaminas\|mkt-regalos" lib/settings.ts` | POS de cliente nuevo arranca sin routing errors |
| D-04 | `grep -n "mkt-amalay\|mkt-vitaminas\|mkt-regalos" lib/pos-constants.ts` | — |
| D-05 | `grep -n "AMALAY real menu\|mkt-" lib/pos-data.ts` | Categorías de menú cargadas desde DB para cliente nuevo |
| D-06 | `grep -n "BAKERY_CATEGORIES" lib/pos-constants.ts` | Feature flag `pos.bakery_station=false` → panadería oculta |
| D-07 | `grep -n "panaderia" app/pos/panaderia/page.tsx \| grep -v redirect` | `/pos/panaderia` redirige a `/pos` sin `bakery_station` activo |
| D-08 | `grep -n "inventario-market" app/pos/inventario-market/page.tsx \| grep -v redirect` | `/pos/inventario-market` redirige a `/pos` sin `posTienda` activo |
| D-09 | `grep -rn "DEFAULT 'amalay'" scripts/sql/` | `\d+ reservaciones` en Supabase → sin DEFAULT en client_id |
| D-10 | `grep -rn "client_id: 'amalay'" cloudflare/delivery-worker/` | Webhook con `storeId` desconocido → DLQ, no insertado en tabla |
| D-11 | `grep -n "Omar Aguilera\|Hector Rodriguez" src/app/api/chat/route.ts src/app/api/voice/route.ts` | Chat de NÓMADA-MINI no menciona meseros de AMALAY |
| D-12 | `grep -rn "cafeamalay.com" agents/reviews-manager/` | `clients.support_email` poblado en AMALAY; escalación llega al email correcto |
| D-13 | `grep -n "qjiomlvudfmzuvqvhwpk" electron-kds/main.js` | KDS falla explícitamente si `SUPABASE_URL` no está en env |
| D-14 | `grep -n "ramonfaur.daniel@gmail.com" src/lib/roles.ts` | `resolveRole(null, 'otro@email.com')` → `'staff'`, no `'dueño'` |
| D-15 | `grep -n "Plaza Duendes\|Mónica\|horario" cloudflare/orquestador-worker/src/lib/claude-api.ts` | SYSTEM_PROMPT contiene nombre del restaurante desde `clients.display_name` |
| D-16 | `grep -n "\|\| 'amalay'" .github/scripts/client_config.py` | Script Python sin CLIENT_ID → exit code ≠ 0 con mensaje de error claro |
| D-17 | `grep -n "\|\| 'amalay'" src/app/api/integrations/uber-eats/` | Estado OAuth inválido → throw 400, sin token guardado |
| D-18 | `grep -n "\|\| 'amalay'" src/app/api/agents/cron/route.ts` | Cron sin env var → HTTP 400, no ejecuta agentes |
| D-19 | `grep -n "ramonfaur.daniel@gmail.com\|monica@fullsite.mx" src/app/api/backup/route.ts` | Dueño de VANTARA puede exportar backup; Daniel no puede exportar backup de VANTARA |
| D-20 | `grep -rn "amalay_reservaciones" scripts/sql/migrations/` | `\dt amalay_reservaciones` en Supabase → tabla no existe |
| D-21 | `grep -n "'amalay'" src/lib/pos-config.ts` | POS con sesión de cliente nuevo nunca muestra config de AMALAY |
| D-22 | `grep -n "\|\| 'amalay'" src/app/encuestas/page.tsx` | Encuesta enviada desde cliente nuevo tiene `client_id` correcto en Supabase |
| D-23 | `grep -n "wansoft_daily" src/app/api/health/route.ts` (sin `data_source` guard) | `/api/health` devuelve `ok` para cliente con `data_source='fullsite'` y `wansoft_daily` vacía |
| D-24 | `grep -n "7654040494" src/app/api/prospect/route.ts` | Lead desde formulario de nuevo cliente llega al Telegram del dueño de ese cliente |
| D-25 | `grep -n "AMALAY" src/components/pos/CierreCajaWizard.tsx` | Ticket de corte Z muestra `display_name` del cliente activo, no "AMALAY" |
| D-26 | `grep -n "_cid.*===.*amalay\|FLOOR_TABLES" src/app/pos/mesas/page.tsx` | Deferred — evidencia cuando `pos_floor_plans` esté implementado |
| D-27 | `grep -n "AMALAY Rewards" src/app/lealtad/page.tsx` | Página de lealtad de nuevo cliente muestra su propio nombre |
| D-28 | `grep -n "Orden de Compra - AMALAY" src/app/inventario-real/orden-compra/page.tsx` | Plantilla WhatsApp de OC muestra `display_name` del cliente activo |
| D-29 | `grep -n "TAQUITOS AMALAY\|AMALAY SALMON" src/app/api/chat/route.ts` | Chat de NÓMADA-MINI no menciona platillos de AMALAY |
| D-30 | `grep -n "AMALAY pattern" src/components/PredictionWidget.tsx` | Widget de predicción usa distribución calculada del cliente (o N/A si sin historial) |
| D-31 | `grep -rn "wansoft_daily\b" src/app/api/ \| grep -v "client_slug\|data_source"` (esperado 0) | Ruta de chat con NÓMADA-MINI (data_source='fullsite') no devuelve datos de AMALAY |
| D-32 | `grep -n "127.0.0.1:7718" src/app/pos/layout.tsx` | Deferred — evidencia cuando `getFingerprintUrl()` implementado |
| D-33 | `grep -n "terraza.*jardin.*salon\|8115324371" src/app/reservar/page.tsx` | Página de reservas muestra espacios del cliente activo |
| D-34 | `grep -n "XXXXXXXXXXXX" src/app/api/contabilidad/polizas/route.ts` | XML de póliza contiene RFC real del cliente emisor |

---

### Audit Provenance — HC-xx → D-xx (Auditoría cloneabilidad 2026-08-01)

Mapeo completo de hallazgos del audit contra el Debt Registry. Cada HC queda absorbido por un D-xx. Auditoría congelada — no seguir buscando por iniciativa propia.

| HC (audit 2026-08-01) | D-xx | Estado del D-xx |
|---|---|---|
| HC-04 — client-config.ts fallback map | D-01 | DONE (0bf9993) — extendido con demo config |
| HC-05 — email hardcodeado a 'amalay' | D-02 | DONE (0bf9993) |
| HC-06 — pos-config.ts slug fallback | D-21 | DONE (d0836a1) |
| HC-07 — cron route `\|\| 'amalay'` | D-18 | DONE (0bf9993) |
| HC-08 — encuestas SSR fallback | D-22 | DONE (d0836a1) |
| HC-09 — Uber Eats OAuth fallback | D-17 | DONE (0bf9993) |
| HC-10 / HC-14 — health wansoft check | D-23 | DONE (d0836a1) |
| HC-11 — prospect Telegram chat_id | D-24 | DONE (d0836a1) |
| HC-12 — CierreCaja ticket `<h2>AMALAY</h2>` | D-25 | DONE (d0836a1) |
| HC-13 — pos-data.ts `if clientId === 'amalay'` | D-05 | DEFERRED |
| HC-15 / HC-16 — FLOOR_TABLES + vista Plano gate | D-26 | OPEN — P2 deferred (GAP-D OCS-P2.5.7) |
| HC-17 — cocina routing keywords | D-03 | DONE (M2 applied + mkt-* removed) |
| HC-18 — pos-constants MODIFIER_STRIP_PATTERNS | D-04 | DONE (M2 applied + mkt-* removed) |
| HC-19 — lealtad `'AMALAY Rewards'` | D-27 | DONE (d0836a1) |
| HC-20 — OC WhatsApp template | D-28 | DONE (d0836a1) |
| HC-21 — food-cost MARKET_KEYWORDS | D-05 | DEFERRED |
| HC-22 — chat dish normalization map | D-29 | DONE (d0836a1) |
| HC-23 — PredictionWidget brunch pattern | **D-30** | OPEN |
| HC-24 — wansoft tables sin client filter | **D-31** | OPEN (bloqueado por OCM) |
| HC-25 — fingerprint URL hardcodeado | **D-32** | OPEN |
| HC-26 — dashboard category alias | D-05 | DEFERRED |
| HC-27 — reservar page hardcodeada | **D-33** | OPEN |
| HC-28 — Uber Eats sandbox store name | D-10 | OPEN |
| HC-29 — email placeholder admin/usuarios | P3 — sin D-xx | No corrompe datos |
| HC-30 — mission-control workflow name | P3 — sin D-xx | Cosmético de ops |
| HC-31 — polizas RFC placeholder | D-34 | DONE (d0836a1) |
| HC-32 — WhatsApp demo pages | P3 — sin D-xx | Marketing, no del producto |
| HC-33 — demo config datos AMALAY | D-01 | DONE (0bf9993) |
| HC-34 — platillos AMALAY en pos-data.ts | D-05 | DEFERRED |
| HC-35 — GitHub Actions timezone UTC-6 | P3 — sin D-xx | Infra/ops, no bloquea NÓMADA-MINI |
| HC-36 / HC-37 — Python scripts + agents | D-16 / D-31 | D-16 DONE; D-31 OPEN |

**P3 (no D-xx, no bloquean smoke test):** HC-29, HC-30, HC-32, HC-35.

### P1 Execution Progress (actualizado 2026-08-02)

| ID | Status | Commit | Pendiente |
|---|---|---|---|
| D-01 | DONE | 0bf9993 | — |
| D-02 | DONE | 0bf9993 | — |
| D-03 | DONE | M2 (p1_d03_amalay_station_routing) + this commit | — |
| D-04 | DONE | M2 (p1_d03_amalay_station_routing) + this commit | — |
| D-05 | DEFERRED | — | Requiere menú desde DB (scope mayor) |
| D-06 | DONE | 0bf9993 | — |
| D-07 | DONE | 0bf9993 | — |
| D-08 | DONE | 0bf9993 | — |
| D-09 | DONE | M3 (p1_d09_remove_client_id_defaults) — 72 tablas | — |
| D-10 | OPEN | — | Requiere `integration_store_mappings` table + lookup logic |
| D-11 | DONE | 0bf9993 | — |
| D-12 | DONE | 0bf9993 + M1 (p1_d12_clients_support_email_plan) | — |
| D-13 | DONE | 0bf9993 | — |
| D-14 | DONE | 0bf9993 | — |
| D-15 | DONE | b21dace | Agregar env vars a Cloudflare Worker deployment |
| D-16 | DONE | 0bf9993 | — |
| D-17 | DONE | 0bf9993 | — |
| D-18 | DONE | 0bf9993 | — |
| D-19 | DONE | 0bf9993 | Env var `BACKUP_ADMIN_EMAILS` debe configurarse en Vercel |
| D-20 | BLOCKED — out of critical path | — | Proyecto de migración de datos: migrar 23 filas → reservaciones, actualizar views/scripts, validar, luego DROP |
| D-21 | DONE | d0836a1 | — |
| D-22 | DONE | d0836a1 | — |
| D-23 | DONE | d0836a1 | Pasar `?data_source=fullsite` al llamar desde cliente no-wansoft |
| D-24 | DONE | d0836a1 | Configurar env var `TELEGRAM_CHAT_ID_PLATFORM` en Vercel |
| D-25 | DONE | d0836a1 | — |
| D-27 | DONE | d0836a1 | — |
| D-28 | DONE | d0836a1 | — |
| D-29 | DONE | d0836a1 | — |
| D-34 | DONE | d0836a1 | — |
| D-30 | OPEN | — | Sprint 2 |
| D-31 | OPEN — bloqueado por OCM | — | Sprint 2 (requiere OCM v0.1) |
| D-32 | OPEN | — | Sprint 2 |
| D-33 | OPEN | — | Sprint 2 (refactor feature reservaciones) |
| D-26 | OPEN — deferred P2 | — | Requiere DB design `pos_floor_plans` |

---

### Sprint 1 — P1 abre: primeros 8 items (sin migraciones, sin refactors grandes)

**Gate:** P0-4 CERTIFIED + milestone POS V2 Operational Certification CLOSED.  
**Estimado:** ~5h de código + tests. Un bloque de trabajo, un commit.  
**Criterio de cierre:** `smoke_test_nomada.py` pasa steps 1–6 sin errores.

| # | D-xx | Archivo | Fix | Riesgo | Tests | Criterio PASS |
|---|---|---|---|---|---|---|
| 1 | D-25 | `src/components/pos/CierreCajaWizard.tsx:388` | `<h2>AMALAY</h2>` → `<h2>{config.display_name}</h2>`. Leer con `usePosConfig()`. | BAJO — 1 línea | `grep -n "AMALAY" CierreCajaWizard.tsx` → 0 | Ticket de corte Z imprime nombre del cliente activo |
| 2 | D-21 | `src/lib/pos-config.ts:28` | `: 'amalay'` → `: null`. El POS muestra loading si `clientId` es null en SSR. | BAJO — 1 línea | `grep -n "'amalay'" pos-config.ts` → 0 | POS arranca sin flash de config AMALAY |
| 3 | D-22 | `src/app/encuestas/page.tsx:150` | `|| 'amalay'` → `|| ''`. Agregar guard: `if (!clientId) return null`. | BAJO — 2 líneas | `grep -n "amalay" encuestas/page.tsx` → 0 | Encuesta de nuevo cliente persiste con `client_id` correcto |
| 4 | D-23 | `src/app/api/health/route.ts:16,22` | Leer `data_source` del cliente activo. Omitir check de `wansoft_daily` si `data_source !== 'wansoft'`. | BAJO — 10 líneas | `curl /api/health` con cliente fullsite → `{status:'ok'}` | `/api/health` green para cliente sin pipeline Wansoft |
| 5 | D-24 | `src/app/api/prospect/route.ts:59` | Leer `telegram_chat_id` desde `clients` table. Silencio (no error) si vacío. Agregar columna `telegram_chat_id text` a `clients` si no existe. | MEDIO — requiere column check | `grep -n "7654040494" prospect/route.ts` → 0 | Lead de demo de NÓMADA llega a su Telegram (si configurado), no al de Daniel |
| 6 | D-27 | `src/app/lealtad/page.tsx:83` | `'AMALAY Rewards'` → `` `${config.display_name} Rewards` ``. | BAJO — 1 línea | `grep -n "AMALAY Rewards" lealtad/page.tsx` → 0 | Página lealtad muestra nombre correcto del cliente |
| 7 | D-28 | `src/app/inventario-real/orden-compra/page.tsx:114,662` | `*Orden de Compra - AMALAY*` → `` `*Orden de Compra - ${config.display_name}*` ``. Mismo para el enlace de email (línea 662). | BAJO — 2 líneas | `grep -n "Orden de Compra - AMALAY" orden-compra/page.tsx` → 0 | Plantilla WhatsApp de OC tiene nombre del cliente |
| 8 | D-29 | `src/app/api/chat/route.ts:385,390` | Eliminar las 2 entradas AMALAY del normalization map. El map debe contener solo aliases genéricos o estar vacío. Las búsquedas fuzzy manejan los alias restantes. | BAJO — eliminar 2 líneas | `grep -n "TAQUITOS AMALAY\|AMALAY SALMON" chat/route.ts` → 0 | Chat de NÓMADA no normaliza platillos de AMALAY |
| +1 | D-34 | `src/app/api/contabilidad/polizas/route.ts:551` | `RFC="XXXXXXXXXXXX"` → `RFC="${clientRfc}"` leyendo desde `clients.rfc`. | BAJO — 5 líneas | `grep -n "XXXXXXXXXXXX" polizas/route.ts` → 0 | XML de póliza contiene RFC real del cliente |

**Sprint 1 no incluye:** D-26 (deferred), D-30/31/32/33 (requieren diseño o OCM). Migraciones D-03/04/09/20 son Sprint 2 (coordinadas con DB).

**New systems shipped (commit 0bf9993):**
- `lib/restaurant-manifest.ts` — TypeScript schema for tenant onboarding
- `scripts/manifests/nomada-mini.json` — NÓMADA-MINI sample manifest
- `scripts/manifests/amalay.json` — AMALAY manifest (source of truth)
- `scripts/bootstrap_client.py` — provisions new restaurant from manifest
- `scripts/smoke_test_nomada.py` — automated 7-step NÓMADA-MINI verification
- `electron-kds/kds.config.json` — in .gitignore, generated by bootstrap

**Migrations in `scripts/sql/migrations/` (run manually, in this order):**
1. `P1-D12-clients-support-email-plan.sql` — DDL: add columns to clients
2. `P1-D03-amalay-station-routing.sql` — DML: save AMALAY routing to DB
3. `P1-D09-remove-client-id-defaults.sql` — DDL: remove DEFAULT 'amalay' from 69 tables
4. `P1-D20-drop-amalay-reservaciones.sql` — DDL: drop legacy table

After migrations 2+3 run: remove mkt-* from `lib/settings.ts` and `lib/pos-constants.ts` (D-03/D-04 code close).

---

## 10. Minute 0 State

What exists the moment a new restaurant is provisioned, before any operator action.

### Auto-seeded on provisioning

| What | How | Table |
|---|---|---|
| 1 row in `clients` | FEOS wizard | `clients` |
| Plan + feature flags | Selected at creation | `clients.plan` + `clients.features` |
| 1 admin user | Owner email | `client_users` |
| Payment methods (4) | Seed: Efectivo, T.Crédito, T.Débito, Transferencia | `pos_payment_methods` |
| Units of measure (7) | Seed: g, ml, pz, kg, lt, caja, bolsa | `pos_units` |
| Default settings | Registry in `lib/settings.ts` (DB override = null → uses defaults) | `clients.pos_settings` |
| Terminal config | FEOS generates, terminal downloads on first boot | Local file |
| AI Agents enabled | All 26 agents activated with `client_slug` | GitHub Actions |
| Onboarding wizard | Active until completed | UI state |

### Empty — operator fills during setup

| What | When needed |
|---|---|
| Menu / platillos | **Day 0 blocker** — POS cannot take orders without menu |
| Staff / meseros | **Day 0 blocker** — cannot open turno without ≥1 staff |
| Tables config | Default: 16 numbered tables. Customizable but not blocking. |
| Ingredients / inventory | Optional. POS works without active inventory. |
| Recipes | Optional. Food cost shows N/A until configured. |
| Suppliers | Optional. Purchase orders work without pre-loaded suppliers. |
| Printers | Configured during physical installation or via FEOS Printer Manager. |
| Fingerprint enrollments | Enrolled during physical installation. |
| Orders, sales, reports | Generated by operation — day 1+. |

---

## Digital Twin + Self-Healing

Each restaurant has a **live digital state** inside FEOS — a real-time representation of its entire operational environment. The twin is read by the Observability Hub, written by agents and terminals, and drives automated recovery before any human is involved.

### What the Digital Twin tracks

| Entity | State tracked |
|---|---|
| Terminals | Online/offline, version, last heartbeat, config hash |
| KDS displays | Station, latency, last ack, queue depth |
| Printers | Reachable, paper status, last successful print, queue size |
| Offline queue | Pending items, oldest item age, sync lag |
| Agents | Last run, status, FP rate, last alert generated |
| Certifications | Valid/expired, last cert date, failing checks |
| Staff | Active sessions, open turnos, auth method in use |
| Inventory | Critical items below reorder, last sync timestamp |
| App version | Terminal version vs latest stable, update pending |

**Implementation:** `feos_restaurant_state` table — one row per entity per restaurant. Agents write. FEOS reads. Edge functions trigger on state changes.

### Self-Healing Tiers

| Tier | Trigger | System Action | Human Involvement |
|---|---|---|---|
| **T1 Auto-heal** | Known failure pattern | Resolves automatically | None — log only |
| **T2 Assisted** | Unusual but recoverable state | Attempts fix, notifies on completion | Acknowledge |
| **T3 Escalate** | Unresolvable or data-risk | Alerts with full context + recommended action | Decide + act |
| **T4 Critical** | Data loss or security risk | Escalates immediately, freezes affected component | Immediate action required |

### Failure → Response Matrix

| Failure | Tier | Automated Response |
|---|---|---|
| Printer stops responding | T1 | Retry connection, flush queue, log |
| KDS latency >500ms | T1 | Alert kitchen, attempt reconnect, log |
| Offline queue >50 items for >10min | T2 | Force sync attempt, alert manager |
| Terminal config mismatch detected | T2 | Push correct config, request restart |
| Sync conflict detected | T3 | Freeze conflicting order, alert with both versions |
| Certification expired | T3 | Alert FEOS, block new terminals from production |
| DB connection lost | T4 | Full offline mode, alert, persist all state locally |

---

## 11. FEOS Boundary

What currently lives in the app that belongs in FEOS. Migration is incremental — nothing moves until FEOS has the module ready.

| Currently in app | Moves to FEOS | FEOS Module | Phase |
|---|---|---|---|
| `/configuracion` | Restaurant configuration | Restaurant Manager | 2 |
| `/sucursales` | Branch management | Restaurant Manager | 2 |
| `/seguridad` | IAM, MFA, permissions | IAM & Security | 2 |
| `/certificados` | Installation certification | Auto-Certification | 3 |
| `/mission-control` | Real-time restaurant state | Observability Hub | 2 |
| `/admin/usuarios` | Team access management | Staff Manager + IAM | 2 |
| Electron `config.json` | Terminal configuration | Terminal Manager | 2 |
| `lib/settings.ts` station routing | Kitchen routing visual | Kitchen Manager | 3 |
| Printer IP config | Printer fleet management | Printer Manager | 3 |
| `clients.features` | Feature toggle per restaurant | Feature Flags | 2 |
| `onboard_client.py` | 8-step automated wizard | Installer & Provisioning | 2 |

**Rule:** Until FEOS has the module, the app keeps the functionality. No capability gap between today and FEOS migration.

---

## 12. Implementation Sequence

Ordered by impact/effort ratio. Steps 1–4 unlock the second client. Steps 5–10 complete the skeleton.

| Step | Action | Files | Effort | Unlocks |
|---|---|---|---|---|
| 1 | Eliminate `DEFAULT 'amalay'` from 17 tables | `004_remove_amalay_defaults.sql` | 4h | Multi-tenant data safety |
| 2 | Clean hardcoded fallback in client-config.ts | `lib/client-config.ts` | 1h | No AMALAY data in code |
| 3 | Remove AMALAY category slugs from constants | `lib/pos-constants.ts`, `lib/settings.ts` | 2h | Clean routing defaults |
| 4 | Add feature flag guard to panadería + market routes | `app/pos/panaderia/page.tsx`, `app/pos/inventario-market/page.tsx` | 30min | Routes hidden for other clients |
| 5 | Onboarding wizard — empty menu → setup CTA | `app/pos/page.tsx` | 4h | Day 0 UX for new restaurant |
| 6 | Auto-seed on provisioning | `onboard_client.py` + FEOS Provisioning | 3h | No manual seed SQL |
| 7 | Export 194 RLS policies to SQL migration | `supabase/migrations/004_rls_policies.sql` | 3h | Reproducible tenant isolation |
| 8 | Dynamic menu categories from DB | `lib/pos-data.ts`, `lib/pos-constants.ts` | 6h | Zero hardcoded categories |
| 9 | Tenant resolution por DB en delivery-worker (D-10) | `cloudflare/delivery-worker/src/index.ts` | 3h | `provider_store_id → integration_store_mappings → client_id`. Fail-closed + DLQ si no hay mapping. |
| 10 | Fetch meseros from DB in chat/voice AI context (D-11) | `api/chat/route.ts`, `api/voice/route.ts` | 2h | AI context correcto para cualquier cliente |
| 11 | Review escalation desde clients table (D-12) | `agents/reviews-manager/worker/src/lib/groq-api.ts` | 1h | Review agent multi-tenant |
| 12 | Eliminar email-to-role fallback (D-14) | `lib/roles.ts` | 30min | Auth sin datos AMALAY |
| 13 | Orquestador SYSTEM_PROMPT dinámico (D-15) | `cloudflare/orquestador-worker/src/lib/claude-api.ts` | 3h | War Room multi-tenant |
| 14 | Python scripts: CLIENT_ID requerido (D-16) | `.github/scripts/client_config.py` + 8 scripts | 2h | Automation sin default AMALAY |
| 15 | Uber Eats routes: requerir env var, throw en callback (D-17) | `api/integrations/uber-eats/webhook`, `auth/initiate`, `auth/callback` | 1h | OAuth tokens al tenant correcto |
| 16 | Cron route: requerir env var (D-18) | `api/agents/cron/route.ts` | 30min | Agentes IA corren para cliente correcto |
| 17 | Backup admins desde DB (D-19) | `api/backup/route.ts` | 1h | Export de backup accesible para cualquier dueño |
| 18 | Eliminar tabla amalay_reservaciones (D-20) | Nueva migración SQL | 1h | Schema limpio, sin tablas AMALAY dedicadas |
| 19 | Gate tests in CI as required checks | `.github/workflows/` | 2h | No skeleton regression merges |
| 20 | Smoke test con VANTARA + NÓMADA-MINI | `sandbox.app.fullsite.mx` | — | Skeleton acceptance verified |

### Estimación revisada (2026-08-01)

Estado 2026-08-02: D-01/02/03/04/06/07/08/09/11/12/13/14/15/16/17/18/19/21/22/23/24/25/27/28/29/34 = DONE. D-20 = BLOCKED (datos vivos, proyecto de migración separado). D-05 = DEFERRED. D-10/26/30/31/32/33 = OPEN.

| Sprint | Items | Estimado | Descripción |
|---|---|---|---|
| **Sprint 1** | D-21..D-29, D-34 (8 code fixes) | **~5h** | Un bloque, sin migraciones. Gate: P0-4 CERTIFIED. |
| **Sprint 2** | D-03/04 (post-migration code) + D-09 migration + D-20 migration + D-12 migration | **~4h** | Requiere correr las 4 migraciones SQL coordinadas con DB. |
| **Sprint 3** | D-10 (delivery worker) + D-30 (prediction widget) + D-32 (fingerprint URL) + D-27/28 cleanup | **~6h** | Integrations + config items. |
| **Sprint 4** | D-31 (OCM abstraction, wansoft tables) + D-33 (reservar page refactor) | **~12h** | OCM es prerequisito para D-31. D-33 requiere diseño de `reservation_spaces`. |
| **D-26** | FLOOR_TABLES → `pos_floor_plans` | **~12h** | Track separado. Requiere DB design + FEOS Kitchen Manager. |
| **D-05** | Menú desde DB (DEFERRED) | **~16h** | Depende de FEOS. No en roadmap activo. |

**Total hasta smoke test NÓMADA-MINI (sin D-26/D-05):** ~27h  
**Total completo incluyendo D-26:** ~39h  
**Vs estimación anterior (~41h para D-01..D-20):** el scope creció con 14 nuevos items, pero 14 de los originales ya están DONE → el costo neto es similar.

---

## Execution Priority

**Documentation phase is closed. Implementation sets the pace.**

The motor operativo gets certified before the control plane that will manage it. No P(n+1) starts until P(n) has at least one milestone in production with evidence of clonability.

### Work classification (formalizado 2026-08-01)

Every active work item belongs to exactly one category:

| Cat | Name | Rule |
|---|---|---|
| **A** | Critical path | Delays this item → delays the next major platform milestone |
| **B** | Parallel | Generates value, but does not move the date of the next milestone |
| **C** | External | Blocked by a third party (Uber, SAT, Facturapi, vendors, etc.) |

**If a Cat B item is consuming capacity that a Cat A item needs → Cat B pauses.**  
**If a Cat C item unblocks → it may become Cat A or B at that point.**

### Active roadmap

| Priority | Initiative | Category | Unlocks |
|---|---|---|---|
| **P0** | Offline Fase 5 — ejecución física en AMALAY | **A** | P0 DONE → P1 arranca |
| **P0** | OCS P2.5.9 Offline/Sync smoke test | **A** | Completa certificación OCS |
| **P1** | Golden Skeleton — eliminar AMALAY debt D-01…D-20 | **A** | Clonable product → Cliente #2 |
| **P2** | FEOS Core — Orgs, Restaurants, Users, Roles | **A** | Control plane |
| **PAE** | Platform Acceptance Environment | **A** | Gate antes de Cliente #2 |
| **Uber Eats** | Sandbox (B-1…B-6) + Categoría B + ticket Uber | **B** (paralelo) + **C** (B-3, B-6 Uber) | Revenue diversification |
| **P0-3** | CSD Facturapi / SAT | **C** | CFDI en producción |

### Pre-Implementation Gate

Before implementing any significant feature, answer these 4 questions. If any answer indicates AMALAY-specific or manual, redesign before implementing.

| # | Question | If "No"... |
|---|---|---|
| I-01 | ¿Esto pertenece al producto o es específico de AMALAY? | No implementar — o generalizar primero |
| I-02 | ¿Puede configurarse desde FEOS en lugar de quedar hardcodeado? | Diseñar el punto de configuración antes de escribir el código |
| I-03 | ¿Puede automatizarlo un agente en lugar de requerir una persona? | Documentar en ZHO y diseñar el path de automatización |
| I-04 | ¿Será reutilizable por cualquier restaurante nuevo sin modificar código? | Replantear el diseño — no es plataforma, es deuda |

**Execution Mode (permanent rule):** Every new document, ADR, or architectural decision ends in implementation. Ideas enter the Platform Lifecycle pipeline — no document that doesn't map to a specific Implementation milestone is merged into `docs/`. Each implementation ends with its certification, consolidation in `docs/`, and commit.

### Definition of Done

No phase advances because "it's almost there." Each phase closes only when all criteria are met.

| Phase | Closed when... |
|---|---|
| **P0 — Operational Certification Suite** | All modules certified. P0/P1 gaps resolved. Evidence consolidated in `docs/certifications/`. Parity or superiority vs Wansoft on equivalent flows. |
| **P1 — Golden Skeleton** | Debt Registry P0+P1 items = 0. Smoke test NÓMADA-MINI passes. See P1 exit gate below. |
| **P2 — FEOS Core** | Multiple organizations, restaurants, users, roles, and permissions working end-to-end. ZHO-01/02/03/04 resolved with evidence. |

#### P1 Exit Gate — Reglas formales (formalizado 2026-08-01)

**Criterio de cierre por ítem del Debt Registry:**

Una deuda (D-XX) solo se marca cerrada cuando existe evidencia objetiva:
1. Commit con el fix identificable
2. Tests que demuestren que la dependencia desapareció (grep, suite, o prueba funcional)
3. Para P0: demostración funcional de que el módulo afectado opera para un restaurante nuevo sin depender de AMALAY

"El código se ve bien" no cierra ningún ítem.

**Clasificación durante P1:**

| Prioridad | Definición | Ejemplos |
|---|---|---|
| P0 | Bloquea Minute 0 o rompe multi-tenencia | D-01, D-03, D-04, D-09, D-10, D-11, D-12 |
| P1 | Impide que el Skeleton sea completamente genérico | D-05, D-06, D-07, D-08, D-13, D-14, D-15, D-16 |
| P2/P3 | No bloquea clonabilidad — ejecutar después del smoke test | HC-08, HC-09, HC-10 |

**Gate de salida:**

- Debt Registry debe llegar a **P0 = 0 y P1 = 0** antes del smoke test NÓMADA-MINI
- Si durante el smoke test aparece una nueva dependencia AMALAY: registrar como D-xx, corregir, repetir el smoke test
- El objetivo es que el Skeleton salga realmente independiente, no "suficientemente bueno"
- Si durante la implementación aparecen nuevas dependencias reales: ampliar el registro, no cerrar P1 con deuda oculta

**Smoke test NÓMADA-MINI (criterio de aceptación final):**

```
1. python3 scripts/onboard_client.py --client-id nomada --display-name "Nómada Mini"
2. Login con credenciales del restaurante nuevo (ningún token ni cookie de AMALAY)
3. POS carga sin datos de AMALAY visibles en ninguna pantalla
4. Tomar una orden → enviar a cocina → cobrar → imprimir ticket
5. AI Chat responde con contexto de "Nómada Mini", no de AMALAY
6. Dashboard KPIs en cero — no hay datos de otro restaurante visibles
7. grep -r "amalay" src/ lib/ app/ (excluir docs/) → 0 hits relevantes
```

Si cualquier paso falla → nueva deuda D-xx → fix → repetir desde paso 1.
| **P3 — Demo 24/7** | Creating an org + restaurant from FEOS produces a fully operational Dashboard, POS, and KDS — zero code touched, zero manual SQL. |

### Development Cycle

Every implementation follows this permanent cycle. AMALAY remains the operational reference — if it doesn't work reliably there, it does not reach the Skeleton or the Control Plane.

```
Implementation → AMALAY → Certification → Golden Skeleton → FEOS
```

- **Implementation:** code exists, tests pass
- **AMALAY:** runs reliably in production — 30+ days or explicit sign-off
- **Certification:** smoke test + certification doc in `docs/certifications/`
- **Golden Skeleton:** zero AMALAY-specific code in this module
- **FEOS:** control plane module owns configuration, no manual intervention needed

---

## 13. Governance

**Update rule:** Update this document when a fact changes — not when you think about changing it.  
**Section ownership:** Each section can be updated independently. No section owns another.  
**No rewrites:** Append or replace individual sections. Never regenerate this file wholesale.  
**Evidence requirement:** Readiness scores require a date and a blocking-issue list. A score with no evidence is invalid.  
**PR gate:** This document does not replace `GOLDEN-SKELETON.md` (the 5-question PR gate). Both are required.  
**Versioning:** When a major structural change is needed, create `GOLDEN-POS-SKELETON-v2.md` and deprecate this file with a pointer.

**Living document / auto-scoring (future state):** Platform Readiness and Autonomy scores are currently updated manually. The target is for these scores to be calculated automatically from: CI test results, certification suite outputs, `feos_restaurant_state` health data, and agent run outcomes. When auto-scoring is live, the `Last Updated` column in §4 is replaced by a build badge. Until then: never update a score without a date and a linked blocking-issue change.

**Execution Mode (permanent):** This document is closed for major additions. New concepts enter as ADRs in `docs/adr/` and are promoted here only when they reach the SKELETON stage of the Platform Lifecycle. The ratio of docs-to-code must decrease with every release.

**Debt Registry frozen (2026-08-02):** D-01..D-34 is the complete and closed backlog for Golden Skeleton. No new D-xx may be added unless a blocker crítico real emerge durante la ejecución del smoke test NÓMADA-MINI o del Sprint 1. Cualquier adición debe justificarse explícitamente con: archivo, línea, riesgo operativo demostrado, y aprobación de Daniel. El objetivo es reducir el backlog, no hacerlo crecer. Los P3 sin D-xx (HC-29/30/32/35) permanecen como deuda de baja prioridad, no como items accionables del Golden Skeleton sprint.
