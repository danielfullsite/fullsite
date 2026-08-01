# FULLSITE RUNTIME — ESPECIFICACIÓN DE COMPONENTE
> Versión: 1.1
> Fecha: 2026-07-24
> Estado: BORRADOR — pendiente aprobación de Daniel Ramonfaur
> Clasificación: Especificación de producto. No es un RFC de migración.
> Referencia: P0-4-LOCAL-FIRST-RFC.md, WANSOFT ARCHITECTURE.md § 15

---

## 0. Objetivos de diseño

Principios arquitectónicos no negociables. Ninguna decisión de implementación puede violarlos.

| # | Principio | Consecuencia si se viola |
|---|---|---|
| P1 | **La operación del restaurante no depende de internet.** POS, KDS, impresión y autorizaciones funcionan en LAN sin conexión externa. | El restaurante deja de vender cuando cae internet — pérdida directa de ingresos. |
| P2 | **La nube es sincronización y servicios remotos, no el bus operativo.** Supabase y Vercel reciben eventos; no los generan ni los bloquean. | Un corte de Supabase para el restaurante. Inaceptable. |
| P3 | **La plataforma es instalable en cualquier sucursal sin cambios de código.** Toda diferencia entre sucursales se expresa en configuración (`C:\fullsite\runtime.json`, tabla `clients`). | Cada sucursal requiere un deploy personalizado. No escala a 500. |
| P4 | **Toda migración es incremental, observable y reversible.** Ningún flag activa comportamiento que no pueda desactivarse en < 30 segundos. | Un error en producción requiere rollback completo en lugar de un toggle. |
| P5 | **Los contratos son compartidos entre Runtime, POS, KDS y Cloud.** Un cambio de contrato requiere versionado explícito y período de compatibilidad. | Un deploy desincroniza terminales de diferentes versiones. |
| P6 | **El Runtime no contiene lógica de negocio.** Las reglas de descuento, inventario, permisos y financieras pertenecen al POS o a la nube. | El Runtime se convierte en un segundo lugar donde se define el negocio — inconsistencias garantizadas. |
| P7 | **El Runtime es stateless entre reinicios salvo lo que está en SQLite.** No hay estado en memoria que no pueda reconstruirse desde el store local o desde Supabase. | Un reinicio del Electron destruye estado operativo — órdenes perdidas. |
| P8 | **La Caja es el coordinador local. Las demás terminales son clientes.** Un restaurante tiene un Runtime (en la Caja). El resto de la red lo consume. | Múltiples Runtimes en la misma red compiten por ser fuente de verdad. |

---

## 1. Responsabilidad del Runtime

### 1.1 Qué hace

El Fullsite Runtime es el coordinador local de una sucursal. Corre en la terminal Caja como servidor HTTP en `0.0.0.0:7717`. Hace cuatro cosas:

**1. Puerta de hardware local**
Abstrae la comunicación con impresoras térmicas (TCP/USB), el cajón de dinero (ESC/POS), y el lector de huellas digitales (proxy a servicio nativo). El POS y el KDS nunca hablan directamente con el hardware — solo hablan con el Runtime.

**2. Runtime Event Bus**
Distribuye eventos de órdenes (nueva orden, avance de estado, cancelación) a todas las terminales conectadas en la LAN. La implementación inicial usa SSE (Server-Sent Events) por simplicidad y compatibilidad con browsers, pero el mecanismo de transporte es una decisión de implementación: puede evolucionar a WebSockets, gRPC u otro protocolo sin modificar esta especificación. Lo que esta especificación garantiza es la capacidad, no el protocolo.

**3. Caché local con autoridad temporal**
Mantiene en SQLite un estado local de órdenes activas, catálogo, staff y configuración. Durante un episodio offline, SQLite actúa como la fuente de verdad operativa temporal de la sucursal. Al restablecer conectividad, el Runtime sincroniza con Supabase según las reglas de autoridad definidas por dominio en §3.3. Supabase permanece como la fuente de verdad permanente para todos los dominios que la especifican como autoritativos. En modo online, SQLite es un espejo con lag < 2s respecto a Supabase.

**4. Cola de sincronización con la nube**
Recibe operaciones de escritura (crear orden, cerrar orden, logear evento de auditoría), las aplica localmente de inmediato, y las encola para sincronización diferida con Supabase cuando hay internet.

### 1.2 Qué explícitamente NO hace

| Fuera de alcance | Por qué | Quién lo hace |
|---|---|---|
| Lógica de descuentos, recetas, inventario | Lógica de negocio — pertenece al POS | `saveOrder()` en `pos-data.ts` |
| Reconciliación financiera del corte | Cálculo autoritativo — pertenece a Supabase | `r1_save_order_idempotent` RPC |
| Renderizado de pantallas o UI | Responsabilidad del frontend Next.js | Dashboard App / POS |
| Autenticación de sesión Supabase | Auth de usuarios del dashboard — no del operador del POS | Supabase Auth |
| Emisión de CFDIs | Requiere internet y CSD — servicio externo | Facturama API + cola IDB existente |
| Enrutamiento de pagos con terminal bancaria | Protocolo propietario por proveedor | Clip / NetPay / OEL (futuro) |
| Multitenancy cross-sucursal | Cada Runtime solo conoce su `client_id` | Supabase + Dashboard |
| Backups o snapshots de la BD | Responsabilidad del sistema operativo o de Supabase | `pg_dump` / Supabase backups |
| Logs de seguridad de red | Responsabilidad del firewall / router | Red de la sucursal |
| Alta disponibilidad o failover automático | v1 no implementa HA — ver §1.3 | v2 (roadmap) |

