# Congelamientos activos — Fullsite

> **Estado temporal.** Se actualiza cuando se congela o descongela algo.
> Regla: no tocar un módulo congelado sin primero leer el freeze y entender las condiciones de descongelamiento.
> Última actualización: 2026-07-24

---

## Freeze activo: POS V2 Architecture Freeze

**Aprobado:** 2026-07-23
**Scope:** Todo el modelo de datos de POS V2 (entidades, invariantes, flujo canónico, guards, ownership boundaries, domain events)

**Qué está congelado:**
- El modelo de datos de `pos_orders` y tablas relacionadas
- El flujo canónico de save-order / OCC / conflict resolution
- Los guards y boundary de turno
- La máquina de estados de la orden (`abierta → enviada → preparando → lista → entregada → cerrada → cancelada`)
- La arquitectura de impresión y ruteo por estación

**Qué NO está congelado:**
- Bug fixes dentro del modelo existente (pueden cambiar implementación, no el modelo)
- Optimizaciones de performance que no modifiquen el contrato de las RPCs
- UI/UX dentro del flujo aprobado
- Features P1 que no modifiquen el modelo (solo se inician cuando todos los P0 estén CERTIFIED)

**Regla de excepción:**
Si una implementación necesita cambiar el modelo, el flujo o una invariante: primero se abre un RFC, se aprueba, y solo entonces cambia la spec. Nunca al revés.

**Condición de descongelamiento:**
POS V2 Operational Certification completada (los 4 P0s CERTIFIED + 7 días de operación sostenida en AMALAY).

**Referencia:** `docs/bibles/P0-EXECUTION-PLAN.md` §Regla de arquitectura post-freeze

---

## Freeze activo: R0 / R0.5 — HOLD

**Aprobado:** 2026-07-17 (post R1 Field Cert)
**Scope:** Módulos R0 y R0.5 del sistema de inventario

**Qué está congelado:**
- Cualquier cambio a los módulos R0 (inventario básico) y R0.5 (sub-items, factores de rendimiento)

**Condición de descongelamiento:**
Evidencia de regresión en R1. Sin evidencia, estos módulos no se tocan.

**Regla:** R1 Field Cert completó 12/12 PASS. No reabrir R0/R0.5 sin evidencia concreta de que algo en R1 regresionó.

---

## Freeze inactivo: Code Freeze RC1

**Fue activo:** 2026-07-10 al 2026-07-14 (smoke test físico AMALAY)
**Estado:** LEVANTADO — trabajo continúa en rama principal.
