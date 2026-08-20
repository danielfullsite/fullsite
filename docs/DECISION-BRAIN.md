# DECISION BRAIN — de dónde sale cada decisión

> **Qué es esto:** el mapa de las fuentes-oro para tomar decisiones en Fullsite. No es el índice de carpetas (eso es `README.md`) ni la tesis (eso es `strategy/COMPANY-BRAIN.md`). Esto responde una sola pregunta: *"antes de decidir/cambiar X, ¿qué documento ya probado debo leer y citar?"* — para que el conocimiento nunca se pierda y ninguna decisión se tome a ciegas.
>
> **Última actualización:** 2026-08-19.

---

## Regla de operación (obligatoria)

1. **Confirmar antes de actuar.** Antes de cualquier cambio o decisión, buscar el dominio abajo, leer la(s) fuente(s)-oro, y confirmar contra ella. No decidir por decidir.
2. **Basarse en lo que ya es oro.** Los documentos probados en campo (marcados 🏆) ganan sobre cualquier suposición o memoria. Si una memoria contradice un doc field-verified, gana el doc — y se corrige la memoria.
3. **Citar la fuente.** Toda afirmación analizada dice de dónde salió (archivo + sección/commit). "Según `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md §4`…", no "yo creo que…".
4. **El campo es el juez.** Las sesiones en AMALAY (🏆) son la máxima autoridad para offline/operación. Un doc de diseño describe la intención; una sesión de campo describe la realidad. Cuando difieren, gana el campo.
5. **Mantener vivo.** Cada sesión que produce oro (una prueba de campo, una auditoría, un plan) se agrega aquí con su fecha. Un cerebro que no se actualiza miente.

Marcadores: 🏆 = probado en campo (máxima autoridad) · ✅ = verificado en código/prod · 📐 = diseño/intención (no probado aún) · ⚠️ = viejo, verificar antes de citar.

---

## Offline / caja / LAN — el corazón, el oro más grande

**Antes de tocar CUALQUIER cosa de offline, print, KDS, bridge o el local-server, leer primero:**

| Fuente | Autoridad | Qué fundamenta |
|---|---|---|
| `docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md` | 🏆 | **La receta offline probada en campo (AMALAY 2026-08-18).** Topología, las reglas duras (KDS por HTTP, bridge a localhost, no romper), instalación. Punto de partida obligatorio. |
| `docs/pos/PIPELINE-POS-KDS-OFFLINE.md` | 🏆 | Estado exacto por terminal, P0-1..P0-4, diagnósticos, riesgos del demo. |
| `docs/pos/PLAN-INSTALACION-AMALAY-JUEVES.md` | ✅ | Plan de instalación consolidado (versiones, qué reinstalar y qué no, prueba de offline, las 5 reglas duras). |
| `docs/architecture/LOCAL-FIRST.md` | 📐 | Doc fundacional de la arquitectura offline (1,473 líneas). El "por qué" del diseño. |
| `docs/architecture/OFFLINE-MASTER.md` + `EVENT-STORE.md` + `BRIDGE.md` | 📐 | Event store, print bridge, resumen ejecutivo. |
| `docs/offline/RUNBOOK.md` + `TEST-MATRIX.md` + `CHAOS-TESTS.md` | 📐 | Protocolo de certificación (13 pruebas), tests de caos, recuperación. |
| `docs/offline/MULTI-RESTAURANT-DEPLOYMENT.md` | 📐 | Las 3 capas (producto / deployment / datos) para clonar offline. |
| Código canónico | ✅ | `electron-app/main.js` (carga UI, kds_only, inyección bridge), `electron-app/local-server/index.js` (Pedro: /state /print /kds /events /fp), `config-schema.js`. |

**Regla dura verificada (no romper):** el fix de velocidad vive en la **web** (`dashboard-app/src/lib/pos-data.ts` + `pos/page.tsx`, en `origin/main` → Vercel), NO en la cáscara → la caja lo toma con F5, no se reinstala.

