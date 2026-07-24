# Certificaciones — Fullsite

> **Fuente de verdad para el estado de certificación.**
> Regla: solo pasar a PASS con evidencia archivada. Ver criterios en `docs/bibles/P0-EXECUTION-PLAN.md`.
> Regla: nunca reabrir un PASS sin evidencia de regresión.
> Última actualización: 2026-07-24

---

## Qué significa CERTIFIED

Una feature es CERTIFIED cuando:
1. Fue probada en operación real (no en staging, no en prueba de escritorio)
2. La evidencia está archivada (video, logs, commit)
3. Los criterios de aceptación definidos en el P0 Execution Plan se cumplen sin excepción

"Parece funcionar" no es CERTIFIED. "Eduardo lo usó y no se quejó" no es CERTIFIED.

---

## R1 — Field Certification

**Estado:** ✅ PASS — 2026-07-16
**Scope:** 12 casos de prueba de campo (R1 Field Cert)
**Resultado:** 12/12 PASS. Observación 48h completada el 2026-07-17.
**Regla:** R0 y R0.5 en HOLD. No reabrir sin evidencia de regresión. Ver `docs/state/FREEZES.md`.

---

## Offline — F-01 (Frontend)

**Estado:** ✅ PASS — commit `c312fac`
**Scope:** Operación offline en mid-session (después de carga inicial con internet)
**Resultado:** F-01 PASS. La app opera sin internet una vez cargada.
**Limitación conocida:** El boot offline (POS-04) no está certificado — ver `docs/state/BUGS.md`.

---

## Offline — B-01 (Backend sync)

**Estado:** 🟡 FIX DEPLOYED — commit `2edcca1` — sin certificar
**Scope:** Sincronización de cola offline al reconectar
**Fix desplegado:** 2026-07-23
**Pendiente:** Sesión de certificación de campo. Ver `docs/runbooks/CERTIFICATION-SESSION-2026-07-27.md`.
**Bug activo:** PIN bug post-restart — posible race condition. Fix UI del networkError en commit `9de0ab1`. Sin certificar.

---

## P0-1 — Cierre con órdenes abiertas

**Estado:** 🔴 ABIERTO — diseño aprobado, pendiente implementación
**Referencia:** `docs/bibles/P0-EXECUTION-PLAN.md`

---

## P0-2 — Reimpresión desde KDS/cocina/barra

**Estado:** 🟡 EN VALIDACIÓN — código completo 2026-07-23
**Pendiente:** Gate técnico y gate de campo
**Referencia:** `docs/bibles/P0-EXECUTION-PLAN.md`
**Relacionado con:** POS-03 en `docs/state/BUGS.md`

---

## P0-3 — CSD Facturama

**Estado:** 🔴 ABIERTO — acción de Daniel
**Deadline:** 2026-08-03
**Referencia:** `docs/bibles/P0-EXECUTION-PLAN.md`

---

## P0-4 — Local-First / Boot Offline

**Estado:** 🔴 ABIERTO — RFC aprobado 2026-07-24, pendiente implementación
**RFC:** `docs/bibles/P0-4-LOCAL-FIRST-RFC.md`
**Relacionado con:** POS-04 en `docs/state/BUGS.md`

---

## Milestone: POS V2 Operational Certification

**Estado:** 🔴 BLOQUEADO — todos los P0s deben estar CERTIFIED primero

Requisitos completos en `docs/bibles/P0-EXECUTION-PLAN.md`.