### 1.3 Límites explícitos de Runtime v1

Runtime v1 no implementa alta disponibilidad ni failover automático. Un restaurante opera con un único Runtime en la Caja. Si la Caja deja de operar — por corte de luz, fallo de hardware, o reinicio prolongado — la sucursal entra en modo degradado: el POS y el KDS pierden coordinación local y deben operar contra Supabase directamente o esperar la recuperación del Runtime. Ver §5.9 para el comportamiento exacto en este escenario.

Esta limitación es intencional en v1. Diseñar HA prematuramente añade complejidad que no está justificada mientras la plataforma valida en campo. El diseño de v2 (HA activo/pasivo con Caja de respaldo) está en el roadmap pero fuera del alcance de esta especificación.

---

## 2. Interfaces públicas

### 2.1 HTTP REST — puerto 7717

El Runtime expone un servidor HTTP en `0.0.0.0:7717`. La IP pública en la LAN es la IP de la Caja (ej. `192.168.1.71`).

**Versioning:** Todas las rutas nuevas (post-v0) se versionan con prefijo `/v1/`. Las rutas heredadas del bridge original (`/health`, `/print`, `/drawer`, `/test`, `/config`, `/fp/*`) se mantienen sin prefijo por compatibilidad.

#### Rutas heredadas del bridge (v0 — sin prefijo)

```
GET  /health
  → { ok: bool, hostname: str, stations: [...], runtime_version: str,
      supabase_reachable: bool|null, sync_queue_pending: int,
      last_boot_at: ISO8601 }

POST /print
  ← { station?: str, data: base64 }
  → { ok: bool, station: str, bytes: int } | { error: str }

POST /drawer
  → { ok: bool } | { error: str }

POST /test
  → { ok: bool, results: { [station]: 'ok'|error_str } }

GET  /config
  → { stations: StationMap, configPath: str, fromFile: bool }

POST /config
  ← { stations: StationMap }
  → { ok: bool, stations: StationMap }

/fp/*
  → proxy transparente a http://127.0.0.1:7718{path}
```

#### Rutas nuevas (v1 — detrás de feature flag)

```
GET  /v1/status
  → {
      runtime_version: str,
      client_id: str,
      online: bool,
      sync_queue: { pending: int, oldest_age_s: int, last_sync_at: ISO8601 },
      active_orders: int,
      connected_terminals: int,
      uptime_s: int
    }

GET  /v1/orders
  ?status=in.(enviada,preparando,lista)
  &client_id=eq.{id}
  &created_at=gte.{ISO8601}
  → Order[]    (mismo contrato que Supabase REST /pos_orders)

PATCH /v1/orders/:id
  ← { status: str, ... }
  → { ok: bool, order: Order }

GET  /v1/events
  Content-Type: text/event-stream      ← implementación inicial (SSE)
  → Event Bus stream:
      event: order_created   data: { order_id, mesa, status, ... }
      event: order_updated   data: { order_id, status, updated_fields }
      event: order_closed    data: { order_id, closed_at }
      event: ping            data: { ts: ISO8601 }   (cada 30s keepalive)
  Nota: la ruta /v1/events es el contrato estable. El Content-Type y el
        protocolo de transporte (SSE hoy) son detalles de implementación
        que pueden cambiar en una minor version.

POST /v1/api/pos/save-order
  ← (mismo body que /api/pos/save-order en Vercel)
  → (mismo response contract que SaveResult)
  Nota: cuando online, el Runtime hace proxy a Vercel y cachea localmente.
        cuando offline, escribe a SQLite y encola para sync posterior.

POST /v1/api/pos/pin
  ← { pin, client_id, min_role?, manager?, fingerprint_id? }
  → { staff: { id, name, role } } | { error: str }
  Nota: verifica contra SQLite local (tabla staff). Sin TTL cuando offline.
        Rate limit: 5 intentos / 300s por terminal_id (no por IP).

GET  /v1/sync/status
  → { pending: SyncQueueItem[], last_sync_at: ISO8601, errors: SyncError[] }

POST /v1/sync/force
  → { ok: bool, synced: int, errors: int }

GET  /v1/catalog
  → { categories: MenuCategory[], items: MenuItem[], modifiers: [...] }

GET  /v1/staff
  → { staff: StaffMember[] }
  Solo accesible desde 127.0.0.1 (no expuesto a LAN).
```

### 2.2 Versionado de contratos

| Versión | Estado | Soporte mínimo hasta |
|---|---|---|
| v0 (bridge heredado) | Estable — no deprecar | Indefinido |
| v1 | En desarrollo — no usar en producción hasta Fase 2 | — |

Regla: el POS y el KDS deben poder funcionar con un Runtime que tenga exactamente una versión menor más antigua. El campo `runtime_version` en `/health` permite al cliente detectar si el Runtime soporta las rutas que necesita.

### 2.3 Contratos compartidos

Los contratos del Runtime son un subconjunto estricto de los contratos de Supabase. Cualquier campo que exista en Supabase pero no en el Runtime es transparente — el Runtime lo pasa sin modificar. Nunca al revés: el Runtime no puede inventar campos que no existan en Supabase.

Contratos que el Runtime DEBE respetar sin modificación:
- `Order` shape completo (`order_id`, `mesa`, `status`, `items`, `pagos`, `turno_id`, etc.)
- `SaveResult` response shape
- `StaffMember` shape (`id`, `name`, `role`, `pin`)
- `SyncQueueItem` con campos `error_class`, `retries`, `save_operation_id`

