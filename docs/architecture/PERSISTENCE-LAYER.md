# Persistence Layer — Arquitectura de Cola Offline

> Estado post-PER-01. Fuente única de verdad: IDB `sync_queue`.

---

## 1. Capas de persistencia

```
┌─────────────────────────────────────────────────────────┐
│  SUPABASE  (source of record — cloud)                   │
│  pos_orders · pos_turnos · pos_cash_movements · etc.    │
└───────────────────────────▲─────────────────────────────┘
                            │  syncAll() — SUPABASE_REST o APP_API
┌───────────────────────────┴─────────────────────────────┐
│  IDB sync_queue  (canonical offline queue — browser)    │
│  DB: fullsite_pos  Store: sync_queue  Version: 4        │
└────────────────┬────────────────────────────────────────┘
                 │  drainLocalStorageToIdb() al startup
┌────────────────▼────────────────────────────────────────┐
│  localStorage fullsite_offline_queue  (buffer emergencia)│
│  Escrito SOLO si IDB no disponible mid-operacion        │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Quién escribe a cada capa

### IDB `sync_queue` (destino normal)

| Caller | Función | Transport |
|--------|---------|-----------|
| `pos-data.ts` → `saveOrder` (offline catch) | `queueOperation('pos_orders', 'POST', …, 'APP_API')` | APP_API |
| `pos-data.ts` → `updateOrderStatus` (offline catch) | `queueOperation('pos_orders', 'PATCH', …)` | SUPABASE_REST |
| `pos-data.ts` → audit log (offline) | `queueOperation('pos_audit_log', 'POST', …)` | SUPABASE_REST |
| `pos-data.ts` → inventory/market (offline) | `queueOperation('pos_inventory_movements' / 'pos_market_stock', …)` | SUPABASE_REST |
| `pos/page.tsx` → cash movements | `queueOperation('pos_cash_movements', 'POST', …, 'SUPABASE_REST')` | SUPABASE_REST |
| `pos/turno/page.tsx` | `queueOperation('pos_turnos', 'POST', …, 'SUPABASE_REST')` | SUPABASE_REST |
| `CierreCajaWizard.tsx` | `queueOperation('pos_cierres' / 'pos_turnos', …, 'SUPABASE_REST')` | SUPABASE_REST |
| `kds/page.tsx` → toggleItemDone (offline) | `queueOperation('pos_orders', 'PATCH', …)` | SUPABASE_REST |

### localStorage `fullsite_offline_queue` (buffer emergencia)

Escrito **únicamente** cuando `queueOperation()` lanza (IDB no disponible). Los callers son los mismos de arriba — el bloque `catch` dentro del `catch` es el gate.

```typescript
// Patrón en pos-data.ts — IDB primero, localStorage solo si IDB falla
try {
  await queueOperation(…)           // IDB — path normal
} catch {
  localStorage.setItem(…)           // emergencia — drenado al startup
}
```

El KDS sigue el mismo patrón desde PER-01:
```typescript
import('@/lib/pos-offline-db').then(({ queueOperation }) =>
  queueOperation(…)
).catch(() => {
  localStorage.setItem(…)           // emergencia
})
```

---

## 3. Quién consume cada capa

| Capa | Consumidor | Cuándo |
|------|-----------|--------|
| IDB `sync_queue` | `syncAll()` → `_syncAllInner()` | Al reconectar (`online` event) y en mount si hay ítems pendientes |
| IDB `sync_queue` | `getPendingQueue()` | Badge de pendientes en POS/mesas/TurnoGate |
| localStorage | `drainLocalStorageToIdb()` | Una vez al startup, antes del mount-sync |
| localStorage | Nadie más | La única lectura es el drain |

---

## 4. Ciclo de vida de un ítem

```
1. Operación offline detectada (catch de fetch)
       ↓
2. queueOperation() → escribe SyncQueueItem en IDB
   { id, table, method, data, endpoint, transport,
     created_at, synced: false, retries: 0 }
       ↓
   [Si IDB falla] → localStorage buffer
       ↓ (al siguiente startup)
   drainLocalStorageToIdb() → queueOperation()
       ↓
3. registerAutoSync() registra handlers una vez por sesión
   - window.addEventListener('online', syncAll)
   - En mount: si hay ítems pendientes → syncAll()
       ↓
4. syncAll() → _syncAllInner()
   Lee getPendingQueue(actionableOnly=false)
   Por cada ítem no conflictuado y retries < 5:
     → APP_API: /api/pos/save-order (revision-aware)
     → SUPABASE_REST: PostgREST directo
       ↓
5. Éxito → markSynced(id)  → synced=true
   Conflicto → markConflict(id, 'STALE_WRITE_CONFLICT', …)
   Error transitorio → incrementRetry(id)
   Error terminal → markConflict(id, 'TERMINAL_NON_RETRYABLE', …)
       ↓
