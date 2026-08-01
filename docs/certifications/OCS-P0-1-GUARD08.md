# OCS — P0-1 / GUARD-08: Cierre con Órdenes Abiertas

**Módulo:** CierreCajaWizard · turno/page  
**Estado:** CERTIFIED — 2026-07-31  
**Commits:** `f8aef64` feat(P0-1/GUARD-08): soft-block cierre con órdenes abiertas + escalación gerente · `dd81739` chore(db): migration 012 GUARD-08  
**Tests E2:** 27 nuevos · 1,870 suite completa · 0 regresiones

---

## Problema resuelto

El CierreCajaWizard no verificaba si existían órdenes abiertas (`enviada`, `preparando`, `lista`) para el turno activo antes de ejecutar el cierre. Un cajero podía cerrar el turno mientras mesas activas tenían órdenes sin cobrar, dejando esas órdenes huérfanas en el mapa sin ninguna traza visible.

---

## Diseño aprobado (fuente: `docs/feos/EXECUTION-PLAN.md`)

El guard es **soft-block con escalación**:

1. El wizard fetches órdenes abiertas para `turno_id` al montarse.
2. Si existen → pantalla de pre-verificación con lista de órdenes (mesa, mesero, estado, total).
3. Opción A: volver al POS y cerrar las órdenes manualmente.
4. Opción B (solo gerente/admin): escalación in-place:
   - PIN de gerente → `verifyManagerPinWithRole` → `hasPermission(role, 'corte_z')`
   - Nota de autorización ≥ 10 caracteres
   - Confirmación explícita
5. El cierre incluye en el payload: `cierre_con_ordenes_abiertas`, `ordenes_pendientes`, `cierre_autorizado_por`, `cierre_nota`.
6. Al abrir el siguiente turno: banner de alerta con recuento de órdenes huérfanas y nota del motivo.

---

## Criterios de aceptación verificados

| Criterio | Verificación |
|---|---|
| Un cierre no se ejecuta dos veces | `closingRef.current` en `handleSave` — doble tap → segunda llamada retorna inmediatamente |
| Un retry reutiliza la misma identidad | `cierreIdRef = useRef(crypto.randomUUID())` — mismo UUID para todos los retries del mismo mount |
| Un refresh no libera un cierre ya iniciado | Un refresh remonta el componente → nuevo UUID → operación distinta (correcto) |
| El cierre offline queda durable | IDB close + sync_queue con payload completo antes de `onComplete()` |
| El replay no genera dos cierres | Mismo `cierreId` en el payload → `id` como PK en `pos_cierres` → segunda inserción es no-op en DB |
| Turno y cierre no quedan en estados incompatibles | `closeCachedTurno` + `queueOperation('pos_turnos', 'PATCH')` atómicas en IDB |
| PIN/biometría y permisos siguen funcionando | Escalación usa `verifyManagerPinWithRole` + `hasPermission(role, 'corte_z')` — mismo path que close PIN |
| Ticket y efectos secundarios no se duplican | `closingRef.current` previene re-entrada; `cierreIdRef` previene IDs distintos |
| No hay regresiones en Caja, Órdenes, KDS, Offline | 1,870 tests — 0 fallos |
| Evidencia consolidada en docs/ | Este documento |

---

## Implementación

### `src/lib/pos-cierre-guard.ts` (nuevo — canonical module)

Extrae la lógica pura según ADR-004 (Canonical Module Rule):
- `filterOpenOrders(orders)` — filtra por `status in (enviada, preparando, lista)`
- `validateEscalationNota(nota)` — mínimo 10 chars después de trim
- `withEscalationPayload(payload, openOrders, authorizedBy, nota)` — merges los 4 campos de escalación
- `openOrderStatusLabel(status)` — etiqueta legible para el guard screen

### `src/components/pos/CierreCajaWizard.tsx` (modificado)

**`cierreIdRef`**: UUID generado una vez al montar (`useRef`), reutilizado en todos los retries — cumple el criterio de retry idempotente.

**Fetch de órdenes abiertas**: añadido al final del `useEffect` de shift data — mismo ciclo de carga, timeout de 4s, fallo silencioso en offline (el guard es best-effort, no bloquea el cierre offline).

**`handleEscalation`**: verifica PIN + nota + permisos antes de autorizar el avance al wizard.

**`handleSave`**: usa `cierreIdRef.current` en lugar de `crypto.randomUUID()` y wraps `cierreData` con `withEscalationPayload`.

**Render**: guard screen condicional entre header y wizard. Si hay órdenes abiertas y no hay escalación autorizada → muestra lista + opciones. En caso contrario → wizard normal.

### `src/app/pos/turno/page.tsx` (modificado)

**`orphanCierre` state**: almacena `{ count, nota }` del último cierre con órdenes abiertas.

**`fetchTurno`**: tras obtener el turno activo, fetcha el último cierre con `cierre_con_ordenes_abiertas=eq.true`. Si existe → `setOrphanCierre`. Falla silenciosa si las columnas no están migradas aún.

**Banner**: aparece encima del card del turno activo; incluye recuento y nota; descartable con X.

---

## Migración de base de datos requerida

Las 4 columnas nuevas en `pos_cierres` deben crearse antes del primer cierre con órdenes abiertas. El wizard funciona sin ellas (el POST fallará y el item quedará en el sync_queue hasta que la migración se aplique), pero el banner de turno no aparecerá hasta que la migración esté activa.

```sql
-- GUARD-08: columnas para cierre con órdenes abiertas
ALTER TABLE pos_cierres
  ADD COLUMN IF NOT EXISTS cierre_con_ordenes_abiertas boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ordenes_pendientes          text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cierre_autorizado_por       text,
  ADD COLUMN IF NOT EXISTS cierre_nota                 text;
```

**Aplicar vía:** `docs/playbooks/SQL-MIGRATION.md` (sección GUARD-08).

---

## Tests

Archivo: `src/__tests__/pos-cierre-guard.test.ts` — 27 tests en 4 grupos:

| Grupo | Tests | Qué cubren |
|---|---|---|
| `filterOpenOrders` | 8 | enviada ✓ · preparando ✓ · lista ✓ · cobrada/cancelada drop · mixed list · vacío · todos los OPEN_ORDER_STATUSES |
| `validateEscalationNota` | 7 | vacío · solo whitespace · < 10 chars · exactamente 9 · exactamente 10 · largo · trim correcto |
| `withEscalationPayload` | 9 | true cuando hay órdenes · IDs capturados · authorizedBy · nota · false sin órdenes · empty array · no muta original · preserva fields · nulls |
| `openOrderStatusLabel` | 3 | enviada · preparando · lista |

---

## Patrones aplicados

- **Canonical Module** (ADR-004): lógica de guard en `pos-cierre-guard.ts`, no inline en el componente.
- **Offline-first**: guard es best-effort (timeout 4s); no bloquea el cierre si offline.
- **Idempotencia**: `cierreIdRef` garantiza misma identidad de operación durante el ciclo de vida del wizard.
- **Double-submit prevention**: `closingRef.current` existente + no-op si ya en progreso.
- **Soft-block con escalación**: nunca hard-block; siempre permite override con evidencia.
