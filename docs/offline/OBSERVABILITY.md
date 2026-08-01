# OFFLINE-OBSERVABILITY — Métricas del Sistema Offline

> Versión: 2026-07-27 | OFFLINE-100
> Lista de métricas que deberían existir para certificar y operar el sistema offline.
> Status actual: IMPLEMENTED | PARTIAL | MISSING

---

## Categoría 1: Local Server

### 1.1 Queue Depth (sync_queue_size)

**¿Qué mide?**: Número de eventos en events.ndjson con `synced: false`.

**¿Por qué importa?**: Un queue que crece indefinidamente indica que el outbox sync no está funcionando. En Phase 1 es esperado que crezca (nadie hace sync), pero en Phase 2 debe converger a 0.

**Status**: IMPLEMENTED — reportado en `/health` como `sync_queue_size` y en heartbeat a Supabase como `sync_queue_size`.

**Fuente**: `await eventStore.unsyncedCount()`

**Alerta sugerida**: `sync_queue_size > 100` → `health_status: 'degraded'` (ya implementado en heartbeat)

---

### 1.2 Pending Sync (browser)

**¿Qué mide?**: Items en IDB `sync_queue` que no están synced y no están en estado terminal de error.

**¿Por qué importa?**: Indica cuántas operaciones del POS no han llegado a Supabase. Si hay internet y este número no baja, hay un problema con syncAll().

**Status**: PARTIAL — `getPendingCount()` existe en pos-offline-db.ts pero no se expone en ningún dashboard o log estructurado. Solo accesible desde el código del POS.

**Fuente**: `await getPendingQueue(actionableOnly: true)` → `.length`

**Alerta sugerida**: Si `pending_sync > 0` y `navigator.onLine = true` por más de 60s → mostrar banner de advertencia.

---

### 1.3 Last ACK (último evento procesado exitosamente)

**¿Qué mide?**: El timestamp del último evento procesado por el CommandHandler (último ACK enviado al cliente).

**¿Por qué importa?**: Si el restaurante está abierto y no hay ACKs por más de 10 minutos, puede indicar que los operadores no están usando el POS.

**Status**: MISSING — no hay una métrica de "last command processed at" en el sistema. La secuencia del event store crece, pero no hay timestamp de último comando expuesto en `/health`.

**Implementación sugerida**: Agregar `last_command_at: timestamp` en el CommandHandler y reportarlo en `/health`.

---

### 1.4 Last Heartbeat

**¿Qué mide?**: Cuándo fue el último heartbeat exitoso a Supabase.

**¿Por qué importa?**: Si el heartbeat falla, no hay visibilidad remota del estado del Local Server. Un heartbeat fallido por más de 30 minutos indica problema de conectividad o de credenciales.

**Status**: PARTIAL — el heartbeat se ejecuta, pero `_lastSyncAt` solo se actualiza cuando el Supabase poll es exitoso (no cuando el heartbeat mismo tiene éxito). No hay forma de consultar "¿cuándo fue el último heartbeat exitoso?" desde fuera.

**Implementación sugerida**: Guardar `last_heartbeat_at` en el estado del heartbeat module y exponerlo en `/health`.

---

### 1.5 Connected Terminals

**¿Qué mide?**: Número de clientes WS conectados y su identidad.

**¿Por qué importa?**: Si hay 0 terminales conectados a las 9am en un restaurante abierto, algo falló.

**Status**: IMPLEMENTED — `clients_connected` y `clients` (lista con `client_id`, `client_type`, `remote_ip`, `connected_at`) en `/health`.

---

### 1.6 Local Server Health

**¿Qué mide?**: Estado general del servidor.

**¿Por qué importa?**: Un endpoint `/health` que devuelve 200 con `ok: true` es la señal primaria de que el servidor está vivo.

**Status**: IMPLEMENTED — `/health` devuelve:
```json
{
  "ok": true,
  "server_id": "...",
  "restaurant_id": "...",
  "version": "...",
  "protocol_version": "1.0",
  "hostname": "...",
  "platform": "win32",
  "uptime_s": 3600,
  "lan_ip": "192.168.1.71",
  "clients_connected": 2,
  "clients": [...],
  "last_sequence": 342,
  "sync_queue_size": 0,
  "print_jobs_failed": 1,
  "staged_update": null,
  "update_channel": "stable",
  "stations": ["cocina", "barra", "caja"]
}
```

---

### 1.7 Printer Health

**¿Qué mide?**: Número de print jobs fallidos desde el arranque.

**¿Por qué importa?**: Si `print_jobs_failed > 0` y hay servicio activo, una impresora puede estar caída.

**Status**: PARTIAL — `print_jobs_failed` se reporta en `/health` como count total desde startup. No hay breakdown por estación, ni el último error. Solo un número.

**Implementación sugerida**: Agregar al `/health`:
```json
"printer_health": {
  "cocina": { "last_success": "...", "last_error": "...", "failed_count": 0 },
  "caja": { "last_success": "...", "last_error": "...", "failed_count": 0 }
}
```

---

### 1.8 Retry Count (print jobs)

