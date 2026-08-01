# OFFLINE-RECOVERY — Protocolo de Recovery

> Versión: 2026-07-27 | OFFLINE-100
> Qué pasa exactamente cuando vuelve Internet. Qué sincroniza primero. Qué nunca debe duplicarse. Qué conflictos pueden existir. Cómo se resuelven.

---

## 1. Qué Pasa Cuando Vuelve Internet

### 1a. Secuencia de Eventos (Browser POS)

```
Internet restaurado
  │
  ├─ window.dispatchEvent('online')
  │     │
  │     └─ registerAutoSync() listener:
  │           ├─ Si isSyncing = true → skip (mutex activo)
  │           └─ Si isSyncing = false:
  │                 isSyncing = true
  │                 await drainLocalStorageToIdb()   ← migra buffer de emergencia
  │                 await syncAll()                  ← procesa IDB sync_queue
  │                 isSyncing = false
  │
  └─ (paralelo, sin relación causal)
        Heartbeat del Local Server → Supabase (5 min)
        Supabase poll (Local Server) → STATE_SYNC cada 5s
```

### 1b. Secuencia de Eventos (Local Server)

```
Internet restaurado
  │
  ├─ Supabase poll (`startSupabasePoll`) retoma automáticamente
  │   └─ Siguiente poll en <5s: GET pos_orders → STATE_SYNC event
  │        └─ RestaurantState._applyStateSync() actualiza mesas/kds/turno
  │             └─ WsHub.broadcast(event) → DELTA a terminales conectadas
  │
  └─ Heartbeat (si estaba en backoff por fallos):
        _applyBackoff() puede haber extendido interval hasta 30min
        Al primer heartbeat exitoso: _resetBackoff() → vuelve a 5min
```

### 1c. Secuencia de Eventos (Electron)

```
Internet restaurado
  │
  └─ Si POS estaba en offline.html:
        setupOfflineRetry() loop (cada 10s):
          if (url no empieza con 'https://') → mainWindow.loadURL(POS_URL)
            └─ Si POS_URL responde → carga POS
            └─ Si POS_URL falla → vuelve a offline.html
```

---

## 2. Qué Sincroniza Primero

### Prioridad de sincronización en `syncAll()`

La función `syncAll()` procesa la IDB `sync_queue` en **orden FIFO (created_at)**. No hay priorización explícita. El orden queda determinado por el orden en que las operaciones fueron encoladas.

Esto implica:
- Si una orden fue abierta antes de que internet cayera, se sincroniza antes que las que se abrieron después
- Los cobros se sincronizan en el orden en que se completaron
- Los movimientos de caja se sincronizan después de las órdenes que los generaron (si se encolaron después)

### Items que NUNCA deben sincronizarse en paralelo

`syncAllRunning` es un mutex a nivel de módulo. Solo puede correr una instancia de `syncAll()` a la vez. Esto garantiza que:
- No hay race conditions en la actualización de items de la sync_queue
- Los items marcados como `conflict` no son re-procesados por un sync concurrente

---

## 3. Qué Nunca Debe Duplicarse

| Entidad | Garantía de no-duplicación | Mecanismo |
|---|---|---|
| Eventos del Local Server | Garantizada por `command_id` | `CoreEventStore.processCommand()` rechaza comandos duplicados |
| Órdenes en Supabase | Garantizada por `id` (UUID generado en cliente) | Supabase retorna 409 si el id ya existe; se marca como synced |
| Turno (shift) | Garantizada por UUID generado con `crypto.randomUUID()` | El UUID es estable — nunca cambia durante sync |
| Print jobs | Garantizada por `id` único por job | IDB y localStorage usan el mismo id; IDB no genera una copia nueva |
| Heartbeat | Garantizado por `server_id` + `Prefer: resolution=merge-duplicates` | Supabase hace upsert, no insert |

### Qué NO está garantizado

- **Movimientos de caja**: si el mismo movimiento se encola dos veces (bug en el POS), puede duplicarse en Supabase. La tabla `pos_cash_movements` no tiene una constraint de unicidad visible en el código auditado.
- **Events del Local Server → Supabase**: el outbox sync no está implementado (ver OFFLINE-MASTER §5). Si se implementa, debe usar el `command_id` como idempotency key en la tabla destino.

---

## 4. Conflictos que Pueden Existir

### Tipo 1: STALE_WRITE_CONFLICT

**Cuándo ocurre**: Un terminal modifica una orden offline. Mientras tanto, otro terminal (con internet) modifica la misma orden en Supabase. Al sincronizar, el servidor rechaza la escritura porque la revision esperada no coincide.

