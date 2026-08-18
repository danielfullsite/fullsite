# OFFLINE LAN — Field-Proven Architecture & Clone Recipe

> **Estado (honesto, AMALAY 2026-08-18):** VERIFICADO offline en **2 terminales** — la **CAJA**
> imprimió con internet desconectado, y el **KDS recibió órdenes con la caja offline**. El reenvío
> de **POS secundarios** (Entrada) está probado **ONLINE**; su offline es **offline-capable por
> diseño** pero **aún no probado físicamente**. No darlo por verificado hasta el test: desconectar
> internet con el POS abierto → orden → imprime en caja + sale en KDS.
>
> Este documento captura **la arquitectura que SÍ jaló** y **cómo clonarla** a un
> restaurante nuevo. Los docs previos ([[OFFLINE-MASTER]], `docs/offline/*`) describen
> el diseño de julio; este documento es la **verdad de campo** que lo corrige y cierra.
>
> **Regla #1: no romper esto.** Cada pieza de abajo existe por una causa raíz concreta.
> Antes de tocar cualquier cosa marcada 🔒, lee "Causas raíz" y "No romper".

---

## 0. TL;DR — el modelo mental de una frase

> **Todo es local/LAN y todo es HTTP.** El POS le habla a Pedro por `http://127.0.0.1:7717`
> (localhost); el KDS le habla a la caja por `http://<caja>:7717` (LAN). **Nada de esto
> necesita internet.** Internet solo se usa para sincronizar a Supabase cuando vuelve.

El error histórico fue asumir que el POS/KDS cargaban de `https://app.fullsite.mx` y que
todo pasaba por internet. **Offline eso se cae.** La solución es que la operación viva en
la LAN, servida por **Pedro** (el Local Server que corre dentro de Electron, puerto 7717).

---

## 1. Las dos causas raíz que rompían el offline (y sus fixes)

### Causa raíz A — El print offline no salía
**Síntoma:** offline, enviar una orden mostraba *"Error al guardar orden — NO se imprimió"*.

**Por qué:** el POS corre bajo un **Service Worker**. Cuando no hay internet, el SW
**intercepta** `POST /api/pos/save-order` (network-first) y **devuelve una respuesta
no-ok en vez de dejar que el `fetch` truene**. El código de `saveOrder` solo tomaba el
camino offline (que **sí imprime** por el bridge local) cuando el fetch **tronaba** (catch).
Como el SW respondía, caía a `API_ERROR` → **nunca imprimía**.

**Fix 🔒** (`dashboard-app/src/lib/saveOrder` en `pos-data.ts`):
1. Guard **antes** del fetch: si `navigator.onLine === false` → `OFFLINE_QUEUED` (encola + imprime). Instantáneo.
2. Si el fetch responde `status 0` o `5xx` → `OFFLINE_QUEUED` (cubre "conectado a la LAN pero sin WAN", donde `navigator.onLine` sigue `true`).
3. **Timeout de 7s** (`AbortController`) en el fetch → si se cuelga, aborta → catch → `OFFLINE_QUEUED`. (Sin esto, "LAN arriba sin internet" **congelaba** el POS.)

El branch offline (`pos/page.tsx`, rama `OFFLINE_QUEUED`) hace `printByStation(...)` (imprime
por el bridge local, comentario literal *"print even when internet is down"*) y **postea
`ORDER_SENT` a `http://<bridge>:7717/events`** (Pedro), así el KDS lo ve.

### Causa raíz B — El KDS en máquina separada nunca recibía órdenes
**Síntoma:** `clients_connected: 0` siempre; el KDS mostraba 0 órdenes aunque existían.

**Por qué:** la página del KDS cargaba de `https://app.fullsite.mx/pos/cocina`. Para recibir
órdenes por la LAN tenía que hablarle al bridge de la caja (`ws://192.168.1.71:7717`). El
navegador **bloquea eso por mixed-content** (una página `https` no puede abrir un `ws://` /
`http://` a una **IP de LAN**; localhost sí, IP de LAN no). `webSecurity:false` en Electron
**no bastó** (Chromium 130 lo bloquea también por Private Network Access).

