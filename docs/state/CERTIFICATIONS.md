# Certificaciones — Fullsite

> **Fuente de verdad para el estado de certificación.**
> Regla: solo pasar a PASS con evidencia archivada.
> Regla: nunca reabrir un PASS sin evidencia de regresión.
> Regla: este archivo es el índice — nunca la fuente primaria de evidencia.
> Regla: toda entrada debe referenciar un documento de evidencia que exista en disco.
> Última actualización: 2026-08-01

---

## Qué significa CERTIFIED

Una feature es CERTIFIED cuando:
1. Fue probada en operación real (no en staging, no en prueba de escritorio)
2. La evidencia está archivada (video, logs, commit)
3. Los criterios de aceptación definidos se cumplen sin excepción

"Parece funcionar" no es CERTIFIED. "Eduardo lo usó y no se quejó" no es CERTIFIED.

---

## Gate obligatorio: Shadow Day

Shadow Day es un gate explícito antes de Go-Live para todo cliente nuevo (Cliente #2 en adelante). Sin Shadow Day aprobado, no hay Go-Live — sin excepción.

**Criterio de aprobación:** al final del Shadow Day, el gerente abre turno, toma 10 órdenes, las envía a cocina, cobra, imprime ticket y cierra turno — sin ayuda de soporte.

**Protocolo:**
- Se ejecuta el día anterior al Go-Live (día -1)
- Wansoft activo + Fullsite activo en paralelo — las transacciones reales van en Wansoft
- El equipo opera Fullsite durante turno completo
- Soporte Daniel observa sin intervenir
- Si el gerente no alcanza el criterio de autonomía: Go-Live se pospone, no se negocia

**Estado por cliente:**

| Cliente | Fecha | Resultado | Evidencia |
|---|---|---|---|
| AMALAY | 2026-07-15 | PASS — Eduardo Esquivel | Visita 1 `docs/customers/amalay/LOG.md` |
| Cliente #2 | Pendiente | — | — |

**PRR:** PRR-19 en `docs/certifications/PRR-v1.md` (OPEN para Cliente #2)

---

## R1 — Field Certification

**Estado:** PASS — 2026-07-16
**Scope:** 12 casos de prueba de campo (R1 Field Cert)
**Resultado:** 12/12 PASS. Observación 48h completada el 2026-07-17.
**Regla:** R0 y R0.5 en HOLD. No reabrir sin evidencia de regresión. Ver `docs/state/FREEZES.md`.

---

## Offline — F-01 (Frontend)

**Estado:** PASS — commit `c312fac`
**Scope:** Operación offline en mid-session (después de carga inicial con internet)
**Resultado:** F-01 PASS. La app opera sin internet una vez cargada.
**Limitación conocida:** El boot offline (POS-04) no está certificado — ver `docs/state/BUGS.md`.

---

## Offline — B-01 (Backend sync)

**Estado:** FIX DEPLOYED — commit `2edcca1` — sin certificar
**Scope:** Sincronización de cola offline al reconectar
**Fix desplegado:** 2026-07-23
**Pendiente:** Sesión de certificación de campo. Ver `docs/certifications/CERTIFICATION-SESSION-2026-07-27.md`.
**Bug activo:** PIN bug post-restart — posible race condition. Fix UI del networkError en commit `9de0ab1`. Sin certificar.

---

## Concurrencia x3 — CLOSED

**Estado:** CLOSED — 2026-06-30
**Scope:** Tres condiciones de carrera identificadas en multi-terminal antes del Go-Live
**Evidencia:** `docs/archive/migration-plans/ROADMAP-2026-06-30.md` (3 checkboxes ✓); P0-1 AMALAY CERTIFIED commit `91379b5`

| Fix | Descripción | Fecha |
|---|---|---|
| C1 | `updated_at` en `handlePayment` — previene doble cobro en cobro concurrente | 2026-06-30 |
| C2 | Fix 409 en sync offline — idempotencia al reconectar con cola pendiente | 2026-06-30 |
| C3 | Separar KDS writes del campo `items` — evita race condition en cocina | 2026-06-30 |

**Modelo canónico:** `docs/constitution/CONCURRENCY.md`
**ADR:** `docs/adr/ADR-001-CONCURRENCY.md`

**Nota:** estos 3 parches resuelven los race conditions identificados a 2026-06-30. La certificación de campo de multi-terminal bajo carga máxima (2 tablets paralelas en hora pico) es parte de P0-4.

---

## IEPS — DEFERRED

**Estado:** DEFERRED — bloqueado externamente, sin fecha
**Scope:** Modelo fiscal IEPS en facturación CFDI 4.0 (IEPS desglosado en el XML)
**Blocker:** XML de factura con IEPS de Wansoft — sin fecha de entrega comprometida por Wansoft

**Qué se necesita para desbloquearlo:**
1. Obtener una factura XML real de Wansoft con IEPS desglosado
2. Validar estructura contra Facturapi
3. Implementar cálculo de IEPS en `pos_orders` (probablemente como campo adicional)
4. P0-3 (CSD Facturapi) debe estar CERTIFIED antes de probar IEPS en producción

**ADR:** `docs/adr/ADR-002-FISCAL-MODEL.md`

**Nota:** en el ROADMAP 2026-06-30, IEPS figuraba como P0 junto con XML CFDI validado. Ambos se clasifican DEFERRED porque el blocker es externo (Wansoft, sin SLA). No ocupan slot en el backlog activo hasta que el blocker se resuelva.

---

## P0-1 — Cierre con órdenes abiertas

**Estado:** CERTIFIED — 2026-07-31
**Tests:** 27 nuevos E2 + 1,870 suite completa · 0 regresiones
**Implementación:** soft-block guard + escalación gerente (PIN + nota ≥10 chars) + banner en turno siguiente
**Migración:** `ALTER TABLE pos_cierres ADD COLUMN IF NOT EXISTS cierre_con_ordenes_abiertas...` (ver `OCS-P0-1-GUARD08.md`)
**Referencia:** `docs/certifications/OCS-P0-1-GUARD08.md` · `docs/feos/EXECUTION-PLAN.md`

---

## P0-2 — Reimpresión desde KDS/cocina/barra

**Estado:** EN VALIDACIÓN — código completo 2026-07-23; commit `636771a` (batch-aware reprint)
**Pendiente:** Gate de campo
**Referencia:** `docs/feos/EXECUTION-PLAN.md`
**Relacionado con:** POS-03 en `docs/state/BUGS.md`

---

## P0-3 — CSD Facturapi

**Estado:** ABIERTO — acción de Andy ante SAT
**Blocker:** Andy tramita CSD ante SAT — estimado agosto 2026
**Referencia:** `docs/feos/EXECUTION-PLAN.md`
**Nota:** Facturapi (no Facturama) — PAC elegido para CFDI 4.0. Ver `docs/adr/ADR-002-FISCAL-MODEL.md`.

---

## P0-4 — Local-First / Operación Offline Completa

**Estado:** ABIERTO — Fase 5 (certificación de campo) pendiente

> **Distinción crítica:**
> - **POS-04** (en `docs/state/BUGS.md`) = sub-componente técnico **CERRADO** (commit `447a777`, 2026-07-24).
>   Scope: boot offline del app shell (IDB menú cache + localStorage staff cache).
> - **P0-4** (este ítem) = certificación amplia de Local-First **ABIERTA**.
>   Scope: turno offline completo, persistencia local, sync queue, recuperación ante fallo,
>   multi-terminal, certificación end-to-end. Requiere Offline Certification Suite v1 PASS.

**Progreso:** Fases 1-4 COMPLETE. Fase 5 (prueba de 4h continuas en hardware de AMALAY) PENDIENTE.
Ver `docs/certifications/OFFLINE-SUITE-v1.md` y `docs/offline/RUNBOOK.md`.

**RFC:** `docs/product/LOCAL-FIRST-RFC.md`
**Audit matrix:** `docs/offline/CODE-AUDIT.md`

---

## Hardware-contingent — DEFERRED

Estos ítems figuraban como P0 en el ROADMAP 2026-06-30. Fueron reclasificados a P1 antes del Go-Live porque el blocker es de hardware, no de software.

| Ítem | Blocker | Estado actual | Tracking |
|---|---|---|---|
| Huella digital gerente | Lector DP4500 pendiente de instalación en AMALAY | P1-02 OPEN | `docs/customers/amalay/DEPLOYMENT-STATE.md` |
| Cajón de dinero — apertura desde cualquier impresora | Configuración física RJ-11 | P1-03 OPEN | `docs/customers/amalay/DEPLOYMENT-STATE.md` |

---

## OCS — Operational Certification Suite (v1, iniciada 2026-07-31)

La OCS certifica módulos del POS de forma independiente. El cierre de todos los módulos OCS equivale a la certificación de POS V2.

**Criterio de cierre por módulo:**
1. Código implementado
2. Tests E2 automatizados pasan (0 regresiones en suite completa)
3. Documentación consolidada en `docs/`
4. Design Review disponible

### P2.5.4 — Caja (Turno, Movimientos, Arqueo)

**Estado:** CERTIFIED — 2026-07-31
**Tests:** 27 nuevos E2 + 1,759 suite completa · 0 regresiones
**Gaps resueltos:** CAJ-GAP-01 PASS · CAJ-GAP-02 PASS · CAJ-GAP-03 PASS · CAJ-GAP-04 P3 DOC
**Referencia:** `docs/certifications/OCS-P2.5.4-CAJA.md`

### P2.5.5 — KDS / Cocina / Barra

**Estado:** CERTIFIED — 2026-07-31
**Tests:** 24 nuevos E2 + 1,783 suite completa · 0 regresiones
**Gaps resueltos:** KDS-GAP-01 PASS · KDS-GAP-02 PASS · KDS-GAP-03 PASS · KDS-GAP-04 P3 DOC
**Referencia:** `docs/certifications/OCS-P2.5.5-KDS.md`

### P2.5.6 — Impresión / Print Bridge

**Estado:** CERTIFIED — 2026-07-31
**Tests:** 23 nuevos E2 + 1,843 suite completa · 0 regresiones
**Gaps resueltos:** PRN-GAP-01 PASS · PRN-GAP-02 PASS · PRN-GAP-03 P3 DOC
**Referencia:** `docs/certifications/OCS-P2.5.6-IMPRESION.md`

### P2.5.7 — Órdenes / Flujo Principal

**Estado:** CERTIFIED — 2026-07-31
**Scope:** 20 flujos verificados — abrir mesa, agregar platillos, enviar cocina, post-envío, cancelar ítem/orden, transferir, unir, cambiar mesero, refresh, multi-terminal, offline, replay, KDS exactly-once, impresión exactly-once, auditoría
**Superficies:** `pos/page.tsx` (5,714 líneas) · `pos/plano/page.tsx` · `pos/mesas/page.tsx`
**Criterios:** 9/9 PASS (OC-01 a OC-09)
**Fix incluido:** GAP-A — `handleCancelItem` reemplazado de raw PATCH a `/api/pos/cancel-item` (OCC + APP_API queue)
**Fix incluido:** ORD-GAP-01 — `setIvaRate(cfg.ivaRate)` wired en layout.tsx bootstrap (229/229 tests PASS)
**Gaps tracked:** GAP-C (addOrderItems offline, MED, P2 backlog) · GAP-E (cambiar mesero raw PATCH, LOW, P3 backlog)
**Gaps deferred:** GAP-D (FLOOR_TABLES hardcoded — Golden Skeleton)
**Referencia:** `docs/certifications/OCS-P2.5.7-ORDERS.md`

### P2.5.8 — Pagos / Cobro / Propinas / MP Point

**Estado:** CERTIFIED — 2026-07-31
**Scope:** Efectivo, tarjeta manual, transferencia, mixto, propinas, descuentos, split parejo + por items, cierre de orden, MP Point + recovery, reintentos, idempotencia, ticket final, cajón, auditoría, operación offline, reconexión, doble intento, refresh/reinicio durante pago, reconciliación
**Fix incluido:** PAY-GAP-01 — `IVA_RATE` → `getIvaRate()` en `pos-calculations.ts` (4 sitios) y `pos/page.tsx` (7 sitios). Affects `calcOrderTotals`, `calcSplitParejo`, `calcSplitItems`, `handlePayment`, split UI.
**Gaps P2 documentados:** PAY-GAP-02 (ticket duplicado en crash MP entre save y clearMpRecovery — tarjeta only, sin cajón) · PAY-GAP-03 (total no recalculado server-side desde items)
**Tests:** 1 843/1 843 PASS
**Referencia:** `docs/certifications/OCS-P2.5.8-PAGOS.md`

---

## Milestone: POS V2 Operational Certification

**Estado:** BLOQUEADO — todos los P0s deben estar CERTIFIED primero

Requisitos completos en `docs/feos/EXECUTION-PLAN.md`.

---

## P1 — Golden Skeleton (PENDING-GATE)

**Estado del track:** PENDING-GATE — no puede iniciar hasta que el milestone POS V2 Operational Certification esté CLOSED.

**Registro:** `docs/certifications/P1-GOLDEN-SKELETON-REGISTRY.md`

| Certificación | Scope | Estado |
|---|---|---|
| GS-01 — Hardcodes | Cero refs AMALAY en código fuera de whitelist | PENDING-GATE |
| GS-02 — Onboarding pipeline | `provision_client` → cliente operativo sin pasos manuales | PENDING-GATE |
| GS-03 — Aislamiento multi-tenant | RLS + `auth_tenant` verificados en todas las tablas | PENDING-GATE |
| GS-04 — POS cloneable | Shadow Day completado en cliente #2 sin intervención técnica | PENDING-GATE |
| GS-05 — Sandbox environment | 9-step sandbox milestone CLOSED + reset verificado | PENDING-GATE |

Ninguna entrada de esta tabla puede avanzar mientras el gate esté OPEN.
