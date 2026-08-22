# Clonabilidad end-to-end: cada cliente con SU propia data — análisis completo

> **Fecha:** 2026-08-21 · **Autor:** sesión Claude Code (aterrizado en código + prod read-only)
> **Pregunta que responde:** ¿cómo hacemos que POS + KDS + dashboard + IA sean clonables por
> cliente, corriendo sobre **los datos de cada cliente**, sin sembrar nada a mano ni depender de AMALAY?
> **Complementa:** `CLIENT-ONBOARDING-REQUIREMENTS.md`, `OCM-REVIEW-2026-08-19.md`, `migrations/`.

---

## 0. TL;DR — el veredicto

Fullsite **ya es clonable en su columna vertebral**: un tenant nuevo se provisiona en ~30s, nace
**aislado y seguro** (RLS por tenant verificada en prod), y POS/KDS/dashboard corren scopeados por
`client_id`. Desde hoy (2026-08-21) el **chat/coach/voz** leen la data VIVA (`pos_orders`) de cada
tenant vía `src/lib/pos-daily.ts` — un clon ya "sabe su info" en esas superficies.

**Los gaps reales, por tipo (mapa completo en §4):**
- 🔴 **Core del clon** (la IA no cruza todo / alertas mal ruteadas): (G1) los 17 agentes leen fuente
  muerta `wansoft_*`, (G1b) los crons hardcodean `amalay` y no hacen fan-out por tenant, (G11) ~15
  scripts mandan alertas al canal de Daniel, no al del clon. **Todo se cierra con la misma columna
  vertebral de datos por tenant (pos_orders) + fan-out.** = **Fase 0**.
- 🟠 **Escala / revenue**: (G2) falta wizard de alta self-serve, (G10) no hay routing host→subdominio,
  (G7/G8) CFDI y pagos usan credenciales globales (falta `credentials_vault` por tenant + cuenta PAC por cliente).
- 🟡 **Fricción / degradación silenciosa**: (G3) alta de hardware manual por terminal, (G4) contenido
  AMALAY hardcoded (`EXCLUDE_STAFF`/`MARKET_BRANDS`), hardcodes P1/P3, T4.

**Lo que NO es el problema (verificado sano):** aislamiento/RLS (el clon nace seguro), provisioning base,
scoping POS/KDS/dash, chat/coach/voz (ya en pos_orders), Uber Eats (multi-tenant real), Local Server/offline.
**El cuello no es dificultad de datos ni seguridad — es ingeniería acotada, empezando por la Fase 0.**

---

## 1. Qué significa "clonable con los datos de cada cliente"

Un restaurante nuevo (clonado del esqueleton) debe, sin intervención de ingeniería:

1. **Nacer configurado** — POS/KDS/dashboard funcionando con su identidad (nombre, logo, tema, mesas).
2. **Nacer aislado** — nadie ve ni toca la data de otro tenant.
3. **Capturar su propia operación** — cada venta cae en `pos_orders` con su `client_id`.
4. **Que su IA cruce SU info** — chat, coach, voz y los 17 agentes leen y cruzan la data viva del
   propio cliente (ventas, meseros, platillos, food cost, inventario, fraude…), sin seeds.
5. **Volverse experto solito** — con 2-4 semanas de operación real, la IA tiene patrones (día de la
   semana, tendencias, benchmarks) sin necesidad de migrar histórico.

Las capas 1-3 **ya están**. La capa 4 está a medias (superficies conversacionales ✅, agentes ❌).
La capa 5 es consecuencia automática de la 4.

---

## 2. Estado actual por capa (aterrizado en código + prod)

### Capa A — Provisioning / clonado ✅ (funciona, idempotente)

`dashboard-app/src/lib/provision-tenant.ts` → `provisionTenant()` crea, por UPSERT (re-ejecutable
sin duplicar), en ~10-30s:

| Objeto | Detalle | Ref |
|---|---|---|
| `clients` (1) | display_name, accent, theme, logo, iva 0.16, tz MX, features, mesas, `data_source='fullsite'` | L126-139 |
| `client_locations` (1) | `${clientId}-principal` | L142-148 |
| `pos_menu_categories` (3 plantilla) | Bebidas / Alimentos / Postres | L151-159 |
| `pos_menu_items` (11 plantilla) | ids `${clientId}-…` | L161-172 |
| `pos_payment_methods` (4) | efectivo/crédito/débito/transfer + código SAT | L175-184 |
| `pos_staff` (6 plantilla) | dueño…mesero, PINs 1001-1006 | L190-204 |
| `pos_mesas` (grid) | solo si `mesas>0` y tabla vacía (idempotente por conteo) | L210-230 |