---

## 3. Persistencia

### 3.1 Archivo de configuración local

`C:\fullsite\runtime.json` — leído en boot, recargable en caliente via `POST /config`.

```json
{
  "client_id": "amalay",
  "runtime_version": "1.0",
  "feature_flags": {
    "local_runtime.shadow_mode": false,
    "local_runtime.lan_listen": false,
    "kds.read_from_local": false,
    "pos.dual_write": false
  },
  "printers": {
    "cocina": { "type": "tcp", "host": "192.168.1.21", "port": 9100 },
    "barra":  { "type": "tcp", "host": "192.168.1.30", "port": 9100 },
    "caja":   { "type": "usb", "names": ["TICKET", "EC01"] }
  }
}
```

### 3.2 Base de datos local — SQLite

Archivo: `C:\fullsite\runtime.db`
Driver: `better-sqlite3` (síncrono, sin dependencias nativas adicionales en Electron)

#### Tablas

```sql
-- Órdenes activas — espejo de pos_orders (últimas 24h)
CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  mesa         INTEGER,
  status       TEXT NOT NULL,
  mesero       TEXT,
  turno_id     TEXT,
  items        TEXT,           -- JSON
  pagos        TEXT,           -- JSON
  total        REAL,
  closed_at    TEXT,
  comanda_batches   TEXT,      -- JSON
  kds_item_status   TEXT,      -- JSON
  supabase_revision INTEGER,
  local_updated_at  TEXT NOT NULL,
  synced            INTEGER DEFAULT 0
);

-- Staff local — espejo de pos_staff (se refresca al conectar)
CREATE TABLE IF NOT EXISTS staff (
  id        TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name      TEXT NOT NULL,
  pin_hash  TEXT NOT NULL,    -- bcrypt hash del PIN
  role      TEXT NOT NULL,
  active    INTEGER DEFAULT 1,
  synced_at TEXT NOT NULL
);

-- Catálogo — espejo de pos_menu_categories + pos_menu_items
CREATE TABLE IF NOT EXISTS catalog (
  entity_type TEXT NOT NULL,  -- 'category' | 'item' | 'modifier'
  id          TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  data        TEXT NOT NULL,  -- JSON del objeto completo
  synced_at   TEXT NOT NULL,
  PRIMARY KEY (entity_type, id)
);

-- Cola de sincronización — espejo de sync_queue IDB
CREATE TABLE IF NOT EXISTS sync_queue (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  method       TEXT NOT NULL,
  data         TEXT NOT NULL,  -- JSON
  transport    TEXT NOT NULL,  -- 'APP_API' | 'SUPABASE_REST'
  created_at   TEXT NOT NULL,
  retries      INTEGER DEFAULT 0,
  error_class  TEXT,
  error_detail TEXT,
  synced       INTEGER DEFAULT 0
);

-- Terminales conectadas (para health y diagnóstico)
CREATE TABLE IF NOT EXISTS terminals (
  terminal_id  TEXT PRIMARY KEY,
  hostname     TEXT,
  role         TEXT,           -- 'pos' | 'kds' | 'cocina' | 'barra'
  last_seen_at TEXT NOT NULL,
  ip           TEXT
);

-- Métricas de telemetría
CREATE TABLE IF NOT EXISTS telemetry (
  id         TEXT PRIMARY KEY,
  metric     TEXT NOT NULL,
  value      REAL,
  labels     TEXT,             -- JSON
  recorded_at TEXT NOT NULL
);
```

### 3.3 Sistema autoritativo por dominio

SQLite nunca reemplaza a Supabase como fuente permanente de verdad. La columna "Sistema autoritativo" indica quién tiene la última palabra cuando hay discrepancia. El Runtime aplica este orden en cada reconexión.

| Dominio | Sistema autoritativo | Runtime hace qué |
|---|---|---|
| Revisiones de órdenes (`order_revision`) | **Supabase** — solo el RPC puede incrementarlo | Cachea la última revisión conocida; no genera revisiones |
| Totales financieros del corte | **Supabase** — `r1_save_order_idempotent` + reconciliación | Réplica local de totales; no recalcula |
| Definición de staff y PINs | **Supabase** (`pos_staff`) | Cachea localmente para verificación offline; no crea ni modifica |
| Configuración de hardware | **Runtime** (`C:\fullsite\runtime.json`) | Es la única fuente — Supabase no conoce las IPs de impresoras |
| Eventos de impresión | **Runtime** | Supabase nunca ve estos eventos — no hay tabla de print_jobs |
| Cola de sync pendiente | **Runtime** (SQLite `sync_queue`) | Supabase solo ve los items después de sync exitoso |
| Catálogo activo (menú) | **Supabase** (`pos_menu_*`) | Runtime cachea; refresh al conectar y cada 4 horas |
| Órdenes activas (últimas 24h) | **Supabase** (`pos_orders`) | SQLite es fuente temporal durante episodio offline; se reconcilia al reconectar |
| Audit log | **Supabase** (`pos_audit_log`) | Runtime encola y replica; no elimina ni modifica entradas |

---

## 4. Ciclo de vida

### 4.1 Boot

