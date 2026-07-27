# Handoff: Offline / Local-First — 2026-07-27

**Sesión:** rescue/pre-optimization-2026-07-24  
**Commit base:** `a8e0b00` (build 1.2.0 estable)  
**Commit turno offline:** `7e17828`  
**Autor:** Daniel Ramonfaur + Claude Sonnet 4.6  

---

## A. Estado del sistema al momento del handoff

| Componente | Estado | Evidencia |
|---|---|---|
| Electron Fullsite POS | v1.2.0 instalado | `electron-app/dist/Fullsite POS Setup 1.2.0.exe` |
| Local Server (HTTP+WS) | Corriendo en `0.0.0.0:7717` | `electron-app/main.js` — `startLocalServer()` |
| KDS window | Corregido — apunta a `/pos/kds` | commit `a8e0b00` |
| KDS retry loop | Eliminado — backoff 3 intentos | commit `ab38fe7` |
| `kds_only` mode | Implementado | `config.json: kds_only: true` |
| Service Worker v6 | Precaché HTML + assets | `/sw.js` |
| IndexedDB `fullsite_pos` v3 | Activo | `pos-offline-db.ts` DB_VERSION=3 |
| **Turno offline** | **IMPLEMENTADO** | commit `7e17828` |
| Órdenes offline | Ya operaba | `saveOrder` → `OFFLINE_QUEUED` |
| Cobro cash offline | Ya operaba | `handlePayment` → `OFFLINE_QUEUED` |
| Conflicto de orden | Pass-through offline | `checkOrderConflict` catch → `return false` |
| Print bridge | Corriendo en `127.0.0.1:7717` | `electron-app/main.js` |

---

## B. Lo que SE IMPLEMENTÓ en esta sesión

### B1. Turno offline — `pos-offline-db.ts` + `turno/page.tsx`

**Problema:** `handleOpenTurno` hacía POST directo a Supabase. Si no había internet, el turno no abría y el restaurante no podía operar.

**Solución implementada:**

```
Antes:                              Después:
POST Supabase →                     crypto.randomUUID() (estable)
  if ok → setActiveTurno             → cacheTurno(IDB) [inmediato]
  else → showToast("Error de red")   → setActiveTurno [UI optimista]
                                     → POST Supabase [best-effort]
                                       if fail → queueOperation()
```

**Archivos modificados:**
- `dashboard-app/src/lib/pos-offline-db.ts` — DB_VERSION 2→3, stores `turnos` + `cash_movements`, funciones `cacheTurno / getCachedActiveTurno / closeCachedTurno / markTurnoSynced`
- `dashboard-app/src/app/pos/turno/page.tsx` — `fetchTurno` con fallback IDB, `handleOpenTurno` optimistic + queue

**Invariante clave:** El UUID del turno se genera con `crypto.randomUUID()` en el cliente y NUNCA cambia durante el sync. Identidad operativa estable.

### B2. IndexedDB schema v3

Stores nuevos (además de los v1-v2 existentes):

```
turnos          { keyPath: 'id', indexes: [client_id, closed_at] }
cash_movements  { keyPath: 'id', indexes: [turno_id] }
```

### B3. `fetchTurno` — lectura con fallback offline

```typescript
// Intenta Supabase → cachea en IDB → si offline, lee de IDB
try {
  const res = await fetch(SUPABASE_URL + '/rest/v1/pos_turnos?...')
  if (res.ok) {
    const turno = rows[0] || null
    setActiveTurno(turno)
    if (turno) await cacheTurno({ ...turno, synced_at: new Date().toISOString() })
    return
  }
} catch { /* offline */ }
const cached = await getCachedActiveTurno(_cid())
setActiveTurno(cached ? { ...mapToTurno(cached) } : null)
```

---

## C. Lo que funciona offline AHORA mismo (validado en código)