`/api/platform/onboard` (2FA admin) además crea: **auth user** del dueño + `client_users` (rol dueño)
+ **usuario `local-server+${clientId}`** para el Local Server offline. Smoke test existe. Gate
`CLON-ONBOARD <20 min` ✅.

**Manual / no automático (hoy):** menú real, staff real, terminales/hardware, recetas/food-cost,
sync Wansoft. → esto es lo que el **wizard** debe cubrir (ver §5).

### Capa B — Aislamiento / seguridad ✅ (verificado en prod, el clon nace seguro)

**Corrección importante:** una lectura del archivo de migración `003` sugiere RLS permisiva (anon
`USING(true)`). **Eso es stale.** Verificado en prod (`qjiomlvudfmzuvqvhwpk`, 2026-08-21):

- Tablas sensibles (`pos_orders`, `pos_staff`, `pos_menu_items`, `pos_cierres`, `pos_customers`,
  `clients`) → policies **solo `authenticated` + `service_role`**, **cero `anon`**.
- Filtro real por tenant: ej. `pos_orders_sel` `USING private.user_has_client_access(client_id)`;
  `pos_orders_ins/upd` con `WITH CHECK (user_has_client_access(client_id) AND turno_id IS NOT NULL)`.
- `clients` → solo `clients_tenant_read[SELECT]` para authenticated.

→ **Un clon nace aislado.** CRUD cross-tenant está cerrado (cierre B2, 2026-08-19).
**Gap menor (T4):** `pos_customers` tiene `authenticated SELECT` pero no INSERT/UPDATE → las escrituras
de clientes van por server/service_role (no bloqueante, pero anotarlo).

### Capa C — Producto (POS / KDS / dashboard) ✅ (scopeado por tenant)

Todo el runtime resuelve `client_id` por host/sesión (`getActiveClientSlug()`/`_cid()`), la data se
lee filtrada por tenant, y el store local offline ya se particiona por tenant (`guardTenant()`).
**Hardcodes de `amalay` residuales** (limpieza, no bloqueantes):

| Archivo | Severidad | Nota |
|---|---|---|
| `admin/tarjetas-regalo/page.tsx:23` | **P1** | default `client_id='amalay'` |
| `api/health/route.ts` | P3 | lee `wansoft_daily` sin filtro (falso negativo de health) |
| `lib/pos-config.ts:28`, `lib/pos-data.ts:1258`, `pos/mesas/page.tsx` | P3 | fallbacks/UI especiales AMALAY |
| `api/chat`, `api/coach` (`=== 'amalay'`) | OK | rama legacy "si amalay usa wansoft"; `pos-daily` ya cubre el resto |

### Capa D — IA ⚠️ (superficies ✅, agentes ❌)

**Conversacional (chat/coach/voz) ✅** — desde hoy leen `pos_orders` vivo vía
`src/lib/pos-daily.ts` (`buildDailyFromOrders`): si `wansoft_daily` está vacío (todo clon), sintetiza
las filas diarias (ventas, meseros, platillos, pagos, propinas) con el mismo shape. AMALAY sigue en su
histórico legacy. Ver `OCM-REVIEW` / memoria `ocm-repunte`.

**Agentes AI Ops (17 Python) ⚠️ — el hueco de fondo.** Son multi-tenant **en código** (todos usan
`client_config.get_client()`, filtran por `client_id`, escriben `agent_results`/`agent_insights` con
`client_id` — sin hardcode de amalay en la lógica). **Pero** su fuente de datos los divide para un clon:

| Estado | # | Agentes | Por qué |
|---|---|---|---|
| 🟢 Vive sin Wansoft | 3 | hermes (meta), auto86, cost-variance | leen POS (inventory/recipes/ingredients) |
| 🟡 Se degrada | ~9 | antifraud, table-time, anomaly, kitchen-quality, upselling, waste, climate, tips, close-predictor | fallback parcial a POS, pero pierden benchmark histórico → varios devuelven `no_data` sin historia |
| 🔴 Muere | ~4-5 | crm-recompra, purchase-predictor, staffing-optimizer, menu-engineering, stock-alert | dependen duro de `wansoft_daily` (meseros/platillos_top/ventas_por_grupo) o `wansoft_data` (inventario scrapeado) |