6. clearSyncedItems() al final de syncAll() — limpieza periódica
```

---

## 5. Supervivencia a reinicios

### Reinicio con internet disponible

1. `openDB()` abre `fullsite_pos` v4 (IDB persiste entre reinicios)
2. `drainLocalStorageToIdb()` migra el buffer emergencia (si hay)
3. `registerAutoSync()` detecta `navigator.onLine === true` y tiene ítems → llama `syncAll()` a los 2s
4. Todos los ítems se sincronizan

### Reinicio sin internet

1. IDB persiste — ítems siguen en `sync_queue` con `synced: false`
2. `drainLocalStorageToIdb()` migra el buffer emergencia a IDB (local, no necesita red)
3. `window.addEventListener('online', …)` registrado — cuando regrese internet, `syncAll()` dispara

### Crash del renderer (tab muerta, Electron renderer gone)

- IDB persiste: `sync_queue` intacta
- localStorage persiste: items de emergencia en buffer
- En el próximo mount: drain + sync

---

## 6. Prevención de duplicados

### Dentro de una sesión

`syncAll` tiene un lock de módulo (`syncAllRunning`) — si ya corre, retorna `{ synced: 0, failed: 0 }` sin leer la cola.

### Entre reinicios

IDB genera IDs únicos en `queueOperation`:
```typescript
const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
```

Si la misma orden llega dos veces (retry + éxito previo), el servidor maneja idempotencia:
- **APP_API**: `/api/pos/save-order` usa `save_operation_id` para detectar replays idempotentes (retorna `idempotentReplay: true`)
- **SUPABASE_REST**: HTTP 409 → `markSynced()` (el dato ya existe)

### Drain de localStorage

`drainLocalStorageToIdb()` no tiene dedup explícito de IDs — items de emergencia no tienen `id` propio. Si el mismo item está tanto en IDB como en localStorage (improbable pero posible si el crash ocurrió entre el `queueOperation` y el `localStorage.removeItem`), el servidor lo maneja vía idempotencia.

---

## 7. Transports

### `APP_API` — para mutaciones de órdenes

Replica vía `/api/pos/save-order`. Revision-aware:
- `base_version` en el ítem = `orderRevision` al momento de la operación offline
- El servidor compara vs revision actual en BD
- Si divergen → `STALE_WRITE_CONFLICT` (no se sobreescribe, requiere intervención operador)

### `SUPABASE_REST` — para datos no-reconciliación

PostgREST directo para: audit log, cash movements, turnos, cierres, inventory, market stock.
No revision-aware. HTTP 409 = ítem ya existe → marcado como synced.

---

## 8. Clasificación de errores

| Clase | Retries | Acción |
|-------|---------|--------|
| `TRANSIENT_RETRYABLE` | Hasta 5 | `incrementRetry()` — reintentará en próximo `syncAll` |
| `STALE_WRITE_CONFLICT` | 0 (terminal) | `markConflict()` — visible en badge, requiere operador |
| `TERMINAL_NON_RETRYABLE` | 0 (terminal) | `markConflict()` — payload malformado o rechazado definitivamente |

---

## 9. Reglas para nuevos callers

1. **Todo offline write va a `queueOperation()`** — nunca a localStorage directamente
2. **Si `queueOperation()` puede fallar** (e.g., en un catch de fetch), el patrón es:
   ```typescript
   try {
     await queueOperation(…)
   } catch {
     // emergencia — será drenado al próximo startup
     localStorage.getItem / push / setItem
   }
   ```
3. **Elegir el transport correcto**:
   - `APP_API` → cualquier mutación de `pos_orders` (reconciliación)
   - `SUPABASE_REST` → todo lo demás
4. **No llamar `syncQueue()` de `offline-sync.ts`** — ese módulo está deprecado (dead code post-PER-01)
5. **No llamar `addToQueue()` de `offline-sync.ts`** — deprecated, no usa IDB

---

## 10. Archivos clave

| Archivo | Rol |
|---------|-----|
| `src/lib/pos-offline-db.ts` | IDB schema, `queueOperation`, `syncAll`, `drainLocalStorageToIdb`, `registerAutoSync` |
| `src/lib/offline-sync.ts` | Deprecado — solo como referencia histórica |
| `src/lib/pos-data.ts` | Lógica de negocio offline: `saveOrder`, `updateOrderStatus` |
| `src/hooks/usePosOffline.ts` | Hook de estado offline para la UI |
| `src/app/pos/layout.tsx` | Llama `registerAutoSync()` una vez por sesión |
| `src/app/pos/kds/page.tsx` | `toggleItemDone` — IDB first, localStorage fallback |