```
1. Electron main.js inicia
2. loadConfig() — lee C:\fullsite\runtime.json
   Si no existe: usa defaults y crea el archivo
3. openDatabase() — abre/crea C:\fullsite\runtime.db
   Si la versión del schema es antigua: migra automáticamente (WAL journal)
4. startFingerprintService() — spawn fingerprint-service.exe en 7718
5. startRuntime() — HTTP server en HOST:7717
   HOST = '0.0.0.0' si flag local_runtime.lan_listen activo
   HOST = '127.0.0.1' si flag desactivado (modo compatibilidad)
6. createWindow() — abre WebView con POS_URL
7. scheduleSync() — inicia daemon de sincronización (cada 30s si online)
8. rehydrate() — carga órdenes activas de SQLite al estado en memoria
```

Si `C:\fullsite\runtime.db` no existe o está corrupto: el Runtime arranca sin estado local. El POS y KDS funcionan contra Supabase como si el Runtime no existiera (modo degradado transparente).

### 4.2 Descubrimiento

Las terminales KDS y PDV necesitan saber la IP del Runtime. Estrategia:

1. **Config estática** (MVP): `C:\fullsite\client.json` en cada terminal incluye `runtime_ip`. Se configura una vez al instalar.
2. **DNS local** (Fase 2): El router de la sucursal puede asignar un hostname fijo a la Caja via DHCP reservation. La terminal consulta `fullsite-runtime.local`.
3. **mDNS** (Fase 3, opcional): El Runtime publica `_fullsite._tcp.local`. Las terminales descubren automáticamente sin config.

**Regla:** La Caja DEBE tener IP estática configurada en el router (DHCP reservation por MAC address). Esto es un requisito de instalación, no un comportamiento del Runtime.

### 4.3 Operación online

```
POS/KDS ─── POST /v1/api/pos/save-order ──► Runtime
                                                │
                                    ┌───────────┴───────────┐
                                    ▼                       ▼
                              SQLite local           POST /api/pos/save-order
                              (inmediato)            en Vercel (async)
                                    │
                                    ▼
                            Event Bus /v1/events
                            ────────────────────►  KDS conectados
```

En operación online, el Runtime actúa como proxy inteligente: escribe localmente de inmediato (para respuesta rápida al POS) y propaga a Supabase en el mismo ciclo o en el siguiente (< 2s lag).

### 4.4 Operación offline

```
POS ─── POST /v1/api/pos/save-order ──► Runtime
                                            │
                                    SQLite local (inmediato)
                                    sync_queue (INSERT)
                                            │
                                            ▼
                                    Event Bus /v1/events
                                    ────────────────────►  KDS (LAN, funciona)

Supabase: no alcanzable — los datos llegarán al reconectar
```

El POS recibe `{ ok: true }` en < 100ms aunque Supabase no sea alcanzable. El Runtime garantiza que la orden llegará a Supabase al reconectar. Si hay conflicto al reconectar, el Runtime emite `pos-order-synced` con `conflict: true` para que el POS muestre la alerta correspondiente.

**El POS no necesita saber si está online o offline.** Su contrato con el Runtime es el mismo en ambos casos.

### 4.5 Reconexión

```
1. Runtime detecta internet via DNS probe cada 10s
2. Al detectar conectividad:
   a. scheduleImmediateSync() — procesa sync_queue en orden FIFO
   b. refreshCatalog() — descarga cambios de catálogo desde Supabase
   c. refreshStaff() — descarga cambios de staff desde Supabase
   d. emitEvent('runtime:reconnected', { pending_synced: N })
3. Durante sync:
   - Ítems TRANSIENT_RETRYABLE: reintento inmediato
   - Ítems STALE_WRITE_CONFLICT: NO se reintentan → notificación al POS
   - Ítems TERMINAL_NON_RETRYABLE: descartados, log en telemetría
4. Después de sync: emitEvent('runtime:sync_complete', { synced: N, errors: M })
```

**Idempotencia:** Todos los ítems de sync tienen `save_operation_id`. Si Supabase ya procesó el ítem (por ejemplo, porque la conexión se cortó después de que el servidor recibió la request pero antes de que el Runtime recibiera la respuesta), el RPC detecta el replay y responde `{ idempotent_replay: true }` — el Runtime lo marca como synced sin error.

### 4.6 Recovery

**Escenario: Runtime reiniciado mientras hay operación activa**
1. Boot normal (ver §4.1)
2. `rehydrate()` carga órdenes de SQLite — ninguna orden se pierde
3. Los clientes del Event Bus reconectan automáticamente (el protocolo SSE incluye reconexión built-in)
4. Órdenes en sync_queue pendientes se procesan en el siguiente ciclo

**Escenario: SQLite corrupto**
1. Runtime detecta en boot que `PRAGMA integrity_check` falla
2. Intenta restaurar desde el WAL journal
3. Si falla: renombra el archivo (`.corrupted.{timestamp}`) y crea uno nuevo vacío
4. Log de `runtime.recovery` en telemetría
5. Rehydration desde Supabase al primer sync exitoso

**Escenario: Caja apagada sin shutdown limpio**
1. SQLite WAL garantiza que no hay transacciones incompletas en el archivo
2. El próximo boot completa el WAL pendiente automáticamente

### 4.7 Shutdown

```
Electron app.on('will-quit'):
1. Cerrar conexiones del Event Bus — emitir señal de cierre a todos los clientes
2. Flush sync_queue — un intento de sync final si hay internet
3. bridgeServer.close()
4. fingerprintProcess.kill()
5. database.close()   — WAL checkpoint
```

---

## 5. Modelo de fallos

Esta sección es la referencia para QA y certificación. Para cada escenario se especifica el comportamiento esperado, qué continúa funcionando, qué se degrada, cómo se recupera y qué alerta se genera.

### 5.1 Caída de internet