Refs: `client_config.py:18-47` (hub), `agent_common.py:96-187` (log+insight aislados),
`crm_recompra_agent.py:75-81` / `purchase_predictor.py:139-146` / `staffing_optimizer.py:58-67`
(dependencia dura Wansoft).

**Segundo hueco (orquestación):** los crons `agents-daily/hourly/weekly.yml` hardcodean
`CLIENT_ID: … || 'amalay'` y **ningún workflow itera `clients`** → aunque el código es multi-tenant,
**el cron solo corre para AMALAY**. Un clon nunca dispara sus agentes solo.

### Capa E — Integraciones externas (credenciales por tenant) ⚠️

Cada integración suele requerir credenciales/cuenta POR cliente. Estado:

| Integración | ¿Por-tenant? | Credenciales | Clon sin código | Nota |
|---|---|---|---|---|
| **CFDI / Facturama** | Parcial | **env global** + cuenta única AMALAY (RFC AFO200806JI0) | ❌ **NO** | datos fiscales sí en `clients`, pero PAC hardcoded (`lib/facturama.ts:14-15`) |
| **MP Point** | En tránsito | `MP_ACCESS_TOKEN` global + fallback inseguro | ❌ NO | Phase 2 → `credentials_vault` (`api/mp-point/route.ts:6-21`) |
| **Clip** | En tránsito | `CLIP_API_KEY` global | ❌ NO | igual que MP (`api/clip-pinpad/route.ts:3-20`) |
| **Uber Eats** | **✅ SÍ** | `integration_providers` por client_id + OAuth por tenant | ⚠️ parcial (OAuth initiate manual) | framework multi-tenant real |
| **Rappi** | Diseñado ✅ | igual patrón, sin implementar | ❌ (sin código) | `docs/integrations/rappi/DESIGN.md` |

**Patrón del gap:** falta un **`credentials_vault` por tenant (encriptado)** para CFDI/MP/Clip.

### Capa F — Routing host→tenant + notificaciones ⚠️

- **Host→tenant:** no hay campo `subdomain`/`host` en `clients`. El `client_id` se resuelve por
  JWT `app_metadata` / `client_users` / `NEXT_PUBLIC_DEFAULT_CLIENT_ID` (`lib/data.ts:50-58`,
  `AuthContext.tsx:61-93`). Funciona por-usuario, pero **no hay routing por subdominio** → a escala,
  falta columna `subdomain` + resolución por host en middleware.
- **Notificaciones Telegram:** infra por-tenant existe (`client_config.get_chat_ids()`, `clients.telegram_chat_ids`),
  **pero ~15 scripts hardcodean `TELEGRAM_CHAT_ID_DANIEL`** (orquestador, uptime, wansoft_*, smoke) →
  **las alertas de un clon caen en el canal de Daniel/AMALAY** (fallback silencioso). WhatsApp no es multi-tenant.
- **Hardcodes de contenido AMALAY en dashboard:** `EXCLUDE_STAFF` (`lib/data.ts:225`) y `MARKET_BRANDS`
  (`food-cost/page.tsx:57`) están quemados → un clon puede ver meseros/food-cost mal categorizados
  (degradación silenciosa, no error). El resto de rutas (~8 muestreadas: ventas, meseros, nómina, gastos,
  conciliación, cortes, reporte-fiscal, propinas) **sí filtran por client_id/slug** y tienen fallback
  `getDashboardFromPosOrders()` para clones sin wansoft_daily.

---

## 3. El keystone: una columna vertebral de datos por tenant

Todo el hueco de la Capa D se cierra con **una sola pieza**: un **agregado diario canónico derivado de
`pos_orders`, por tenant**, que todas las superficies (TS y Python) consuman en lugar de `wansoft_*`.

Ya existe la mitad:
- **TypeScript:** `src/lib/pos-daily.ts` (commits `2b4d8ff7`+`e54ace52`, en prod) — chat/coach/voz.
- **SQL:** vistas OCM `ocm_daily` / `ocm_waiter_rankings` / `ocm_menu_groups` (Fase 1/2, aplicadas a
  prod 2026-08-19) — agregan `pos_orders` UNION historia, sin doble-conteo.

**Verificado en prod (2026-08-21) — las vistas OCM YA sirven a clones:**