| Flujo | Mecanismo | Archivo |
|---|---|---|
| Abrir turno | IDB-first → queue sync | `turno/page.tsx:319` |
| Fetch turno activo | Supabase → IDB fallback | `turno/page.tsx:302` |
| Tomar orden (items) | React state + IDB `orders` | `pos/page.tsx` |
| Enviar a cocina | `saveOrder` → `OFFLINE_QUEUED` | `pos-data.ts:1392` |
| KDS recibe orden | WebSocket LAN broadcast | `main.js` WsHub |
| Cobro cash | `handlePayment` → `OFFLINE_QUEUED` | `pos/page.tsx:3133` |
| Conflicto de orden | catch → proceed offline | `pos/page.tsx:2664` |
| Impresión | Local bridge `127.0.0.1:7717` | `printer.ts` |
| Caja chica (drawer) | Serial via Electron | `main.js` |
| PIN auth | TTL 8h local | service worker |
| Menú | IDB `menu` store | `pos-offline-db.ts` |
| Modificadores | IDB `modifier_groups` | `pos-offline-db.ts` |
| Métodos de pago | IDB `payment_methods` | `pos-offline-db.ts` |
| Personal | IDB `staff` store | `pos-offline-db.ts` |
| Sync automático | `registerAutoSync()` + `online` event | `pos-offline-db.ts:607` |

---

## D. Lo que NO funciona offline todavía (deuda conocida)

| Flujo | Problema | Esfuerzo estimado |
|---|---|---|
| Cerrar turno (corte de caja) | `CierreCajaWizard` lee órdenes de Supabase sin fallback IDB | M (2h) |
| Corte X | `CorteXModal.fetchData` GET directo Supabase | S (1h) |
| Historial de cierres | Lee `pos_turnos` sin IDB | M (2h) |
| Cobro tarjeta MP Point | Requiere internet por diseño (terminal física) | N/A — by design |
| Cobro UberEats/Rappi | Requiere internet por diseño | N/A — by design |
| Facturas CFDI | Requiere PAC online | N/A — by design |
| Dashboard analytics | Read-only, no crítico para operación | L (deuda baja) |
| Inventario pull de Wansoft | Scraper externo, no crítico | L |
| Órdenes de compra | Flujo admin, no crítico para servicio | M |

**Regla de diseño:** El restaurante puede OPERAR (tomar órdenes, imprimir, cobrar efectivo, KDS) 100% sin internet. Los flujos de cierre y reportes pueden esperar reconexión.

---

## E. Arquitectura local-first: diagrama textual

```
┌─────────────────────────────────────────────────────────────┐
│                    SERVIDOR LOCAL (Electron)                  │
│           HTTP + WebSocket en 0.0.0.0:7717                   │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  EventStore  │  │  RestaurantState│  │  WsHub (LAN)    │   │
│  │  (NDJSON)    │  │  (en memoria)  │  │  SUBSCRIBE/CMD  │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Print Bridge │  │Fingerprint Svc│  │  BonjourService  │   │
│  │ /api/print   │  │/api/fingerprint│  │  mDNS discovery │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         ▲                    ▲                   ▲
         │ HTTP               │ HTTP              │ WS
┌────────┴──────┐    ┌────────┴──────┐   ┌───────┴────────┐
│  POS Window   │    │  KDS Window   │   │  Otros términnales│
│  Next.js SPA  │    │  /pos/kds     │   │  (LAN, port 7717)│
│  IndexedDB v3 │    │  WebSocket    │   │                  │
│  Service Worker│   │               │   │                  │
└───────────────┘    └───────────────┘   └────────────────┘
         │
         │ Solo cuando hay internet
         ▼
┌─────────────────┐
│    Supabase     │
│ (sync + backup) │
│ read-only apps  │
│ dashboard.web   │
└─────────────────┘
```

**Principio:** Internet = canal de sincronización, respaldo, dashboard, IA. Nunca requisito para operar.

---