**Fix 🔒 — servir el KDS por HTTP desde Pedro.** Una página **http** puede libremente hablarle
a `http://<lan-ip>:7717`. Entonces:
- `electron-app/local-server/kds-ui.html` — página KDS **autocontenida** (vanilla JS, sin framework).
- Pedro la sirve en `GET /kds` (`local-server/index.js`), **inyectando** `bridge_base` = IP de la caja.
- El KDS Electron carga **`http://127.0.0.1:7717/kds`** (su PROPIO Pedro sirve la página → carga aunque no haya internet, incluso en frío). Esa página lee `kds_orders` del **`/state` de la caja** por la LAN.

**Todo http↔http → sin muro de mixed-content. Todo local/LAN → offline total.**

> El truco viejo de "LOCAL_UI" servía el bundle **viejo** por http (por eso "funcionaba"
> pero con código obsoleto que no guardaba). Este enfoque sirve una página **nueva y mínima**
> por http, dedicada al KDS, sobre datos frescos del `/state`.

---

## 2. La arquitectura que SÍ jala (topología)

```
                 INTERNET (Supabase) — solo para sync cuando vuelve
                              ▲
                              │  sync_queue (idempotente, save_operation_id)
        ┌─────────────────────┴───────────────────────────────────────────┐
        │                      LAN  192.168.1.x                            │
        │                                                                  │
        │   CAJA (server_pos, .71)                                         │
        │   ┌────────────────────────────────────────────────────────┐    │
        │   │ Electron "Fullsite POS"                                 │    │
        │   │  • Ventana POS → https://app.fullsite.mx/pos            │    │
        │   │  • PEDRO (Local Server) :7717  ← el corazón offline     │    │
        │   │     /state  (kds_orders)   /events (POST ORDER_SENT)    │    │
        │   │     /print  /kds  /health  /identity                    │    │
        │   │  • Impresoras (cocina/barra/caja/tickets) 🖨️           │    │
        │   └───────▲───────────────────────▲────────────────────────┘    │
        │           │ http localhost        │ http LAN                     │
        │    imprime+ORDER_SENT       lee /state                           │
        │           │                       │                              │
        │   POS 2/3 (role pos)        KDS / PDV2 (role kds)                │
        │   Electron "Fullsite POS"   Electron "Fullsite KDS"              │
        │   ventana → app.fullsite    ventana → http://127.0.0.1:7717/kds  │
        │   FULLSITE_BRIDGE_URL=.71    (su Pedro sirve la página;          │
        │   → imprime en la caja       bridge_base=.71 → lee /state caja)  │
        └──────────────────────────────────────────────────────────────────┘
```

**Flujo de una orden (offline o online, es el mismo):**
1. El mesero envía en el POS → `saveOrder` (a Supabase si hay internet; si no, encola).
2. **Siempre**: `printByStation` imprime por `FULLSITE_BRIDGE_URL` (la Pedro de la caja).
3. **Siempre**: `POST ORDER_SENT` a `<bridge>/events` → el estado de Pedro (`kds_orders`) se actualiza.
4. El KDS hace poll a `/state` cada 2s → pinta la orden. **Cero internet en los pasos 2-4.**

---

## 3. Mapa de código (qué archivo hace qué)

