# FULLSITE CLONABLE CORE V1 — Documento Canónico

**v1.0 — 2026-08-07 · Consolidación de la auditoría READ-ONLY de clonabilidad**
**Clasificación: Interno — Fundador / Equipo Técnico**
**Estado: DISEÑO APROBADO PARA REVISIÓN — SIN IMPLEMENTAR. Cero cambios de runtime, cero migraciones, release 1.3.4 y producción intactos.**

> Objetivo: instalar Fullsite en restaurante #2, #3, #5, #10+ sin forks de código
> ni configuración manual duplicada. POS, KDS y Dashboard son TRES aplicaciones
> independientes que comparten una fuente canónica de configuración del
> restaurante — nunca memoria ni estado.

## DECISIONES DEL FUNDADOR (2026-08-07 — vinculantes para este diseño)

- **D-A:** F0 (sellado de identidad en datos operativos) se implementa **DESPUÉS**
  de la visita física de AMALAY. No se toca el release 1.3.4 antes del field
  acceptance.
- **D-B:** El Configuration Plane es **MULTI-TENANT COMPARTIDO por default**,
  protegido por auth/RLS/membership real. Un Supabase por restaurante NO es la
  arquitectura principal; una instalación dedicada podrá existir como excepción
  enterprise, no como default.
- **D-C:** `organization` se **MODELA desde el inicio** del Clonable Core; sus
  capacidades avanzadas de grupo se activan después. Grupo Galería es test
  case, no driver del diseño.

Reglas heredadas: la configuración AMALAY vive en manifest/config/onboarding,
nunca en branches de runtime (`feedback: provisioning engine direction`).
Wansoft se usa para semántica operativa y edge cases, no para copiar UI,
arquitectura ni deuda histórica.

---

# PARTE I — ESTADO ACTUAL (EVIDENCIA)

## 1. Current Architecture

- **Un solo repo de frontend, tres aplicaciones reales:**
  - **POS** = `dashboard-app/src/app/pos/**` servido por **Electron**
    (`electron-app/main.js` + Bridge `local-server/` en puerto 7717, config
    local por terminal).
  - **KDS** = la misma web app en `/pos/cocina` | `/pos/kds`, envuelta por
    Electron en modo kiosk (`kds_only:true`); `electron-kds` es un wrapper
    kiosk con auto-login. La estación que muestra la decide **la URL**.
  - **Dashboard** = rutas no-`/pos` de `dashboard-app`, desplegado en Vercel.
- **Datos:** Supabase multi-tenant (75 tablas, snapshot
  `scripts/sql/migrations/010_consolidated_core.sql`), RLS por
  `auth_client_id()`; invariante congelado en
  `docs/architecture/SYSTEM-ARCHITECTURE.md`: toda tabla con datos de tenant
  lleva `client_id TEXT`.
- **Jerarquía efectiva HOY:** `clients` (tenant ≡ sucursal colapsados) →
  terminales como archivos locales (`config.json`, `printers.json`) fuera del
  modelo de datos cloud.
- **Fortaleza real:** runtime e invariantes congelados (POS-SPEC v2.1 FREEZE):
  turno como contenedor, guards, audit log inmutable, offline exactly-once
  (soak 4h + twin certificados), escalation con registro de autorizador.
- **Debilidad real:** exactamente donde vive el Clonable Core — **entidades de
  configuración por tenant** (catálogos, políticas, matrices, overrides). De
  25 settings P0 de la Settings Bible, 11 pendientes son de este tipo; de 25
  P1, 22.

## 2. POS / KDS / Dashboard como sistemas independientes

| | POS | KDS | Dashboard |
|---|---|---|---|
| Proceso | Electron + Bridge local | Electron kiosk (misma app web) | Browser (Vercel) |
| Vida offline | Crítica (turno completo) | Crítica (WsHub LAN primario, KDS-02) | No requerida |
| Estado compartido | NINGUNO (protocolo WS + eventos) | NINGUNO (snapshot+delta por WS) | NINGUNO (PostgREST) |
| Identidad | `config.json` local (terminal_id) | `config.json` (`kds_only`) + URL | JWT `app_metadata` |

Principio de diseño confirmado: **no crear un mega-monolito**. El Clonable Core
es una fuente canónica de configuración que cada app consume por su propia vía
(Bridge cache para POS/KDS offline; PostgREST para Dashboard).

## 3. Source-of-Truth Hierarchy (actual, con conflictos)

Precedencia real observada hoy (de más a menos autoritativa, por dominio):

1. **Datos operativos**: event ledger local (`events.ndjson` +
   `processed-commands.ndjson`) → Supabase tras sync. Sólido.
2. **Menú/staff/pagos/mesas**: tablas `pos_*` por `client_id` → cache IDB.
   Sólido, con residuos estáticos (ver §4 N-01).
3. **Settings operativos**: `clients.pos_settings` JSONB con registry tipado
   (`dashboard-app/src/lib/settings.ts`) — mecanismo correcto, cobertura de
   solo 5 keys de ~111 settings catalogados en SETTINGS-BIBLE.
4. **Hardware/terminal**: `config.json` + `printers.json` locales — HOY son la
   ÚNICA verdad (RUNTIME-SPEC §3.3 declara hardware autoritativo en el
   Runtime). Contradice el principio anti-Wansaoft "config en la nube,
   versionada, con rollback" (GAP-ANALYSIS).
5. **Manifest** (`scripts/manifests/*.json`): "source of truth" de onboarding
   con **drift ya observado** contra `clients` (razón social difiere entre
   manifest y deployment profile; routing existe en manifest, en P1-D03 y en
   `STATION_CATEGORIES` hardcoded).

## 4. Los 20 hardcodes encontrados (verificados contra código, 2026-08-07)

### 4.1 Registro existente (docs/product/HARDCODE-REGISTRY.md) — estado actual

| ID | Archivo:línea | Estado | Clasificación | Bloqueo p/cliente #2 |
|---|---|---|---|---|
| HC-01 tarjetas-regalo | `admin/tarjetas-regalo/page.tsx:38` | CERRADO (`useClientId()`) | GENERIC ALREADY | Ninguno |
| HC-02 vault dropdown | `admin/vault/page.tsx:188`, `internal/vault/page.tsx:177` | CERRADO (dinámico) | GENERIC ALREADY | Ninguno |
| HC-03 chat-logs badge | `internal/chat-logs/page.tsx:159` | VIGENTE (cosmético) | HARDCODED | Ninguno real |
| HC-04/05/06 IA lee wansoft_daily | `api/chat/route.ts`, `api/coach/route.ts`, `api/inventory/predict/route.ts` | **VIGENTE** (OCM v0.1 congelado, no aplicado) | MISSING MODEL | Chat/Coach/predicción **vacíos** para `data_source='fullsite'` |
| HC-07 workflows GitHub | `.github/workflows/*.yml`, `.github/scripts/*.py` | VIGENTE | CLIENT-SPECIFIC | Agentes/briefings sin valor p/#2 |
| HC-08 SSR fallback | `lib/pos-config.ts:26-31` | CERRADO (defaults vacíos) | GENERIC ALREADY | Ninguno |
| HC-09 floor plan | `lib/pos-data.ts:1235-1272` (`if (clientId === 'amalay') return MESAS_CONFIG` :1267) | **VIGENTE** | PARTIALLY CONFIGURABLE | #2 solo grilla; falta `pos_floor_plans` |
| HC-10 health | `api/health/route.ts:16,32` | VIGENTE | HARDCODED | Falso negativo de monitoreo |
| HC-11 email map | `lib/client-config.ts:171-176` | CERRADO parcial (queda `demo@`) | GENERIC ALREADY | Ninguno |

### 4.2 Hallazgos nuevos del barrido (N-01..N-20)