| Vista | Columnas clave | boruca (clon) | amalay |
|---|---|---|---|
| `ocm_daily` | escalares: ventas_dia, tickets_count, personas, ticket_promedio, propinas_total, `source_system` | 31 días (fullsite) | 924 (wansoft+fullsite) |
| `ocm_waiter_rankings` | **relacional**: mesero, ventas, tickets, propinas (1 fila/mesero/fecha) | 109 filas | 12 |
| `ocm_menu_groups` | **relacional**: grupo, ventas, cantidad | 31 | 44 |

**Falta:** que los **17 agentes Python** (helper compartido `agent_common.py:sb_get(table,params)`,
repoint **por-agente**) lean de esa columna en vez de `wansoft_daily`/`ops_daily_*`. El repoint es **mixto**
porque la forma cambió (antes meseros/platillos/grupos venían como jsonb-por-fila; ahora son relacionales):

| Grupo | Agentes | Cambio |
|---|---|---|
| **Swap fácil** (escalares → `ocm_daily`) | anomaly, close-predictor, kitchen-quality, table-time | cambiar nombre de tabla |
| **Restructure** (meseros/platillos JSON → vistas relacionales) | crm-recompra, staffing → `ocm_waiter_rankings`; purchase-predictor, menu-engineering → `ocm_menu_groups`; upselling | leer vista relacional + re-parsear |
| **Sin cambio** (ya POS) | auto86, cost-variance, hermes | — |

Con eso: los 🔴 reviven, los 🟡 dejan de devolver `no_data`, un clon con POS tiene los 17 agentes cruzando
su info sin seeds, y los que necesitan histórico (anomaly, close-predictor) **maduran solos** en 2-4 semanas.

> **Subtleza AMALAY (crítica):** `ocm_daily` de AMALAY **mezcla su `pos_orders` de PRUEBA ($2k/día)**
> con Wansoft (ver §6). Si los agentes de AMALAY leyeran `ocm_daily` hoy, reportarían un desplome falso.
> Por eso el repoint debe ser **tenant-aware: AMALAY sigue en `wansoft_daily` hasta el cutover; los clones
> leen OCM.** Tras el cutover, AMALAY voltea a OCM solo.

> **Regla de arquitectura:** ninguna superficie de IA (TS o Python) vuelve a acoplarse a `wansoft_*` como
> fuente nueva. Fuente única = agregado de `pos_orders` por tenant (OCM views / pos-daily).

---

## 4. Mapa completo de gaps (todo el producto)

Clasificados por qué tan clonable es HOY. Tres tipos: **🔴 bloquea el valor core del clon**,
**🟠 bloquea un feature de revenue**, **🟡 fricción de alta / degradación silenciosa**.

| # | Gap | Capa | Tipo | Esfuerzo |
|---|---|---|---|---|
| **G1** | 17 agentes AI Ops leen fuente muerta (`wansoft_*`/`ops_daily_*`) para clones | D | 🔴 core | Medio (repoint a OCM/pos-daily) |
| **G1b** | Crons de agentes hardcodean `amalay`, sin fan-out por tenant | D | 🔴 core | Bajo (workflow: matrix sobre `clients`) |
| **G11** | ~15 scripts mandan alertas a `TELEGRAM_CHAT_ID_DANIEL` (no al canal del clon) | F | 🔴 core (privacidad) | Bajo-medio (usar `get_chat_ids()`) |
| **G2** | Wizard de alta self-serve (menú/staff/connector) | A | 🟠 escala | Medio-alto (UI/orquestación) |
| **G7** | CFDI: PAC (Facturama) en env global, cuenta única AMALAY | E | 🟠 revenue | Medio-alto (`credentials_vault` + cuenta por cliente) |
| **G8** | Pagos MP Point / Clip: token en env global | E | 🟠 revenue | Medio (`credentials_vault` Phase 2) |
| **G10** | Sin routing host→tenant (falta `subdomain` en `clients`) | F | 🟠 escala | Medio (columna + resolución en middleware) |
| **G3** | Electron/hardware: alta manual por terminal (25-45 min), sin config pre-empacada, `POS_URL` hardcoded | A | 🟡 fricción | Medio |
| **G4** | Contenido AMALAY hardcoded: `EXCLUDE_STAFF`, `MARKET_BRANDS` → mis-categorización silenciosa | C/F | 🟡 degradación | Bajo (mover a `client_config`) |
| **G4b** | Hardcodes `amalay`: `tarjetas-regalo:23` (P1), health route, pos-config/pos-data (P3) | C | 🟡 fuga | Bajo |
| **G6** | Import histórico concierge (cookie Wansoft / CSV) | A | 🟡 opcional | Bajo-medio |
| **G5** | T4: `pos_customers` sin write policy authenticated (escrituras vía server) | B | 🟡 menor | Bajo |
| **G9** | Rappi diseñado, no implementado (Uber ✅ ya multi-tenant) | E | 🟡 feature | (fuera de scope clon) |