| Pieza | Archivo | Rol |
|---|---|---|
| Detección offline + no perder/no congelar | `dashboard-app/src/lib/pos-data.ts` → `saveOrder` 🔒 | guard `navigator.onLine`, status 0/5xx, timeout 7s → `OFFLINE_QUEUED` |
| Imprime + avisa a Pedro offline | `dashboard-app/src/app/pos/page.tsx` (rama `OFFLINE_QUEUED`) | `printByStation` + `POST /events` |
| URL del bridge para imprimir/eventos | `dashboard-app/src/lib/bridge-url.ts` → `getBridgeUrl()` | lee `localStorage.FULLSITE_BRIDGE_URL` (default `http://127.0.0.1:7717`) |
| Página KDS offline (http) | `electron-app/local-server/kds-ui.html` 🔒 | vanilla; poll `/state`; render por status/estación; avanzar status por `POST /events` |
| Pedro sirve el KDS | `electron-app/local-server/index.js` → ruta `GET /kds` 🔒 | lee el html, inyecta `bridge_base` (IP de la caja de `config.pos_server_ip`) |
| Estado de cocina | `electron-app/local-server/core/state.js` → `toSnapshot().kds_orders` | órdenes completas enviadas a cocina, sin Supabase |
| Inyecciones por terminal | `electron-app/main.js` (did-finish-load) 🔒 | `fullsite_client_id`; para role `pos`: `pos_bridge_host` **y `FULLSITE_BRIDGE_URL`** = caja |
| Ventana KDS carga la página local | `electron-app/main.js` (kds_only) 🔒 | `http://127.0.0.1:7717/kds` |
| Config → Pedro | `electron-app/main.js` `cfg.posServerIp` → `index.js buildHttpRouter` | de dónde el `/kds` toma `bridge_base` |

---

## 4. 🔒 No romper (reglas duras)

