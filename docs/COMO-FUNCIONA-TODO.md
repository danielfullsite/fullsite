# Cómo funciona TODO el producto — Fullsite

> Doc maestro único: de la caja registradora al dashboard, pasando por offline, KDS,
> impresoras, HID y agentes IA. Anclado al **código real** (rutas verificadas 2026-09-02).
> Es el mapa de entrada; cada sección apunta al doc profundo de su dominio.
> Fuente de verdad del código: el repo. Si este doc y el código difieren, gana el código —
> corrige el doc.

---

## 0. El sistema en una imagen

```
        NUBE (Vercel + Supabase)                       RESTAURANTE (LAN)
  ┌────────────────────────────────┐          ┌──────────────────────────────────┐
  │  Next.js 16 (dashboard-app/)   │          │   CAJA = SERVER1 (server_pos)     │
  │  - Dashboard admin (~70 rutas) │◄────WAN──►│   Electron main.js                │
  │  - POS web (~35 rutas)         │  HTTPS   │   + Local Server :7717 (HTTP+WS)  │
  │  - 112 API routes              │          │   + CoreEventStore events.ndjson  │
  │  Supabase Postgres + RLS       │          │   + mDNS _fullsite-pos._tcp       │
  │  Agentes IA (.github crons)    │          └───────┬───────────────┬───────────┘
  └────────────────────────────────┘             LAN │           LAN │
                                              ┌───────▼──────┐ ┌──────▼───────┐
                                              │ COCINA=PDV2  │ │ ENTRADA=PDV3 │
                                              │ (kds_only)   │ │ (pos satél.) │
                                              │ KDS + impres.│ │ POS + huella │
                                              └──────────────┘ └──────────────┘
```

**Principio rector:** la CAJA es la única fuente de verdad local del restaurante. Los
satélites (cocina, entrada) apuntan a su IP. Si se cae internet, el restaurante sigue
operando contra la caja; cuando vuelve el WAN, todo sincroniza idempotente a Supabase.

---

## 1. WEB APP — dashboard + POS (`dashboard-app/`, Next.js 16 + Turbopack)

### Cómo funciona
Una sola app Next.js sirve dos productos: el **dashboard administrativo** (dueño/gerente)
y el **POS** (`/pos/*`, meseros/cajeros/cocina). Todo dato se lee de Supabase por
**PostgREST** (`fetch` directo, NUNCA el SDK — cuelga en App Router; ver `dashboard-app/AGENTS.md`).

**Resolución de tenant (una sola fuente):** [data.ts](../dashboard-app/src/lib/data.ts) `getActiveClientSlug()`:
`localStorage 'fullsite_client_id'` (lo pone AuthContext al login) → `NEXT_PUBLIC_DEFAULT_CLIENT_ID`
→ vacío (falla seguro, 0 filas). En POS: [pos-data.ts](../dashboard-app/src/lib/pos-data.ts) `_getClientId()`.

**Backend:** 112 route handlers en `src/app/api/*/route.ts`. Los del camino del dinero:
`pos/save-order`, `pos/add-items`, `pos/cancel-item`, `pos/pin` (emite shift-token),
`mp-point` (MercadoPago), `factura/timbrar` (CFDI).