| Campo | Detalle |
|---|---|
| **Comportamiento esperado** | El Runtime detecta pérdida de conectividad en el próximo DNS probe (< 10s). Entra en modo offline automáticamente. |
| **Continúa funcionando** | POS completo (crear, editar, cerrar órdenes). KDS (recibe eventos via Event Bus LAN). Impresión de comandas y tickets. Autorización de PIN contra SQLite local. |
| **Se degrada** | CFDI no se puede emitir (requiere Facturama). Fotos de menú desde CDN pueden no cargar. Reportes del Dashboard no tienen datos nuevos. |
| **Recuperación** | Al detectar conectividad, el Runtime procesa la sync_queue en orden FIFO. Sin intervención manual. |
| **Alerta** | Log `[WARN] supabase unreachable — entering offline mode`. Indicador visual en el POS (banda amarilla). Telemetría `runtime.offline_start`. |

### 5.2 Supabase no disponible (con internet activo)

| Campo | Detalle |
|---|---|
| **Comportamiento esperado** | DNS probe a supabase.co tiene respuesta (internet OK), pero las requests a la API fallan con 5xx o timeout. Runtime distingue este caso de caída de internet. |
| **Continúa funcionando** | Igual que §5.1 — modo offline local completo. |
| **Se degrada** | Igual que §5.1. Adicionalmente: si el staff no está cacheado localmente, la verificación de PIN requiere que el cache haya sido refrescado en la sesión anterior. |
| **Recuperación** | Automática al recuperarse Supabase. Mismo mecanismo que §5.1. |
| **Alerta** | Log `[WARN] supabase API unreachable (internet up)`. Telemetría `runtime.supabase_error` con código HTTP y duración del episodio. |

### 5.3 Reinicio del Runtime (Electron se cierra y reabre)

| Campo | Detalle |
|---|---|
| **Comportamiento esperado** | El proceso Electron termina (fallo, actualización, reinicio manual). El Runtime se reinicia. |
| **Continúa funcionando** | Todas las órdenes en SQLite sobreviven el reinicio. La sync_queue se preserva. |
| **Se degrada** | Interrupción de 5-30 segundos en el POS (tiempo de boot). Los clientes del Event Bus pierden la conexión y reconectan automáticamente. |
| **Recuperación** | `rehydrate()` carga el estado de SQLite. Los clientes del Event Bus reconectan. Los elementos en sync_queue se procesan en el primer ciclo de sync post-boot. |
| **Alerta** | Log `[INFO] boot completed in {N}ms`. Telemetría `runtime.restart` con uptime del ciclo anterior. |

### 5.4 SQLite corrupto

| Campo | Detalle |
|---|---|
| **Comportamiento esperado** | `PRAGMA integrity_check` falla en boot. El Runtime intenta recuperar el WAL journal primero. |
| **Continúa funcionando** | Si el WAL se recupera: operación normal. Si no: el Runtime arranca vacío y opera contra Supabase directamente. |
| **Se degrada** | Sin WAL recovery: las órdenes no sincronizadas en el episodio offline anterior se pierden. Staff requiere conexión a Supabase para verificación de PIN. |
| **Recuperación** | Rehydration automática desde Supabase al primer sync exitoso. Las órdenes no sincronizadas son irrecuperables — este es el único escenario de pérdida de datos en el diseño de v1. |
| **Alerta** | Log `[ERROR] sqlite integrity check failed`. Telemetría `runtime.db_corruption`. Notificación crítica al Dashboard de soporte (via Supabase telemetry). |

### 5.5 Pérdida de energía (UPS ausente o agotado)

| Campo | Detalle |
|---|---|
| **Comportamiento esperado** | El proceso Electron termina sin ejecutar `will-quit`. No hay flush de sync_queue. |
| **Continúa funcionando** | SQLite WAL garantiza integridad del archivo — no hay corrupción por shutdown abrupto. |
| **Se degrada** | Las órdenes escritas en el ciclo de 30s anterior a la caída que no habían sido sincronizadas a Supabase están en la sync_queue. El POS mostró `{ ok: true }` para esas órdenes pero aún no llegaron a la nube. |
| **Recuperación** | Boot normal al restaurar energía. SQLite WAL completa el checkpoint. `rehydrate()` carga el estado. sync_queue procesa los ítems pendientes. |
| **Alerta** | Telemetría `runtime.unclean_shutdown` (detectado en el siguiente boot comparando `last_boot_at` con el último checkpoint de WAL). |

### 5.6 Impresora desconectada

| Campo | Detalle |
|---|---|
| **Comportamiento esperado** | `POST /print` a una estación falla con `{ error: "connection refused" }` o `{ error: "timeout" }`. |
| **Continúa funcionando** | POS y KDS completos. Otras estaciones de impresión no afectadas. |
| **Se degrada** | Las comandas de la estación afectada no llegan físicamente. El staff debe ser notificado manualmente o el KDS suple visualmente. |
| **Recuperación** | La cadena de fallback de impresión se aplica: cocina TCP → cocina BT → comanda en pantalla. Al reconectar la impresora, las siguientes comandas se imprimen normalmente. Las comandas pasadas durante la desconexión no se reimprimen automáticamente. |
| **Alerta** | Log `[WARN] print station {name} unreachable`. Telemetría `bridge.print_errors` por estación. El POS muestra alerta en pantalla para la comanda afectada. |

### 5.7 KDS desconectado (terminal de cocina sin conexión)