## F. Flujos de operación por estado de red

### F1. Con internet (modo normal)

```
Mesero toma orden → POS → saveOrder → /api/pos/save → Supabase
                                    ↘ WsHub broadcast → KDS
                                    ↘ Print bridge → impresora
```

### F2. Sin internet (modo offline)

```
Mesero toma orden → POS → saveOrder → IndexedDB (orders store)
                                    ↘ SyncQueue (sync_queue store)
                                    ↘ WsHub broadcast (LAN) → KDS
                                    ↘ Print bridge → impresora

Internet regresa → online event → syncAll() → Supabase
```

### F3. Multi-terminal offline

```
Terminal A:  orden A → IndexedDB A + WsHub broadcast (LAN)
Terminal B:  orden B → IndexedDB B + WsHub broadcast (LAN)
KDS:         recibe A y B por WebSocket LAN
Internet:    A sync → ok | B sync → conflict check (OCC) → ok o STALE_WRITE_CONFLICT
```

---

## G. IndexedDB: schema actual (DB_VERSION 3)

```typescript
const DB_NAME = 'fullsite_pos'
const DB_VERSION = 3

Stores:
  menu              { keyPath: 'id' }                           // v1
  orders            { keyPath: 'id', indexes: [status, mesa] }  // v1
  inventory         { keyPath: 'ingredient_id' }                // v1
  sync_queue        { keyPath: 'id', indexes: [synced] }        // v1
  meta              { keyPath: 'key' }                          // v1
  modifier_groups   { keyPath: 'id' }                           // v2
  modifiers         { keyPath: 'id' }                           // v2
  item_modifier_links { keyPath: 'id' }                         // v2
  payment_methods   { keyPath: 'id' }                           // v2
  staff             { keyPath: 'id' }                           // v2
  turnos            { keyPath: 'id', indexes: [client_id, closed_at] }  // v3 ← nuevo
  cash_movements    { keyPath: 'id', indexes: [turno_id] }      // v3 ← nuevo
```

---

## H. SyncQueue: clasificación de errores y protocolo de reconciliación

```typescript
type SyncErrorClass =
  | 'TRANSIENT_RETRYABLE'      // red, 5xx — auto-retry
  | 'STALE_WRITE_CONFLICT'     // revisión obsoleta — TERMINAL, requiere operador
  | 'TERMINAL_NON_RETRYABLE'   // payload malformado, validación — no puede pasar sin cambio
```

**Protocolo de sync:**

1. `registerAutoSync()` escucha `window.addEventListener('online', ...)`
2. `syncAll()` con mutex `syncAllRunning` — previene runs concurrentes
3. Por cada item en `sync_queue` donde `synced === false`:
   - Si `transport === 'APP_API'` → replay via `/api/pos/save`
   - Si `transport === 'SUPABASE_REST'` → POST directo a PostgREST
4. Respuesta 200/201 → `markSynced(id)` → `synced = true`
5. Respuesta 409/422 → `error_class = 'STALE_WRITE_CONFLICT'` → no auto-retry
6. Red muerta → `error_class = 'TRANSIENT_RETRYABLE'` → retry en próximo `online` event

**ReplayTransport por dominio:**

| Dominio | Transport | Razón |
|---|---|---|
| `pos_orders` (send/pay) | `APP_API` | Pasa por `/api/pos/save` — revision-aware, inventory hook |
| `pos_turnos` | `SUPABASE_REST` | Simple INSERT, no reconciliation |
| `pos_cash_movements` | `SUPABASE_REST` | Audit log, no revision |
| `pos_inventory` | `SUPABASE_REST` | Movimientos simples |

---

## I. WebSocket hub: protocolo LAN

**Endpoint:** `ws://[IP_LOCAL]:7717`

### Cliente → Servidor