| # | Archivo:línea | Qué es | Clasificación | Bloqueo p/cliente #2 |
|---|---|---|---|---|
| N-01 | `lib/pos-data.ts:827-~1190` | `MENU_CATEGORIES` — menú AMALAY completo estático (los "84 items"). Runtime real usa `pos_menu_*` por client_id + IDB. **3 consumidores vivos del estático:** `lib/printer.ts:1093` (lookup comanda), `app/menu/[mesa]/page.tsx:4` (menú QR), `lib/pos-promos.ts:193` | CLIENT-SPECIFIC | QR e impresión pueden caer al menú AMALAY en cualquier tenant |
| N-02 | `lib/pos-data.ts:697-775` | `RECIPE_ALIASES` AMALAY↔Wansoft + phase-gate fuzzy (:775) | CLIENT-SPECIFIC | Contaminación de deducción si gate ≠ disabled |
| N-03 | `lib/pos-data.ts:2409-2416` | `MARKET_CATEGORY_PREFIX='mkt-'` + `DIRECT_STOCK_CATEGORIES` con `'mkt-amalay'` | PARTIALLY CONFIGURABLE | Convención impuesta; slug inofensivo |
| N-04 | `lib/pos-constants.ts:89-193` | `CATEGORY_TO_STATION` + `CAJA_KEYWORDS` (incl. `'amalay -'` :189) + `BEBIDA_KEYWORDS`; override vía setting `pos.station_routing`; default del registry en `lib/settings.ts:58` también AMALAY | PARTIALLY CONFIGURABLE | Sin override configurado, #2 rutea con keywords de AMALAY |
| N-05 | `lib/settings.ts` | Settings Contract (`clients.pos_settings` + registry tipado, 5 keys) | CONFIGURABLE | — (mecanismo correcto, cobertura corta) |
| N-06 | `lib/date-mx.ts:1` + `lib/data.ts:439` | `TZ='America/Mexico_City'` hardcoded + offset `-06:00` literal; `clients.timezone` existe y **nadie la lee** | HARDCODED | Cliente fuera de UTC-6 → business date/cortes corridos |
| N-07 | `app/pos/kds/page.tsx:45-56` | `STATION_KEYWORDS` léxico café/brunch + `caja→'panaderia'` + `Station='cocina'\|'panaderia'\|'barra'` como TYPE | HARDCODED | **El hardcode más profundo**: estaciones no configurables |
| N-08 | `app/cocina/page.tsx:458` | Keyword map propio con `'combo amalay'` (vista cocina Dashboard) | HARDCODED | Igual que N-07 en Dashboard |
| N-09 | `components/POSCopilot.tsx:60-71` | `COMBO_RULES` (combo gated `clientId:'amalay'` — patrón correcto, data en código) | PARTIALLY CONFIGURABLE | Sugerencias no configurables |
| N-10 | `app/pos/mesas/page.tsx:736` | `_cid()==='amalay'` toggle planograma | CLIENT-SPECIFIC | #2 sin vista plano (deriva de HC-09) |
| N-11 | `lib/agents/finance.ts:50` | `if (clientId !== 'amalay') return events` | CLIENT-SPECIFIC (gate intencional) | Agente inerte p/#2 |
| N-12 | `app/reservar/page.tsx:118` | Reservas gated a `NEXT_PUBLIC_DEFAULT_CLIENT_ID==='amalay'` + link cafeamalay.com (:239) | CLIENT-SPECIFIC | Feature inexistente p/#2 |
| N-13 | `lib/roles.ts:20` | `RELEASE_HIDDEN_PAGES` global (flag de release, no per-tenant) | HARDCODED (intencional) | Oculta a todos por igual |
| N-14 | `lib/pos-permissions.ts` | ~50 permisos POS por rol EN CÓDIGO (defaults estilo Wansoft) | PARTIALLY CONFIGURABLE | Ajustar permisos de #2 = editar código |
| N-15 | `lib/pos-constants.ts:226-233` | `PAYMENT_METHODS` base + catálogo `pos_payment_methods` por tenant | CONFIGURABLE | Ninguno |
| N-16 | `lib/plans.ts` | Planes/páginas por plan en código (catálogo de producto) | GENERIC ALREADY | Ninguno |
| N-17 | `electron-app/main.js:17,121` | Paths legacy `C:\fullsite\*` (solo migración read-only) | GENERIC ALREADY | Ninguno |
| N-18 | `api/export/polizas/route.ts:1` | 'amalay' en comentario | GENERIC ALREADY | Ninguno |
| N-19 | `app/page.tsx:778`, `app/mission-control/page.tsx:36` | Labels `weekly-amalay` (deriva de HC-07) | CLIENT-SPECIFIC | Cosmético |
| N-20 | `app/food-cost/page.tsx:68` | Exclusión `'granola amalay'` | CLIENT-SPECIFIC | Ruido menor |

## 5. Config Duplication (completa)

1. **Routing de estaciones en 4 lugares que pueden divergir:**
   `pos-constants.ts` (CATEGORY_TO_STATION + keywords) · setting cloud
   `pos.station_routing` (`clients.pos_settings`, P1-D03) ·
   `app/pos/kds/page.tsx` (STATION_KEYWORDS propio + remapeo caja→panaderia) ·
   `app/cocina/page.tsx:458` (keyword map propio). **Una misma orden puede
   rutearse distinto en POS, KDS y vista cocina.**
2. **Nombres de estación incompatibles:** POS `cocina/barra/caja` (caja
   etiquetada "MARKET" en STATION_LABELS); KDS `cocina/panaderia/barra` con
   traducción `caja→panaderia`. "caja/market/panaderia" = tres conceptos según
   la app.
3. **Identidad de personas bifurcada:** `client_users` (auth dashboard) vs
   `pos_staff` (PINs POS) sin vínculo.
4. **Timezone:** manifiestos escriben `clients.timezone='America/Monterrey'`;
   todo el código usa `date-mx.ts` (`America/Mexico_City`). Config almacenada
   que nadie consume.
5. **Menú:** POS lee DB+IDB; menú QR y `printer.ts` importan aún el estático
   AMALAY (N-01).
6. **printers.json local por terminal** vs
   `scripts/manifests/AMALAY-DEPLOYMENT-PROFILE/printers.json` (declarativo de
   campo): el perfil es documentación, no fuente que la app consuma.
7. **Manifest ↔ clients/pos_settings:** doble source-of-truth con drift real
   observado (razón social, routing triplicado).

## 6. Tenant Resolution Paths (actuales — tres mecanismos)

| App | Camino | Riesgo |
|---|---|---|
| Dashboard | JWT `app_metadata.client_id` → tabla `client_users` → email map legacy (`client-config.ts`) → escribe localStorage `fullsite_client_id` | El bug vantara #1 (auth user sin app_metadata) sigue SIN aplicarse en `onboard_client.py` |
| POS/KDS (Electron) | `config.json` → inyección Electron a localStorage (`main.js:633-637`); enforcement minúsculas (fixes `3484962`+`11c9573` — caso "amalay" vs "Amalay") | Correcto; sólido |
| Fallback web | env `NEXT_PUBLIC_DEFAULT_CLIENT_ID` (`lib/data.ts:49-56`) | **Implica un deploy Vercel por cliente** o slug vacío — incompatible con multi-tenant compartido (D-B). Debe morir |

KDS remoto adicional: `?bridge=IP` (`app/pos/kds/page.tsx:195-201`).

---

# PARTE II — MODELO CANÓNICO PROPUESTO

## CANONICAL IDENTITY MODEL

> Se define ANTES de recomendar columnas para que exista UNA sola migración de
> identidad, no dos. Regla transversal: los IDs de identidad son **inmutables
> post-creación**; lo mutable son atributos, nunca la identidad. Todo evento
> operativo sella su contexto de identidad al crearse — nunca se deriva
> retroactivamente.

### organization_id
- **Representa:** el grupo empresarial (puede tener 1..N tenants). Modelada
  desde el día 1 (D-C); capacidades de grupo se activan después.
- **Crea:** provisioning (paso CREATE GROUP). Para independientes se crea una
  organization implícita 1:1 con el tenant (costo cero, evita backfill futuro).
- **Mutabilidad:** ID inmutable; atributos (razón social del grupo, logo) mutables.
- **Vive en:** cloud (`organizations`) — Configuration Plane.
- **Consumen:** Dashboard (consolidación, permisos de grupo). POS/KDS NO la
  necesitan en runtime (la reciben implícita vía tenant).
- **En eventos:** NO se persiste en el envelope operativo (derivable de
  tenant→org, relación inmutable). Excepción: si algún día un tenant pudiera
  cambiar de org, la relación se versiona en el plane — nunca se reescribe historia.
- **Derivable:** org←tenant SÍ (lookup). **Nunca derivar:** membership de
  usuarios a orgs desde emails/dominios.

### tenant_id
- **Representa:** el cliente comercial (hoy `clients.id`, ej. `'amalay'`).
  Contrato, plan, features, facturación de Fullsite.
- **Crea:** provisioning (CREATE TENANT). Slug en minúsculas — invariante ya
  forzado en código.
- **Mutabilidad:** inmutable (renombrar = display_name, nunca el slug/ID).
- **Vive en:** cloud (`clients`, se conserva la tabla). RLS raíz: D-B —
  proyecto Supabase COMPARTIDO multi-tenant por default; `auth_client_id()` +
  membership real; instalación dedicada = excepción enterprise futura.
- **Consumen:** las tres apps (POS/KDS vía config.json→localStorage; Dashboard vía JWT).
- **En eventos:** SÍ — ya se sella (`restaurant_id` en el envelope; probado por
  el gate de tenant-isolation del twin).
- **Nunca derivar:** de emails, dominios ni env vars por deploy
  (`NEXT_PUBLIC_DEFAULT_CLIENT_ID` debe eliminarse como mecanismo).