---

## Sesiones de campo AMALAY — oro puro (la realidad, no la intención)

**Estas describen lo que REALMENTE pasó en el restaurante. Máxima autoridad para offline y operación.**

| Fuente | Fecha | Qué fundamenta |
|---|---|---|
| `docs/customers/amalay/DEPLOYMENT-STATE.md` | vivo | Topología física actual, P0/P1/P2 por dispositivo. |
| `docs/customers/amalay/LOG.md` | vivo | Diario operacional — qué se hizo cada visita. |
| `docs/customers/amalay/FIELD-NOTES.md` + `FIELD-NOTES-PREFLIGHT-JUL12.md` | JUL | Notas crudas de campo. |
| `docs/customers/amalay/DEBRIEF-JUL12.md` | JUL-12 | Debrief de la visita. |
| `docs/customers/amalay/EDUARDO-SESSION-JUL21.md` | JUL-21 | **Spec del KDS de Eduardo** (estación, FIFO, tarjeta por envío, personas, "Enviar", sin cancelar, offline). |
| `docs/customers/amalay/VERIFICACION-CAJA-JUEVES.md` + `KDS-BUILD-JUEVES.md` + `PREFLIGHT-DAY0-FINAL.md` | JUL | Checklists de verificación en sitio. |
| `docs/customers/amalay/MANUAL-OPERATIVO.md` + `OPERATING-SYSTEM.md` | vivo | Cómo opera AMALAY con Fullsite. |
| `docs/certifications/AMALAY-R1-VALIDATION.md` | 🏆 JUL-16 | Validación de campo R1 — PASS. |
| Memoria: `project_amalay_pos_reinstall_20260817`, `project_offline_debug_session` | 🏆 AGO 17-18 | El breakthrough offline en campo (caja+cocina+entrada por LAN sin internet). |

---

## Inventario / food cost — contrato formal

| Fuente | Autoridad | Qué fundamenta |
|---|---|---|
| `dashboard-app/AGENTS.md` (tabla de contratos) | ✅ | **Inventario = `recordMovement()` formal.** Prohibido PATCH directo a `pos_inventory`. Físico y merma ya migrados; facturas-proveedor/recepción pendientes. |
| `dashboard-app/src/lib/inventory.ts` | ✅ | El contrato: ledger atómico + costo promedio + idempotencia + underflow. |
| `docs/product/HARDCODE-REGISTRY.md` | 📐 | Hardcodes pendientes. |
| Memoria: `project_food_cost_truth` | 📐 | pos_recipes = verdad ~27.6%. |

---

## Fraude / seguridad — auditoría + blindaje

| Fuente | Autoridad | Qué fundamenta |
|---|---|---|
| `docs/audit/AUDITORIA-FULL-2026-08-19.md` | ✅ | **Auditoría full POS/KDS/Dash/Offline.** 4 CRÍTICO (skimming, cancelar, KDS fan-out, render), 6 ALTO. |
| `docs/security/FRAUD-ENFORCEMENT-FLAGS.md` | ✅ | **Runbook de los flags grace→strict:** `POS_APPROVAL_STRICT` (reopen), `CANCEL_APPROVAL_STRICT` (cancel). Cuándo/cómo voltear, verificar, rollback. Skimming Fase 2 (rechazo) aún no codificada. |
| Código en `origin/main` | ✅ | `save-order` (skimming grace), `cancel-item` (enforcement grace), `reopen-order`+`manager-approval` (grace). Default = grace (audita `legacy_no_approval`). |
| `docs/security/SECURITY-FOUNDATION.md` + `policies/` | 📐 | PINs, roles, RLS, audit, SOC2. |
| Memoria: `project_blindaje_security_audit`, `project_full_audit_20260819` | ✅ | 31 hallazgos, plan B1-B6, aislamiento multi-tenant cerrado+verificado. |