| Campo | Detalle |
|---|---|
| **Comportamiento esperado** | El KDS pierde conexión al Event Bus. Las órdenes siguen procesándose y acumulándose en SQLite. |
| **Continúa funcionando** | POS completo. Impresión de comandas (cadena de fallback). Los estados de órdenes se siguen actualizando desde el POS. |
| **Se degrada** | La cocina no recibe actualizaciones en tiempo real hasta reconectar. No hay pérdida de datos — solo delay. |
| **Recuperación** | Al reconectar el KDS al Event Bus, recibe las órdenes activas via `GET /v1/orders` (snapshot inicial) y luego se suscribe al stream para actualizaciones. Sin intervención manual. |
| **Alerta** | Telemetría `kds.terminals_connected` baja a 0 o al número esperado menos uno. Log `[INFO] event bus client disconnected: {terminal_id}`. |

### 5.8 Cambio de IP de la Caja

| Campo | Detalle |
|---|---|
| **Comportamiento esperado** | La Caja obtiene una nueva IP via DHCP (el router no tiene DHCP reservation configurado correctamente). Las terminales PDV y KDS tienen la IP anterior en `client.json` y no pueden alcanzar el Runtime. |
| **Continúa funcionando** | El POS en la Caja misma (accede al Runtime via 127.0.0.1). La impresión local (USB). |
| **Se degrada** | KDS y PDV remotos pierden conexión al Runtime. Deben operar contra Supabase directamente o quedar sin coordinación. |
| **Recuperación** | Actualizar `runtime_ip` en `C:\fullsite\client.json` de las terminales afectadas. Esto requiere intervención de soporte. **La mitigación permanente es DHCP reservation por MAC address** — requisito de instalación. |
| **Alerta** | Las terminales afectadas loguean `[ERROR] runtime unreachable at {old_ip}`. El Runtime en la Caja opera normalmente y no genera alerta por este escenario. |

### 5.9 Runtime no disponible (Caja no opera)

| Campo | Detalle |
|---|---|
| **Comportamiento esperado** | La Caja está apagada, bloqueada, o con fallo de hardware. Ninguna terminal puede alcanzar el Runtime. |
| **Continúa funcionando** | El POS en las terminales PDV puede operar contra Supabase directamente (modo degradado legacy). La impresión via puente local en cada PDV si está configurado. |
| **Se degrada** | Sin Event Bus — el KDS no recibe actualizaciones en tiempo real. Sin coordinación de hardware central. La impresión de cocina desde PDV depende de la configuración de cada terminal. Las órdenes se sincronizan directamente a Supabase sin cache local, lo que requiere internet activo. |
| **Recuperación** | Recuperar la Caja (reiniciar el equipo, restaurar la energía). El Runtime retoma la coordinación automáticamente al hacer boot. Las terminales PDV reconectan al Runtime y regresan al flujo coordinado. |
| **Alerta** | Las terminales detectan ausencia del Runtime en el próximo health check (< 5s). El POS muestra alerta `"Runtime no disponible — modo directo"`. La ausencia del Runtime se registra en telemetría cuando se restablezca la conexión. |

---

## 6. Integración con el bridge existente

### Decisión: el bridge evoluciona oficialmente para convertirse en el Runtime

**Justificación basada en evidencia:**

El bridge actual (`electron-app/main.js`) ya es estructuralmente el Runtime en miniatura:
- Es el único servidor HTTP del proceso Electron — sin este servidor, no hay coordinación local
- Ya tiene un patrón de extensión probado: `/fp/*` se añadió como proxy a fingerprint-service sin cambiar ninguna ruta existente
- Tiene hot-reload de config (`POST /config` recarga `printers.json` en memoria sin reiniciar)
- Su ciclo de vida está gestionado por Electron main — `startBridge()` en `app.whenReady()`, `bridgeServer.close()` en `will-quit`
- Sus contratos (`POST /print`, `POST /drawer`) son estables y tienen clientes productivos

Crear un proceso separado (Opción B del RFC) implicaría:
- Gestionar un segundo ciclo de vida dentro de Electron o como servicio Windows independiente
- Duplicar la lógica de inicio/shutdown
- Añadir un segundo puerto que todas las terminales necesitarían conocer
- Más superficie de error para despliegues en 500 sucursales

**El Runtime v1 es el bridge v0 + nuevos módulos.** No hay dos binarios, no hay dos puertos, no hay dos ciclos de vida.

### Plan de integración técnica

```
electron-app/main.js (hoy)          electron-app/main.js (Runtime v1)
─────────────────────────            ─────────────────────────────────
startBridge()                   →    startRuntime()
  HTTP en 127.0.0.1:7717               HTTP en HOST:7717 (configurable)
  /health                               /health  (igual)
  /print                                /print   (igual)
  /drawer                               /drawer  (igual)
  /test                                 /test    (igual)
  /config                               /config  (igual)
  /fp/*                                 /fp/*    (igual)
                                        /v1/*    (NUEVAS — detrás de flag)

loadStations()                  →    loadConfig()
  printers.json                         runtime.json (superset de printers.json)

[sin persistencia]              →    openDatabase()
                                        C:\fullsite\runtime.db (SQLite)

[sin sync]                      →    scheduleSync()
                                        daemon cada 30s cuando online
```

**Compatibilidad:** `runtime.json` puede contener un campo `"printers"` que el Runtime usa como alias de `printers.json` para que las instalaciones existentes no requieran cambios de config.

---

## 7. Seguridad

### 7.1 Superficie de red

