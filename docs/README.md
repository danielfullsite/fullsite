# Fullsite — Knowledge Base

> Única fuente de verdad. Última actualización: 2026-08-19 (auditoría full + saneo de docs).
> Flujo permanente: Artifact → Revisión → Consolidación → **docs/** → Commit.
>
> ⚠️ Muchos docs individuales son de julio y llevan banner "DOCUMENTO HISTÓRICO". El estado
> vigente vive en: [`DECISION-BRAIN.md`](DECISION-BRAIN.md) (router de decisiones),
> [`PLAN-AHORA.md`](PLAN-AHORA.md) (qué hacer), [`audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md`](audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md)
> (estado completo) y [`state/OPEN-ITEMS.md`](state/OPEN-ITEMS.md) (todo lo abierto).

---

## ¿Qué es Fullsite?

Fullsite es un **Restaurant Operating System** multi-restaurante. No es un POS más. Es la capa que convierte datos operativos en decisiones en tiempo real.

Thesis central: los restaurantes no tienen un problema de software. Tienen un problema de decisiones. Fullsite resuelve eso dando información al segundo — ventas, inventario, food cost, meseros, propinas — sin que el gerente tenga que esperar al cierre del día.

El modelo: plataforma SaaS multi-tenant, un solo Supabase, particionamiento por `client_id` + RLS. El POS corre en Electron (local-first). El dashboard corre en Next.js (cloud). Los dos se sincronizan.

---

## ¿Qué debo leer primero?

| Propósito | Doc |
|---|---|
| **Antes de decidir/cambiar algo: de dónde sale cada decisión** | [`DECISION-BRAIN.md`](DECISION-BRAIN.md) |
| Entender la filosofía y restricciones | [`constitution/PRINCIPLES.md`](constitution/PRINCIPLES.md) |
| Entender cómo está construido | [`architecture/SYSTEM-ARCHITECTURE.md`](architecture/SYSTEM-ARCHITECTURE.md) |
| **Qué está abierto (índice único)** | [`state/OPEN-ITEMS.md`](state/OPEN-ITEMS.md) |
| **Qué hacer ahora (priorizado)** | [`PLAN-AHORA.md`](PLAN-AHORA.md) |
| **Estado completo auditado** | [`audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md`](audit/AUDITORIA-FULL-FULLSITE-2026-08-19.md) |
| Certificaciones (⚠️ congeladas 07-31) | [`state/CERTIFICATIONS.md`](state/CERTIFICATIONS.md) |
| Entender qué sigue | [`feos/INITIATIVES.md`](feos/INITIATIVES.md) + [`feos/EXECUTION-PLAN.md`](feos/EXECUTION-PLAN.md) |
| Entender la arquitectura offline | [`architecture/LOCAL-FIRST.md`](architecture/LOCAL-FIRST.md) |
| **Fullsite Factory — programa vivo (estado, contratos, ADRs, runbooks)** | [`factory/README.md`](factory/README.md) |

---

## Mapa completo

### Patterns — implementaciones reutilizables
```
patterns/
  README.md                  Catálogo completo y reglas de contribución.
  canonical-module.md        Business rule usada por >1 componente → módulo canónico (ADR-004).
  optimistic-update.md       Aplicar cambio inmediato + rollback en error. Cierre-by-closure.
  forward-only-state-machine.md  Rank numérico previene transiciones hacia atrás en multi-device.
  background-poll.md         setInterval + cleanup + fallback offline para superficies en tiempo real.
  auto-archive.md            Avanzar registros stale a estado terminal en cada ciclo de poll.
  offline-queue.md           Write-through cache + sync_queue para operación offline.
  recoverable-operation.md   Side effects externos (cobro, CFDI) antes del write → log durable + retry.
```

### Constitution — principios permanentes (no se negocian)
```
constitution/
  PRINCIPLES.md              15 restricciones. "Nunca perder una orden. Nunca emitir factura incorrecta."
  ENGINEERING-AXIOMS.md      Axiomas derivados de bugs reales. Scope: Fullsite + Octogent.
  CONCURRENCY.md             Protocolo de concurrencia en el POS.
  DATA-MODEL.md              Tablas core, invariantes, relaciones canónicas.
```

### Architecture — cómo está construido
```
architecture/
  SYSTEM-ARCHITECTURE.md     Platform Architecture v1 (frozen 2026-07-28). Multi-tenant, RLS, auth flow.
  OFFLINE-AUTH.md            Autorización offline PBKDF2 — diseño, API, threat model. [2026-07-31]
  LOCAL-FIRST.md             Arquitectura offline/local-first completa. 1,473 líneas. Doc fundacional.
  OFFLINE-MASTER.md          Resumen ejecutivo del sistema offline. Punto de entrada rápido.
  EVENT-STORE.md             Event store del Electron app.
  BRIDGE.md                  Print bridge architecture.
  PERSISTENCE-LAYER.md       sync_queue y capa de persistencia operacional.
  PER-02-RESEARCH.md         Investigación de alternativas de persistencia (PER-02).
  entity-schema-matrix.md    Matriz de cobertura de entidades.
  OFFLINE-GAP-001.md         Gap de arquitectura offline #1.
  OFFLINE-GAP-002.md         Gap de arquitectura offline #2.
  OFFLINE-IMPL-001-OUTBOX-v2.2.md  Outbox pattern v2.2 (versión canónica).
  incidents/
    INCIDENT-b6882d1.md      Postmortem del incidente b6882d1 (commit isolation).
```

### ADR — por qué cada decisión
```
adr/
  README.md                  Template + índice numerado.
  ADR-001-CONCURRENCY.md     Por qué el modelo de concurrencia actual.
  ADR-002-FISCAL-MODEL.md    Por qué el modelo fiscal elegido.
  ADR-003-TURNO-LIFECYCLE.md Por qué el ciclo de vida del turno.
  ADR-004-CANONICAL-MODULE.md  Canonical Module Rule — regla business en >1 componente → módulo canónico.
```

### Product — qué construimos
```
product/
  POS-SPEC.md                Spec completo del POS v2.
  SETTINGS-BIBLE.md          Referencia de configuración. 2,369 líneas.
  LOCAL-FIRST-RFC.md         RFC de la arquitectura local-first (P0-4).
  WANSOFT-POS-BIBLE.md       Paridad funcional con Wansoft.
  RUNTIME-SPEC.md            Especificación del runtime.
  SETTINGS-GAP-ANALYSIS.md   Gaps en configuración vs Wansoft.
  HARDCODE-REGISTRY.md       Registro de hardcodes pendientes de eliminar.
```

### Offline — sistema offline completo
```
offline/
  RUNBOOK.md                 Runbook de certificación offline. Fuente canónica.
  TEST-MATRIX.md             Matriz de 13 pruebas de certificación.
  CHAOS-TESTS.md             Tests de caos para validación offline.
  OBSERVABILITY.md           Métricas y observabilidad offline.
  RECOVERY.md                Protocolos de recuperación.
  EXECUTIVE-SUMMARY.md       Resumen ejecutivo del estado offline.
  WANSOFT-BENCHMARK.md       Wansoft como benchmark de confiabilidad offline.
  MULTI-RESTAURANT-DEPLOYMENT.md  Deployment offline en múltiples restaurantes.
  CODE-AUDIT.md              Auditoría de código offline (PAY/ORD/KDS/CFG/PER series).
  LIMITACION-OFF-INV-01.md   Limitación documentada en inventario offline.
```

### Playbooks — cómo hacer X
```
playbooks/
  ONBOARDING-RESTAURANT.md   De cero a go-live. Crítico para escalar.
  CUTOVER.md                 Cutover de Wansoft a Fullsite.
  GO-LIVE.md                 Checklist de go-live.
  DEPLOY-SANDBOX.md          Deploy de nuevo sandbox.
  SQL-MIGRATION.md           Ejecución de migraciones SQL.
  HID-SETUP.md               Setup de hardware (impresoras, cajón, terminal).
  SALES.md                   Playbook de ventas.
  LINKEDIN-OUTREACH.md       Outreach en LinkedIn.
  BUG-FIX.md                 Ciclo completo: reproducir → fix → cert.
  RELEASE.md                 Build Electron + distribución.
  guides/
    guia-mesero.md
    guia-cajero-gerente.md
    guia-cocina-barra.md
```

### Certifications — evidencia certificada (inmutable al cerrarse)
```
certifications/
  PRR-v1.md                  Production Readiness Review v1. Score 4.7/10. 27 hallazgos.
  OFFLINE-SUITE-v1.md        Offline Certification Suite v1. OC-01–OC-12. 8 P0 + 11 P1.
  AMALAY-R1-VALIDATION.md    Validación de campo R1 en AMALAY. PASS 2026-07-16.
  CFG-01-REPORT.md           Reporte de certificación CFG-01.
  FOUNDATION-SKELETON-AUDIT.md  Auditoría del Foundation Skeleton (SKEL-04).
  PUBLIC-CLAIMS-REGISTER.md  Registro de claims públicos con evidencia.
  OCS-P2.5.4-CAJA.md         OCS Caja — CERTIFIED 2026-07-31. 27 tests E2, 0 regresiones.
  OCS-P2.5.5-KDS.md          OCS KDS/Cocina/Barra — CERTIFIED 2026-07-31. 24 tests E2, 0 regresiones.
  OCS-P2.5.6-IMPRESION.md    OCS Impresión/Print Bridge — CERTIFIED 2026-07-31. 23 tests E2, 0 regresiones.
  OCS-P2.5.7-ORDERS.md       OCS Órdenes/Flujo Principal — CERTIFIED 2026-07-31. ORD-GAP-01 resuelto. 229 tests.
  OCS-P0-1-GUARD08.md        OCS P0-1 GUARD-08 — CERTIFIED 2026-07-31. Soft-block + escalación. 27 tests E2.
  OCS-P2.5.8-PAGOS.md        OCS Pagos completo — CERTIFIED 2026-07-31. PAY-GAP-01 resuelto. 1843 tests.
  KDS-WANSOFT-GAP-ANALYSIS.md  Revisión funcional KDS vs Wansoft. 6 gaps (2×P2, 4×P3).
```

### State — estado vivo (se actualiza cada sesión)
```
state/
  OPEN-ITEMS.md              Índice ÚNICO de lo abierto (OP-01..OP-35). Fuente de verdad.
  BUGS.md                    ⚠️ Legacy (POS-XX/DASH-XX, incompleto). Migrar a OPEN-ITEMS.
  CERTIFICATIONS.md          Estado de P0-1 a P0-4 y certificaciones activas.
  FREEZES.md                 Freezes activos.
```

### FEOS — Fullsite Engineering Operating System
```
feos/
  OVERVIEW.md                Qué es FEOS y cómo usarlo.
  INITIATIVES.md             Las 9 iniciativas P-01 a P-09.
  EXECUTION-PLAN.md          Plan de ejecución P0 activo.
```

### Platform — Golden Skeleton + plataforma multi-restaurante
```
platform/
  GOLDEN-SKELETON.md         El Golden Skeleton: 5 preguntas antes de cualquier PR.
  GOLDEN-POS-SKELETON.md     Skeleton completo del POS: scores, debt registry, roadmap A/B/C.
  PAE.md                     Platform Acceptance Environment — Café Nómada. Gate antes de Cliente #2.
  PAE-IMPLEMENTATION-PLAN.md Backlog de implementación PAE: 6 componentes, dependencias, riesgos, PASS/FAIL.
  PROVISIONING.md            Cómo aprovisionar un nuevo cliente.
  GOLDEN-DEPLOYMENT-KIT-v1.md Generador de configs, impresoras, manifiesto y smoke por sucursal.
  CLONEABILITY-REPORT-v1.md  Reporte de clonabilidad v1.
  migrations/
    00..07 *.md               Pipeline del Migration Engine (MT-03 CLOSED).
    OCM-v0.1.md               Operational Canonical Model v0.1 (frozen 2026-07-29).
    SEC-DEPLOY-01-*.md        Security deployment plan.
    MT-03-closure-report.md   Cierre formal de MT-03.
```

### AI — Agentes IA y War Room
```
ai/
  OVERVIEW.md                Mapa del War Room multi-agente.
  AGENT-CERTIFICATION-REGISTRY.md  Registro de certificaciones de agentes.
  AGENT-CERTIFICATION.md     Protocolo de certificación de agentes.
```

### Customers — documentación por restaurante
```
customers/
  amalay/
    DEPLOYMENT-STATE.md      Estado físico actual: topología, P0/P1/P2 por dispositivo.
    LOG.md                   Diario operacional vivo.
    MANUAL-OPERATIVO.md      Manual de operación para el equipo AMALAY.
    OPERATING-SYSTEM.md      Sistema operativo de AMALAY.
    FIELD-NOTES.md           Notas de campo de visitas.
    WANSOFT-EXIT-AUDIT.md    Auditoría de salida de Wansoft.
    [otros archivos de visitas y sesiones]
```

### Knowledge — Wansoft, benchmarks, intel competitivo
```
knowledge/
  PMF-DEEP-RESEARCH.md       Investigación profunda de PMF.
  wansoft/
    ARCHITECTURE.md          Arquitectura de Wansoft.
    BACKOFFICE-KNOWLEDGE.md  Conocimiento del backoffice.
    CAJA-SPEC.md             Spec de caja en Wansoft.
    DATA-MODEL.md            Modelo de datos de Wansoft.
    PORTAL-MAP.md            Mapa del portal de Wansoft.
    BIBLE.md                 Bible completa de Wansoft.
    DEPENDENCY-ELIMINATION.md  Plan de eliminación de dependencia.
    AUTH-DIAGNOSIS.md        Diagnóstico de auth en Wansoft.
    LESSONS-NETSILVER.md     41 lecciones del reverse engineering de NetSilver.
  competitive/
    COMPETITIVE-INTELLIGENCE.md  Intel competitivo detallado.
    LANDSCAPE-MEXICO.md      Landscape competitivo en México.
    HOW-TOAST-CLIP-PMF.md    Cómo Toast y Clip encontraron PMF.
    WHY-RESTAURANTS-SWITCH.md  Por qué los restaurantes cambian de POS.
    RESTAURANT-PAIN-POINTS.md  Pain points documentados.
```

### Strategy — empresa y negocio
```
strategy/
  COMPANY-BRAIN.md           Thesis de la empresa. "No un problema de software. De decisiones."
  INVESTMENT-THESIS.md       Thesis de inversión v1. 3 mecanismos de moat.
  WHY-FULLSITE-WINS.md       Por qué Fullsite gana vs competidores.
  PRICING.md                 Precio canónico: $4,999 MXN/mes + $4,999 setup.
  ICP-PLAYBOOK.md            Ideal Customer Profile.
  UNIT-ECONOMICS-DEEP.md     Unit economics detallados.
  OPERATIONAL-INTELLIGENCE-ROADMAP.md  Roadmap de inteligencia operacional.
  FULLSITE-VALUATION-MEMO-JUL2026.md   Memo de valuación jul 2026.
  DECISIONS.md               Decisiones estratégicas clave.
  AI-OPPORTUNITIES.md        Oportunidades de IA no capturadas.
  [otros docs de estrategia y GTM]
```

### Operations — operaciones generales
```
operations/
  OPERATIONAL-RELIABILITY.md  Guía de confiabilidad: DR, RTO/RPO, Manager Panel.
  PLAYBOOK.md                 Playbook general de operaciones.
  CUSTOMER-2-ACCEPTANCE-CRITERIA.md  Criterios de aceptación para Cliente #2.
  STATE-OF-THE-COMPANY-2026-07-01.md  Snapshot de estado jul 2026.
  DEBRIEF-TEMPLATE.md         Template para debriefs de visita.
```

### Security
```
security/
  SECURITY-FOUNDATION.md     Foundation de seguridad: PINs, roles, RLS, audit.
  POS-BROWSER-SECURITY.md    Seguridad del POS en browser.
  SECURITY-GLOBAL.md         Políticas globales.
  policies/
    01-information-security-policy.md
    02-access-control-policy.md
    03-incident-response-plan.md
    04-business-continuity-disaster-recovery.md
    05-change-management-policy.md
    06-data-handling-policy.md
    07-vendor-management-policy.md
    08-acceptable-use-policy.md
    09-risk-assessment-policy.md
    10-logging-monitoring-policy.md
    11-pci-dss-saq-a.md
```

### Postmortems
```
postmortems/
  README.md + TEMPLATE.md
  R0-INVENTORY-DEDUCTION.md
  ROOT-CAUSE-001-recipe-identifier-mismatch.md
```

### Investor / Hiring
```
investor/    pitch decks (DALUS, HI-VENTURES)
hiring/      COFOUNDERS.md
```

### Archive — histórico inmutable
```
archive/
  bibles/          19 bibles de la era pre-consolidación.
  handoffs/        Handoffs de sesiones anteriores.
  migration-plans/ DOCS-MIGRATION-MANIFEST-2026-07-27, ROADMAP-2026-06-30, MASTER-INDEX-2026-07-02.
  legacy-fullsite-docs/  Contenido de FULLSITE DOCS/ que no migró.
  [otros docs históricos]
```

---

## Invariantes del knowledge base

1. `docs/` es la única fuente de verdad. Nunca en la raíz del repo (salvo `CLAUDE.md` y `AGENTS.md`).
2. Flujo permanente: **Artifact → Revisión → Consolidación → docs/ → Commit**.
3. `constitution/` solo cambia con RFC aprobado.
4. `state/` se actualiza cada sesión. Es el único directorio que se espera que cambie frecuentemente.
5. `certifications/` es inmutable una vez que una certificación está cerrada.
6. `archive/` nunca se elimina. Solo recibe, nunca pierde.
7. Los artifacts de Claude no son documentación permanente. Todo artifact crítico termina en `docs/`.