1. **El KDS se sirve por HTTP, no HTTPS.** Si algún día el KDS vuelve a `https://app.fullsite.mx`, se rompe el offline (mixed-content). La página del KDS **vive en Pedro** (`/kds`).
2. **El POS imprime por `FULLSITE_BRIDGE_URL`**, que apunta a la **caja** en terminales secundarias. Si no se inyecta, POS 2/3 imprimen a su Pedro local vacío → no imprimen.
3. **`saveOrder` debe caer a `OFFLINE_QUEUED`** ante `navigator.onLine===false`, `status 0/5xx`, o timeout. Nunca a `API_ERROR` por un problema de red (perdería la orden y no imprimiría).
4. **Pedro es el corazón.** Corre dentro de Electron. Si se cierra el Electron, muere Pedro y muere el print/KDS. `Ctrl+Shift+Q` es el único escape del kiosko.
5. **`ORDER_SENT` se postea a `<bridge>/events` por HTTP** (no `ws://`). El `getBridgeUrl` de `lib/bridge-url` ya es http — no confundir con el de `bridge-client.ts` (que es ws:// para el hub).
6. La sync a Supabase es **idempotente** (`save_operation_id`). Encolar de más nunca duplica.

---

## 5. Receta clonable — nuevo restaurante offline en minutos

> Objetivo esqueleton: un cliente nuevo tiene offline funcionando **sin escribir código**,
> solo con **config + instalador**.

### 5.1 Roles y config (`config.json` por terminal)
Un restaurante tiene **1 caja servidor** + N POS + M KDS. Todos apuntan a la IP LAN de la caja.

| Rol | `terminal_role` | `local_server_host` | `pos_server_ip` | Notas |
|---|---|---|---|---|
| Caja (servidor + impresoras) | `server_pos` | `127.0.0.1` | — | corre Pedro con las impresoras |
| POS de meseros | `pos` | `<IP caja>` | `<IP caja>` | imprime+KDS vía la caja |
| Pantalla de cocina | `kds` | `<IP caja>` | `<IP caja>` | `kds_only: true` |

Campos mínimos (ver `electron-app/local-server/config-schema.js`): `config_version`,
`restaurant_id`, `terminal_id`, `terminal_role`, `terminal_name`, `local_server_host`,
`local_server_port` (7717), `protocol_version` ("1.0"), `provisioned_at`. Para KDS: `kds_only: true`.
**Clave:** `pos_server_ip` = IP LAN de la caja (así el POS imprime en la caja y el KDS lee su `/state`).

### 5.2 Instaladores
- **Caja y POS de meseros:** `Fullsite POS Setup.exe` (role `server_pos` / `pos`).
- **Pantalla de cocina:** `Fullsite KDS Setup.exe` (fuerza `kds_only`).
- Ambos se generan con `electron-app/electron-builder-pos.json` y `-kds.json`.
  **Siempre `--x64`** (los defaults en Mac Apple Silicon salen arm64 y NO corren en Windows).

### 5.3 Instalación por máquina (3 pasos)
1. Desinstalar cualquier "Fullsite" viejo (libera el puerto 7717).
2. Correr el `.exe`.
3. Asistente → **Importar desde respaldo** → el `config.json` de esa máquina → reiniciar.

### 5.4 Verificación (aceptación offline)
1. **Online:** orden en la caja → guarda + imprime + sale en el KDS.
2. **Offline:** POS **ya abierto y logueado** → desconectar internet → orden → **imprime** + toast *"Sin conexión — orden guardada localmente"* + **sale en el KDS**.
3. **Recuperación:** reconectar → sincroniza sola a Supabase.
4. `http://<caja>:7717/state` debe mostrar `kds_orders` poblado.

> **Ojo cold-boot:** la ventana POS carga de `app.fullsite.mx`. Si la máquina **prende de
> cero sin internet**, la ventana POS puede quedar en negro (el KDS no, porque su página
> la sirve Pedro local). Mantener las máquinas prendidas; un corte de internet en operación
> **no las tumba** (SW cachea la app + Pedro sirve la LAN).

---

## 5.5 Impresión de POS secundarios — RESUELTO (v1.3.6)

> ✅ **RESUELTO 2026-08-18 (v1.3.6) — impresión de POS secundarios (role `pos`).**
> El problema (§5 viejo): un POS secundario es `https` y NO puede postear a `http://<lan-ip>:7717`
> (la caja) — **mixed-content bloqueado**, el MISMO muro del KDS. `webSecurity:false` NO lo tumba
> (probado en campo con Entrada/PDV3). La caja funciona solo porque imprime a `127.0.0.1` (exento).
>
> **FIX (patrón del KDS, verificado con Entrada):** el POS postea a su PROPIO Pedro local
> (`FULLSITE_BRIDGE_URL = http://127.0.0.1:7717`, localhost exento del muro) y ese Pedro **REENVÍA**
> `/print`, `/events` y `/drawer` a la caja por **Node http** (sin muro del navegador). Piezas:
> - `local-server/index.js` 🔒 — intercept al inicio del router: `if (posServerIp && POST && /print|/events|/drawer) → forwardPost(http://<posServerIp>:7717<url>)`. La caja (posServerIp=null) NO reenvía (procesa local) → sin loop.
> - `main.js` 🔒 — para role `pos`: inyecta `FULLSITE_BRIDGE_URL = http://127.0.0.1:7717` y borra `pos_bridge_host`. (En el asistente/Configuración se puede fijar manual: bridge = `http://127.0.0.1:7717`.)
>
> **REGLA (corrige §5.1):** un POS secundario apunta su bridge a **`127.0.0.1`** (su propio Pedro),
> NO a la IP de la caja. El reenvío es automático por `pos_server_ip` del config. Todo local/LAN → jala offline igual.

## 6. Pendientes conocidos (no bloquean lo anterior)

- **Velocidad offline del POS:** fetches sin timeout se cuelgan → abrir mesa/enviar lentos. Fix: `fetchWithTimeout` + guard `navigator.onLine` en rutas calientes.
- **Diseño del KDS:** `kds-ui.html` es una UI base. Falta el diseño de Eduardo (cascada, tarjeta por envío, toque por item, filtro por estación, alertas, botón salida).
- **KDS status → Supabase:** avanzar status en el KDS offline actualiza Pedro, no Supabase (el online lo maneja aparte). Diseñar el sync de status KDS→Supabase.
- **Endurecer `/api/pos/kitchen`** con token de cocina (hoy solo `client_id`-scoped).

---

*Field-proven AMALAY 2026-08-18. Ver [[OFFLINE-MASTER]] para el diseño histórico y
`docs/offline/MULTI-RESTAURANT-DEPLOYMENT.md` para el despliegue multi-restaurante.*