En v0 (hoy), el bridge escucha en `127.0.0.1` — solo el proceso local puede alcanzarlo. En v1 (cuando flag `local_runtime.lan_listen` activo), escucha en `0.0.0.0:7717` — alcanzable desde toda la LAN.

**Mitigaciones obligatorias antes de activar `lan_listen`:**

**Firewall de Windows** — regla entrante que permite solo el puerto 7717 desde la subred de la sucursal:
```cmd
netsh advfirewall firewall add rule name="Fullsite Runtime LAN" ^
  protocol=TCP dir=in localport=7717 ^
  remoteip=192.168.1.0/24 action=allow
```
Esta regla se instala como parte del setup de la sucursal, no en tiempo de ejecución.

**Token de autenticación para rutas v1:**
```
Authorization: Bearer {runtime_token}
```
`runtime_token` es un secreto generado en la primera instalación, almacenado en `runtime.json`, y distribuido a las terminales cliente via el mismo archivo de config de sucursal (`C:\fullsite\client.json`).

Las rutas heredadas del bridge (v0) no requieren token — son backward compatible.

### 7.2 Rutas con restricción de localhost

Las siguientes rutas solo responden a `127.0.0.1`, independientemente del flag `lan_listen`:

- `GET /v1/staff` — contiene hashes de PINs
- `POST /v1/sync/force` — operación destructiva potencial
- `GET /v1/sync/status` — contiene detalles de errores internos

### 7.3 Descubrimiento seguro

El mDNS opcional (Fase 3) solo anuncia el hostname y el puerto — no el token de autenticación. El token se distribuye fuera de banda (archivo de instalación o QR en el dashboard de la sucursal).

### 7.4 Datos sensibles

- **PINs**: nunca se almacenan en texto plano. La tabla `staff` en SQLite almacena `bcrypt(pin, cost=12)`.
- **Datos financieros**: el Runtime almacena totales de órdenes pero no los procesa. La validación financiera (`sum(pagos) === total + propina`) la hace el POS antes de enviar al Runtime.
- **Audit log**: el Runtime encola y replica — no modifica ni elimina. La tabla `pos_audit_log` en Supabase es la fuente autoritativa.

### 7.5 Versionado y compatibilidad

El campo `runtime_version` en `/health` permite al POS y KDS detectar si el Runtime soporta las rutas que necesita. Política:

- **Minor version bump** (1.0 → 1.1): nuevas rutas. Clientes que no las conocen simplemente no las usan.
- **Major version bump** (1.x → 2.0): cambio de contrato. Requiere actualización coordinada de Runtime + POS + KDS. No se permite tener v1 Runtime con v2 POS en la misma sucursal.
- Las rutas v0 (bridge heredado) son permanentes — nunca se deprecan en v1.x.

---

## 8. Observabilidad

### 8.1 Health check

`GET /health` — llamado por el POS cada 5s para detectar disponibilidad del bridge.

Response expandido en v1:
```json
{
  "ok": true,
  "hostname": "CAJA-AMALAY",
  "runtime_version": "1.0.0",
  "supabase_reachable": true,
  "sync_queue_pending": 0,
  "last_boot_at": "2026-07-24T10:00:00.000Z",
  "stations": [
    { "name": "cocina", "type": "tcp", "target": "192.168.1.21:9100" },
    { "name": "barra",  "type": "tcp", "target": "192.168.1.30:9100" },
    { "name": "caja",   "type": "usb", "target": "TICKET" }
  ]
}
```

### 8.2 Status extendido

`GET /v1/status` — panel de estado del Runtime para diagnóstico:

```json
{
  "runtime_version": "1.0.0",
  "client_id": "amalay",
  "uptime_s": 3600,
  "online": true,
  "sync_queue": {
    "pending": 0,
    "in_error": 0,
    "oldest_age_s": null,
    "last_sync_at": "2026-07-24T15:30:00.000Z"
  },
  "database": {
    "size_bytes": 2097152,
    "active_orders": 3,
    "staff_count": 12,
    "last_catalog_refresh": "2026-07-24T14:00:00.000Z"
  },
  "connected_terminals": 2,
  "feature_flags": {
    "local_runtime.shadow_mode": true,
    "local_runtime.lan_listen": true,
    "kds.read_from_local": true
  }
}
```

### 8.3 Logs estructurados

El Runtime emite logs a stdout (capturados por Electron) y a `C:\fullsite\logs\runtime-{date}.log`:

```
[runtime] 2026-07-24T15:30:00Z INFO  boot completed in 412ms
[runtime] 2026-07-24T15:30:01Z INFO  print cocina 847bytes ok
[runtime] 2026-07-24T15:30:15Z WARN  supabase unreachable — entering offline mode
[runtime] 2026-07-24T15:30:15Z INFO  sync_queue 3 items pending
[runtime] 2026-07-24T15:45:03Z INFO  online — starting sync
[runtime] 2026-07-24T15:45:04Z INFO  sync complete: 3 synced, 0 errors
```

Retención: 7 archivos de 10MB max (log rotation via `rotating-file-stream` o similar). Logs más viejos se eliminan automáticamente.

### 8.4 Métricas de telemetría

Almacenadas en SQLite tabla `telemetry`, replicadas a Supabase en cada sync (tabla `pos_telemetry`):