**Estado resultante**: El item en IDB queda marcado `conflict: true`, `error_class: 'STALE_WRITE_CONFLICT'`. El payload de la operación local se preserva — no se borra.

**Riesgo**: La orden local "perdida" puede contener ítems que el cliente ya pagó. Un operador humano debe revisar.

### Tipo 2: MESA_LOCK simultáneo

**Cuándo ocurre**: Dos terminales intentan abrir la misma mesa al mismo tiempo (ambas online con el Local Server).

**Cómo se resuelve**: La primera que llega al `CommandHandler` obtiene el lock. La segunda recibe `REJECT: Mesa X locked by another terminal`. El lock expira en 30s si no se libera (GC en `gcLocks()`).

### Tipo 3: STATE_SYNC overwrite

**Cuándo ocurre**: El POS hace una operación local que se refleja en el event store pero aún no llegó a Supabase. El siguiente poll (5s) trae el estado de Supabase y sobrescribe el estado local.

**Estado resultante**: La operación local existe en events.ndjson pero el estado en memoria ya no la refleja. Si hay terminales conectados, reciben un DELTA con el STATE_SYNC que "deshace" el efecto visual del evento local.

**Mitigación actual**: En Phase 1 esto es el comportamiento correcto (Supabase es autoridad). En Phase 2 (cuando el Local Server sea autoridad), este mecanismo debe desaparecer.

### Tipo 4: LS Emergency Buffer perdido

**Cuándo ocurre**: `offline-sync.ts` escribe a localStorage como fallback. Si IDB falla Y localStorage se borra (modo privado, clear de datos), los items se pierden.

**Mitigación actual**: `drainLocalStorageToIdb()` migra al inicio de `registerAutoSync()`. Si la migración falla, los items quedan en LS.

---

## 5. Cómo se Resuelven los Conflictos

### STALE_WRITE_CONFLICT — Protocolo Manual

1. El sistema marca el item con `conflict: true` y preserva el payload
2. La UI debe mostrar un indicador visible (actualmente: existe el campo, la UI de resolución no fue auditada)
3. El operador ve: "Orden [X] — conflicto de sincronización. Payload local preservado."
4. El operador puede: (a) descartar el cambio local, (b) forzar el apply si tiene certeza que el dato local es correcto (NO implementado — requeriría un endpoint de force-sync)

**Estado actual**: El payload está preservado. La UI de resolución manual no fue auditada. El `clearTerminalItems()` borra items `retries >= 3` sin endpoint, pero no los conflictos.

### MESA_LOCK — Automático

El lock expira en 30s. Si el terminal que obtuvo el lock se desconecta sin liberar, el GC en `gcLocks()` lo limpia en el siguiente ciclo (cada 30s). No requiere intervención manual.

### Duplicate sync (409 SUPABASE_REST) — Automático

Al recibir 409 de Supabase en una llamada SUPABASE_REST, el sistema marca el item como synced — asumiendo que el dato ya existe. Esto es correcto para datos de solo creación (INSERT). Para updates (PATCH), un 409 puede indicar otra cosa y debería investigarse.

---

## 6. Checklist de Recovery para Operadores

Si el restaurante perdió conexión durante el servicio y acaba de volver:

```
[ ] 1. El banner de "Sin conexión" desapareció → internet restaurado
[ ] 2. Revisar el ícono de sync_queue en el POS → debe decir "0 pendientes" en <2 min
[ ] 3. Si hay "conflictos" indicados → anotar las órdenes afectadas y comparar con el cuaderno físico
[ ] 4. Revisar impresoras → si hay comandas en "needs_attention", reimprimir manualmente
[ ] 5. Verificar /health en el Local Server → sync_queue_size debe ser 0
[ ] 6. Antes de cerrar el turno → confirmar que el total de órdenes en Supabase coincide con el conteo local
```

---

## 7. Estado de Implementación por Tipo de Recovery

| Recovery | Status | Gap |
|---|---|---|
| Internet vuelve → syncAll() automático | VERIFIED | — |
| Conflicto STALE_WRITE preservado | VERIFIED | UI de resolución no auditada |
| MESA_LOCK expiry | VERIFIED | — |
| Print job recovery al reiniciar | PARTIAL | Sin test de restart |
| IDB recovery de LS buffer | VERIFIED | Depende de que registerAutoSync() se llame |
| Outbox Local Server → Supabase | NOT IMPLEMENTED | markSynced existe, nadie la llama |
| Force-sync manual para conflictos | NOT IMPLEMENTED | No hay endpoint |
| STATE_SYNC overwrite en Phase 2 | NOT IMPLEMENTED | Se resuelve cuando Local Server sea autoridad |
