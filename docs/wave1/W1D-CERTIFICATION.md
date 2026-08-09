# W1-D — Cierre canónico e inmutable · Certificación

**Fecha:** 2026-08-08 · **Rama:** `wave1/inventory-truth` · **Depende de:** W1-A/B/C (54f6c28, 358d38a, 796b7a6)

## Pre-flight (STEP 0) — veredicto

`pos_cierres` es un **cierre de caja por TURNO** (arqueo: fondo, conteo, diferencia, `turno_id` FK), no un cierre de día ni de location. Client = location en el modelo POS actual (una caja); no existe entidad register/terminal separada. Único escritor: `CierreCajaWizard` (offline-first); **cero paths de UPDATE/DELETE en código**. Múltiples turnos (y cierres) por día operativo son legítimos. Ya existía `uq_cierres_turno_id` (UNIQUE turno_id). Puede llegar post-cierre: sync offline de órdenes, refunds/cancelaciones (cambio de total en re-save), reopenOrder, movimientos de caja. Impresión/KDS: excluidos (sin impacto contable).

**CANONICAL CLOSE IDENTITY: `(client_id, turno_id)`** — un cierre por turno de caja.
**WHY:** el arqueo es por turno; forzar unicidad por (client, business_date) rompería el caso legítimo de dos turnos el mismo día (certificado en D10). El "cierre del día" es la agregación por `(client_id, fecha)` — expuesta por la vista `pos_cierres_estado`.

## Cambios

| Pieza | Cambio |
|---|---|
| `scripts/sql/wave1/w1d_close_migration.sql` | ADITIVA: `snapshot JSONB` + `sealed_at`; tabla `pos_cierre_ajustes` (append-only, UNIQUE `(client_id,tipo,source_operation)`); trigger de inmutabilidad `w1d_sealed_guard` en cierres Y ajustes (aplica también a service_role — triggers no respetan bypass RLS; excepción administrativa EXPLÍCITA `SET LOCAL app.cierre_admin_unlock='on'` con WARNING auditado); triggers de guardia post-cierre en `pos_orders` (INSERT/UPDATE financiero con turno sellado → ajuste automático: late_order / post_close_refund / post_close_cancellation / post_close_adjustment, monto = delta) y `pos_cash_movements` (cash_correction); vista `pos_cierres_estado` (SEALED / SEALED_WITH_ADJUSTMENTS + neto de ajustes). Rollback documentado y certificado. |
| `CierreCajaWizard.tsx` | Snapshot sellado (`w1d.v1`: business_date + config W1-C usada + degraded flag + pending_sync_count + órdenes escaladas); close gate WARN-no-bloqueante por backlog de sync (una caída de red nunca impide cerrar — lo tardío se reconcilia como ajuste); 409 en POST = reintento idempotente (cierre ya sellado, no error). |
| `scripts/onboarding/onboard_client.py` | **Onboarding gate Cliente #2+**: el manifest DEBE traer `timezone` y `business_day_start_local` o `client_create` FALLA; smoke_check verifica ambos configurados en la fila `clients`. |

**Diseño clave:** los triggers de guardia derivan la compensación a nivel BD — cubren CUALQUIER ruta de escritura (replay offline por APP_API, cancel-item PATCH, PostgREST directo), no solo la app. El cierre sellado jamás se reescribe; la verdad tardía se representa como `SEALED + ajustes + estado de reconciliación`.

## Certificación (staging `w1acert`, todos los gates)

| # | Gate | Evidencia | Resultado |
|---|---|---|---|
| 1 | Cierre normal | cierre-w1d-1 sellado con snapshot completo (config W1-C, pending_sync, escalación) | **PASS** |
| 2 | Segundo intento mismo cierre lógico | `unique_violation` (uq_cierres_turno_id); wizard trata 409 como idempotente | **PASS** |
| 3 | UPDATE financiero histórico | `SEALED:` exception — bloqueado a nivel BD | **PASS** |
| 4 | DELETE histórico | `SEALED:` exception | **PASS** |
| 5 | Totales sellados reconstruibles | Columnas + snapshot legibles tras todo el battery (total 300 intacto de punta a punta) | **PASS** |
| 6 | Refund post-cierre | Orden 300→250 → ajuste `post_close_refund` −50; cierre intacto | **PASS** |
| 7 | Corrección de caja post-cierre | Retiro 100 → ajuste `cash_correction` −100; cierre intacto | **PASS** |
| 8 | Orden offline de D llega tras sello de D | INSERT tardío → orden PRESERVADA + ajuste `late_order` +180; cierre intacto | **PASS** |
| 9 | Sin pérdida / sin doble reconocimiento | Replay idéntico del refund → 0 ajustes nuevos (3 totales, no 4); neto +30 = −50−100+180 exacto | **PASS** |
| 10 | Business date W1-C | `fecha` y `snapshot.business_date` = fecha operativa del primitivo certificado (wizard usa `getBusinessDate`; sin math independiente) | **PASS** |
| 11 | Cross-tenant | Tenant B con orden apuntando al turno sellado de A → 0 ajustes en ambos lados (guard scoped por client_id) | **PASS** |
| 12 | Múltiples turnos/día legítimos | 2 cierres mismos (client, fecha) coexisten; vista agrega el día | **PASS** |
| 13 | Rollback/reapply | Rollback DDL limpio (0 triggers) → reapply → inmutabilidad restaurada, datos intactos | **PASS** |
| 14 | Admin unlock explícito | `SET LOCAL` permite operación con WARNING auditado; nunca ruta de app | **PASS** |
| 15 | Build/static/tests | `tsc --noEmit` limpio; suite 57 files / 2,236 PASS; onboard_client.py sintaxis OK | **PASS** |

## Close gate (clasificación)

- **HARD BLOCKER:** órdenes abiertas sin escalación autorizada (flujo P0-1 existente del wizard, intacto).
- **WARN BUT ALLOW:** backlog de sync pendiente (registrado en snapshot; se reconcilia como ajustes); diferencia de arqueo (visible, decisión del gerente).
- **IRRELEVANT:** cola de impresión, estado KDS, WAN caída (offline-first: el cierre encola y sella).

## Invariante de onboarding (Cliente #2+)

Un tenant production-ready DEBE tener `clients.timezone` y `clients.business_day_start_local` explícitos. `onboard_client.py` falla el alta sin ellos (manifest) y el smoke_check lo verifica en BD. El fallback a calendario de `resolveBusinessDayConfig` queda solo como compatibilidad para tenants legacy — un tenant configurado jamás lo pisa (certificado en W1-C: `degraded=false`).

## No tocado

Producción (datos/config/schema), BUG-019, release offline congelada, W1-E. Reportes que reclaman verdad "cerrada": el único consumidor actual (`/pos/turno` historial) lee `pos_cierres` sellado; la adopción de `pos_cierres_estado` en reportes financieros va a W1-E/Wave 3 (backlog documentado).