| Métrica | Tipo | Descripción |
|---|---|---|
| `bridge.print_latency_ms` | histogram | Tiempo total de una operación de impresión |
| `bridge.print_errors` | counter | Errores de impresión por estación |
| `runtime.supabase_latency_ms` | histogram | Latencia de sync a Supabase |
| `runtime.sync_queue_depth` | gauge | Ítems pendientes en cola |
| `runtime.offline_duration_s` | histogram | Duración de cada episodio offline |
| `runtime.order_state_divergence` | counter | Veces que el estado local difirió de Supabase |
| `runtime.restart` | counter | Reinicios del Runtime con uptime del ciclo anterior |
| `runtime.db_corruption` | counter | Eventos de corrupción de SQLite detectados |
| `runtime.unclean_shutdown` | counter | Boots detectados tras apagado sin shutdown limpio |
| `kds.poll_latency_ms` | histogram | Latencia de respuesta de `/v1/orders` al KDS |
| `kds.terminals_connected` | gauge | Terminales con conexión activa al Event Bus |

### 8.5 Diagnóstico remoto

El Dashboard de Fullsite puede consultar métricas de una sucursal via Supabase — el Runtime las replica en cada sync. Esto permite que soporte vea el estado del Runtime de AMALAY desde fuera sin conectar al equipo directamente.

---

## 9. Actualizaciones

### 9.1 Canal de distribución

El Runtime está embebido en el paquete Electron (`electron-app`). Las actualizaciones siguen el mismo canal que la app:

- `electron-updater` detecta una nueva versión en el servidor de releases
- Descarga en background mientras la app está en uso
- Instala en el próximo arranque (no interrumpe operación activa)
- El usuario puede diferir la instalación pero no bloquearla indefinidamente (max 7 días)

### 9.2 Canales de release

| Canal | Quién recibe | Criterio de promoción |
|---|---|---|
| `dev` | Solo AMALAY (piloto) | Cualquier commit en rama de desarrollo |
| `beta` | Sucursales voluntarias | P0-4 Fase 2 CERTIFIED |
| `stable` | Todas las sucursales | 7 días en beta sin incidentes |

### 9.3 Compatibilidad entre versiones

Un update del Runtime nunca puede requerir un update simultáneo del POS o del KDS. Las versiones de Runtime dentro de la misma generación (1.x) deben ser backward compatible con el POS en producción.

Proceso de release para cambios que afectan contratos:
1. Nueva ruta/campo se añade como opcional
2. El POS adopta la nueva ruta opcionalmente (detect via `runtime_version` en `/health`)
3. La ruta vieja se mantiene por al menos 2 versiones de stable
4. Solo entonces se puede deprecar

### 9.4 Rollback de versión

Si una versión de stable produce incidentes: el Dashboard puede marcar la versión como `reverted` en el servidor de releases. `electron-updater` en las terminales detecta el flag y hace rollback automático a la versión anterior en el próximo arranque.

### 9.5 Schema migrations de SQLite

El Runtime usa migraciones numeradas (`schema_v1.sql`, `schema_v2.sql`, etc.) almacenadas en el paquete. En cada boot, compara la versión del schema en `PRAGMA user_version` y corre las migraciones pendientes en una transacción. Si una migración falla, se hace rollback completo y el Runtime usa el schema anterior.

---

## 10. Out of Scope

Esta sección existe para evitar scope creep. Si alguien propone añadir algo de esta lista al Runtime, debe primero argumentar por qué no puede vivir en el POS, el Dashboard o Supabase.

| Fuera de alcance | Dónde pertenece |
|---|---|
| Cálculo de costos de recetas | Supabase (función o vista) |
| Deducción de inventario por venta | Supabase RPC `r1_reconcile_order` |
| Generación de reportes o cortes | Supabase / Dashboard |
| Cálculo de propinas por empleado | Supabase / Dashboard |
| Gestión de proveedores o compras | Dashboard / Supabase |
| Emisión de CFDI | Facturama API (desde el POS con cola IDB) |
| Integración con plataformas de delivery (Rappi, Uber Eats) | API Routes de Vercel |
| Validación de permisos granulares | POS (consulta staff.role localmente o en Supabase) |
| Dashboard de analytics o reportes en tiempo real | Dashboard App + Supabase |
| Gestión de reservaciones | Sistema externo (Reservy) |
| Procesamiento de pagos con terminal bancaria | Proveedor de pagos (Clip, NetPay, OEL) |
| Multi-sucursal o datos cross-tenant | Supabase (RLS garantiza aislamiento) |
| Sincronización entre Runtimes de diferentes sucursales | No existe — cada Runtime solo conoce su `client_id` |
| Interfaz de usuario de cualquier tipo | POS / Dashboard / KDS |
| Configuración remota de feature flags | Dashboard (escribe en `clients.feature_flags`, Runtime lee en el próximo boot) |
| Alta disponibilidad / failover automático | v2 roadmap — ver §1.3 |

---

## CHANGELOG

| Versión | Fecha | Cambio |
|---|---|---|
| 1.0 | 2026-07-24 | Versión inicial — especificación completa basada en audit de codebase y evidencia de campo AMALAY |
| 1.1 | 2026-07-24 | SQLite como fuente temporal (no permanente) clarificado en §1.1, §3.3 y §10. Event Bus desacoplado de SSE en §1.1, §2.1, §4.3, §4.4, §4.6, §4.7, §8.4. Límites de HA v1 explicitados en §1.2 y §1.3. Sección §5 Modelo de fallos añadida (9 escenarios). Secciones renumeradas 5→6 en adelante. |

---

> Este documento es la especificación oficial del Fullsite Runtime.
> Toda implementación debe ser consistente con este documento.
> Si el código y la especificación difieren, el código está mal — no la especificación.
> Para cambiar la especificación: abrir RFC, obtener aprobación, luego actualizar este documento y el código.