### branch_id
- **Representa:** la sucursal física — unidad operativa real (timezone,
  horario, fiscal local, fondo, mesas, estaciones, impresoras).
- **Crea:** provisioning (CREATE BRANCH). Todo tenant nace con ≥1 branch
  explícita (`{tenant}-main` NO: usar UUID + slug legible; hoy coexisten dos
  convenciones incompatibles — `'amalay-spgg'` default hardcoded vs
  `${clientId}-main` del onboarding: unificar en la migración F0).
- **Mutabilidad:** ID inmutable; atributos mutables versionados.
- **Vive en:** cloud (`client_locations` se ACTIVA y se vuelve real, no se
  crea tabla nueva).
- **Consumen:** las tres apps. POS/KDS la reciben en el bootstrap del terminal
  (config.json cachea `branch_id`).
- **En eventos:** SÍ — sellada en toda fila operativa desde F0
  (`pos_orders`, `pos_turnos`, `pos_cierres`, `pos_cash_movements`,
  movimientos de inventario, audit). Ver §25: cada día sin branch_id agranda
  el backfill.
- **Nunca derivar:** branch desde terminal retroactivamente para datos ya
  escritos (por eso se sella al crear).

### terminal_id
- **Representa:** una instalación física de la app (PDV, caja, KDS device).
- **Crea:** el wizard de provisión del terminal (ya genera UUID en
  `config.json`); F2 lo REGISTRA en cloud (`terminals {id, branch_id, role,
  nombre, provisioned_at}`) — el wizard reporta al plane, el plane no lo inventa.
- **Mutabilidad:** inmutable por instalación (reinstalar = nuevo terminal_id +
  baja del anterior; la historia del viejo queda ligada a su ID).
- **Vive en:** verdad = cloud (registro); cache/bootstrap = `config.json`
  local (sigue existiendo — ver CLOUD TRUTH / LOCAL CACHE abajo).
- **Consumen:** POS/KDS (identidad propia); Dashboard (SalesByTerminal, corte
  global multi-terminal, diagnóstico).
- **En eventos:** SÍ — hoy `pos_turnos`/`pos_orders` llevan string libre y
  `pos_audit_log.device_id` texto sin FK; desde F0 se sella el UUID canónico.
- **Nunca derivar:** de hostname/IP (volátiles — evidencia de campo AMALAY).

### station_id
- **Representa:** una estación de preparación/impresión (cocina-fría, barra,
  postres...). HOY es un enum de TypeScript + texto libre estampado — pasa a
  **catálogo dinámico por branch**.
- **Crea:** provisioning/Dashboard (CONFIG STATIONS). Set inicial por template
  de giro.
- **Mutabilidad:** ID inmutable; nombre/tipo mutables; desactivar ≠ borrar
  (la historia referencia el ID).
- **Vive en:** cloud (`stations {id, branch_id, nombre, tipo}`), cacheada al
  Bridge y al KDS.
- **Consumen:** POS (estampa routing al capturar), KDS (renderiza por catálogo
  — mata keywords N-07/N-08), Bridge/impresión (resuelve estación→impresora),
  Dashboard (config + reportes).
- **En eventos:** SÍ — `items[].station_id` (además del nombre legible como
  snapshot, patrón ya usado en name/price).
- **Nunca derivar:** por keywords del nombre del platillo (el patrón actual a
  extinguir).

### user/person_id
- **Representa:** UNA persona. Unifica la bifurcación actual
  `pos_staff` (PIN/huella, operación) ↔ `client_users` (auth dashboard):
  `persons {id}` + credenciales como facetas (pin_hash, fingerprint_id,
  auth_user_id) + memberships por tenant/branch con perfil de permisos.
- **Crea:** provisioning (CONFIG STAFF) o Dashboard admin.
- **Mutabilidad:** ID inmutable; roles/credenciales mutables y versionados
  (revocación con timestamp — caso "empleado revocado offline" del gauntlet).
- **Vive en:** cloud; cache offline en POS (ya existe: `pos_staff_cache`,
  PBKDF2, TTL 24h, jerarquía de escalation — se conserva el mecanismo).
- **Consumen:** POS (PIN/escalation), Dashboard (login/roles). KDS no.
- **En eventos:** SÍ — actor y autorizador ya se sellan (`authorized_by`);
  pasa de nombre/rol a person_id + snapshot de nombre.
- **Nunca derivar:** identidad desde el email map legacy (HC-11 residual).

### business_date
- **Representa:** el día OPERATIVO/fiscal (≠ día calendario; el cierre de la 1
  a.m. pertenece al día anterior). Derivado de `branch.timezone` +
  `branch.operating_hours` / `business_day_start_local` (columna ya existente
  y no consumida).
- **Crea:** el Bridge/POS al abrir turno y al crear cada orden — **se sella**.
- **Mutabilidad:** inmutable una vez sellado en el evento/orden/turno/corte.
- **Vive en:** regla en cloud (config de branch); valor sellado en datos
  operativos.
- **Consumen:** POS (corte Z), Dashboard (todo reporte diario), agentes.
- **En eventos:** SÍ, SIEMPRE (hoy no existe → toda la ambigüedad nocturna).
- **Nunca derivar:** retroactivamente desde timestamps con la timezone
  hardcodeada actual (N-06) — exactamente el bug que esto elimina.

### config_version
- **Representa:** la versión del árbol de configuración vigente cuando ocurrió
  algo. Base del "config en la nube, versionada, con rollback" (la promesa
  anti-Wansoft) y del diagnóstico ("¿con qué routing se imprimió esta comanda?").
- **Crea:** el Configuration Plane en cada cambio
  (`config_versions {branch_id, dominio, payload, changed_by, ts}`).
- **Mutabilidad:** append-only. Rollback = nueva versión que restaura payload.
- **Vive en:** cloud; el Bridge cachea "última versión aplicada" y la reporta
  en `/health`.
- **Consumen:** las tres apps (lectura de config vigente); Dashboard
  (historial/rollback); soporte (diagnóstico).
- **En eventos:** SÍ como referencia ligera (config_version vigente al sellar
  el evento) — permite reproducir el contexto exacto.
- **Nunca derivar:** el estado de config histórico desde el estado actual.

## CLOUD TRUTH / LOCAL CACHE / OPERATIONAL TRUTH

| Plano | Verdad canónica | Cache/bootstrap | Regla |
|---|---|---|---|
| **CLOUD TRUTH** (Configuration Plane) | organizations, clients, branches, terminals(registro), stations, printers+routing declarativo, mesas/áreas, menú/modifiers/recetas, persons/memberships/perfiles, security matrix, incentivos, catálogos de razones, payment methods, tips/tax/business-date policies, feature flags, integraciones, config_versions | — | Multi-tenant compartido (D-B), RLS + membership; TODO cambio versionado |
| **LOCAL CACHE** | — | `config.json` (identidad terminal + bootstrap), `printers.json` (routing materializado por terminal), IDB (menú/staff), caches del Bridge | **Siguen existiendo** — son bootstrap y garantía offline, NO la única verdad de entidades administrables centralmente. El wizard escribe local Y registra/lee del plane; divergencia detectable por config_version |
| **OPERATIONAL TRUTH** | Event ledger local (events.ndjson, processed-commands, print-queue) → Supabase tras sync | — | Append-only, exactly-once (probado); sella tenant/branch/terminal/station/person/business_date/config_version. La config NUNCA muta datos operativos pasados |

## 7. Canonical Entity Model (resumen estructural)

```
A. CONFIGURATION PLANE (cloud, versionado, cacheado local)
   organizations ── NUEVO (D-C: desde el día 1, capacidades después)
     └ clients (tenant — existe)
         └ branches (= client_locations ACTIVADA)
             ├ terminals (NUEVO en cloud; espejo del config.json)
             ├ stations (NUEVO: catálogo dinámico)
             ├ printers + routing (elevado de printers.json a declaración
             │   cloud con herencia branch → categoría → item → no_print)
             ├ pos_mesas + areas (zone TEXT → entidad)
             ├ service_modes, business_date_rule, tips_policy,
             │   tax_profiles (IVA+IEPS), suggested_tips
             ├ security_matrix + permission_profiles (datos, no código)
             ├ incentives (descuentos/cortesías/2x1/promos unificados)
             ├ catálogos de razones (cancelación/cortesía/retiro/merma)
             └ config_versions (todo cambio: autor, ts, payload, rollback)
   menu/categories/items(+stations[], price_overrides, tax_profile,
     incentive_flags, availability, barcode, no_print)
   modifier_groups(+order_types[]) / modifiers(+recipe_impact[])
   recipes(+yield_factor, type=subreceta, warehouse_id) / payment_methods(+categoría contable, currency)
   persons + memberships (unifica pos_staff ↔ client_users)
B. OPERATIONAL DATA: pos_orders/turnos/cierres/movimientos + branch_id,
   terminal_id, business_date, folios secuenciales por sucursal, z_sequence.
C. EVENT LEDGER: sin cambios de diseño (exactly-once probado); el envelope
   gana branch/terminal/business_date/config_version.
D/E/F. POS, KDS, Dashboard: consumidores independientes del plane.
```