```jsonc
{ "type": "SUBSCRIBE", "channel": "orders" }          // registrar listener
{ "type": "COMMAND", "action": "print", "data": {...} } // comando de impresión
{ "type": "PING" }                                     // keepalive
```

### Servidor → Cliente

```jsonc
{ "type": "SNAPSHOT", "orders": [...] }    // estado completo al suscribirse
{ "type": "DELTA", "order": {...} }        // cambio incremental
{ "type": "ACK", "id": "..." }             // confirmación de comando
{ "type": "REJECT", "reason": "..." }      // error de comando
{ "type": "PONG" }                         // respuesta a PING
```

**Discovery LAN:** Bonjour/mDNS service `_fullsite._tcp` — terminales descubren el servidor automáticamente.

---

## J. Electron: configuración y modos

### Archivo de configuración

`%APPDATA%/Fullsite POS/config.json`

```json
{
  "pos_server_ip": "192.168.1.71",
  "kds_only": false,
  "client_id": "amalay"
}
```

### Modos de operación

| Modo | config.json | Comportamiento |
|---|---|---|
| POS completo | `kds_only: false` (default) | Abre POS window + inicia Local Server + fingerprint |
| KDS dedicado | `kds_only: true` | Solo abre KDS en fullscreen, se conecta al server del POS |

### URLs de ventanas

```javascript
const POS_URL = 'https://app.fullsite.mx/pos'
const KDS_URL = 'https://app.fullsite.mx/pos/kds'
```

### Retry logic KDS

```javascript
// 3 intentos con backoff progresivo de 800ms
// Si falla 3 veces → loadFile('offline.html', { query: { target: KDS_URL } })
// offline.html usa ?target= para evitar redirect loop
```

---

## K. Instalación en AMALAY: checklist step-by-step

### K1. Servidor principal (SERVER1 — 192.168.1.71)

- [ ] Copiar `Fullsite POS Setup 1.2.0.exe` a `\\SERVER1\Downloads`
- [ ] Instalar como administrador (perMachine: true)
- [ ] Verificar que `%APPDATA%\Fullsite POS\config.json` tenga `pos_server_ip: "192.168.1.71"`
- [ ] Abrir `https://app.fullsite.mx/pos` — debe cargar sin error
- [ ] Abrir turno sin internet (deshabilitar WiFi) — debe funcionar
- [ ] Re-habilitar WiFi — turno debe sincronizarse automáticamente
- [ ] Verificar en Supabase que el turno aparece con el mismo UUID

### K2. Estaciones KDS (cocina, barra)

- [ ] Instalar mismo `.exe` en cada estación
- [ ] Editar `config.json`: `kds_only: true`, `pos_server_ip: "192.168.1.71"`
- [ ] Iniciar app — debe abrir directamente en KDS fullscreen
- [ ] Desde POS principal: enviar una orden de prueba
- [ ] Verificar que KDS la recibe en < 500ms (LAN WebSocket)

### K3. Red LAN

- [ ] Todas las estaciones en el mismo subnet (192.168.1.x)
- [ ] Puerto 7717 abierto en el firewall de SERVER1
- [ ] mDNS/Bonjour habilitado (o usar IP fija en config.json)

---

## L. Validación post-instalación: smoke test

```bash
# 1. Desconectar internet (deshabilitar WiFi o jalar cable)
# 2. En POS:
#    - Abrir turno — debe abrir sin error ✓
#    - Tomar una orden (2-3 items con modificadores)
#    - Enviar a cocina — KDS debe recibir ✓
#    - Imprimir comanda — debe imprimir ✓
#    - Cobrar en efectivo — debe registrar con "Sin conexión" toast ✓
#    - Imprimir ticket de cobro ✓

# 3. Reconectar internet
#    - SyncQueue debe sincronizarse automáticamente
#    - Verificar en https://app.fullsite.mx/dashboard que aparecen las ventas ✓
#    - Verificar en Supabase tabla pos_turnos que el turno tiene synced_at ✓
```