**¿Qué mide?**: Número de reintentos de print jobs, por job y agregado.

**¿Por qué importa?**: Un job con retries altos es señal de impresora con problemas intermitentes.

**Status**: MISSING en el Local Server. En el browser (print-queue.ts), `job.retries` existe por job pero no se agrega ni se expone en un endpoint.

---

### 1.9 Conflict Count (sync conflicts)

**¿Qué mide?**: Número de items en IDB sync_queue con `conflict: true`.

**¿Por qué importa?**: Un conflicto no resuelto significa que una operación del operador no llegó a Supabase. Si el número crece, hay un problema de concurrencia o conectividad que requiere revisión manual.

**Status**: MISSING — el campo `conflict: true` existe en IDB pero no hay un getter de "cuántos conflictos hay" ni un endpoint que lo exponga.

**Implementación sugerida**:
```typescript
// En pos-offline-db.ts
export async function getConflictCount(): Promise<number> {
  const queue = await getPendingQueue()
  return queue.filter(i => i.conflict === true).length
}
```

---

## Categoría 2: Browser POS

### 2.1 Queue Depth (browser sync_queue)

**Status**: PARTIAL — `getPendingCount()` existe pero no se agrega a ningún log estructurado.

### 2.2 IDB Print Queue Status

**Status**: PARTIAL — `getPendingCount()`, `getNeedsAttentionCount()`, `getBridgeUnavailableCount()` existen y disparan `print-queue-updated` CustomEvent. La UI consume este evento.

### 2.3 Bridge Health (http://127.0.0.1:7717/health)

**Status**: IMPLEMENTED — `isBridgeHealthy()` chequea con cache 10s. Resultado disponible en el estado del print-queue.

### 2.4 Last Successful Sync

**Status**: MISSING — no hay un getter de "cuándo fue el último syncAll() exitoso" en pos-offline-db.ts.

---

## Categoría 3: Supabase (Fleet View)

### 3.1 local_server_heartbeats

**Status**: IMPLEMENTED (tabla definida en heartbeat.js, requiere ser creada en SQL Editor)

```sql
CREATE TABLE IF NOT EXISTS local_server_heartbeats (
  server_id         TEXT PRIMARY KEY,
  restaurant_id     TEXT NOT NULL,
  reported_at       TIMESTAMPTZ NOT NULL,
  version           TEXT,
  protocol_version  TEXT,
  platform          TEXT,
  uptime_seconds    INTEGER,
  clients_connected INTEGER,
  sync_queue_size   INTEGER,
  last_sync_at      TIMESTAMPTZ,
  print_jobs_failed INTEGER,
  health_status     TEXT,   -- 'ok' | 'degraded'
  disk_free_mb      INTEGER
);
```

**Alerta sugerida**: Si `reported_at` de un server es más de 30 minutos viejo → el Local Server está caído o sin internet.

---

## Resumen de Gaps de Observabilidad

| Métrica | Status | Prioridad para Certificación |
|---|---|---|
| sync_queue_size (servidor) | IMPLEMENTED | ✓ |
| pending_sync (browser) | PARTIAL | Alta |
| last_ack timestamp | MISSING | Media |
| last_heartbeat (exitoso) | PARTIAL | Alta |
| connected_terminals | IMPLEMENTED | ✓ |
| local_server_health (/health) | IMPLEMENTED | ✓ |
| printer_health por estación | PARTIAL | Alta |
| retry_count por job | MISSING | Media |
| conflict_count | MISSING | Alta |
| bridge_health | IMPLEMENTED | ✓ |
| last_successful_sync (browser) | MISSING | Media |
| idb_print_queue_status | IMPLEMENTED | ✓ |
| fleet_heartbeats (Supabase) | IMPLEMENTED (tabla requerida) | Alta |

---

## Dashboard de Observabilidad Sugerido

Para alcanzar OFFLINE CERTIFIED, se recomienda un panel visible en la pantalla de administración con:

```
┌─────────────────────────────────────────────────────┐
│  FULLSITE LOCAL SERVER STATUS                       │
├─────────────────────────────────────────────────────┤
│  Estado: ● OK          Uptime: 2h 15m              │
│  Terminales conectadas: 3 (pos, pos, kds)           │
│  Último ACK: hace 00:01:23                          │
├─────────────────────────────────────────────────────┤
│  SINCRONIZACIÓN                                     │
│  Pendientes servidor: 0 eventos                     │
│  Pendientes browser:  0 operaciones                 │
│  Conflictos:          0                             │
│  Último sync exitoso: hace 00:00:45                 │
├─────────────────────────────────────────────────────┤
│  IMPRESORAS                                         │
│  cocina:  ● OK   | caja: ● OK                       │
│  Print jobs fallidos hoy: 0                         │
│  Cola browser: 0 pendientes, 0 atención             │
├─────────────────────────────────────────────────────┤
│  CONECTIVIDAD                                       │
│  Internet: ● Conectado                              │
│  LAN IP: 192.168.1.71                               │
│  mDNS: ● Anunciando                                 │
│  Último heartbeat Supabase: hace 00:03:12           │
└─────────────────────────────────────────────────────┘
```