### Archivos clave
- Rutas: `src/app/**/page.tsx` (~105) · Backend: `src/app/api/**/route.ts` (112)
- Dominio: `src/lib/*.ts` (102 módulos) — ver [SYSTEM-MAP por capa](#apéndice--índice-de-código)
- Componentes POS: `src/components/pos/` ([TurnoGate](../dashboard-app/src/components/pos/TurnoGate.tsx), [CierreCajaWizard](../dashboard-app/src/components/pos/CierreCajaWizard.tsx), …)

### Doc profundo
`docs/architecture/SYSTEM-ARCHITECTURE.md` (multi-tenant/auth/RLS), `dashboard-app/AGENTS.md` (contratos de dominio).

---

## 2. OFFLINE — local-first (el corazón, CONGELADO)

### Cómo funciona
Tres piezas cooperan para que el POS NUNCA se caiga:

1. **Service Worker** ([public/sw.js](../dashboard-app/public/sw.js)) — cachea el app-shell + TODOS
   los chunks de Next (vía warm-crawl + `precache-manifest.json`, ver `scripts/gen-precache-manifest.mjs`),
   API de menú/staff con network-first. Sin internet, la app arranca desde caché.
2. **IndexedDB** ([pos-offline-db.ts](../dashboard-app/src/lib/pos-offline-db.ts), DB `fullsite_pos` v4) —
   guarda menú, órdenes y una **cola de sync**. Las mutaciones offline se encolan.
3. **Cola de sync** ([offline-sync.ts](../dashboard-app/src/lib/offline-sync.ts)) — al volver `online`,
   drena la cola a Supabase de forma **idempotente** (por `save_operation_id`).

**Cold-boot sin internet:** lo maneja Electron ([main.js](../electron-app/main.js), `did-fail-load`
→ [offline.html](../electron-app/offline.html) con reintentos escalonados `loadFailCount*800ms`).
El SW debe ganar la carrera antes que el 4º intento. **Regla dura:** este camino no se rediseña
sin evidencia de campo; Wansoft es el benchmark.

### Archivos clave
`public/sw.js`, `src/lib/pos-offline-db.ts`, `src/lib/offline-sync.ts`,
`src/lib/recoverable-operation.ts`, `electron-app/main.js`, `electron-app/offline.html`.

### Doc profundo
`docs/architecture/OFFLINE-MASTER.md`, `docs/architecture/LOCAL-FIRST.md`,
`docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md`, `docs/pos/PIPELINE-POS-KDS-OFFLINE.md`.

---

## 3. EVENT STORE + BRIDGE — cómo viaja una comanda

### Cómo funciona (el flujo crítico)
El browser NO escribe directo a la cocina ni a la impresora. Todo pasa por un **command con
`command_id` estable** que el Local Server persiste ANTES de responder (contrato en
`docs/architecture/PERSISTENCE-LAYER.md`):

```
POS (browser) ──sendCommand(command_id)──► Local Server :7717 ──► CoreEventStore
   bridge-client.ts                          index.js              event-store.js
        │                                        │                     │
        │                                        │                     ├─ append events.ndjson
        │                                        │                     │  (ANTES del ACK)
        │                                        ▼                     ▼
        │                                    ws-hub  ──push──►  KDS (cocina/barra)
        │                                        │              useKdsWsClient.ts
        └──si no hay Local Server──► polling Supabase directo (fallback)
```

**Idempotencia:** el `command_id` == id del evento; `hasProcessedCommand` deduplica
([event-store.js](../electron-app/local-server/core/event-store.js)). Doble clic = una sola comanda.

### Archivos clave
Browser: [bridge-client.ts](../dashboard-app/src/lib/bridge-client.ts) (`sendCommand`),
[bridge-url.ts](../dashboard-app/src/lib/bridge-url.ts), [kitchen-bridge.ts](../dashboard-app/src/lib/kitchen-bridge.ts).
Local Server: `electron-app/local-server/core/{event-store,command-handler,outbox,state,ws-hub}.js`,
`adapters/storage/ndjson.js`.

### Doc profundo
`docs/architecture/EVENT-STORE.md`, `docs/architecture/BRIDGE.md`, `docs/architecture/PERSISTENCE-LAYER.md`.

---

## 4. KDS — pantallas de cocina

### Cómo funciona
El KDS es una vista web (`/pos/cocina`, `/pos/barra`, `/pos/kds`) que se suscribe por
**WebSocket** al `ws-hub` del Local Server. Cuando entra una comanda, el hub la empuja y la
pantalla se actualiza sin refrescar. Offline, el KDS lee de IndexedDB alimentado por el bridge.

**Dos variantes de KDS** (ver memoria del proyecto):
- `/pos/cocina` = KDS diseño Eduardo (el que corre en Electron `kds_only`).
- `/pos/kds` = KDS simplificado.
- Electron `kds_only` carga `http://127.0.0.1:7717/kds` sirviendo `kds-ui.html` desde la caja.

### Archivos clave
Web: `src/app/pos/{cocina,barra,kds}/page.tsx`, `src/hooks/useKdsWsClient.ts`.
Local Server: `local-server/core/ws-hub.js`, `local-server/kds-ui.html`.
Electron: [main.js](../electron-app/main.js) `createKdsWindow()` (relaja CSP para `ws://*:7717`).

### Doc profundo
`docs/pos/PIPELINE-POS-KDS-OFFLINE.md`.

---

## 5. ELECTRON — el skeleton de escritorio (`electron-app/`)

### Cómo funciona
Electron envuelve la web app y le da acceso al hardware + resiliencia. [main.js](../electron-app/main.js)
(1068 líneas) hace:
- **Provisioning gate:** al arrancar lee `userData/config.json`. Sin `restaurant_id` válido →
  `NOT_PROVISIONED` → abre wizard [setup.html](../electron-app/setup.html) y bloquea todo.
- **3 modos de máquina** (según `config.json`):
  - `server_pos` (CAJA) → ventana POS + Local Server :7717.
  - `kds_only` (COCINA) → ventana KDS contra `http://127.0.0.1:7717/kds`.
  - `pos` (SATÉLITE) → ventana POS apuntando a la IP de la caja (`pos_server_ip`).
- **Descubrimiento LAN:** [discovery/mdns.js](../electron-app/local-server/discovery/mdns.js) anuncia
  `_fullsite-pos._tcp` con TXT `restaurant_id`/`server_id`; los satélites verifican que hablan
  con la caja correcta sin IP fija.
- **IPC de provisioning:** `provision:scan-lan`, `provision:test-server`, `provision:test-printer`,
  `provision:save`, etc.
- **Auto-update:** [update/auto-installer.js](../electron-app/update/auto-installer.js) — solo instala
  con el restaurante en reposo (`update/politica.js`), falla cerrado.

### Packaging / instalación
- electron-builder NSIS (v1.3.8): [electron-builder-pos.json](../electron-app/electron-builder-pos.json)
  (`mx.fullsite.pos`, perMachine, `files: ["**/*"]`), [electron-builder-kds.json](../electron-app/electron-builder-kds.json).
  El servicio de huella NO se empaqueta aquí (ver §7 — vive en `C:\fullsite\`, se lanza como proceso hijo).
- Field kit (instalación en sitio): `docs/agent-os/field/FULLSITE-FIELD-KIT/`
  (`INSTALL.cmd`, `FIREWALL-SETUP.ps1`, `PRE-INSTALL-BACKUP.ps1`, `ROLLBACK.ps1`).

### Doc profundo
`docs/pos/PLAN-INSTALACION-AMALAY-JUEVES.md`, `docs/pos/PLAN-RECONCILIACION-ELECTRON.md`.

---

## 6. IMPRESORAS — comandas y tickets

### Cómo funciona
El browser NUNCA habla con la impresora directo. Manda un command de impresión al Local Server
(:7717), que lo encola y lo manda a la térmica por su adapter. Si una impresora falla, hay cola
y reintentos. La cobertura de impresora por estación se valida al arranque (OFF-01).

```
POS ──print command──► Local Server :7717 ──► print-queue ──► printer.js ──► térmica USB/red
   printer.ts (browser)                        adapters/print-queue.js  adapters/printer.js
```

### Archivos clave
Browser: [printer.ts](../dashboard-app/src/lib/printer.ts), [print-queue.ts](../dashboard-app/src/lib/print-queue.ts).
Local Server: `adapters/printer.js`, `adapters/print-queue.js`, `adapters/printer-wizard-logic.js`,
`adapters/printer-config-schema.js`. Endpoint `/print` en `local-server/index.js`.

### Doc profundo
`docs/certifications/OCS-P2.5.6-IMPRESION.md`.

---

## 7. HID — huella digital (login biométrico)

### Cómo funciona
Hardware: **DigitalPersona 4500** vía **Windows Hello (WBF)**. El empleado registra su huella en
`/pos/huella`; luego hace login con huella (fallback a PIN).

El lector NO lo maneja electron-builder. Es un **servicio aparte**: `fingerprint-service.exe`
+ `DPUruNet.dll` (SDK DigitalPersona) que deben estar en `C:\fullsite\`. Electron lo **lanza como
proceso hijo** en el **puerto 7718** ([main.js:586](../electron-app/main.js#L586) `startFingerprintService`,
con reinicio automático); si no existe, el login por huella simplemente no está disponible (cae a PIN).
El browser llega al servicio vía [fingerprint-url.ts](../dashboard-app/src/lib/fingerprint-url.ts).

> Consecuencia para clonabilidad: el `.exe`/`.dll` de huella se copian a mano hoy — no van en el
> instalador. Es parte del gap de "instalador pre-empaquetado".

### Archivos clave
`src/app/pos/huella/page.tsx`, `src/lib/fingerprint-url.ts`, `electron-app/main.js:586+`
(`startFingerprintService`, puerto 7718). Guía de hardware: `docs/playbooks/HID-SETUP.md`.

### Doc profundo
`docs/playbooks/HID-SETUP.md` (guía paso a paso de driver + registro).

---

## 8. DATOS + MULTI-TENANT + AISLAMIENTO

### Cómo funciona
Supabase Postgres con **RLS por `client_id`**. Cada lectura filtra por tenant; las policies solo
permiten `authenticated`/`service_role` (cero `anon`). Un clon **nace aislado** sin tocar código
(verificado en prod 2026-08-21). Config por tenant en la tabla `clients` (features JSONB, timezone,
iva, telegram_chat_ids, data_source).

### Archivos clave
Migraciones: `scripts/sql/migrations/` (23 archivos: `001_core_schema`, `003_rls_policies`,
`006_views`, `P1-D09-remove-client-id-defaults`…).
Aislamiento: `scripts/tenant-isolation/ti_checks.sql` (TI-01..06), `scripts/clone-test.sql`.
Config: `.github/scripts/client_config.py` (`get_client`), `src/lib/client-config.ts`.

### Doc profundo
`docs/architecture/SYSTEM-ARCHITECTURE.md`, `docs/platform/CLONABILITY-FULL-ANALYSIS.md`, `docs/platform/PAE.md`.

---

## 8.1 MODELO DE DATOS — tablas reales `[VERIFICADO ✓]`

**75 tablas** (`scripts/sql/migrations/010_consolidated_core.sql`). Todas llevan `client_id` (multi-tenant). Agrupadas por dominio:

**Tenant / plataforma:** `clients`, `client_locations`, `client_users`, `credentials_vault`.
**Órdenes / dinero:** `pos_orders`, `pos_cash_movements`, `pos_cierres`, `pos_turnos`, `pos_save_operations` (idempotencia de save), `pos_facturas`, `pos_cfdi_requests`, `pos_billing_clients`, `pos_gastos`, `pos_reconciliation_results`.
**Menú:** `pos_menu_categories`, `pos_menu_items`, `pos_modifiers`, `pos_modifier_groups`, `pos_item_modifier_groups`, `pos_category_modifiers`, `pos_combos`, `pos_promotions`, `pos_sizes`, `pos_payment_methods`.
**Recetas / costeo:** `pos_recipes` (capa costeo), `pos_recipes_old` (capa depleción), `pos_recipe_lines`, `pos_recipe_versions`, `pos_sub_recipes`, `pos_sub_recipe_ingredients`, `pos_ingredients`, `pos_ingredient_presentations`, `pos_presentations`, `pos_unit_conversions`, `pos_insumos`.
**Inventario / compras:** `pos_inventory`, `pos_inventory_movements`, `pos_inventory_products`, `pos_inventory_alerts`, `pos_market_stock`, `pos_market_movements`, `pos_retail_items`, `pos_item_inventory_policy`, `pos_suppliers`, `pos_purchase_orders`, `pos_purchase_order_items`.
**Personal:** `pos_staff`, `pos_staff_shifts`, `pos_staff_audit`, `pos_attendance`, `pos_schedules`, `pos_fingerprint_templates` (huellas server-side), `pos_mutation_authority`.
**Clientes / CRM:** `pos_customers`, `pos_customer_notes`, `pos_customer_visits`, `pos_gift_cards`, `reviews`.
**Eventos / auditoría:** `events` (append-only), `pos_print_jobs`, `pos_audit_log`, `agent_runs`, `agent_results`, `agent_audit_log`.
**Delivery:** `delivery_orders`, `pos_delivery_zones`.
**Otros:** `reservaciones`, `amalay_reservaciones`, `memories`, `chat_logs`, `whatsapp_*`, `prospects`, `push_subscriptions`, `ops_daily`.

> **El camino del dinero en 3 tablas:** una comanda vive en `pos_orders`, el cobro en efectivo mueve `pos_cash_movements`, el cierre de turno consolida en `pos_cierres`/`pos_turnos`, y la factura en `pos_facturas`. En prod real las 3 primeras están en **0 filas** — nunca ha corrido en campo.

---

## 9. ALTA DE UN CLIENTE NUEVO (provisioning)

### Cómo funciona
Automático e idempotente (~10-30s): [provision-tenant.ts](../dashboard-app/src/lib/provision-tenant.ts)
`provisionTenant()` (llamado por [api/platform/onboard](../dashboard-app/src/app/api/platform/onboard/route.ts))
crea `clients` + `client_locations` + menú/staff/pagos/mesas plantilla + auth user del dueño +
usuario del Local Server. CLI alterno: `scripts/bootstrap_client.py` (desde manifest JSON).

### Gaps de clonabilidad — estado VERIFICADO contra código (2026-09-02)

| Gap | Qué falta | Estado real (evidencia) |
|---|---|---|
| **G1b** Agentes multi-tenant | Los crons no iteran `clients` | ❌ **Abierto ✓verificado.** `CLIENT_ID … \|\| 'amalay'` en [agents-daily.yml:15](../.github/workflows/agents-daily.yml#L15), `tenants_activos.py:7`, `uber_sync.py:22`, `wansoft_backfill.py:31`. Existe `tenants_activos.py` (intento de iteración) pero los workflows siguen defaulteando a amalay. |
| **G3** Instalador pre-empaquetado | `.exe+config+printers` descargable; sacar `kds-ui.html` del .exe; huella (`fingerprint-service.exe`) copiada a mano | ❌ Abierto (ver §5, §7). |
| **G7/G8** Vault de credenciales | MP/Clip/CFDI por tenant | 🟡 **Parcial ✓verificado.** Tabla `credentials_vault` + UI (`/admin/vault`, `/internal/vault`) **existen**, pero los endpoints de pago **aún leen env global**: `TODO P0-H Phase 2` en [mp-point/route.ts:8](../dashboard-app/src/app/api/mp-point/route.ts#L8), `TODO P0-I` en [clip-pinpad/route.ts:4](../dashboard-app/src/app/api/clip-pinpad/route.ts#L4); Facturama es **mono-emisor** con RFC AMALAY hardcodeado ([facturama.ts:53](../dashboard-app/src/lib/facturama.ts#L53)). |
| **G10** Routing host→tenant | Columna `subdomain` + resolución por host | ❌ **Abierto ✓verificado.** Cero `subdomain` en migraciones ni en `data.ts` (grep vacío). |
| **G11** Alertas al canal del clon | Scripts alertan a `TELEGRAM_CHAT_ID_DANIEL` | 🟡 Reportado (INFERIDO de doc; no re-verificado exhaustivamente). |
| **D** IA clonable | Agentes Python leen `wansoft_*` (fuente muerta en un clon) | 🟡 Reportado en `CLONABILITY-FULL-ANALYSIS.md` (INFERIDO). |

**Lo que SÍ nace automático y aislado ✓:** fila `clients` + locations + menú/staff/pagos/mesas plantilla + auth user + RLS. **Lo manual hoy:** menú/recetas reales, alta de terminales Electron, env vars Vercel, DNS, cablear el vault, iterar agentes por tenant.

### Doc profundo
`docs/platform/PROVISIONING.md`, `docs/platform/GOLDEN-POS-SKELETON.md`, `docs/platform/CLONABILITY-FULL-ANALYSIS.md`.

---

## 9.1 PAGOS `[VERIFICADO ✓]`

### MercadoPago Point (terminal física)
Flujo: browser [mercadopago.ts](../dashboard-app/src/lib/mercadopago.ts) → proxy [api/mp-point/route.ts](../dashboard-app/src/app/api/mp-point/route.ts) → API MP (`/point/integration-api`).
- Crear intención: `sendPaymentToPoint()` → POST `/devices/{deviceId}/payment-intents` (monto en **centavos**). Polling `pollPaymentStatus()` cada 2s, máx 2 min. Cancelar/refund (solo Smart)/change-mode PDV↔STANDALONE.
- Config del device en `localStorage 'mp_point_config'` (accessToken, deviceId, model).
- **Recuperación de pago perdido** ([mp-payment-recovery.ts](../dashboard-app/src/lib/mp-payment-recovery.ts) sobre [recoverable-operation.ts](../dashboard-app/src/lib/recoverable-operation.ts)): máquina de 7 estados (`MP_STARTED→MP_APPROVED→…→RECONCILED/FAILED_MANUAL_REVIEW`), persiste en `localStorage 'mp_recovery_{mesa}'` **antes** de la llamada externa; estados `MP_APPROVED`/`RECONCILIATION_REQUIRED`/`FAILED_MANUAL_REVIEW` **bloquean** nuevos pagos hasta reconciliar. Idempotencia por `opId` reusado como `save_operation_id`.

### Clip pinpad
Proxy [api/clip-pinpad/route.ts](../dashboard-app/src/app/api/clip-pinpad/route.ts) → `api-gw.payclip.com/pinpad/v2` (`devices`/`payment`/`status`/`cancel`). Monto en **pesos con decimales** (ojo: distinto a MP). **Sin** módulo de recuperación (pendiente).

### Credenciales (hoy)
`process.env.MP_ACCESS_TOKEN || clientToken` y `process.env.CLIP_API_KEY || clientApiKey` — **env global**, no por tenant (gap G7/G8).

---

## 9.2 FACTURACIÓN CFDI `[VERIFICADO ✓]`

PAC único: **Facturama** ([facturama.ts](../dashboard-app/src/lib/facturama.ts)) — no hay facturapi. Sandbox = multiemisor `/api-lite` con CSD de pruebas; producción = **mono-emisor** `/3/cfdis` con CSD real de AMALAY (RFC AFO200806JI0).
- **Endpoints:** `factura` (crea solicitud desde QR del ticket, público, **recalcula total real** de `pos_orders`, bloquea duplicados por `order_id`, filtra GET/PATCH por `client_id`); `factura/timbrar` (resuelve `client_id` de `client_users` en DB, timbra estados pendiente/error, guarda folio fiscal/PDF/XML + email); `factura/complemento-pago` (CFDI tipo P para PPD); `factura/descarga` (proxy PDF/XML con credenciales en servidor).
- **Parser de XML de proveedores:** [cfdi-xml-parser.ts](../dashboard-app/src/lib/cfdi-xml-parser.ts) (100% browser, fuzzy-match concepto→ingrediente).
- **Emisor fiscal:** NO por tenant — CSD vive en la cuenta Facturama de AMALAY + env globales. Es **mono-emisor** hoy.

> ⚠️ **Posible fuga cross-tenant detectada (a auditar):** `factura/descarga` no valida que el `fid` pertenezca al tenant que lo pide, y `factura/complemento-pago` no filtra por `client_id`. Confirmar y cerrar.

---

## 10. AGENTES IA

### Cómo funciona
~40 scripts Python (`.github/scripts/*.py`) corren en cron (GitHub Actions) o on-demand vía el
orquestador de Telegram. Leen datos (Supabase/OCM), razonan con Groq/Claude, y alertan por Telegram,
logueando en `agent_runs`. En la app: chat/coach/voz.

### Archivos clave
Fraude/ops: `antifraud_agent.py`, `anomaly_detector.py`, `close_predictor.py`, `menu_engineering.py`…
Orquestación: `orquestador.py`, `agent_common.py`, `tenants_activos.py`.
Motor en app: `src/lib/agents/{engine,finance,fraud,inventory,operations,staff}.ts`, `src/lib/pos-daily.ts`.

### Doc profundo
`docs/ai/OVERVIEW.md`, `docs/ai/ARQUITECTURA-CRUCE.md`, `CLAUDE.md` §War Room.

---

## 11. DELIVERY — Uber Eats + Rappi `[VERIFICADO ✓]`

Ambas integraciones comparten patrón: webhook con firma HMAC → normaliza a orden canónica → persiste en `delivery_orders` → mapea tienda→tenant. El mapeo vive en `integration_store_mappings` (`provider_store_id` → `client_id`); **sin mapping → DLQ, nunca cae a otro tenant** (`resolveClientId` es DB-only).

### Uber Eats (más maduro)
- **OAuth:** `auth/initiate` (state CSRF en cookie httpOnly, TTL 600s) → `auth/callback` (valida CSRF, intercambia code, `upsertProvider` + `upsertStoreMapping`).
- **Endpoints:** `menu` (sube menú / marca OOS), `order` (accept/deny/cancel/ready), `store` (pausar/activar), `stores` (listar, solo sandbox), `webhook` (HMAC-SHA256 `x-uber-signature` + dedup + persiste + DLQ), `reconcile` (órdenes atascadas >30min → DLQ).
- **Estado ✓verificado:** `status:'active'` pero `certification_state:'uncertified'` ([auth/callback:63](../dashboard-app/src/app/api/integrations/uber-eats/auth/callback/route.ts)). ⚠️ **Bloqueador de producción en código:** tokens guardados en columnas `_enc` pero **aún sin cifrar** (`TODO: envelope encryption before production go-live`).

### Rappi (implementado, gated por credenciales)
- **Endpoints:** `webhook` (push-first: ACK 200 inmediato + procesa en background), `order` (accept/ready/reject/cancel), `menu` (**dev-only**: 409 fuera de dev), `poller` (fallback pull), `status`, `health`, `onboarding/register`+`onboarding/callback` (registro de webhook con firma).
- **Estado ✓verificado:** no es skeleton (hay OAuth, HMAC, ingest, order-sync). Gated por env: `assertRappiConfigured` lanza si falta `RAPPI_CLIENT_ID/SECRET/STORE_ID`; menú bloqueado fuera de dev. El bloqueo por T&C es **INFERIDO** del gating, no hay flag explícito.

> Nota: la etiqueta "P1-D10A" del análisis de clonabilidad no existe en `src/` (INFERIDO/obsoleto). El mapeo real es `integration_store_mappings`.

---

## 12. ROLES, PERMISOS Y SEGURIDAD `[VERIFICADO ✓]`

- **Roles** ([roles.ts:7](../dashboard-app/src/lib/roles.ts)): `dueño | gerente | capitan | cajero | mesero | staff`. `canAccessPage()` gatea páginas; los overrides por empleado **solo restringen, nunca elevan**. `POS_ONLY_ROLES` (mesero/staff/cajero) redirigen a `/pos`.
- **Permisos POS** ([pos-permissions.ts](../dashboard-app/src/lib/pos-permissions.ts)): **57 flags** booleanos en 7 categorías (cuentas, descuentos, impresión, caja, reportes, config, roles). 5 perfiles predefinidos (admin/gerente/capitan/cajero/mesero). `cancelar_ordenes` marcado "CRITICO — solo admin".
- **Shift token** ([shift-token.ts](../dashboard-app/src/lib/shift-token.ts)): identidad de terminal SIN sesión Supabase. `base64url(payload).base64url(HMAC-SHA256)`, secreto `SHIFT_TOKEN_SECRET`, TTL 8h. Payload lleva `cid` (tenant) firmado.
- **Auth de API** ([api-auth.ts](../dashboard-app/src/lib/api-auth.ts)): `withPOSAuth` acepta shift token O sesión Supabase; **`clientId` SIEMPRE server-side, nunca del header**; multi-membresía sin header → falla cerrado. `api-guard.ts` `sameOriginOnly` = anti-CSRF en mutaciones.
- **Aprobación de gerente** ([manager-approval.ts](../dashboard-app/src/lib/manager-approval.ts)): online valida shift token firmado + nivel de rol + mismo tenant; offline = device-trust (PBKDF2 10k iteraciones, TTL 16h) — **no** firma criptográfica.
- **PIN:** `staff-pin.ts` genera PIN de 10 dígitos (rejection sampling); `pin-throttle.ts` anti-fuerza-bruta con clave `clientId:ip` (FAIL_MAX=8, lockout 15min, RPC atómica Postgres).
- **Plataforma:** `platform-auth.ts` (fail-closed contra GoTrue + RPC `is_platform_admin`), `platform-2fa.ts` (step-up 2FA por email, HMAC-SHA256, TTL 12h).
- **Guardianes** ([seguridad/guardianes-api.ts](../dashboard-app/src/lib/seguridad/guardianes-api.ts)): registro único de qué guardián protege cada ruta; declara `HUECOS_CONOCIDOS` (deuda).

> ⚠️ **Posturas fail-open / bugs ✓verificados (a endurecer):**
> - Varios controles son **grace/fail-open por default** y solo se vuelven duros con flags (`POS_APPROVAL_STRICT`, `PLATFORM_2FA_ENFORCED`, `*_STRICT`). Sin ellos, `verifyManagerApproval` devuelve `ok:true` aun **sin** aprobación.
> - **Inconsistencia de niveles de rol:** `manager-approval.ts:16` no incluye `dueño` (→ nivel 0), mientras `api-auth.ts:148` sí (`dueño:6`). Un `dueño` aprobando online podría no alcanzar `minLevel`.
> - `pos-manager-auth.ts` usa un **salt fallback fijo** si no hay localStorage.
> - `internal-auth` compara con `===` sin rate-limit (declarado en `HUECOS_CONOCIDOS`).

---

## 13. INVENTARIO Y COSTEO `[VERIFICADO ✓]`

- **`recordMovement()`** ([inventory.ts:121](../dashboard-app/src/lib/inventory.ts)) — único punto transaccional de stock. Escribe al **ledger inmutable** `pos_inventory_movements` (append-only), luego materializa `pos_inventory.stock` y `pos_ingredients.cost_per_unit`. Si el PATCH final falla, el stock se reconstruye con `SUM(quantity)`. Costo = **promedio ponderado**. Idempotente por `idempotency_key`. Prohibido escribir stock/costo directo.
- **Política de inventario** ([inventory-policy.ts](../dashboard-app/src/lib/inventory-policy.ts)): `InventoryPolicyService` carga `pos_item_inventory_policy` al arranque, lookup O(1) de `inventory_mode` en el pago sin red, con caché LKG en localStorage (WARM <7d / STALE 7-30d / descartado >30d). Fail-open → modo legacy.
- **Motor de costo** ([cost-engine.ts](../dashboard-app/src/lib/cost-engine.ts) vía [api/food-cost/calculate](../dashboard-app/src/app/api/food-cost/calculate/route.ts)): **corre en servidor** (prohibido en cliente), puro/derivado (no persiste), recursión de sub-recetas con protección de ciclos (prof. máx 10).
- **Capa dual de recetas** ([recipe-derivation.ts](../dashboard-app/src/lib/recipe-derivation.ts)): capa **costeo** = `pos_recipes.ingredientes` (jsonb); capa **depleción** = `pos_recipes_old` (plano, con `ingredient_id` real). `deriveRecipeLines()` explota combos/sub-recetas hasta insumo crudo. **Sin este módulo un tenant tiene costeo/IA pero el POS nunca rebaja stock.**
- **Auto-86 ✓verificado:** NO apaga productos solo. La página `auto86` solo **visualiza** críticos (`stock < reorder_point`); el agente `auto86_agent.py` solo **alerta** por Telegram. El apagado lo decide un humano.

---

## 14. TURNOS Y CORTES `[VERIFICADO ✓]`

- **Día de venta** ([dia-de-venta.ts](../dashboard-app/src/lib/dia-de-venta.ts)): arranca **05:00** (`business_day_start_local`, configurable por cliente); antes de esa hora, el instante pertenece al día anterior.
- **Arqueo** ([pos-arqueo.ts](../dashboard-app/src/lib/pos-arqueo.ts)) `calcEfectivoEsperado()`:
  `fondoInicial + ventasEfectivo + propinaEfectivo + depositos − retiros − propinasNoEfectivo`. `diferencia = contado − esperado`.
- **Corte X** (`/pos/turno`): reporte parcial, turno **sigue abierto**. **Corte Z** ([CierreCajaWizard.tsx](../dashboard-app/src/components/pos/CierreCajaWizard.tsx)): requiere permiso `corte_z` (PIN/huella); escribe `pos_cierres` + PATCH `pos_turnos`, offline-first (IDB → cola de sync → Supabase best-effort).
- **Gate de turno** ([TurnoGate.tsx](../dashboard-app/src/components/pos/TurnoGate.tsx)) estados: `active | none | stale (día anterior→Corte Z) | conflict (>N turnos) | sesion (401/403, reautenticar)`. **Regla de Eduardo:** con cuentas abiertas vivas no se abre turno hasta cancelarlas (auditado, nunca DELETE).

> ⚠️ **Incidente real documentado inline:** un filtro corrido un parámetro dejó un PATCH **sin filtro** que cerró los 11 turnos de AMALAY al mismo milisegundo. Por eso hoy todo PATCH de turno va con `id=eq.${turnoId}` y el estado `sesion` evita crear turnos duplicados.

---

## Apéndice — índice de código

| Subsistema | Entrada / contrato | Tests |
|---|---|---|
| POS web | `src/app/pos/*`, `src/lib/pos-data.ts` | `src/__tests__/` |
| Offline | `public/sw.js`, `src/lib/pos-offline-db.ts` | `e2e/offline.spec.ts`, `e2e/multiterminal-offline.spec.ts` |
| Event store | `src/lib/bridge-client.ts` → `local-server/core/event-store.js` | `local-server/tests/event-store.test.js` |
| KDS | `src/app/pos/cocina`, `local-server/core/ws-hub.js` | `local-server/tests/kds-ws.test.js` |
| Electron | `electron-app/main.js` | `local-server/tests/*` (26) |
| Impresoras | `src/lib/printer.ts` → `local-server/adapters/printer.js` | `local-server/tests/printer-*.test.js` |
| HID | `src/app/pos/huella`, `src/lib/fingerprint-url.ts` | — |
| Multi-tenant | `src/lib/data.ts`, `scripts/sql/migrations/003_rls_policies.sql` | `scripts/clone-test.sql`, `ti_checks.sql` |
| Provisioning | `src/lib/provision-tenant.ts` | `local-server/tests/provisioning-wizard-contract.test.js` |
| Agentes | `.github/scripts/*.py`, `src/lib/agents/` | `.github/scripts/test_*` |

---

*Mantener vivo: al cambiar un subsistema, actualiza su sección aquí. Router general: `docs/DECISION-BRAIN.md`.*