---

## M. Roadmap: qué falta para offline completo

### P0 — Crítico para operación autónoma

| Feature | Dónde | Esfuerzo |
|---|---|---|
| Cerrar turno offline (`CierreCajaWizard`) | `components/pos/CierreCajaWizard.tsx` | M (2-3h) |
| Corte X offline (`CorteXModal`) | `turno/page.tsx:46` | S (1h) |
| Historial de cierres IDB | `turno/page.tsx` HistorialCierres | M (2h) |

### P1 — Mejoras de robustez

| Feature | Dónde | Esfuerzo |
|---|---|---|
| `cash_movements` en turno offline | `pos-offline-db.ts` (store ya existe) | M |
| Resolución de conflictos en UI | Dashboard operador | L |
| Test de integración offline end-to-end | `playwright.config.ts` | M |
| Indicador visual de estado de sync | POS header | S |

### P2 — Nice to have

| Feature | Descripción | Esfuerzo |
|---|---|---|
| Offline analytics básico | Resumen local de ventas del día sin dashboard | L |
| Exportar sync queue a CSV | Para diagnóstico de conflictos | M |
| Auto-compaction EventStore | Snapshots periódicos del NDJSON | M |

---

## N. Referencias: archivos clave, commits, builds

### Commits de referencia

| Commit | Descripción |
|---|---|
| `36f6b7c` | feat(offline): LAN multi-terminal, KDS WebSocket |
| `fe9f0df` | fix(sw): offline page inteligente, Continuar o Escenario C |
| `ab38fe7` | fix(electron): KDS retry + offline redirect loop fix |
| `a8e0b00` | feat(electron): kds_only mode, KDS URL fix, architecture docs |
| `6253add` | docs: LOCAL_FIRST_ARCHITECTURE.md → docs/reference/ |
| `7e17828` | feat(offline): turno abre/cierra sin internet — IDB-first |

### Archivos clave

| Archivo | Rol |
|---|---|
| `electron-app/main.js` | Local Server, WsHub, KDS window, print bridge |
| `dashboard-app/src/lib/pos-offline-db.ts` | IndexedDB schema v3, syncAll, queues |
| `dashboard-app/src/lib/pos-data.ts` | saveOrder, OFFLINE_QUEUED flow |
| `dashboard-app/src/app/pos/page.tsx` | POS principal, handleSendToKitchen, handlePayment |
| `dashboard-app/src/app/pos/turno/page.tsx` | Turno offline (recién implementado) |
| `dashboard-app/src/app/pos/kds/page.tsx` | KDS unificado (barra + cocina tabs) |
| `docs/reference/LOCAL_FIRST_ARCHITECTURE.md` | Arquitectura completa (15 secciones) |

### Build actual

```
Instalador: electron-app/dist/Fullsite POS Setup 1.2.0.exe
Versión:    1.2.0
Commit:     a8e0b00 (base), 7e17828 (turno offline — requiere nuevo build)
Platform:   Windows x64
NSIS:       perMachine, oneClick
```

> **Nota:** Para incluir el fix de turno offline en el instalador, hacer nuevo build:  
> `cd electron-app && npm run build:win`  
> El Next.js (app.fullsite.mx) se actualiza con deploy a Vercel — no requiere nuevo .exe.

---

## Estado final de la sesión

**Implementado y commiteado:**
- `7e17828` — Turno offline completo (IDB + sync queue + UUID estable)
- `a8e0b00` — Electron v1.2.0 con KDS loop fix + kds_only mode
- `6253add` — Architecture docs en docs/reference/

**Funcionando en producción (app.fullsite.mx):**
- Órdenes offline
- Cobro cash offline
- KDS por LAN
- Service Worker precaché

**Físicamente validado en AMALAY:**
- Pendiente (validación programada con Eduardo)

**Pendiente de implementar (P0):**
- Cerrar turno offline
- Corte X offline