## 8–18. Modelos por dominio (decisiones de diseño)

- **8. Organization/Tenant/Branch semantics:** org agrupa tenants; tenant es
  el contrato; branch es la operación. Config física SIEMPRE en branch (hoy
  colapsada en `clients`: mesas, footer, IVA, business_day_start — se
  reubican). Usuarios con membership por tenant y scope opcional por branch
  (requisito Wansoft "permisos por sucursal").
- **9. Terminal identity:** registro cloud + config.json como cache; roles
  `server_pos|pos|kds|admin` (ya existen); periféricos como slots
  (`terminal.peripherals[]`: drawer, huella, báscula futura).
- **10. Station model:** catálogo por branch; tipo (`preparacion|impresion|
  mixta`); `item.stations[]` ARRAY (Wansoft soporta 5 destinos/ítem);
  `no_print` explícito; el KDS filtra por station_id — muere el enum y los
  tres juegos de keywords.
- **11. Printer/routing:** impresoras como entidad cloud por branch
  (conexión tcp/usb/windows, copies, backup_id); routing con herencia 3
  niveles versionada; el Bridge materializa a printers.json (cache) y reporta
  la versión aplicada. Resuelve el conflicto RUNTIME-SPEC §3.3 (hardware
  autoritativo local) a favor del plane con cache local garantizado offline.
- **12. Menu/modifier/recipe:** estructura actual PARITY; se agregan CAMPOS
  día-1: `stations[]`, `price_base + price_overrides{contexto}`,
  `tax_profile{iva,ieps}`, `incentive_flags{descuento,dxu,cortesia}`,
  `availability{horario|dia|turno}`, `modifier.recipe_impact[]`,
  `recipe.yield_factor`, subrecetas, `warehouse_id`. Un solo catálogo
  (market = `item.type`, no módulo espejo).
- **13. Staff/user identity:** persons + facetas de credencial + memberships;
  el mecanismo offline actual (PBKDF2, TTL 24h, jerarquía) se conserva tal
  cual como cache del plane.
- **14. Business date/timezone:** regla por branch; sellado al crear; muere
  `date-mx.ts` hardcoded y el offset literal.
