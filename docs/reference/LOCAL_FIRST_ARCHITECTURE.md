# Fullsite — Arquitectura Local-First

> **Documento de referencia oficial.** Escrito para que cualquier ingeniero pueda desplegar, operar y extender el sistema sin haber estado en las conversaciones donde fue diseñado. Actualiza este documento cuando cambie la arquitectura.
>
> Versión inicial: 2026-07-27. Basado en la implementación en AMALAY (Monterrey, MX).

---

## Tabla de contenidos

1. [Visión y principios](#1-visión-y-principios)
2. [Arquitectura completa](#2-arquitectura-completa)
3. [Flujo completo de una orden](#3-flujo-completo-de-una-orden)
4. [Persistencia local](#4-persistencia-local)
5. [Sincronización](#5-sincronización)
6. [Protocolo LAN (WS)](#6-protocolo-lan-ws)
7. [Checklist de instalación](#7-checklist-de-instalación)
8. [Checklist de validación](#8-checklist-de-validación)
9. [Estado actual](#9-estado-actual)
10. [Roadmap](#10-roadmap)
11. [Decisiones arquitectónicas](#11-decisiones-arquitectónicas)
12. [Troubleshooting](#12-troubleshooting)
13. [Lecciones aprendidas en AMALAY](#13-lecciones-aprendidas-en-amalay)
14. [Runbook operativo](#14-runbook-operativo)
15. [Estrategia de escala](#15-estrategia-de-escala)

---

## 1. Visión y principios

### Por qué local-first

Un restaurante no puede permitirse que su operación dependa de una conexión a internet que puede caerse en cualquier momento. El modelo mental correcto no es "POS con soporte offline" — es un **sistema local que usa internet cuando está disponible**.

La diferencia es fundamental:

| POS convencional en la nube | Fullsite local-first |
|---|---|
| Requiere internet para operar | Opera completamente sin internet |
| Internet es el camino principal | Internet es el canal de sincronización |
| Falla de red = operación bloqueada | Falla de red = operación sin cambios visibles |
| El dato vive en el servidor remoto | El dato vive en la máquina del restaurante |
| Latencia de red en cada acción | Latencia de disco local en cada acción |

### Objetivo de diseño

Si mañana un restaurante pierde internet durante todo el día, el personal debe poder trabajar prácticamente igual que si nunca se hubiera caído. Un mesero no debería poder notar cuándo hay internet y cuándo no.

### Principios

1. **Local-first:** toda operación escribe localmente primero. Supabase es el destino de sincronización, no la fuente de verdad operativa.
2. **Resiliencia ante reinicios:** si se va la luz o se reinicia Windows, el restaurante continúa exactamente donde estaba. Nada se pierde.
3. **Consistencia eventual:** las réplicas (POS + KDS + Barra) convergen vía el event log local. No se necesita internet para que la cocina vea una orden.
4. **Idempotencia:** cada operación tiene un `command_id` único. Enviarla dos veces produce exactamente el mismo resultado que enviarla una vez.
5. **LAN como red primaria, internet como respaldo:** la comunicación entre terminales pasa por LAN, no por la nube.
6. **Sin polling de internet:** la comunicación en tiempo real entre terminales ocurre vía WebSocket local. No hay polling a Supabase en el camino crítico.
7. **Transparencia operativa:** el sistema no muestra loaders ni pantallas de error durante operación offline. El estado se reconstruye del log local.

### Qué no resuelve esta arquitectura (hoy)

- Terminales de pago bancarias externas (Clip, MP Point) — tienen sus propias limitaciones de conectividad.
- Facturación electrónica (CFDI) — requiere PAC en línea.
- Dashboards y reportes en tiempo real — requieren Supabase online.
- IA cloud (Claude, Groq) — requieren internet.

---

## 2. Arquitectura completa

### Diagrama

```
┌─────────────────────────────────────────────────────────────────┐
│                        RESTAURANTE (LAN)                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    SERVER1 (Windows PC)                  │  │
│  │                                                          │  │
│  │  ┌─────────────────────┐   ┌──────────────────────────┐ │  │
│  │  │   Electron — POS    │   │  Electron — KDS (2nd mon)│ │  │
│  │  │  app.fullsite.mx/pos│   │  app.fullsite.mx/pos/kds │ │  │
│  │  │                     │   │                          │ │  │
│  │  │  ┌───────────────┐  │   │  ┌────────────────────┐ │ │  │
│  │  │  │  React POS    │  │   │  │    React KDS       │ │ │  │
│  │  │  │  IndexedDB    │  │   │  │    IndexedDB        │ │ │  │
│  │  │  │  Service Wrkr │  │   │  │    Service Worker   │ │ │  │
│  │  │  └───────┬───────┘  │   │  └────────┬───────────┘ │ │  │
│  │  └──────────┼──────────┘   └───────────┼─────────────┘ │  │
│  │             │    HTTP/WS                │    WS         │  │
│  │             ▼                           ▼               │  │
│  │  ┌─────────────────────────────────────────────────────┐│  │
│  │  │              Fullsite Local Server                  ││  │
│  │  │              0.0.0.0:7717                           ││  │
│  │  │                                                     ││  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐││  │
│  │  │  │  WsHub   │  │ CmdHndlr │  │  EventStore (NDJSON)│││  │
│  │  │  │ (realtime│  │ + State  │  │  event log on disk  │││  │
│  │  │  │  fanout) │  │ machine  │  │  (rebuilt on start) │││  │
│  │  │  └──────────┘  └──────────┘  └────────────────────┘││  │
│  │  │                                                     ││  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐││  │
│  │  │  │  Printer │  │   mDNS   │  │    Heartbeat       │││  │
│  │  │  │ (TCP/USB)│  │ discovery│  │  (telemetry only)  │││  │
│  │  │  └──────────┘  └──────────┘  └────────────────────┘││  │
│  │  └─────────────────────────────────────────────────────┘│  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────┐   ┌──────────────────────────────┐   │
│  │   Terminal 2 (POS)  │   │   KDS dedicado (kds_only)    │   │
│  │  Chrome / Electron  │   │   Electron con kds_only:true │   │
│  │  ?bridge=192.168.x  │   │   pos_server_ip: 192.168.x   │   │
│  └──────────┬──────────┘   └────────────────┬─────────────┘   │
│             │                               │                  │
│             └──────────── WS ──────────────┘                  │
│                      LAN (192.168.x.x)                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                         (internet)
                               │
                    ┌──────────▼──────────┐
                    │      Supabase        │
                    │  (sync + dashboard   │
                    │   + IA + respaldo)   │
                    └──────────────────────┘
```

### Componentes y responsabilidades

#### Electron Main Process (`electron-app/main.js`)

- Arranca el Local Server antes de abrir cualquier ventana.
- Abre la ventana POS (fullscreen, kiosk) cargando `https://app.fullsite.mx/pos`.
- Si `config.json.kds: true` y hay segundo monitor: abre ventana KDS en el segundo monitor.
- Si `config.json.kds_only: true`: omite la ventana POS y abre solo KDS en el monitor principal.
- Inyecta `clientId` y `terminalId` en `localStorage` vía `executeJavaScript` tras carga exitosa.
- Maneja `did-fail-load` con 3 reintentos progresivos (800ms, 1600ms, 2400ms) antes de mostrar `offline.html`.
- Maneja reinicios del renderer (crashes) recargando `POS_URL` automáticamente.

#### Fullsite Local Server (`electron-app/local-server/`)

El servidor Node.js que corre dentro del proceso Electron. No es un proceso separado.

| Módulo | Responsabilidad |
|---|---|
| `index.js` | Entry point. Ensambla todos los módulos y levanta HTTP en 0.0.0.0:7717 |
| `core/event-store.js` | Wrapper de idempotencia sobre el storage NDJSON |
| `adapters/storage/ndjson.js` | Persiste eventos en disco como NDJSON line-delimited JSON |
| `core/state.js` | Máquina de estado en memoria. Se reconstruye del event log al arrancar |
| `core/ws-hub.js` | Gestiona conexiones WebSocket. Hace broadcast de eventos a todos los clientes |
| `core/command-handler.js` | Valida comandos entrantes, los persiste, aplica al estado, hace broadcast |
| `discovery/mdns.js` | Anuncia el servidor en LAN vía mDNS (`_fullsite-pos._tcp`) |
| `telemetry/heartbeat.js` | Envía métricas a Supabase cada N segundos (no-crítico) |
| `update/manager.js` | Verifica actualizaciones disponibles y notifica a clientes |
| `adapters/printer.js` | Abstracción de impresión TCP (cocina) y USB (caja) |
| `adapters/network.js` | Detecta la IP LAN del servidor |

**Endpoints HTTP:**

| Endpoint | Método | Descripción |
|---|---|---|
| `/health` | GET | Estado del servidor: versión, clientes, sync queue, IP LAN |
| `/state` | GET | Snapshot del estado en memoria (mesas, órdenes, KDS, turno) |
| `/events` | POST | Acepta comandos de terminales sin WS conectado |
| `/events?since=N` | GET | Devuelve eventos después de secuencia N (catch-up) |
| `/print` | POST | Imprime a una estación (base64 ESC/POS) |
| `/drawer` | POST | Abre cajón registradora |
| `/test` | POST | Imprime ticket de prueba en todas las estaciones |
| `/config` | GET/POST | Lee/actualiza configuración de impresoras |

#### React Web App (`dashboard-app/`)

La aplicación Next.js desplegada en Vercel (`app.fullsite.mx`). Corre tanto en Electron como en Chrome.

Módulos clave para offline:

| Archivo | Responsabilidad |
|---|---|
| `src/lib/pos-offline-db.ts` | IndexedDB: leer/escribir menú, órdenes, sync queue, modificadores, staff |
| `src/lib/pos-data.ts` | Capa de datos: intenta Supabase, cae a IDB en error |
| `src/lib/bridge-client.ts` | WebSocket client hacia el Local Server. Detecta host LAN via localStorage |
| `src/lib/service-worker.ts` | Registro del SW desde la app |
| `public/sw.js` | Service Worker: precachea rutas, sirve offline fallback |
| `src/app/pos/layout.tsx` | Auth (PIN + huella), turno gate, init offline, session |
| `src/app/pos/page.tsx` | POS principal: menú, carrito, envío a cocina |
| `src/app/pos/plano/page.tsx` | Mapa de mesas |
| `src/app/pos/kds/page.tsx` | KDS unificado (tabs cocina/barra/panadería) |
| `src/app/pos/cocina/page.tsx` | Vista cocina |
| `src/app/pos/barra/page.tsx` | Vista barra |

#### Service Worker (`public/sw.js`)

- Versión: `v6` (incrementar al cambiar STATIC_ASSETS o lógica crítica).
- Precachea en `install`: todas las rutas POS, manifest, iconos.
- Precachea en `install`: todos los chunks JS/CSS de Next.js (evita pantalla negra offline en Electron).
- Estrategia HTML: network-first → cache fallback → `offlineHTML()`.
- Estrategia JS/CSS: cache-first → network fallback.
- Estrategia API Supabase: network-first → cache fallback (patrones configurables).
- `offlineHTML()`: cuando no hay cache disponible, muestra UI con botón "Continuar offline" (si cache existe) o instrucción de conectarse (si no existe).

#### IndexedDB (`pos-offline-db`)

Base de datos local en el navegador/Electron. Persiste todos los datos operativos necesarios para funcionar sin internet.

Ver sección 4 para el esquema completo.

#### Supabase (cloud)

En la arquitectura local-first, Supabase tiene roles específicos y acotados:

- **Fuente de verdad histórica:** datos que no cambian en el POS (menú maestro, recetas, configuración).
- **Destino de sincronización:** cuando hay internet, el sync queue sube operaciones pendientes.
- **Dashboard y BI:** reportes, análisis, dashboards — todos requieren internet.
- **IA cloud:** Claude, Groq, agentes autónomos.
- **Respaldo:** el event log y los datos operativos suben periódicamente.
- **Heartbeat de flota:** el servidor local reporta métricas al telemetry endpoint.

**Lo que Supabase NO es en Phase 2+:** la fuente de verdad para operaciones del turno activo. Las órdenes abiertas, el estado de mesas, el KDS — todo vive en el event log local.

---

## 3. Flujo completo de una orden

### Online (internet disponible)

```
1. ABRIR MESA
   Mesero selecciona mesa en /pos/plano
   └─ Intento de MESA_LOCK via WS → Local Server acepta
   └─ Local Server broadcast DELTA a todos los clientes
   └─ Otros POS ven la mesa "ocupada" inmediatamente

2. SELECCIONAR MESERO
   PIN o huella digital
   └─ verifyManagerPin() → intenta Supabase primero
   └─ Si responde: valida, cachea resultado en IDB (TTL 8h)
   └─ Navigator → /pos?mesa=N

3. AGREGAR PRODUCTOS
   Menú cargado desde IDB cache
   └─ getMenuCategories() → intenta Supabase, cae a IDB en error
   └─ Modificadores cargados desde IDB (prefetchOfflineData al inicio)
   └─ Carrito en estado React (sessionStorage)

4. ENVIAR A COCINA
   Usuario presiona "Enviar pedido"
   └─ saveOrder() → POST a Supabase
   └─ Si OK (online): orden guardada en Supabase
   └─ Impresión: fetch POST /print al Local Server → TCP/USB
   └─ Broadcast ORDER_SENT vía:
      a) WS al Local Server → broadcast DELTA a KDS/Barra
      b) POST /events al Local Server (fallback HTTP)
   └─ KDS recibe DELTA → muestra orden inmediatamente
   └─ Navegación → /pos/plano

5. KDS — PREPARACIÓN
   fetchOrders() → intenta Supabase
   └─ Órdenes con status 'enviada' / 'preparando'
   └─ Cocinero presiona item → avanza status
   └─ PATCH a Supabase (kds_item_status)
   └─ ORDER_SENT badge → preparando → lista

6. COBRO
   Usuario selecciona método de pago
   └─ Efectivo/mixto: local, sin internet
   └─ Tarjeta terminal externa: MP Point / Clip (conexión propia)
   └─ Cierre de cuenta: PATCH pos_orders (status=closed)
   └─ Movimiento cajón: POST /drawer al Local Server
   └─ Propina registrada
   └─ Mesa liberada: ORDER_CLOSED broadcast

7. SINCRONIZACIÓN
   Todo lo anterior fue a Supabase directamente (online path)
   └─ No hay sync queue (ya está en la nube)
```

### Offline (sin internet)

```
1. ABRIR MESA
   Mesero selecciona mesa en /pos/plano
   └─ Mapa de mesas desde localStorage / estado React
   └─ Sin MESA_LOCK WS (no hay broadcast LAN si WS desconectado)
   └─ Mesa marcada visualmente como seleccionada

2. SELECCIONAR MESERO
   PIN
   └─ verifyManagerPin() → Supabase falla
   └─ Cae a _getPinFromCache() → lee PIN cacheado en IDB
   └─ Cache TTL: 8 horas desde última validación exitosa online

3. AGREGAR PRODUCTOS
   Menú desde IDB (cacheado en sesión online anterior)
   └─ getCachedMenuCategories() → IDB store 'menu'
   └─ Modificadores desde IDB store 'modifier_groups', 'modifiers', 'item_modifier_links'
   └─ 100% local, sin latencia de red

4. ENVIAR A COCINA
   Usuario presiona "Enviar pedido"
   └─ saveOrder() → intenta Supabase → falla → retorna OFFLINE_QUEUED
   └─ Orden guardada en IDB store 'orders' (status: 'enviada')
   └─ Operación añadida a IDB store 'sync_queue' (id, type, payload, synced:false)
   └─ Impresión: fetch POST /print al Local Server → TCP/USB (siempre local, sin internet)
   └─ POST /events http://127.0.0.1:7717/events → ORDER_SENT command
   └─ Local Server acepta → append event log → broadcast WS a KDS/Barra
   └─ KDS recibe evento vía WS LAN → caches orden en su IDB → muestra orden
   └─ Navegación → /pos/plano (igual que online)

5. KDS — PREPARACIÓN (offline)
   fetchOrders() → Supabase falla → cae a getCachedOrders() desde IDB
   └─ Órdenes recibidas vía WS DELTA del Local Server
   └─ Cocinero avanza status → PATCH Supabase falla silenciosamente
   └─ Estado KDS solo en memoria hasta reconexión

6. COBRO (offline)
   Efectivo: 100% local
   └─ Registro en sync_queue para sincronizar después
   Tarjeta: depende de terminal bancaria (límite externo)

7. CUANDO VUELVE INTERNET
   registerAutoSync() detecta online (navigator.onLine + fetch de prueba)
   └─ syncAll() procesa sync_queue en orden
   └─ Cada operación sube exactamente una vez (idempotencia via command_id)
   └─ IDB sync_queue limpiada al completar
```

### Diagrama de decisión por operación

```
Cada operación sigue este árbol:

REQUEST
  │
  ├─ ¿Hay internet? ─────────────────── SÍ ──► Supabase directo
  │                                              │
  │                                              ├─ OK ──► Éxito, update IDB cache
  │                                              │
  │                                              └─ Error ──► (tratado como offline)
  │
  └─ NO / timeout ──► IDB local
                        │
                        ├─ Lee: datos desde cache
                        │
                        └─ Escribe: sync_queue + IDB
```

---

## 4. Persistencia local

### IndexedDB (`pos-offline-db`)

**Base de datos:** `fullsite-pos-v2`  
**DB_VERSION:** 2  
**Ubicación:** Electron userData (Windows: `%APPDATA%\fullsite-pos\`) o perfil de Chrome

#### Stores

| Store | Key | Índices | Descripción |
|---|---|---|---|
| `orders` | `id` (uuid) | `status`, `mesa` | Órdenes activas. Cacheadas al enviar o al recibir por WS |
| `menu` | `id` | — | Categorías y productos del menú |
| `inventory` | `id` | — | Ingredientes e inventario actual |
| `sync_queue` | `id` | `synced` | Operaciones pendientes de subir a Supabase |
| `meta` | `key` | — | Metadatos: última sincronización, versiones |
| `modifier_groups` | `id` | — | Grupos de modificadores (cacheados offline) |
| `modifiers` | `id` | — | Modificadores individuales |
| `item_modifier_links` | — | — | Relación ítem-modificador |
| `payment_methods` | `id` | — | Métodos de pago disponibles |
| `staff` | `id` | — | Personal del restaurante (para PIN offline) |

#### Estructura de sync_queue

```typescript
interface SyncQueueItem {
  id: string               // uuid — también es el command_id (idempotencia)
  type: string             // 'ORDER_CREATED' | 'ORDER_UPDATED' | 'PAYMENT' | etc.
  payload: object          // datos completos de la operación
  synced: boolean          // false = pendiente, true = enviado
  created_at: string       // ISO timestamp
  attempts: number         // intentos de sync fallidos
  last_error?: string      // último error para diagnóstico
  base_version?: string    // server updated_at al momento de encolar (detección de conflictos)
}
```

#### Ciclo de vida de sync_queue

```
Operación offline
  └─► addToSyncQueue(item)         IDB write
        └─► syncAll() al reconectar
              └─► _syncAllInner()
                    └─► Por cada item:
                          └─► POST a Supabase
                                ├─ OK ──► markSynced(id) → IDB delete
                                └─ Error ──► increment attempts, log error
                                              Si attempts >= MAX ──► marcar failed
```

### localStorage (navegador/Electron)

| Key | Tipo | Descripción | TTL |
|---|---|---|---|
| `fullsite_client_id` | string | UUID del restaurante (inyectado por Electron desde config.json) | Permanente |
| `pos_terminal_id` | string | UUID de la terminal (inyectado por Electron) | Permanente |
| `pos_bridge_host` | string | IP LAN del servidor principal (guardada vía ?bridge=IP) | Permanente |
| `pos_last_boot` | ISO string | Último arranque exitoso (mostrado en offline.html) | Actualiza en cada boot |
| `offline_continue_state` | JSON | Contador de intentos offline para Escenario C | Reseteado cada 90s |
| `pos_last_activity` | ISO string | Última actividad del mesero (para timeout de sesión) | Por sesión |
| `pos_staff` | JSON | Staff autenticado actualmente (para timeout de sesión) | Por sesión |
| `pos_active_turno` | JSON | Turno activo cacheado offline | Hasta cierre de turno |

### Event Log (Local Server)

**Ubicación:** `{userData}/event-log.ndjson`  
**Formato:** NDJSON — un evento JSON por línea.

```json
{"id":"uuid","type":"ORDER_SENT","ts":1722000000000,"client_id":"terminal-1","restaurant_id":"uuid","payload":{"order_id":"uuid","mesa":5,"items":[...]}}
{"id":"uuid","type":"ORDER_CLOSED","ts":1722000100000,"client_id":"terminal-1","restaurant_id":"uuid","payload":{"order_id":"uuid","mesa":5}}
```

El event log es la **fuente de verdad local** del Local Server. Al arrancar, el servidor lee todos los eventos y reconstruye el estado en memoria (`RestaurantState`). Esto garantiza que tras un reinicio, el estado operativo se recupera completamente.

**Processed commands:** `{userData}/processed-commands.ndjson` — registro de `command_id` ya procesados, para idempotencia.

**Server ID:** `{userData}/server-id` — UUID estable que identifica esta instalación.

### Service Worker Cache

**Cache names:** `fullsite-static-v6`, `fullsite-dynamic-v6`, `fullsite-api-v6`  
(El número incrementa con `CACHE_VERSION` en `sw.js`)

| Cache | Contenido | Estrategia |
|---|---|---|
| `fullsite-static-v6` | Rutas HTML del POS, JS/CSS chunks de Next.js, iconos, manifest | Cache-first para assets, precache en install |
| `fullsite-dynamic-v6` | Páginas HTML visitadas dinámicamente | Network-first con fallback a cache |
| `fullsite-api-v6` | Respuestas de Supabase REST para patrones configurados | Network-first con fallback a cache |

**Rutas precacheadas en install:**
```
/ /pos /pos/mesas /pos/plano /pos/cocina /pos/barra /pos/kds /pos/corte
/pos/historial /pos/inventario /pos/compras /pos/recetas /pos/turno
/pos/panaderia /pos/delivery /pos/cliente /pos/facturacion /pos/auditoria
/manifest.json /icon-192v2.png /icon-512v2.png
```

**Nota crítica:** el precache de chunks JS (Phase 2 del install) extrae todas las URLs `/_next/static/` del HTML de `/pos` y las cachea. Sin esto, Electron muestra pantalla negra offline porque el HTML carga pero React no puede inicializarse sin sus bundles.

**TTL del cache API:** network-first — el cache se actualiza automáticamente con cada request exitoso online. No hay expiración forzada.

### Configuración en disco (Electron)

`C:\fullsite\config.json`:
```json
{
  "clientId": "uuid-del-restaurante",
  "restaurantId": "uuid-del-restaurante",
  "terminalId": "uuid-de-esta-terminal",
  "instanceName": "AMALAY Sucursal Principal",
  "channel": "stable",
  "kds": false,
  "kds_only": false,
  "pos_server_ip": "192.168.1.71",
  "supabaseUrl": "https://proyecto.supabase.co",
  "supabaseAnonKey": "eyJ..."
}
```

`C:\fullsite\printers.json`:
```json
{
  "stations": {
    "cocina": { "type": "tcp", "host": "192.168.1.21", "port": 9100 },
    "barra":  { "type": "tcp", "host": "192.168.1.30", "port": 9100 },
    "caja":   { "type": "usb", "names": ["TICKET", "EC01", "EC TICKET"] }
  }
}
```

---

## 5. Sincronización

### Cuándo sincroniza

Hay tres disparadores de sincronización:

1. **`registerAutoSync()`** — corre en el fondo desde que carga el POS layout. Hace una prueba de conectividad activa cada 30 segundos. Si detecta internet disponible, llama `syncAll()`.

2. **`online` event del navegador** — `window.addEventListener('online', ...)` dispara `syncAll()` cuando el browser detecta reconexión.

3. **Service Worker Background Sync** — si el browser soporta `Background Sync API`, el SW registra una tarea `sync-orders` que el browser ejecuta en background incluso si la pestaña está cerrada.

4. **Manual** — el usuario puede presionar el botón "Sincronizar" en el `OfflineIndicator` cuando hay pedidos pendientes y hay internet.

### Cómo detecta internet

```typescript
// registerAutoSync — doble verificación
async function checkConnectivity(): Promise<boolean> {
  if (!navigator.onLine) return false
  try {
    // Prueba real: fetch a un endpoint conocido con timeout 3s
    const res = await fetch('/api/ping', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}
```

`navigator.onLine` puede ser `true` con una red sin internet real (e.g., WiFi sin salida a internet). La doble verificación con fetch real previene falsos positivos.

### Proceso de syncAll

```
syncAll() — garantiza ejecución única (mutex syncAllRunning)
  │
  ├─ Lee todos los items de sync_queue donde synced=false
  │
  ├─ Por cada item (en orden de created_at):
  │   ├─ Construye el payload para Supabase
  │   ├─ POST/PATCH al endpoint correcto
  │   │   ├─ OK 200/201 ──► markSynced(id) → IDB delete
  │   │   ├─ 409 Conflict ──► intenta resolución (ver abajo)
  │   │   └─ Error ──► increment attempts, continúa con siguiente
  │   └─ (nunca bloquea por un item fallido — sigue con los demás)
  │
  ├─ Retorna { synced: N, failed: M }
  │
  └─ Si failed > 0: loguea para diagnóstico, deja items en queue
```

### Idempotencia

Cada operación encolada tiene un `id` que actúa como `command_id`. Si la misma operación llega dos veces a Supabase (e.g., retry después de timeout donde el primer intento sí llegó), Supabase la ignora por constraint de `id` único.

En el Local Server, `CoreEventStore.processCommand()` verifica `hasProcessedCommand(command_id)` antes de aceptar un comando. Comandos duplicados reciben `ACK` con `duplicate: true` sin side-effects.

### Resolución de conflictos (Phase 1)

En Phase 1, la resolución de conflictos es conservadora:

- **Órdenes:** last-write-wins en Supabase. El campo `base_version` en sync_queue captura el `updated_at` del servidor al momento de encolar, permitiendo detectar si alguien más modificó el registro.
- **Estado KDS:** `kds_item_status` es un JSONB separado del campo `items` para evitar race conditions entre KDS (que escribe items marcados) y POS (que escribe items del carrito).
- **Mesas:** `MESA_LOCK` en el Local Server previene que dos terminales abran la misma mesa simultáneamente. Locks expiran en 30 segundos.

En Phase 2 (ver roadmap), el Local Server será la autoridad de escritura y el conflict resolution será más sofisticado.

### Orden de sincronización

La sync queue sube operaciones en orden de `created_at`. Esto preserva la causalidad: si el mesero creó una orden y luego la cobró offline, la creación sube antes que el cierre.

---

## 6. Protocolo LAN (WS)

### Versión del protocolo: 1.0

### Mensajes Client → Server

```json
// SUBSCRIBE — registrar terminal
{
  "protocol_version": "1.0",
  "type": "SUBSCRIBE",
  "client_id": "terminal-uuid",
  "client_type": "pos|kds|barra|admin",
  "last_sequence": 42
}

// COMMAND — enviar operación
{
  "protocol_version": "1.0",
  "type": "COMMAND",
  "restaurant_id": "uuid",
  "payload": {
    "command_id": "uuid",
    "command_type": "ORDER_SENT|MESA_LOCK|KDS_ITEM_STATUS|...",
    // ... campos específicos del comando
  }
}

// PING — keepalive (cada 25s)
{
  "protocol_version": "1.0",
  "type": "PING",
  "client_id": "terminal-uuid"
}
```

### Mensajes Server → Client

```json
// SNAPSHOT — estado completo al suscribirse
{
  "type": "SNAPSHOT",
  "server_id": "uuid",
  "restaurant_id": "uuid",
  "sequence": 157,
  "payload": {
    "state": { "mesas": [...], "orders": [...], "kds": [...], "turno": {...} },
    "deltas": [/* eventos desde last_sequence del cliente */]
  }
}

// DELTA — un evento en tiempo real
{
  "type": "DELTA",
  "sequence": 158,
  "payload": {
    "event": {
      "id": "uuid",
      "type": "ORDER_SENT",
      "ts": 1722000000000,
      "payload": { "order_id": "uuid", "mesa": 5, "items": [...] }
    }
  }
}

// ACK — comando aceptado
{ "type": "ACK", "payload": { "command_id": "uuid", "duplicate": false } }

// REJECT — comando rechazado
{ "type": "REJECT", "payload": { "command_id": "uuid", "reason": "Mesa 5 locked by another terminal" } }

// PONG — respuesta a PING
{ "type": "PONG", "sequence": 157 }

// UPDATE_AVAILABLE — actualización lista para instalar
{ "type": "UPDATE_AVAILABLE", "payload": { "version": "1.2.0", "notes": "..." } }
```

### Tipos de eventos operacionales

| Tipo | Quién envía | Qué comunica |
|---|---|---|
| `ORDER_UPSERTED` | POS | Orden creada o modificada |
| `ORDER_SENT` | POS | Orden enviada a cocina |
| `ORDER_CLOSED` | POS | Orden cerrada (cobro completado) |
| `ORDER_CANCELLED` | POS | Orden cancelada |
| `KDS_ITEM_STATUS` | KDS | Item marcado como preparado/entregado |
| `MESA_LOCK` | POS | Terminal tomando posesión de una mesa |
| `MESA_UNLOCK` | POS | Terminal liberando la mesa |
| `TURNO_OPENED` | POS | Nuevo turno iniciado |
| `TURNO_CLOSED` | POS | Turno cerrado |
| `PRINT_COMMAND` | POS/KDS | Solicitud de impresión a una estación |
| `STATE_SYNC` | Server (interno) | Resync desde Supabase poll |

### Configuración del bridge en terminales secundarias

Las terminales que no corren el Local Server (otros POS o KDS en Chrome) se conectan especificando la IP del servidor:

**Primera vez:**
```
https://app.fullsite.mx/pos/kds?bridge=192.168.1.71
```
El parámetro `?bridge=IP` es leído por la página al cargar, guardado en `localStorage('pos_bridge_host')`, y la URL limpiada. A partir de entonces, `BridgeClient` conecta siempre a `ws://192.168.1.71:7717/ws`.

**Para KDS Electron dedicado (`kds_only`):**
`config.json` incluye `"pos_server_ip": "192.168.1.71"`. Electron inyecta automáticamente el `?bridge=` en la URL al abrir la ventana KDS.

### Reconexión automática

`BridgeClient` reconecta automáticamente cada 3 segundos después de una desconexión. Al reconectar, envía `SUBSCRIBE` con su `last_sequence`, y el servidor responde con todos los eventos que se perdió (catch-up deltas).

---

## 7. Checklist de instalación

### Pre-requisitos

- [ ] Windows 10/11 (x64) en el PC principal (SERVER1)
- [ ] Al menos 8GB RAM, 100GB disco disponible
- [ ] Impresoras de cocina con IP estática en la red local
- [ ] Impresora de caja conectada por USB o IP estática
- [ ] Router/switch con DHCP configurado para asignar IPs estáticas a las impresoras
- [ ] Restaurante creado en Supabase: `clientId` / `restaurantId` disponible

### Paso 1 — Preparar la máquina

```batch
REM Crear directorio de Fullsite
mkdir C:\fullsite
```

### Paso 2 — Crear config.json

```json
// C:\fullsite\config.json
{
  "clientId": "UUID-DEL-RESTAURANTE",
  "restaurantId": "UUID-DEL-RESTAURANTE",
  "terminalId": "UUID-UNICO-PARA-ESTA-TERMINAL",
  "instanceName": "Nombre del Restaurante — Sucursal Principal",
  "channel": "stable",
  "kds": false,
  "kds_only": false,
  "supabaseUrl": "https://PROYECTO.supabase.co",
  "supabaseAnonKey": "eyJhbGc..."
}
```

**Generar UUIDs únicos:** en PowerShell:
```powershell
[System.Guid]::NewGuid().ToString()
```

### Paso 3 — Crear printers.json

```json
// C:\fullsite\printers.json
{
  "stations": {
    "cocina": { "type": "tcp", "host": "192.168.X.X", "port": 9100 },
    "barra":  { "type": "tcp", "host": "192.168.X.X", "port": 9100 },
    "caja":   { "type": "usb", "names": ["TICKET", "EC01", "EC TICKET"] }
  }
}
```

Ajustar IPs según la red del restaurante. Para impresoras USB, los nombres deben coincidir con los que aparecen en Dispositivos e Impresoras de Windows.

### Paso 4 — Instalar Fullsite POS

1. Copiar `Fullsite POS Setup X.X.X.exe` a la máquina
2. Ejecutar como Administrador
3. La instalación es `oneClick: true` — sin pantallas adicionales
4. El acceso directo aparece en el escritorio y en el menú Inicio
5. Se configura auto-inicio en el login de Windows automáticamente

### Paso 5 — Primera apertura

1. Abrir "Fullsite POS" desde el escritorio
2. La app abre en pantalla completa (kiosk mode)
3. Verificar en la barra de título: "Fullsite POS" (no "Offline")
4. Si aparece pantalla de offline.html en lugar de la app: hay un problema de conectividad (ver Troubleshooting)
5. Completar el login con las credenciales del restaurante

### Paso 6 — Primer arranque online (CRÍTICO)

Esta sesión online es la que activa el Service Worker y cachea todas las páginas para futuras sesiones offline.

- [ ] Verificar que el POS cargó correctamente (menú visible, mesas visibles)
- [ ] Navegar a `/pos/kds` aunque sea brevemente — esto cachea la página KDS
- [ ] Navegar a `/pos/cocina` y `/pos/barra`
- [ ] Dejar la app corriendo 2-3 minutos para que el SW complete el precache
- [ ] Verificar en DevTools → Application → Cache Storage que hay entradas en `fullsite-static-v6`

### Paso 7 — Configurar KDS (si aplica)

**Opción A — KDS en segundo monitor del mismo PC:**
```json
// Agregar a config.json
"kds": true
```
Reiniciar Fullsite POS. Si hay un segundo monitor conectado, abrirá la ventana KDS automáticamente.

**Opción B — KDS en máquina separada:**
1. Instalar el mismo `Fullsite POS Setup X.X.X.exe` en la máquina KDS
2. Crear `C:\fullsite\config.json` con:
```json
{
  "clientId": "MISMO-UUID-DEL-RESTAURANTE",
  "restaurantId": "MISMO-UUID-DEL-RESTAURANTE",
  "terminalId": "UUID-DIFERENTE-PARA-KDS",
  "instanceName": "Nombre Restaurante — KDS Cocina",
  "kds_only": true,
  "pos_server_ip": "192.168.X.X"
}
```
3. Abrir Fullsite en la máquina KDS — solo abrirá la vista KDS sin ventana POS

**Opción C — KDS en Chrome (sin Electron):**
1. Abrir Chrome en el dispositivo KDS
2. Navegar a: `https://app.fullsite.mx/pos/kds?bridge=192.168.X.X`
   (reemplazar con la IP de SERVER1)
3. Presionar F11 para pantalla completa
4. La IP queda guardada en localStorage — el `?bridge=` solo es necesario la primera vez

### Paso 8 — Configurar impresoras

1. Verificar que las impresoras tienen sus IPs estáticas configuradas y están encendidas
2. Abrir la app → en la pantalla de ajustes, usar "Prueba de impresión"
3. O via curl/navegador: `POST http://127.0.0.1:7717/test` para probar todas las estaciones
4. Si falla: verificar IP, puerto 9100 abierto, misma subred

### Paso 9 — Prueba de fingerprint (si aplica)

1. Copiar `fingerprint-service.exe` y `DPUruNet.dll` a `C:\fullsite\`
2. Conectar el lector DigitalPersona 4500 por USB
3. Reiniciar Fullsite POS — el servicio de fingerprint se levanta automáticamente
4. En el POS: Settings → Registrar huella → seguir instrucciones

### Paso 10 — Prueba de terminal bancaria (si aplica)

- **MP Point Smart:** configurar IP en el mismo segmento de red
- **Clip:** funciona por Bluetooth o internet; la terminal tiene conectividad propia

---

## 8. Checklist de validación

Ejecutar estas pruebas antes de dar de alta un restaurante.

### Pruebas de conectividad básica

- [ ] **Health check local:** abrir `http://127.0.0.1:7717/health` desde un browser en SERVER1. Debe retornar JSON con `ok: true`, `lan_ip` correcto, `clients_connected`
- [ ] **State snapshot:** `http://127.0.0.1:7717/state` retorna mesas y estado actual
- [ ] **KDS conectado:** abrir KDS → verificar que aparece en `clients` en el health check

### Pruebas de impresión

- [ ] **Ticket caja:** desde POS, enviar pedido → verificar ticket en impresora de caja
- [ ] **Comanda cocina:** enviar pedido con items de cocina → verificar comanda
- [ ] **Comanda barra:** enviar pedido con items de barra → verificar comanda en barra
- [ ] **Cajón:** cobrar en efectivo → verificar que el cajón se abre
- [ ] **Reimpresión:** desde KDS, usar botón de reimpresión → verificar que imprime

### Pruebas de POS

- [ ] Login con PIN correcto
- [ ] Login con PIN incorrecto (3 veces) → bloqueo 1 minuto
- [ ] Mapa de mesas carga correctamente
- [ ] Seleccionar mesa → entra al POS
- [ ] Agregar productos (incluyendo con modificadores)
- [ ] Eliminar producto del carrito
- [ ] Cambiar cantidad
- [ ] Agregar nota a orden
- [ ] Enviar a cocina
- [ ] Regresar al mapa y seleccionar otra mesa
- [ ] Cobrar en efectivo
- [ ] Cobrar con tarjeta
- [ ] Cobrar mixto
- [ ] Propina registrada correctamente

### Pruebas de KDS

- [ ] KDS muestra órdenes enviadas desde POS
- [ ] KDS actualiza en tiempo real al enviar desde POS (sin recargar)
- [ ] Marcar item como preparado desde KDS
- [ ] Avanzar orden: enviada → preparando → lista
- [ ] Tabs: cocina / barra / panadería funcionan y filtran correctamente

### Pruebas multi-terminal

- [ ] Abrir mesa desde Terminal 1 → mesa aparece como ocupada en Terminal 2 (en tiempo real)
- [ ] Enviar orden desde Terminal 1 → KDS la recibe inmediatamente
- [ ] Intentar abrir la misma mesa desde Terminal 2 → debe estar bloqueada / ocupada

### Pruebas offline

**IMPORTANTE:** Estas pruebas se hacen desconectando el cable de red de SERVER1 o desactivando WiFi.

- [ ] **Pantalla no cambia al desconectar** — el POS sigue mostrando el menú sin cambios visibles
- [ ] **Mapa de mesas carga** desde cache
- [ ] **Menú carga** desde IDB cache
- [ ] **PIN funciona** offline (TTL 8h desde última validación online)
- [ ] **Enviar pedido offline** → aparece "N pendientes" en OfflineIndicator
- [ ] **Impresión funciona offline** (Local Server siempre disponible)
- [ ] **KDS recibe orden offline** vía LAN WS
- [ ] **Reconectar internet** → sync automático en <30 segundos
- [ ] **Verificar en Supabase** que la orden offline llegó correctamente después del sync

### Pruebas de reinicio

- [ ] Cerrar Fullsite (Ctrl+Shift+Q) → reabrir → estado de mesas recuperado
- [ ] Reiniciar Windows → Fullsite abre automáticamente al login → estado recuperado
- [ ] Desconectar luz 5 segundos → reconectar → Fullsite abre y el turno sigue abierto

### Pruebas de turno

- [ ] Abrir turno con efectivo inicial
- [ ] Procesar varias órdenes
- [ ] Ver historial de movimientos de caja
- [ ] Cerrar turno → corte muestra totales correctos
- [ ] Nuevo turno puede abrirse correctamente

---

## 9. Estado actual

### COMPLETADO ✓

#### Service Worker (sw.js v6)
- Precachea todas las rutas POS en install
- Precachea chunks JS/CSS de Next.js (evita pantalla negra en Electron offline)
- Estrategias network-first / cache-first / stale-while-revalidate
- `offlineHTML()` inteligente: detecta cache disponible con `caches.match()`, muestra "Continuar offline" o Escenario C
- Auto-retry de red cada 10s para salir automáticamente cuando vuelve internet

#### IndexedDB (pos-offline-db, v2)
- Stores: orders, menu, inventory, sync_queue, meta, modifier_groups, modifiers, item_modifier_links, payment_methods, staff
- syncAll() con mutex (previene ejecuciones concurrentes)
- registerAutoSync() con detección real de conectividad
- cacheOrder(), getCachedOrders(), cacheMenuCategories(), getCachedMenuCategories()
- cacheModifierData(), getCachedModifierGroups(), getCachedModifiers()
- cachePaymentMethods(), cacheStaff()

#### POS principal (pos/page.tsx)
- saveOrder() devuelve OFFLINE_QUEUED → flujo idéntico al online
- prefetchOfflineData() al inicio de sesión online (precachea modificadores, métodos de pago)
- Tras OFFLINE_QUEUED: POST /events al Local Server (ORDER_SENT vía LAN)
- Navegación de regreso a /pos/plano idéntica online y offline
- Botón "← Mesas" siempre visible (no depende del estado del carrito)

#### KDS (pos/kds/page.tsx)
- fetchOrders() cae a getCachedOrders() cuando Supabase no está disponible
- BridgeClient recibe DELTA de ORDER_SENT → cachea orden en IDB local
- Registro de ?bridge=IP en primera visita
- Tabs cocina/barra/panadería con badge de órdenes

#### Cocina y Barra (pos/cocina y pos/barra)
- Mismo comportamiento offline que KDS
- Bridge host registration

#### Bridge Client (bridge-client.ts)
- Conecta en Electron (isElectron) O en cualquier browser con pos_bridge_host en localStorage
- getBridgeUrl() dinámico: usa pos_bridge_host si existe, sino 127.0.0.1
- Reconexión automática cada 3s
- PING/PONG cada 25s para detectar desconexiones

#### Local Server
- HTTP + WS en 0.0.0.0:7717
- EventStore NDJSON persistente en disco
- State machine reconstruible desde event log
- CommandHandler con idempotencia
- WsHub con ping/pong y timeout de clientes
- COMMAND_TO_EVENT para 10 tipos de operaciones
- Supabase poll cada 5s (Phase 1 bridge)
- mDNS announcement
- Heartbeat a Supabase
- Update manager

#### Electron (main.js)
- 3 reintentos progresivos antes de offline.html (POS y KDS)
- KDS window con retry logic propio
- offline.html con ?target=URL para KDS (evita loop de redirección)
- Modo kds_only para máquinas dedicadas
- Inyección de clientId y terminalId desde config.json
- Auto-inicio en Windows
- Protección contra cierre accidental (diálogo de confirmación)
- Single instance lock

#### Auth offline
- PIN cacheado en IDB con TTL de 8 horas
- Funciona offline durante turno completo sin reconexión

### EN PROGRESO ⚠️

- **KDS negro en SERVER1:** el fix está en el código (retry logic, target URL), pero falta rebuild del exe y despliegue en SERVER1

### PENDIENTE ✗

#### Operaciones offline con deuda técnica conocida

- **Turno offline:** abrir turno sin internet no está implementado. Si se cae internet antes de abrir turno, el mesero no puede iniciar el día.
- **Movimientos de caja offline:** retiros y depósitos no se encolan offline.
- **Pago completo offline:** el flujo de cobro está parcialmente implementado offline. Efectivo funciona pero falta confirmación de cierre de cuenta en IDB.
- **Inventario offline:** las páginas de inventario no tienen IDB cache. Ingredientes y recetas no están disponibles offline.
- **Modificadores offline — edge cases:** el precache de modificadores por categoría funciona pero hay edge cases con ítems que tienen modificadores de múltiples categorías.

#### Funcionalidades futuras

- Resolución de conflictos Multi-terminal (Phase 2): cuando dos terminales modifican la misma orden offline simultáneamente
- Snapshots del event log para acelerar arranque (hoy replaya todos los eventos)
- Compactación del event log (hoy crece indefinidamente)
- Observabilidad: envío de event log a Supabase para auditoría remota
- Actualizaciones automáticas del exe vía update manager (infraestructura lista, falta pipeline)

### RIESGOS CONOCIDOS

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Event log corruptido | Baja | Alto | NDJSON: corrupción de una línea no afecta las demás. Líneas malformadas se ignoran. |
| IDB corrupto | Baja | Medio | `deleteDB()` y reseed desde Supabase. Datos críticos tienen respaldo en Supabase. |
| PIN expirado offline | Media | Medio | TTL de 8h cubre turno completo. Tras 8h sin internet, PIN requiere nueva validación. |
| Impresora offline | Alta | Alto | El Local Server tiene una print queue con retry. Sin conectividad TCP, falla silenciosamente. |
| Sync queue perdida | Muy baja | Muy alto | IDB persiste entre sesiones. Solo si se borra el perfil del browser en Electron. |
| Puerto 7717 en uso | Baja | Alto | Electron detecta EADDRINUSE y loguea pero continúa (sin Local Server). Verificar con netstat. |

### DEUDA TÉCNICA

- El Supabase poll del Local Server (STATE_SYNC) ocurre cada 5s pero solo lee órdenes activas, no el estado completo. En Phase 2 esto debe eliminarse y el Local Server ser la autoridad.
- Los PIN se validan contra Supabase pero el cache no incluye roles con granularidad fina. En Phase 2 los roles deben cachearse completos.
- La sync queue no tiene un límite máximo. Una terminal desconectada por días podría acumular miles de operaciones. Agregar límite + alertas.

---

## 10. Roadmap

### Phase 1 — Operación básica offline (COMPLETADA)

**Objetivo:** el POS puede tomar órdenes y enviar a cocina sin internet.

- ✓ Service Worker con precache de app shell
- ✓ IndexedDB para menú y órdenes
- ✓ sync_queue con syncAll()
- ✓ Local Server con WS hub
- ✓ KDS recibe órdenes offline vía LAN
- ✓ Impresión siempre disponible (Local Server)
- ✓ PIN offline (TTL 8h)
- ✓ Electron con retry y offline.html inteligente

### Phase 2 — Offline completo (PRÓXIMA)

**Objetivo:** 100% de las operaciones del turno funcionan sin internet.

- [ ] **Turno offline:** abrir y cerrar turno sin Supabase. Turno se encola y sube al sincronizar.
- [ ] **Cobro completo offline:** cerrar cuenta, liberar mesa, todo con IDB + sync_queue.
- [ ] **Movimientos de caja offline:** retiros, depósitos, arqueadas se encolan.
- [ ] **Inventario cache offline:** ingredientes, existencias, kardex disponibles en IDB.
- [ ] **Deducciones offline:** al cerrar una orden, deducir ingredientes en IDB; subir al sincronizar.
- [ ] **Resolución de conflictos multi-terminal:** el Local Server es el árbitro para mesa locks y estado de órdenes.
- [ ] **Pantalla de estado offline** para administrador: "N operaciones pendientes de sincronizar".

### Phase 3 — Local Server autoritativo

**Objetivo:** el Local Server reemplaza a Supabase como escritor primario durante el turno.

- [ ] Eliminar Supabase poll del Local Server (STATE_SYNC event innecesario)
- [ ] Writes van al Local Server → sincronización a Supabase en segundo plano
- [ ] Snapshots del event log para arranque rápido (no replaya miles de eventos)
- [ ] Compactación periódica del event log
- [ ] Sincronización incremental: solo eventos no sincronizados suben a Supabase
- [ ] Observabilidad: event log a Supabase para auditoría remota y soporte

### Phase 4 — Multi-sucursal y escala

**Objetivo:** soporte para restaurantes con múltiples sucursales y flotas de terminales.

- [ ] Server ID ↔ restaurante: mapeo en Supabase para saber qué servidor pertenece a qué restaurante
- [ ] Actualizaciones automáticas: el exe se actualiza vía update manager sin intervención manual
- [ ] Dashboard de flota: health de cada instalación en tiempo real
- [ ] Multi-sucursal: una instalación por sucursal, todas sincronizando al mismo proyecto Supabase con client_id separado
- [ ] Failover: si SERVER1 cae, otra terminal puede levantar el Local Server temporalmente
- [ ] Disaster recovery: procedure documentado para restaurar desde Supabase si el disco de SERVER1 falla

---

## 11. Decisiones arquitectónicas

### ADR-001: Local Server como hub, no Supabase directo

**Decisión:** el Local Server en Electron es el punto de coordinación entre terminales, no Supabase.

**Alternativas consideradas:**
- Polling directo a Supabase desde cada terminal (Realtime channels)
- Firebase Realtime Database

**Por qué se descartaron:**
- Supabase Realtime requiere internet. Si se cae la conexión, las terminales no pueden coordinarse.
- Firebase tiene el mismo problema más vendor lock-in adicional.
- El Local Server existe siempre, independientemente de internet.

**Tradeoffs aceptados:**
- Complejidad adicional (mantener un servidor Node.js en Electron)
- Una sola máquina es el servidor primario (single point of failure dentro del restaurante, mitigado en Phase 4 con failover)

### ADR-002: WebSockets sobre HTTP polling

**Decisión:** la comunicación entre terminales usa WebSocket, no polling HTTP.

**Alternativas consideradas:**
- HTTP polling cada N segundos
- Server-Sent Events

**Por qué se descartaron:**
- HTTP polling crea latencia artificial (hasta N segundos para que la cocina vea una orden)
- SSE es unidireccional; no puede enviar comandos del KDS al servidor

**Tradeoffs aceptados:**
- Reconexiones automáticas necesarias (implementadas en BridgeClient)
- Los proxies de red a veces bloquean WS (mitigation: fallback a HTTP POST /events)

### ADR-003: Event sourcing con NDJSON

**Decisión:** el Local Server persiste eventos en un archivo NDJSON línea por línea, y reconstruye el estado en cada arranque.

**Alternativas consideradas:**
- SQLite para el event log
- Estado solo en memoria (sin persistencia)

**Por qué se descartaron:**
- SQLite requiere dependencia nativa; NDJSON es puro Node.js
- Estado solo en memoria se pierde en cada reinicio, destruyendo la garantía de resiliencia ante reinicios

**Tradeoffs aceptados:**
- El estado de arranque es O(n) en número de eventos (mitigado con snapshots en Phase 3)
- NDJSON no es transaccional (una escritura parcial puede corromper la última línea — aceptable porque la línea completa se escribe con `\n` al final, haciendo que las líneas incompletas simplemente no se parseen)

### ADR-004: IndexedDB como caché operativa del browser

**Decisión:** todos los datos que el POS necesita offline se guardan en IndexedDB del navegador.

**Alternativas consideradas:**
- LocalStorage (limitado a strings, ~5MB)
- Cache Storage del SW (solo para HTTP responses)
- SQLite via WebAssembly (sqlite.org/wasm)

**Por qué se descartaron:**
- LocalStorage: límite de tamaño, no apropiado para órdenes y menús
- Cache Storage: diseñado para cachear HTTP responses, no datos estructurados
- SQLite WASM: excelente pero significativamente más complejo; IDB es suficiente para el volumen actual

**Tradeoffs aceptados:**
- IDB tiene una API asíncrona verbosa (mitigado con wrappers en pos-offline-db.ts)
- IDB puede borrarse si el usuario limpia datos del navegador (Electron: perfil dedicado, esto no ocurre en práctica)

### ADR-005: Electron para el cliente POS, no PWA standalone

**Decisión:** el POS principal corre en Electron (Windows), no como PWA instalada.

**Alternativas consideradas:**
- PWA instalable (Chrome App)
- Electron en macOS / Linux
- App nativa Windows (UWP)

**Por qué se descartaron:**
- PWA: no puede correr el Local Server (Node.js), no puede imprimir directamente por TCP, no tiene control sobre el ciclo de vida del proceso
- macOS/Linux: los restaurantes en México usan Windows. No hay demanda de otros OS.
- UWP: ciclo de desarrollo más lento, sin acceso a Node.js ecosystem

**Tradeoffs aceptados:**
- El exe requiere distribución y actualización manual (mitigado con update manager en Phase 4)
- Electron es más pesado que una app nativa (~200MB de RAM base)

### ADR-006: Supabase queda como sincronización cloud, no como base de datos primaria

**Decisión:** en Phase 2+, las operaciones del turno no escriben a Supabase directamente — van al Local Server primero.

**Por qué es importante:**
- Un write a Supabase bajo alta latencia bloquea al mesero esperando respuesta
- Si Supabase está caído (mantenimiento, límite de plan) el restaurante no puede operar
- El Local Server procesa comandos en microsegundos (disco local vs. red)

**Tradeoffs aceptados:**
- Supabase puede quedar "detrás" del estado real del restaurante si hay muchas operaciones sin sync
- Los dashboards y reportes en tiempo real pueden mostrar datos con delay

### ADR-007: `command_id` como garantía de idempotencia

**Decisión:** cada operación lleva un UUID único que actúa como `command_id`. El Local Server y Supabase usan este ID para detectar y descartar duplicados.

**Por qué es crítico:**
- En condiciones de red inestable, un request puede enviarse dos veces (timeout + retry)
- Sin idempotencia: una orden podría crearse dos veces, un cobro aplicarse dos veces

**Implementación:**
- En el Local Server: `processed-commands.ndjson` guarda `command_id` ya procesados
- En Supabase: constraint UNIQUE en el ID de la operación (o UPSERT con `on conflict do nothing`)

### ADR-008: PIN TTL de 8 horas

**Decisión:** el PIN validado online se cachea en IDB por 8 horas.

**Alternativas consideradas:**
- 15 minutos (original)
- Sin cache (requiere internet siempre)
- 24 horas

**Por qué 8 horas:**
- Un turno típico es de 8-10 horas
- 15 minutos era insuficiente: si internet cae en medio del turno, el mesero no puede autenticarse
- 24 horas introduce riesgo de seguridad si alguien roba la terminal

**Tradeoffs aceptados:**
- Si un mesero es dado de baja, su PIN sigue siendo válido por hasta 8h en la terminal
- Mitigación: el revoke online invalida el PIN en el siguiente pull (siguiente sesión online)

---

## 12. Troubleshooting

### El POS muestra pantalla negra al abrir

**Síntomas:** Electron abre pero la ventana queda negra (no offline.html, no la app).

**Causas y soluciones:**
1. **SW sin chunks JS (más común):** el Service Worker está instalado pero no tiene los bundles de React cacheados. Conectar a internet → Ctrl+Shift+R (hard refresh en DevTools) → esperar que SW precachee → desconectar → probar offline.
2. **KDS en loop de redirección (main.js antiguo):** la ventana KDS cargaba offline.html → auto-redirigía → fallaba → loop. Fix: actualizar al exe 1.2.0+.
3. **offline.html no encontrado:** si el archivo no está en la build. Verificar que el exe incluye `offline.html`.
4. **Crash del renderer:** verificar en DevTools → Console → errores JS críticos.

### Aparece "Sin conexión" / offlineHTML pero hay internet

**Síntomas:** la URL carga la página de "Sin conexión" aunque el navegador puede acceder a otras páginas.

**Causas y soluciones:**
1. **Primera carga del dispositivo:** el SW no está instalado aún. Hacer Ctrl+Shift+R para bypassear SW y cargar desde red.
2. **SW v6 limpió cachés viejos y no ha recargado:** recargar la página una vez con internet.
3. **DNS del restaurante bloquea `app.fullsite.mx`:** probar abrir la URL en una nueva pestaña. Si no carga, el router del restaurante puede estar bloqueando el dominio de Vercel.
4. **Firewall corporativo:** algunas redes bloquean puertos no estándar o dominios de CDN. Probar con 4G/hotspot para confirmar.

**Para verificar si la página está en cache:** abrir DevTools → Application → Cache Storage → buscar la ruta en `fullsite-static-v6`.

### El Local Server no responde en 127.0.0.1:7717

**Síntomas:** fetch a `http://127.0.0.1:7717/health` falla o no responde.

**Causas y soluciones:**
1. **Puerto en uso por otro proceso:** en CMD: `netstat -ano | findstr :7717`. Si hay otro proceso usando el puerto, identificarlo y cerrarlo.
2. **Fullsite POS no está corriendo:** el Local Server solo existe mientras Electron esté abierto.
3. **Error en startLocalServer:** revisar logs del proceso Electron. En desarrollo: abrir DevTools del proceso principal. En producción: logs en `%APPDATA%\fullsite-pos\logs\`.
4. **Firewall de Windows bloqueando el puerto:** agregar regla de entrada para el puerto 7717 en el Firewall de Windows.

### Impresión falla

**Síntomas:** órdenes enviadas pero no se imprimen comandas.

**Diagnóstico:**
```
GET http://127.0.0.1:7717/health
```
Ver campo `print_jobs_failed` y `stations`.

**Soluciones por tipo:**
- **TCP (cocina/barra):** verificar que la impresora tiene la IP correcta y está encendida. `ping 192.168.X.X` desde CMD. El puerto 9100 debe estar abierto: `telnet 192.168.X.X 9100`.
- **USB (caja):** verificar que el nombre en printers.json coincide exactamente con el nombre en Dispositivos e Impresoras de Windows. El driver de la impresora debe estar instalado.
- **Papel:** verificar que hay papel. Algunas impresoras retornan error de status cuando se queda sin papel.

```
POST http://127.0.0.1:7717/test
```
Prueba todas las estaciones y retorna qué pasó en cada una.

### WebSocket desconectado (BridgeClient no conecta)

**Síntomas:** KDS no recibe órdenes en tiempo real. `useBridgeClient` retorna `connected: false`.

**Diagnóstico:**
1. Verificar que el Local Server está corriendo: `http://127.0.0.1:7717/health`
2. Verificar que `pos_bridge_host` en localStorage del KDS tiene la IP correcta
3. Intentar `ws://IP:7717/ws` manualmente con una herramienta WS

**Soluciones:**
- Si KDS es en Chrome: navegar a `https://app.fullsite.mx/pos/kds?bridge=IP-CORRECTA` para actualizar el host registrado
- Si KDS es en Electron: verificar `pos_server_ip` en `config.json`
- Verificar que el firewall de Windows en SERVER1 permite conexiones entrantes al puerto 7717 desde la LAN

### Sync queue creciendo (N pedidos pendientes)

**Síntomas:** el OfflineIndicator muestra muchos pendientes. No se sincroniza aunque hay internet.

**Diagnóstico:**
1. Abrir DevTools → Application → IndexedDB → fullsite-pos-v2 → sync_queue
2. Ver los items pendientes y sus campos `attempts` y `last_error`

**Soluciones:**
- Si `last_error` indica auth/permisos: el token puede haber expirado. Recargar la app (re-autenticará y obtendrá nuevo token).
- Si Supabase retorna 409: conflicto de ID — investigar si hay duplicados en la BD.
- Si hay muchos items con `attempts > 10`: usar el botón "Limpiar cola" (solo como último recurso — los datos se perderán localmente aunque ya estén en Supabase).

### Fingerprint no funciona

**Síntomas:** el lector no responde o da error al registrar/verificar huella.

**Checklist:**
1. Verificar que `fingerprint-service.exe` y `DPUruNet.dll` están en `C:\fullsite\`
2. Verificar que el servicio está corriendo: `http://127.0.0.1:7718/health`
3. El lector DigitalPersona 4500 debe aparecer en Administrador de dispositivos sin errores
4. Si el servicio crashea repetidamente (max 5 intentos): reiniciar Fullsite POS
5. En algunos Windows: ejecutar Fullsite POS como Administrador para que el fingerprint service tenga acceso al hardware

### IndexedDB corrupto o desactualizado

**Síntomas:** menú desactualizado, órdenes que no aparecen, errores "Failed to read from IDB".

**Solución de emergencia:**
1. En DevTools → Application → IndexedDB → clic derecho en `fullsite-pos-v2` → Delete database
2. Recargar la app con internet
3. La app reiniciará el IDB con datos frescos de Supabase

**Nota:** la sync_queue también se borra. Si hay operaciones pendientes, subirlas manualmente a Supabase antes de borrar el IDB.

---

## 13. Lecciones aprendidas en AMALAY

### Lección 1: "Offline support" vs "local-first" son cosas fundamentalmente distintas

Empezamos pensando en el offline como un fallback. "Si se cae internet, que funcione lo básico." Eso produjo una arquitectura donde el online path era el principal y el offline un parche encima.

El cambio de mentalidad fue: **el dato vive aquí, en esta máquina. Supabase es una copia.** Con ese framing, el diseño correcto emerge naturalmente: escribe local primero, sincroniza después.

### Lección 2: El Service Worker y Electron tienen ciclos de vida distintos

El SW en Electron usa el mismo motor Chromium, pero su ciclo de activación es diferente a Chrome en una computadora normal. En Electron, el SW puede no estar activo en el primer frame después del boot. Esto causó pantallas negras persistentes al arrancar offline.

La solución: darle tiempo al SW con reintentos progresivos (800ms, 1600ms, 2400ms) antes de capitular al offline.html. En la práctica, el SW se activa en el retry 2 o 3.

### Lección 3: Las rutas del Service Worker deben incluir TODOS los bundles JS

Next.js genera bundles distintos en cada deploy. Si el SW cachea el HTML de `/pos` pero no sus bundles JS, offline muestra un HTML vacío (pantalla negra). La solución fue parsear el HTML cacheado para extraer todas las URLs `/_next/static/` y precachearlas también durante el install del SW.

### Lección 4: Un loop de redirección offline es indistinguible de una pantalla negra

El bug del KDS: offline.html detectaba el bridge local → auto-redirigía a la URL del POS → esa URL fallaba → did-fail-load → offline.html de nuevo → loop. El resultado visible: pantalla negra parpadeante o estática.

La solución tiene dos partes: (1) verificar con `caches.match()` que el URL está en cache antes de auto-redirigir, y (2) pasar el URL correcto como `?target=` para que el KDS no intente ir a `/pos` cuando debería ir a `/pos/kds`.

### Lección 5: El TTL del PIN debe cubrir un turno completo

El PIN con TTL de 15 minutos era correcto para seguridad pero catastrófico para operación offline. Si internet se caía en el turno del mediodía, a las 4pm el mesero no podía autenticarse.

Lección: los parámetros de seguridad que dependen de conectividad deben ajustarse para que un turno completo (8h) funcione sin conexión. Siempre.

### Lección 6: "Tiene internet" no significa "puede llegar a app.fullsite.mx"

En redes de restaurantes hay firewalls, proxies y configuraciones DNS que bloquean ciertos dominios. Un dispositivo puede hacer ping a Google y no poder llegar a Vercel.

La detección de conectividad debe ser positiva (fetch real a un endpoint conocido), no negativa (navigator.onLine que solo verifica si hay interfaz de red activa).

### Lección 7: El KDS no necesita su propio proceso — puede usar el mismo Electron con una ventana adicional

Consideramos un proceso Electron separado para el KDS. Resulta que `kds: true` en config.json abre una segunda ventana BrowserWindow en el mismo proceso, con una preload diferente (`preload-kds.js`), y ambas ventanas comparten la sesión de Chromium (mismo IDB, mismo SW).

Esto simplifica la distribución enormemente: un solo instalador para todo.

### Lección 8: El Local Server debe iniciar antes que cualquier ventana Electron

El orden importa: si la ventana POS abre antes que el Local Server esté escuchando en :7717, la app intenta conectar el WS y falla. Con el servidor iniciado primero, la app siempre encuentra el bridge disponible desde el primer frame.

### Lección 9: NDJSON para el event log, no SQLite

SQLite tiene dependencias nativas que complican el build de Electron para Windows. NDJSON es plain text, sin dependencias, y suficientemente robusto para el volumen de un restaurante (<1000 eventos por turno). La única limitación es que no es transaccional, pero como cada evento es una línea completa con `\n` al final, las escrituras parciales solo corrompen la última línea (ignorada al parsear).

### Lección 10: Los datos del menú deben precachearse en la primera sesión online, no en el primer acceso offline

Implementamos `prefetchOfflineData()` que se llama al inicio de cada sesión online. Precachea modificadores, métodos de pago y staff a IDB antes de que el usuario los necesite offline. 

El error anterior: intentar cargarlos solo cuando fallaba el fetch de Supabase, pero el fallback de IDB retornaba vacío porque nunca se habían cacheado.

### Lección 11: Las pruebas offline deben hacerse desconectando físicamente el cable de red, no solo "desactivando wifi"

En algunos laptops y configuraciones, desactivar WiFi en Windows no afecta todas las interfaces. El cable de red o el modo avión dan un offline limpio y reproducible para pruebas.

---

## 14. Runbook operativo

### Si se cae internet durante el turno

**Acción inmediata:** ninguna. El restaurante debe seguir operando sin interrupciones.

**Verificar:**
1. El POS muestra el OfflineIndicator en rojo ("Offline")
2. Los pedidos se pueden tomar y enviar normalmente
3. La impresión funciona (Local Server siempre disponible)
4. El KDS recibe órdenes (LAN WS, no requiere internet)

**Cuando vuelve internet:**
1. El sync automático ocurre en <30 segundos
2. El OfflineIndicator muestra "N sincronizando..." y luego vuelve a verde
3. Verificar en Supabase que las órdenes del periodo offline están presentes

**Si no sincroniza solo:**
- Ir a Settings → Sincronización → Sincronizar ahora
- Si falla: revisar sync_queue en DevTools → IDB

### Si el Local Server cae (7717 no responde)

**Síntomas:** impresión falla, KDS no recibe órdenes en tiempo real, OfflineIndicator no muestra bridge conectado.

**Acciones:**
1. Verificar que el proceso `Fullsite POS` (Electron) está corriendo en Task Manager
2. Si el proceso está pero el puerto 7717 no responde: hay un error en el Local Server
3. Cerrar y reabrir Fullsite POS (Ctrl+Shift+Q → volver a abrir)
4. El Local Server se levanta automáticamente al abrir el exe

**Mientras el Local Server está caído:**
- El POS sigue funcionando (IDB, Supabase directamente)
- La impresión falla — usar tickets manuales como contingencia
- El KDS no recibe updates en tiempo real — el cocinero debe preguntar al mesero

### Si falla una impresora

**Cocina/Barra (TCP):**
1. Verificar que la impresora está encendida y tiene papel
2. Verificar conectividad de red: `ping 192.168.X.X` desde CMD
3. Reiniciar la impresora
4. Si la IP cambió: actualizar `C:\fullsite\printers.json` y reiniciar Fullsite

**Caja (USB):**
1. Verificar que el cable USB está conectado
2. El nombre en printers.json debe coincidir con el nombre en Dispositivos e Impresoras
3. Reiniciar la impresora y volver a conectar el USB
4. Como contingencia: usar impresión por WiFi si la impresora tiene esa capacidad

**Contingencia general:**
- Anotar órdenes manualmente
- Imprimir comanda en cualquier otra impresora disponible con función de reimpresión

### Si falla el fingerprint

**Acción inmediata:** usar PIN — el fingerprint es una alternativa, no el único método.

**Para restaurar fingerprint:**
1. Verificar que el exe y la DLL están en `C:\fullsite\`
2. Desconectar y reconectar el lector USB
3. Reiniciar Fullsite POS
4. Si continúa fallando: desinstalar y reinstalar el driver del lector

### Si falla una terminal POS (no SERVER1)

**Acción inmediata:** usar otra terminal POS o SERVER1 para tomar órdenes.

**Para restaurar la terminal:**
1. Si la terminal es Chrome: navegar a `https://app.fullsite.mx/pos` y recargar
2. Si la terminal es Electron: cerrar y volver a abrir
3. Si hay sync_queue pendiente en la terminal caída: al volver a conectar, sincroniza automáticamente

### Si falla la sincronización persistentemente

**Diagnóstico:**
1. Abrir DevTools → IDB → sync_queue
2. Ver el campo `last_error` de los items fallidos
3. Ver el campo `attempts`

**Acciones según error:**
- **Auth error:** el token expiró. Cerrar sesión → volver a entrar → reintenta sync
- **409 Conflict:** ya existe en Supabase. Probablemente sincronizado por otra terminal. Marcar como synced manualmente o limpiar cola
- **Network error:** aún no hay internet. Esperar.
- **500 Supabase:** problema en el servidor remoto. Esperar a que se resuelva. Los datos están seguros en IDB.

---

## 15. Estrategia de escala

### De 1 a 10 restaurantes

- Cada restaurante tiene su propio `clientId` en Supabase (row-level security separa todos los datos)
- Un instalador único (`Fullsite POS Setup X.X.X.exe`) — solo cambia `config.json`
- El update manager notifica cuando hay nueva versión disponible
- Soporte vía TeamViewer o acceso remoto — no se necesita ir físicamente para la mayoría de issues

### De 10 a 100 restaurantes

- **Automatizar onboarding:** script que crea el `clientId` en Supabase, genera `config.json` y `printers.json` y los entrega listos para instalar
- **Dashboard de flota:** heartbeat ya envía métricas a `agent_runs` — agregar vista de salud de todas las instalaciones
- **Alertas proactivas:** si heartbeat no llega en 24h (wansoft-staleness pattern) → alerta por Telegram al equipo de soporte
- **Update pipeline:** el update manager (ya implementado) puede distribuir actualizaciones automáticamente al canal `pilot` primero, luego `stable`
- **Documentación de clientes:** cada restaurante tiene su página en el CRM con: IP del servidor, versión del exe, última sincronización

### De 100 a 500 restaurantes

- **Separar el build por restaurante empieza a no escalar** — mover toda la config al servidor remoto. Al arrancar, el exe descarga su config desde Supabase usando solo el restaurantId hardcodeado
- **Multi-región Supabase:** restaurantes en distintas ciudades pueden beneficiarse de proyectos Supabase más cercanos (Supabase tiene regiones en US, EU, SA)
- **Soporte tier 1/2:** documentación de troubleshooting (este documento) permite que personal no técnico resuelva el 80% de issues
- **Monitoreo centralizado:** agregar Sentry o similar para capturar errores del renderer Electron y el Local Server

### De 500 a 1000+ restaurantes

- El Local Server es idéntico en todos los restaurantes — la única diferencia es `restaurantId` y `config.json`
- **El modelo de distribución no cambia:** un exe que se instala igual en restaurante 1 y en restaurante 1000
- **Supabase escala horizontalmente** — el modelo multi-tenant con `client_id` en RLS soporta miles de restaurantes en el mismo proyecto
- **Lo que sí cambia:** el equipo de soporte necesita herramientas de gestión de flota (dashboard de salud, actualizaciones por segmento, A/B de features por canal)
- **Potencial cuello de botella:** el Local Server hoy es un proceso único. Para restaurantes con 20+ terminales simultáneas, revisar el WsHub y el event log para asegurar que no hay bloqueos.

### Invariantes que no cambian a ninguna escala

1. Cada restaurante tiene exactamente un Local Server (en Phase 4 habrá failover, pero sigue siendo un primario)
2. El `clientId` separa todos los datos — la arquitectura multi-tenant está desde el día 1
3. El exe de Electron es el mismo para todos — configuración vía `config.json`
4. La app web (`app.fullsite.mx`) es la misma para todos los restaurantes — Vercel la sirve globalmente
5. La sincronización es eventual — los dashboards pueden mostrar datos con delay de segundos, no de días

---

*Última actualización: 2026-07-27*  
*Implementación de referencia: AMALAY — Monterrey, MX*  
*Próxima revisión: al completar Phase 2 (offline completo)*