**Lo que NO es gap (verificado sano):** aislamiento/RLS (el clon nace seguro), provisioning base
(`provisionTenant` idempotente), scoping por client_id en POS/KDS/dash, chat/coach/voz (ya viven en pos_orders),
Uber Eats (multi-tenant real), Local Server + offline (tenant-aware).

---

## 5. Plan por fases

### Fase 0 — Que la IA del clon "sepa todo" (keystone, 🔴 core)
- **G1** — repuntar los 17 agentes Python a la fuente viva por tenant (vistas OCM o helper `pos_daily.py`
  espejo de `pos-daily.ts`). Empezar por los 🔴 (crm, purchase, staffing, menu-engineering, stock).
  Degradación explícita cuando falte historia (< N semanas de POS) en vez de `no_data` mudo.
- **G1b** — crons con fan-out por tenant (matrix sobre `clients` activos) en vez de `CLIENT_ID=amalay`.
- **G11** — que todos los scripts usen `get_chat_ids(client)` → cada clon recibe SUS alertas en SU canal.
- **Resultado:** un clon con POS operando tiene chat + coach + voz + 17 agentes cruzando su info, y sus alertas.

### Fase 1 — Alta self-serve (🟠 escala; saca a Daniel del cuello)
- **G2** — piezas #1-#3 del `CLIENT-ONBOARDING-REQUIREMENTS`: wizard en `/platform` + import CSV de
  menú/staff + selector de connector. Reusa `provisionTenant()` idempotente + smoke test.
- **G10** — columna `subdomain` en `clients` + resolución host→tenant (habilita subdominio por cliente).

### Fase 2 — Revenue features por tenant (🟠 revenue)
- **G7/G8** — `credentials_vault` por tenant (encriptado) para CFDI (Facturama), MP Point, Clip.
  Requiere además cuenta PAC por cliente (operativo, no solo código).
- **G3** — provisioning de terminales por código + config Electron pre-empacada (pieza #4).

### Fase 3 — Pulido y cobertura (🟡)
- **G4** — mover `EXCLUDE_STAFF` / `MARKET_BRANDS` a `client_config` (por tenant).
- **G4b** — limpiar hardcode P1 (`tarjetas-regalo`) + P3 residuales.
- **G5** — cerrar T4 (`pos_customers` write policy) si se requiere captura client-side.
- **G6** — import histórico concierge (cookie Wansoft guiada / CSV). Starter kits por defecto.

---

## 6. Anexo — Diagnóstico AMALAY (por qué el cutover desbloquea, no hay P0 de sync)

AMALAY cortó a POS propio ~20-jul; su `wansoft_daily` se congeló ahí y **todo el scraper de Wansoft
está caído** (falla en **login** desde 13-jul — Wansoft blindado). Su `pos_orders`:
**$2,097/día vs $75,825 real (2.8%)**. Diagnóstico del patrón (read-only prod):

- Jul 7-16 **todo `cancelada`** (crear-y-cancelar = pruebas).
- Órdenes a la 1-4 AM en un negocio matutino (brunch) = pruebas, no servicio.
- ~21 días con algo, ~20 en cero (no es uso diario).
- **15-jul: 44 órdenes / $29,100** en horario real, 4 meseros → una noche de prueba real
  **que el sync guardó perfecto.**

→ **Es data de prueba, NO fuga de sync.** Cuando el equipo usa el POS, sí sube. El **cutover** del POS
como caja real enciende la IA de AMALAY automáticamente (via `pos-daily` + OCM). Sin P0 previo.
**Decisión tomada:** no revivir el scraper (sistema que se reemplaza); empujar el cutover.

---

## 7. Referencias

- `docs/platform/CLIENT-ONBOARDING-REQUIREMENTS.md` — piezas #1-#7 del alta self-serve.
- `docs/platform/OCM-REVIEW-2026-08-19.md` — mapa de qué lee cada ruta/agente + vistas OCM.
- `docs/platform/migrations/` — migration engine (capa canónica, 65% rechazo = normalización, D-01..D-04).
- `dashboard-app/src/lib/pos-daily.ts` — columna vertebral TS (chat/coach/voz).
- `dashboard-app/src/lib/provision-tenant.ts` — clonado del tenant.