- **15. Permission/security:** `permission_profiles` (plantillas) + override
  individual + `security_matrix {operación × rol × política}` + flags de
  escalation por platillo/grupo/forma de pago/incentivo (los "6 catálogos"
  Wansoft, P0 #22) — todo datos, cacheado offline.
- **16. Configuration versioning:** `config_versions` append-only por
  branch+dominio; rollback instantáneo; `dashboard_audit_log` para cambios de
  config (hoy el audit cubre POS, no backoffice).
- **17. Operational data model:** columnas selladas de identidad (F0);
  folio secuencial por sucursal/turno junto al UUID (lección NetSilver #9);
  `z_sequence` consecutiva fiscal por branch; `incentive_applications[]` por
  orden (scope item|cuenta) en lugar del escalar `descuento`.
- **18. Event ledger/envelope:** el protocolo WS y el store NO cambian de
  diseño; el envelope agrega branch_id, terminal_id (ya viaja), business_date
  y config_version como campos sellados. Compatibilidad: campos nuevos
  opcionales para replay de eventos históricos.

---

# PARTE III — GAPS, PARIDAD WANSOFT Y RUTA

## 19. POS Skeleton Gaps (~85% genérico)

Menú/staff/pagos/mesas/turnos/cierres 100% por tenant (Supabase+IDB). Falta:
routing default con slugs AMALAY (N-04), estático residual con 3 consumidores
(N-01), RECIPE_ALIASES (N-02), floor plan hardcoded (HC-09/N-10), timezone
(N-06), permisos en código (N-14), incentivos como escalar, folios/z_sequence,
price/tax overrides.

## 20. KDS Skeleton Gaps (~60% genérico — el más lejano)

Transporte/bridge/terminal config genéricos y certificados (KDS-02 LAN-primario,
52/52 tests). TODO el modelo de presentación es hardcode: set de estaciones
como TYPE (`cocina|panaderia|barra`), clasificación por keywords del giro
café/brunch (N-07), remapeo caja→panaderia, estación decidida por URL. El KDS
skeleton = KDS que arranca de `terminal_id` + catálogo `stations` y renderiza
por `station_id` estampado, con cero léxico embebido.

## 21. Dashboard Skeleton Gaps (~80% genérico)

Auth/tenant/features/plan gating genéricos. Falta: capa IA sobre OCM
(HC-04/05/06 — con `data_source='fullsite'` chat/coach/predicción quedan
vacíos), health check consciente de data_source (HC-10), vista cocina con
keywords propios (N-08), selector de sucursal (BUG-004; `locationFilter()`
agrega todo), audit de cambios de config del backoffice, labels de workflows
AMALAY (N-19).

## 22. Mapa de paridad Wansoft (~90 conceptos, 14 dominios)

Leyenda STATUS: PARITY / PARTIAL / MISSING-CONFIG-ONLY (runtime lo soporta o es
trivial; falta la entidad de config) / MISSING-FEATURE / OUT-OF-SCOPE-V1.
Fuentes: WANSOFT-POS-BIBLE, SETTINGS-BIBLE (111 settings/26 dominios),
SETTINGS-GAP-ANALYSIS, CONFIGURABILITY-BIBLE, knowledge/wansoft/BIBLE,
LESSONS-NETSILVER (41 lecciones), POS-SPEC v2.1, RUNTIME-SPEC v1.1.

### 22.1 Grupo / Tenant / Sucursal

| WANSOFT CONCEPT | FULLSITE HOY | POS | KDS | DASH | CONFIG MODEL | OFFLINE | STATUS |
|---|---|---|---|---|---|---|---|
| Empresa (RFC, régimen, logo) | `clients` | Ticket/factura | n/a | Onboarding | `organization {rfc, razon_social, regimen, logo}` | Solo-cloud (cache p/ticket) | PARITY |
| Sucursal como unidad operativa | `clients` colapsa grupo+sucursal | Todo | Todo | Consolidación | `organization → branch`, branch_id en toda fila | Crítico turno | PARTIAL |
| Grupo multi-sucursal (consolidados, transferencias) | Consolidación listada; transferencias P2 | Bajo | n/a | Alto | `organization_id` + permisos por sucursal | Solo-cloud | PARTIAL |
| Timezone + horario (define el "día") | P0 #3 ✅ (columna existe; código no la lee — N-06) | Corte/business date | Timers | Reportes | `branch.timezone`, `operating_hours` | Crítico turno | PARITY(config)/FAIL(consumo) |
| Business date (día fiscal ≠ calendario) | No explícito; anclado a turno+timestamps | Corte Z | Timers nocturnos | Reportes diarios | `business_date` sellado (Identity Model) | Crítico turno | MISSING-CONFIG-ONLY |
| Moneda | Default MXN | Precios | n/a | Reportes | `branch.currency` | Crítico turno | PARITY |
| Data source switch | `clients.data_source` | Migración | n/a | Migración | Flag de plataforma | n/a | PARITY |

### 22.2 Terminales

| WANSOFT | FULLSITE HOY | POS | KDS | DASH | CONFIG MODEL | OFFLINE | STATUS |
|---|---|---|---|---|---|---|---|
| Terminal como entidad (tipo, config) | `terminal_id` string libre; tabla solo en SQLite del Runtime | Turnos/ventas | Identidad | SalesByTerminal | `terminals {branch_id, role, nombre}` cloud | Crítico turno | MISSING-CONFIG-ONLY |
| Rol de terminal (Caja=coordinador) | Runtime P8 por diseño | Coordinación | Event Bus | Diagnóstico | `terminal.role` + runtime_ip | Crítico turno | PARITY |
| Modo de terminal (completo/mesero/llevar/retail) | Tipos de orden sí; modo no | Pantalla captura | n/a | n/a | `terminal.mode`/preset | Crítico turno | PARTIAL |
| Corte Global multi-terminal | No (P1 #11) | Cierre consolidado | n/a | Corte del día | Agregable por branch sobre N turnos | Solo-cloud | MISSING-FEATURE |
| Config de botones (sliders) | No | UX | n/a | n/a | NO copiar; presets de densidad | n/a | OUT-OF-SCOPE-V1 |
| 2a pantalla/CashDro/báscula | Pospuesto explícito | Market | n/a | n/a | Slot `terminal.peripherals[]` | n/a | OUT-OF-SCOPE-V1 |

### 22.3 Estaciones + Impresoras + Routing

| WANSOFT | FULLSITE HOY | POS | KDS | DASH | CONFIG MODEL | OFFLINE | STATUS |
|---|---|---|---|---|---|---|---|
| Estación como catálogo | Enum TS hardcoded | Routing comanda | Pantallas | Config cocina | `stations {branch_id, nombre, tipo}` dinámico | Crítico turno | MISSING-CONFIG-ONLY |
| Ruteo grupo + override platillo + [NO IMPRIMIR] | Prioridad item→menú→keyword→default; herencia 3 niveles diseñada, no implementada | Comanda | Routing | Editor+preview | `branch_default → category → item → no_print`; nunca silencio | Crítico turno | PARTIAL |
| Ítem a múltiples impresoras (hasta 5) | Multi-estación KDS en spec; impresión multi-destino no | Expo/duplicados | Multi-estación | Config | `item.stations[]` ARRAY día-1 | Crítico turno | PARTIAL |
| Catálogo de impresoras EN dashboard | Local `runtime.json`/printers.json (GAP #20: "exactamente el modelo Wansoft a superar") | Alta | Alta | Gerente edita remoto | `printers` cloud versionada + cache Bridge | Crítico turno (cache) | PARTIAL |
| Impresora backup por estación | Cadena TCP→BT→pantalla en spec; configurable no | Continuidad | KDS suple | Alertas | `station.printer_backup_id` | Crítico turno | PARTIAL |
| Formato de comanda configurable | Batches/tiempos sí; formato no | Legibilidad | n/a | Editor "Documentos" | `document_templates` compartidos | Crítico turno | PARTIAL |
| Folio consecutivo por turno (lección #9) | UUIDs sin folio visible | "¿llegó todo?" | Orden visual | Auditoría | `folio` secuencial local reconciliable | Crítico turno | MISSING-CONFIG-ONLY |
| Reimpresión con log (lección #8) | Reprint "★ REIMPRESIÓN ★"; log dedicado no | Auditoría | Botón | Auditoría | Evento `comanda.reprinted` | Crítico turno | PARTIAL |
| Firebutton text | Tiempos activos; texto config listado | Courses | Disparo | n/a | `branch.firebutton_text` | Crítico turno | PARTIAL |
| Etiquetas/stickers | No | Delivery | n/a | n/a | Slot en templates | n/a | OUT-OF-SCOPE-V1 |
| Cajón (DRAWER_KICK) | `/drawer` Runtime | Cobro | n/a | n/a | `terminal.drawer` | Crítico turno | PARITY |
| Huella HID | `/fp/*` proxy | Login/autorización | n/a | n/a | `staff.fingerprint_id` | Crítico turno | PARITY |

### 22.4 Mesas / Áreas / Modos de servicio

| WANSOFT | FULLSITE HOY | POS | KDS | DASH | CONFIG MODEL | OFFLINE | STATUS |
|---|---|---|---|---|---|---|---|
| Mapa de mesas / numeración directa | `pos_mesas` DB-first | Entrada principal | n/a | Ocupación | Ya canónico | Crítico turno | PARITY |
| Secciones + permisos por sección | Zonas sí; permisos no (GAP #22) | Filtro por mesero | n/a | Por zona | `sections` + assignments | Crítico turno | PARTIAL |
| Capacidad por mesa | Config listada | Validación | n/a | Ocupación | `mesa.capacidad` | Crítico turno | PARITY |
| Tipos de orden + campos por tipo | `pos_orders.tipo` + GUARD-03/04 (FREEZE) | Núcleo | Por tipo | Por canal | Congelado | Crítico turno | PARITY |
| Alerta 30 min llevar | En spec | Alerta | n/a | n/a | `branch.alert_thresholds` | Crítico turno | PARITY |
| Cambiar # de mesa | En matriz de permisos | Diario | n/a | Audit | Evento auditado | Crítico turno | PARITY |
| Juntar mesas / merge de órdenes | Solo mover, no fusionar | Grupos | Batches de ambas | Trazabilidad | `merge(order_a, order_b)` — event store lo soporta | Crítico turno | MISSING-FEATURE |
| Split por silla/ítems/parejo | Cuentas hijas `{orderId}-C{n}`; KDS ve original [C07] | Cobro | Sin impacto | Ventas | Congelado | Crítico turno | PARITY |
| Sillas por partida | `item.silla` P0 #12 ✅ | Captura | Comanda | n/a | Canónico | Crítico turno | PARITY |
| Tiempos/courses | `comanda_batches` P0 #13 ✅ | Captura | Batch-aware | n/a | Canónico | Crítico turno | PARITY |
| Domicilio propio | Sub-tipo B spec'd | Futuro | Futuro | Futuro | Campos ya en modelo | Crítico turno | OUT-OF-SCOPE-V1 |

### 22.5 Empleados / Roles / Permisos

| WANSOFT | FULLSITE HOY | POS | KDS | DASH | CONFIG MODEL | OFFLINE | STATUS |
|---|---|---|---|---|---|---|---|
| Staff PIN + huella | `pos_staff` (bcrypt, fingerprint_id) + offline | Login/escalation | Opcional | Gestión | Canónico | Crítico turno | PARITY |
| Jerarquía de roles | 5 roles + matriz ~25 acciones hardcoded | Toda acción | n/a | Config | Perfiles como catálogo, no enum | Crítico turno | PARTIAL |
| Perfiles como plantillas | P0 #23 ("insostenible a 10×10") | Alta en 30s | n/a | UX | `permission_profiles` + override | Crítico turno (cache) | PARTIAL |
| 6 catálogos de escalation | Escalation in-place existe; catálogos no (P0 #22) | Anti-fraude núcleo | n/a | Security Matrix UI | `security_matrix {op, rol, política}` + flags | Crítico turno | PARTIAL |
| Escalation con registro de autorizador | Canónico (supera a Wansoft) | Núcleo | n/a | Audit | Canónico | Crítico turno | PARITY |
| Autorización remota push | V3 [C08] | Diferenciador | n/a | Notifs | Arquitectura lo soporta | Solo-cloud | OUT-OF-SCOPE-V1 |
| Permisos POS vs Portal separados | Roles POS sí; portal por rol listado | n/a | n/a | Módulos por rol | `dashboard_role_permissions` | Solo-cloud | PARTIAL |
| Bloqueo post-op/inactividad | Config listada | Seguridad | n/a | n/a | `branch.pos_lock` | Crítico turno | PARTIAL |
| Check-in/out asistencia | Clock-in referido en cierre | Corte mesero | n/a | Horas | `staff_clock_events` | Crítico turno | PARTIAL |
| Cuentas de prueba | NO existen en prod (invariante) | — | — | — | Invariante | n/a | PARITY (por omisión) |

### 22.6 Menú / Categorías / Items / Modificadores

| WANSOFT | FULLSITE HOY | POS | KDS | DASH | CONFIG MODEL | OFFLINE | STATUS |
|---|---|---|---|---|---|---|---|
| Jerarquía tipo→grupo→platillo (lección #14) | `pos_menu_categories`+items P0 #4 ✅ | Captura | Routing | Por grupo | 3 niveles, canónico | Crítico turno | PARITY |
| Tamaños con precio | P1 #1 ✅ | Captura | Comanda | n/a | Canónico | Crítico turno | PARITY |
| Modificadores multinivel | P0 #5 ✅ | Captura | Comanda | Editor | Canónico | Crítico turno | PARITY |
| Modificador con impacto en receta | Listado, sin evidencia de impl | Food cost real | n/a | Recetas | `modifier.recipe_impact[]` día-1 | Crítico turno | MISSING-CONFIG-ONLY |
| Modificadores por tipo de orden | No | Delivery | n/a | n/a | `modifier_group.order_types[]` | Crítico turno | MISSING-CONFIG-ONLY |
| Horarios de disponibilidad por platillo | No (P1 #2) | Validación captura | Menos rechazos | Config | `item.availability` | Crítico turno | MISSING-FEATURE |
| Precios por contexto (hasta 4) | No (#12; P2) | Precio automático | n/a | Márgenes por canal | `price_base + overrides{contexto}` día-1 | Crítico turno | MISSING-CONFIG-ONLY |
| Flags descuento/2x1/cortesía por platillo | No | Elegibilidad | n/a | Catálogo | `item.incentive_flags` | Crítico turno | MISSING-CONFIG-ONLY |
| Barcode + [NO IMPRIMIR] | Barcode listado; no_print no | Retail | Sin comanda | n/a | `item.barcode`, `item.no_print` | Crítico turno | PARTIAL |
| Activo + Auto-86 por stock | Activo sí; auto-86 no | 86 rápido | Menos rechazos | Delivery | Regla auto + override | Crítico turno | PARTIAL |
| Snapshot nombre/precio al vender | `OrderItem.name/unit_price` | Integridad | n/a | Reportes | Canónico | Crítico turno | PARITY |
| Precio histórico | Versionado listado | n/a | n/a | Tendencias | Con config_versions | Solo-cloud | PARTIAL |
| Menú Tienda espejo | Un solo catálogo | — | — | — | `item.type=market`, NO duplicar | n/a | PARITY (por diseño) |

### 22.7 Recetas / Inventario (settings)

| WANSOFT | FULLSITE HOY | POS | KDS | DASH | CONFIG MODEL | OFFLINE | STATUS |
|---|---|---|---|---|---|---|---|
| Receta atómica (574 en AMALAY) | `pos_recipes` + versionadas | Deducción | n/a | Food cost | Canónico | Solo-cloud | PARITY |
| Momento de deducción (al enviar) | Invariante NO configurable | Teórico en pico | n/a | Precisión | Invariante | Solo-cloud | PARITY (por diseño) |
| Almacenes múltiples (AMALAY: 6) | P1 #14 | Por almacén | n/a | Conteos | `warehouses` + `ingredient.warehouse_id` | Solo-cloud | PARTIAL |
| Unidades + presentaciones (1 CAJA=24 PZ) | "Copiar" declarado | n/a | n/a | Compras vs recetas | `units`, `presentations{factor}` — error aquí corrompe TODO | Solo-cloud | PARTIAL |
| Punto de reorden → alerta | En BD; falta trigger | n/a | n/a | Alertas | `reorder_point` + Alert Rule | Solo-cloud | PARTIAL |
| Umbral variación de costo | No (#14) | n/a | n/a | Inflación | `cost_variance_threshold` (15%) | Solo-cloud | MISSING-FEATURE |
| Yield / rendimiento | No (#16 — "food cost 28% subestimado") | n/a | n/a | Food cost real | `yield_factor` (1.0) día-1 | Solo-cloud | MISSING-CONFIG-ONLY |
| Subrecetas | No (#15; pedido de Eduardo) | n/a | n/a | Propagación de costo | `recipe.type=subreceta` recursivo | Solo-cloud | MISSING-FEATURE |
| Costos adicionales (gas, MO) | No (P2) | n/a | n/a | Avanzado | `additional_costs[]` | Solo-cloud | OUT-OF-SCOPE-V1 |
| Producción/batch (26 SPs Wansoft; panadería AMALAY) | No (#24, XL) | n/a | Órdenes producción | Panadería | `production_orders` | Solo-cloud | MISSING-FEATURE |
| Plantillas de conteo | P1 #17 | n/a | n/a | Conteos | `count_templates` | Solo-cloud | PARTIAL |
| Bloqueo venta sin stock | Deliberadamente NO (alerta, no bloqueo) | Alerta | n/a | n/a | Regla, jamás guard | n/a | PARITY (por omisión) |
| Cardex / movimientos | Copiar declarado | n/a | n/a | Auditoría | `inventory_movements` append-only | Solo-cloud | PARTIAL |
| Vales de transferencia (lección #3) | Mejora declarada (digital+aprobación) | n/a | n/a | Auditoría | `warehouse_transfers` | Solo-cloud | PARTIAL |

### 22.8 Pagos / Propinas / Comisiones

| WANSOFT | FULLSITE HOY | POS | KDS | DASH | CONFIG MODEL | OFFLINE | STATUS |
|---|---|---|---|---|---|---|---|
| Formas de pago ilimitadas (18 en AMALAY) | `pos_payment_methods` FK; creador con categoría no (#10) | Cobro | n/a | Línea por forma en corte | `{nombre, categoria contable, requiere_pin, color}` | Crítico turno | PARTIAL |
| Pago mixto N legs | `pagos: PaymentLeg[]` GUARD-07 | Cobro | n/a | Corte | Canónico | Crítico turno | PARITY |
| Botón Auto / cambio_entregado | En spec V2-B | Velocidad | n/a | Disputas | Canónico | Crítico turno | PARITY |
| Propina por método | `PaymentLeg.propina` | Cobro | n/a | Por método | Canónico | Crítico turno | PARITY |
| Pool de propinas (tip-out 5% AMALAY, reparto) | P1 #12 ("drama constante") | Corte mesero | n/a | Liquidación | `tips_policy {pool_pct, plaque, reparto[]}` | Crítico turno | PARTIAL |
| Propinas sugeridas en preticket | En spec G1 | +15-30% propinas | n/a | n/a | `branch.suggested_tips[]` | Crítico turno | PARITY (spec) |
| Cambio-como-propina (<$5 en bancarios) | No — regla REAL activa en AMALAY | Arqueo cuadra | n/a | Propinas | `tips_policy.card_change_as_tip` — afecta fórmula de arqueo | Crítico turno | MISSING-CONFIG-ONLY |
| Comisiones por mesero/forma | No (AMALAY no activa) | Corte | n/a | Nómina | `commission_rules[]` post-V1 | Solo-cloud | OUT-OF-SCOPE-V1 |
| Terminal bancaria + confirmación + conciliación | Clip/MP Point; conciliación no (#25 — "el descubrimiento más importante del CAJA-SPEC") | Cero descuadre | n/a | Conciliación | `bank_terminals` + `leg.reference` obligatorio | Crítico turno (fallback) | PARTIAL |
| IEPS separado del IVA | No — "obligatorio para AMALAY" (alcohol) | Impuestos | n/a | Fiscal | `item.tax_profile {iva, ieps}` día-1 | Crítico turno | MISSING-CONFIG-ONLY |
| Multi-moneda | No | Turístico | n/a | Corte | Slot `method.currency+tipo_cambio` | Crítico turno | OUT-OF-SCOPE-V1 |

### 22.9 Caja / Cortes

| WANSOFT | FULLSITE HOY | POS | KDS | DASH | CONFIG MODEL | OFFLINE | STATUS |
|---|---|---|---|---|---|---|---|
| Fondo (AMALAY $1,700; arrastre del Z) | `pos_turnos.fondo_inicial` + invariante de arrastre | Apertura | n/a | Corte | `branch.fondo_default` | Crítico turno | PARITY |
| Fórmula de arqueo canónica | Spec única; gap #6: corte actual no incluye propinas tarjeta-en-efectivo | Cierre cuadrado | n/a | Diferencias | Una sola implementación | Crítico turno | PARTIAL |
| Retiros/depósitos con razón+PIN | `pos_cash_movements` V1; RCA pendiente [G2] | Control efectivo | n/a | Flujo | `{tipo, monto, razon, staff, autorizado_por}` | Crítico turno | PARTIAL |
| Retiros programados (umbral) | No (P1 #10) | Anti-robo | n/a | Alertas | `auto_withdrawal {threshold}` | Crítico turno | MISSING-FEATURE |
| Arqueo con denominaciones + cada intento auditado | `pos_cierre_intentos` (3-intentos de Wansoft RECHAZADO) | Anti-fraude | n/a | Auditoría | Canónico | Crítico turno | PARITY (spec) |
| Corte de turno con guard de abiertas | GUARD-08/09/10 + huérfanas [C03] | Cierre | n/a | Corte | Canónico | Crítico turno | PARITY (spec) |
| Corte Z numerado consecutivo (fiscal) | P0 #19; invariante | Cierre día | n/a | SAT | `z_sequence` por branch, local+reconciliable | Crítico turno | MISSING-CONFIG-ONLY |
| Corte X parcial | No (P0 #20) | Media jornada | n/a | n/a | Reporte read-only del turno activo | Crítico turno | MISSING-FEATURE |
| Corte por mesero | "Nuevo en V2", wizard paso 3 | Liquidación | n/a | Rendimiento | Spec'd; mesero_id ya en modelo | Crítico turno | PARTIAL |
| Envío digital del corte | Email si configurado | n/a | n/a | Visibilidad dueño | `notification_rules` | Solo-cloud | PARTIAL |

### 22.10 Turnos / Horarios

| WANSOFT | FULLSITE HOY | CONFIG MODEL | STATUS |
|---|---|---|---|
| Turno como contenedor ("nada existe fuera de un turno", lección #4) | GUARD-02, `turno_id` nunca null | Canónico | PARITY |
| Un turno activo por terminal | `pos_sessions` | Canónico | PARITY |
| Turnos nombrados/planificados (catálogo) | Ad-hoc, sin catálogo | `shift_definitions` opcional | MISSING-CONFIG-ONLY |
| Horas máximas (alerta 18h) | Invariante configurable en spec | `branch.max_shift_hours` | PARITY (spec) |
| Programación semanal / asuetos | No (P1 #13) | `weekly_schedule`, `holidays` | MISSING-FEATURE |
| Apertura formal con confirmación de fondo | Gap prioritario declarado | Wizard sobre `pos_turnos` | PARTIAL |

### 22.11 Descuentos / Cortesías / Cancelaciones

| WANSOFT | FULLSITE HOY | CONFIG MODEL | STATUS |
|---|---|---|---|
| Catálogo de descuentos nombrados ("BBVA 15%") | Permisos sí; catálogo no (P0 #8) | Módulo Incentivos unificado | PARTIAL |
| Descuento por ítem vs prorrateado | `descuento` escalar | `incentive_applications[] {scope}` | PARTIAL |
| % abierto solo con permiso | Matriz: solo gerente | Canónico | PARITY |
| Cortesías con categoría (RRPP/empleado/influencer) | `order_purpose='cortesia'`+PIN; categorías no (P0 #9) | `courtesy_categories[]` | PARTIAL |
| 2x1/DXU + promos por combinación | No (P1 #4/#5) | Tipos dentro de Incentivos | MISSING-FEATURE |
| No stacking (toggle) | No evidenciado | `incentives_policy.no_stacking` | MISSING-CONFIG-ONLY |
| Cancelación: razón + "¿se preparó?" + anulación (3 caminos) | Flujo canónico + "★ CANCELADO" en estación | Canónico | PARITY (spec) |
| Catálogo de razones de cancelación | Spec dice catálogo; GAP #3: hoy texto libre | `cancel_reasons[]` por tenant | PARTIAL |
| Consumo interno | `order_purpose='consumo_interno'` [G3] V2-B | En modelo congelado | PARTIAL |
| Reabrir orden (REOPEN) | Gerente PIN, riesgo documentado | Canónico | PARITY (spec) |

### 22.12 Facturación (CFDI)

| WANSOFT | FULLSITE HOY | CONFIG MODEL | STATUS |
|---|---|---|---|
| PAC+CSD+RFC/régimen | Facturama P0 #24 ✅ | Canónico | PARITY |
| Series por sucursal | P0 #25 | `branch.cfdi_series` | PARTIAL |
| Autofacturación QR (400-430/mes AMALAY) | QR existe; flujo completo sin validar (#18) | `factura.fullsite.mx/{order}/{token}` | PARTIAL |
| Linkage factura↔órdenes + anti-doble | `cfdi_request.order_ids[]` | Canónico | PARITY (spec) |
| Factura global periódica | P1 #23 | `branch.global_invoice` | PARTIAL |
| Notas de crédito / complementos | No evidenciado | P2 corporativo | MISSING-FEATURE |
| Catálogo de clientes fiscales | P1 #22 ✅ ("CRM involuntario") | Canónico | PARITY |
| Validación RFC en captura (lección #10) | Diseño declarado | En captura | PARTIAL |

### 22.13 Delivery / Integraciones / Notificaciones

| WANSOFT | FULLSITE HOY | CONFIG MODEL | STATUS |
|---|---|---|---|
| Plataformas con órdenes al KDS | `delivery_platform` + webhooks; KDS badge V2-C | `delivery_integrations` | PARTIAL |
| Horarios + prep time por plataforma | No (P2 #2) | `integration.schedule, prep_time` | MISSING-CONFIG-ONLY |
| Auto-86 en plataformas | Declarado como reemplazo del checkbox | Regla derivada de stock | MISSING-FEATURE |
| Marcas virtuales | No (#23, P2) | `virtual_brands[]` — slot menu↔brand N:M antes del freeze de catálogo | OUT-OF-SCOPE-V1 |
| Top offenders | No (P2) | Derivado de eventos | MISSING-FEATURE |
| Alertas por rol/canal (matriz quién-recibe-qué) | 26+ agentes a Telegram; matriz no (#21) | `notification_rules {evento, rol, canal}` | PARTIAL |
| Alertas nunca desactivables | Declarado (caja sin cerrar, impresora caída) | Invariantes | PARTIAL |
| Config de agentes IA por sucursal | P1 #25; umbrales calibrados | `agent_config {agente, umbral, frecuencia}` | PARTIAL |

### 22.14 Reportes / Auditoría

| WANSOFT | FULLSITE HOY | CONFIG MODEL | STATUS |
|---|---|---|---|
| Audit log inmutable SIEMPRE (Wansoft: checkbox apagado en AMALAY) | `pos_audit_log` no configurable, offline-first [C09] | Invariante | PARITY |
| Transferencias con score de riesgo | Evento + score automático | Canónico | PARITY |
| Reportes de ventas (38 endpoints Wansoft) | Dashboards en vivo + query agent | Derivado, no config | PARITY |
| Auditoría del backoffice (quién cambió el precio) | No evidenciado | `dashboard_audit_log` | MISSING-FEATURE |
| Config versionada con rollback | Declarada como ventaja, SIN entidad | `config_versions` — FUNDACIONAL | MISSING-CONFIG-ONLY |
| P&L mensual | No (P2 #11 — "ORO para el dueño") | Derivado | MISSING-FEATURE |
| Reportes programados | Listado | `scheduled_reports[]` | PARTIAL |
| Sync como módulo visible | Eliminado por diseño (telemetría §8) | Canónico | PARITY (por diseño) |

## 23. TOP 15 — conceptos que la arquitectura DEBE modelar desde el día 1

(Criterio: equivocarse en el modelo obliga a rehacer el core; construir la
feature después es barato si la entidad ya existe.)

1. `organization → branch` con branch_id en toda fila operativa (D-C).
2. `business_date` explícito sellado (orden/turno/corte).
3. Estaciones como catálogo dinámico + `item.stations[]` ARRAY.
4. Routing de impresión 3 niveles + `no_print`, en cloud, versionado.
5. `price_base` + overrides por contexto (delivery/evento/happy hour).
6. `tax_profile {iva, ieps}` por ítem — obligación legal con alcohol.
7. Terminal como entidad cloud registrada.
8. Folios secuenciales por sucursal + `z_sequence` fiscal.
9. Security matrix como datos (operación × rol × política) + flags de escalation.
10. Incentivos unificados con `applications[]` por orden (scope item|cuenta).
11. Catálogos de razones por tenant (cancelación/cortesía/retiro/merma).
12. Payment methods con categoría contable + `reference` bancaria por leg.
13. `tips_policy` por sucursal integrada a la fórmula de arqueo.
14. `yield_factor` + subrecetas + `warehouse_id` en recetas.
15. `config_versions` — toda config con autor/ts/rollback.

## 24. Los 26 patrones de Wansoft que NO debemos copiar

**Arquitectura (lecciones Evitar):** 1) lógica de negocio en la BD (822 stored
procedures); 2) config local por terminal como fuente de verdad (3 terminales =
configurar 3 veces) — *excepción vigente a resolver: printers en runtime.json*;
3) instancia de BD por cliente sin multi-tenant y schema sin migrations;
4) food cost histórico mutable (cambiar costo reescribe el pasado).
**Toggles que son invariantes:** 5) "guardar logs" on/off; 6) "Z con órdenes
abiertas"; 7) preguntar-personas/cerrar-múltiples/N-copias/llenar-fondo como
opciones; 8) numeración Z como opción; 9) timezone como dropdown manual;
10) arqueo "3 intentos máximo" (→ cada intento auditado); 11) momento de
deducción como opción (siempre al enviar).
**Complejidad accidental:** 12) dos modos de ruteo mutuamente excluyentes;
13) 4 motores separados de descuento/cortesía/2x1/promo; 14) 30+15 checkboxes
de comanda/ticket con 60% duplicado; 15) 6 catálogos de permisos en pantallas
separadas; 16) 20 toggles de "Operativas" en onboarding (→ wizard de 4
preguntas); 17) módulo Tienda espejo del módulo Restaurante.
**Módulos muertos / fuera de scope:** 18) billar, tiempo aire, Wannapay,
tablajería, paleo de barra; 19) nómina completa IMSS/ISR (→ export CONTPAQi);
20) cuentas contables como CRUD (→ mapping); 21) MegaPoints/tarjetas físicas/
encuestas multi-pregunta/huella del cliente; 22) "depurar BD" y "liberaciones"
visibles al usuario; 23) "compradores" y "tipo de vales" como módulos;
24) sync como pantalla del usuario; reportes como PDF/Excel estático;
25) bloqueo de venta con stock 0; 26) terminales bancarias standalone sin API.

## 25. Architectural Blockers

1. **branch_id ausente en datos operativos** — cada día operado escribe
   `pos_orders`/`pos_cierres`/`pos_turnos`/`ops_daily`/inventario keyed solo
   por client_id (y `location_id` con DEFAULT falso `'amalay-spgg'` sin FK, en
   convención incompatible con `${clientId}-main` del onboarding). Activar
   multi-sucursal después = backfill masivo + re-keying de 6+ UNIQUE
   constraints (`ops_daily`, `wansoft_*`, `pos_staff(pin)`, `pos_customers`,
   `pos_mesas`) + re-particionar agregados. Pipeline comercial ya lo exige
   (Atope 3 suc; Galería 12+ como test case). **Mitigación D-A-compatible: F0
   sella columnas en nuevas escrituras post-visita, sin construir la feature.**
2. **station como texto libre estampado** en `items[].station` histórico +
   verdad triplicada en código (pos-constants / KDS keywords / cocina keywords).
3. **terminal sin identidad cloud** — `pos_audit_log.device_id`/
   `pos_attendance.device_id` texto libre sin FK: el audit trail acumulado no
   podrá vincularse retroactivamente.
4. **OCM no aplicado** — la capa IA completa lee `wansoft_daily`
   (HC-04/05/06): cliente #2 con `data_source='fullsite'` tiene chat/coach/
   predicción vacíos.
- No-blockers (agregables sin migrar datos): organization, permission-matrix,
  tips_policy, service_modes.

## 26. Exact Code Eventually Affected

`lib/pos-constants.ts` (routing → plane) · `app/pos/kds/page.tsx` +
`app/cocina/page.tsx` (keywords → catálogo stations) · `lib/date-mx.ts` +
`lib/data.ts:439` (timezone → branch) · `lib/pos-data.ts` (MENU_CATEGORIES /
RECIPE_ALIASES / MESAS_CONFIG fuera; consumidores: `lib/printer.ts:1093`,
`app/menu/[mesa]`, `lib/pos-promos.ts`) · `lib/roles.ts` +
`lib/pos-permissions.ts` (→ permission_profiles) · `api/chat|coach|inventory/
predict` (→ OCM) · `api/health` (→ data_source-aware) ·
`scripts/onboarding/onboard_client.py` (app_metadata fix + modo producción) ·
resolución de tenant (matar `NEXT_PUBLIC_DEFAULT_CLIENT_ID` por deploy) ·
`electron-app/local-server` (Bridge: cache de stations/printers del plane +
config_version en /health — post-freeze, D-A) · `settings.ts` (SettingScope
persistido org/sucursal/terminal/estación).

## 27. 10-Restaurant Torture Test (diseño completo)

Acceptance futuro: **los 10 se provisionan con el mismo core y cero cambios de
código por cliente.**

| # | Perfil | POS | KDS | Estaciones | Impresoras | Mesas/modo | Routing | Features | Roles | Menú | Integraciones |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Cafetería pequeña | 1 | 0 | barra | 1 (tickets=barra) | Sin mesas; orden rápida | todo→barra | mínimas | dueño+cajero | 25 items, mods 1 nivel | ninguna |
| 2 | AMALAY-like | 3 | 1 | cocina-fría, cocina-caliente, barra, caja | 5 (cocina→2 simultáneas) | 16 mesas + llevar + market | 3 niveles + no_print market | market, huella, factura QR, IEPS | 5 roles + matriz | 500+ items, multinivel | MP Point, CFDI |
| 3 | Bar | 2 | 0 | barra, cocina | 2 | 20 mesas + barra abierta | bebidas→barra | IEPS pesado | capitán con escalation agresiva | 120 items, tragos con receta | terminal bancaria |
| 4 | QSR sin mesas | 2 | 1 | cocina | 2 | solo llevar/recoger | simple | folios altos, sin propina mostrador | cajeros | 40 items, combos | delivery ×2 |
| 5 | Fine dining | 2 | 1 | cocina, postres | 3 | 12 mesas; personas+cursos OBLIGATORIOS | cursos/fire | preticket, split por silla | perfil custom (sommelier) | 60 items, maridajes como mods | reservas |
| 6 | Cocina+barra+postres | 3 | 2 | cocina, barra, postres | 4 | 25 mesas | item MULTI-estación (postre+café) | estándar | 5 roles | 200 items | CFDI |
| 7 | Grupo 3 sucursales | 3×2 | 3×1 | distintas por sucursal | por sucursal | mixto | menú compartido + overrides de precio por branch | consolidación de grupo | permisos POR SUCURSAL | 1 catálogo, 3 configs | 1 organization |
| 8 | Delivery-heavy | 1 | 1 | cocina | 2 | 80% plataforma | prep-times, auto-86 | marcas virtuales (slot) | mínimos | precios por CANAL (overrides) | Uber+Rappi+DiDi |
| 9 | Sin KDS | 2 | 0 | cocina, barra | 3 (todo impreso) | 18 mesas | comandas impresas puras | flag sin KDS | estándar | 90 items | CFDI |
| 10 | Grupo complejo | 12 / 4 suc | 4 | heterogéneas por suc | 15 | todos los modos | overrides por branch+canal | P&L consolidado, transferencias (slot) | matriz corporativa | catálogos por marca | todo |

Casos que más rompen el modelo actual: **#7/#10** (branch), **#5/#6**
(multi-estación + cursos), **#8** (price overrides por canal), **#3** (IEPS),
**#1** (probar que lo mínimo no arrastra complejidad AMALAY).

## 28. Minimum Work

- **CLIENT #2** (mismo giro, 1 sucursal, UTC-6): routing sin fallback AMALAY
  (config obligatoria en onboarding) · estaciones KDS desde config · purgar
  consumidores del menú estático · OCM aplicado a las 3 rutas IA (o IA
  declarada off) · onboard_client modo producción + fix app_metadata · tenant
  sin env-por-deploy. **~1-2 semanas.**
- **5+ CLIENTES:** + Configuration Plane v1 (stations/printers/routing/
  security-matrix/incentivos/razones + config_versions) · provisioning
  1-comando certificado (GS-02) · business_date + timezone reales ·
  unificación persons. **~4-6 semanas.**
- **20+ CLIENTES:** + branch_id en datos operativos (F0 lo pre-mitiga) ·
  terminal registry cloud · organization con consolidación · price/tax
  overrides · permission profiles UI · torture test 10/10 automatizado como
  gate de CI. **~8-12 semanas acumuladas.**

## 29. Implementation Phases

- **F0 — Sellado de identidad (post-visita AMALAY, D-A):** branch_id +
  terminal_id + business_date como columnas selladas en NUEVAS escrituras
  (aunque la UI siga single-branch). Detiene la hemorragia del blocker #1 sin
  construir multi-sucursal. Incluye unificar la convención de branch ID.
- **F1 — De-AMALAY-izar consumo:** estaciones/routing/keywords/menú-estático/
  timezone → Configuration Plane mínimo; KDS lee catálogo. Desbloquea cliente #2.
- **F2 — Plane completo + provisioning producción:** las 15 entidades día-1,
  config_versions, onboard 1-comando (GS-02), OCM aplicado. Desbloquea 5+.
- **F3 — Branch activation + organization:** migración con el backfill mínimo
  acumulado gracias a F0; consolidación de grupo; torture test como gate de CI.
  Desbloquea 20+ y el test case Galería.
- **F4 — Profundidad Wansoft por demanda:** incentivos avanzados, producción/
  panadería, conciliación bancaria, P&L — sobre entidades que ya existen.

---

## DECISIONES ARQUITECTÓNICAS ABIERTAS (para revisión del fundador)

1. **Printers: verdad cloud vs autoridad Runtime.** Este doc propone plane
   cloud + cache local materializado; RUNTIME-SPEC §3.3 hoy declara lo
   contrario. Requiere resolución formal (propuesta: plane gana; el Bridge
   opera 100% del turno con su cache aunque cloud no exista).
2. **Convención de branch ID** para unificar `'amalay-spgg'` (default en
   datos) vs `${clientId}-main` (onboarding): propuesta UUID + slug legible;
   decidir el mapeo del histórico AMALAY en F0.
3. **Alcance de `persons` en F2:** ¿unificación completa pos_staff↔client_users
   o solo el vínculo (person_id en ambas) dejando la fusión para F3?
4. **RELEASE_HIDDEN_PAGES:** ¿se convierte en flag per-tenant en F2 o
   permanece como control global de release?
5. **Timing de F1 vs certificación AMALAY:** F1 toca POS/KDS runtime — definir
   si arranca tras el field acceptance (consistente con D-A) o tras la
   estabilización (+7 días).

---

*Consolidado 2026-08-07 a partir de: auditoría de hardcodes (30 hallazgos
verificados con archivo:línea), inventario de modelo de datos (75 tablas,
migración 010 + schemas locales), mapa de paridad Wansoft (~90 conceptos, 14
dominios, 4 bibles + 41 lecciones NetSilver) y decisiones del fundador D-A/D-B/
D-C. Documento de DISEÑO: no autoriza implementación por sí mismo.*