---

## Eduardo / KDS — requisitos y variantes

| Fuente | Autoridad | Qué fundamenta |
|---|---|---|
| `docs/audit/EDUARDO-REQUISITOS.md` | ✅ | Los requisitos de Eduardo (KDS 15, POS 12, permisos 22, inv 9, offline 4) + estado. |
| `docs/customers/amalay/EDUARDO-SESSION-JUL21.md` | 🏆 | La spec original de la sesión de campo. |
| Memoria: `project_kds_variants` | ✅ | **Cuál KDS es cuál:** el build dedicado (PDV2) carga `kds-ui.html` local (kds_only), NO `/pos/cocina`. Los fixes de layout van en `kds-ui.html`. |

---

## Clonabilidad / provisioning — el modelo multi-restaurante

| Fuente | Autoridad | Qué fundamenta |
|---|---|---|
| `docs/platform/GOLDEN-POS-SKELETON.md` | 📐 | Los design goals de clonabilidad (100% clonable, multi-tenant, offline-first, LAN-first). |
| `docs/platform/PROVISIONING.md` + `CLONEABILITY-REPORT-v1.md` | 📐 | Cómo aprovisionar un cliente nuevo. |
| `docs/offline/MULTI-RESTAURANT-DEPLOYMENT.md` | 📐 | Las 3 capas de clonado. |
| `electron-app/local-server/config-schema.js` | ✅ | Schema universal (roles server_pos/pos/kds), sin hardcodes de cliente. **Hueco:** config se genera a mano hoy (causó el BOM de Escondite). |
| Memoria: `project_multitenant_architecture_decision`, `project_skeleton_productization` | 📐 | Compartido+subdominio, caja=ancla, clonable. |

---

## Producto / dirección / pagos — a dónde va la empresa

| Fuente | Autoridad | Qué fundamenta |
|---|---|---|
| `docs/product/DIRECTION-EXPERTO-EN-TU-RESTAURANTE.md` | 📐 | La tesis: POS=sensor, IA=producto. 5 jugadas. |
| `docs/strategy/COMPANY-BRAIN.md` | 📐 | Tesis completa, narrativa YC, D-F-E-T, 5 filtros de priorización. |
| Artifact master plan (`bce402d8`) + memoria `project_yc_masterplan_direction` | 📐 | Plan maestro esquina-a-esquina + jugada de pagos (ISV rev-share). |
| `docs/strategy/PRICING.md` + memoria `project_pricing` | ⚠️ | Precio EN REVISIÓN (3 paquetes). |

---

## Arquitectura / multi-tenant — cómo está construido

| Fuente | Autoridad | Qué fundamenta |
|---|---|---|
| `docs/architecture/SYSTEM-ARCHITECTURE.md` | 📐 | Platform Architecture v1 (frozen). Multi-tenant, RLS, auth. |
| `docs/constitution/PRINCIPLES.md` | ✅ | 15 restricciones que no se negocian. "Nunca perder una orden." |
| `docs/platform/migrations/OCM-v0.1.md` | ✅ | Operational Canonical Model (frozen, versionado). |
| `dashboard-app/AGENTS.md` | ✅ | Contratos de dominio + fronteras (inventario, event store, print, etc.). |

---

## Índices hermanos (no confundir con éste)

- `docs/README.md` — índice de TODAS las carpetas (⚠️ viejo, 2026-07-31; no lista el oro reciente).
- `docs/strategy/COMPANY-BRAIN.md` — cerebro estratégico (el "por qué" de la empresa).
- `docs/HANDOFF-STATE.md` — estado de handoff entre sesiones.
- `MEMORY.md` (auto-memoria de Claude) — punteros de una línea a memorias de sesión.

Este doc (`DECISION-BRAIN.md`) es el router de **decisiones técnicas/operativas → fuente-oro**. Los otros son estratégicos o de navegación.
