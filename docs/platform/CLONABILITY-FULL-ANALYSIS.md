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

**El único hueco de fondo para que "los agentes sepan toda la info":** los **17 agentes de AI Ops
(Python)** siguen acoplados a `wansoft_*`/`ops_daily_*`, tablas muertas para cualquier cliente que no
sea AMALAY. **4 mueren y 9 se degradan** en un clon. La solución es **una sola** — la misma que ya
apliqué al chat: una columna vertebral de datos por tenant derivada de `pos_orders`.

**Lo que NO es el problema:** ni el aislamiento (seguro), ni el provisioning (funciona), ni la
migración de datos (opcional y concierge). **El cuello real es (a) repuntar los agentes a data viva
y (b) el wizard de alta self-serve.** Ninguno es "difícil de datos"; son trabajo de ingeniería acotado.

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

---

## 3. El keystone: una columna vertebral de datos por tenant

Todo el hueco de la Capa D se cierra con **una sola pieza**: un **agregado diario canónico derivado de
`pos_orders`, por tenant**, que todas las superficies (TS y Python) consuman en lugar de `wansoft_*`.

Ya existe la mitad:
- **TypeScript:** `src/lib/pos-daily.ts` (hecho hoy) — chat/coach/voz.
- **SQL:** vistas OCM `ocm_daily` / `ocm_waiter_rankings` / `ocm_menu_groups` (Fase 1/2, aplicadas a
  prod 2026-08-19) — agregan `pos_orders` UNION historia, sin doble-conteo.

**Falta:** que los **17 agentes Python** lean de esa columna (las vistas OCM o un helper Python espejo
de `pos-daily`) en vez de `wansoft_daily`/`ops_daily_*`. Con eso:
- Los 🔴 reviven leyendo `ocm_waiter_rankings`/`ocm_menu_groups` del propio tenant.
- Los 🟡 dejan de devolver `no_data` cuando hay POS.
- Un clon con POS operando **tiene los 17 agentes cruzando su info** sin seeds.
- Los que necesitan histórico (anomaly, close-predictor) **maduran solos** al acumular 2-4 semanas de POS.

> **Regla de arquitectura:** ninguna superficie de IA (TS o Python) vuelve a acoplarse a `wansoft_*`.
> Fuente única = agregado de `pos_orders` por tenant (OCM views / pos-daily). AMALAY usa su histórico
> legacy hasta el cutover; después, mismo camino que todos.

---

## 4. Gaps priorizados

| # | Gap | Capa | Impacto | Esfuerzo |
|---|---|---|---|---|
| **G1** | 17 agentes leen fuente muerta para clones | D | 🔴 la IA del clon no cruza todo | Medio (repoint a OCM/pos-daily, patrón repetible) |
| **G2** | Wizard de alta self-serve (menú/staff/connector) | A | 🔴 Daniel = cuello de botella del alta | Medio-alto (UI/orquestación) |
| **G3** | Provisioning de terminales por código (POS/KDS) | A | 🟠 hardware aún manual | Medio |
| **G4** | Hardcode P1 `tarjetas-regalo` + limpieza P3 | C | 🟠 fuga cosmética/lógica | Bajo |
| **G5** | T4: `pos_customers` sin write policy authenticated | B | 🟡 escrituras vía server (ok) | Bajo |
| **G6** | Import histórico concierge (cookie Wansoft / CSV) | A | 🟢 opcional, day-1 history | Bajo-medio |

---

## 5. Plan por fases

### Fase 0 — Columna vertebral de datos (keystone, desbloquea "agentes saben todo")
- Repuntar los 17 agentes Python a la fuente viva por tenant (vistas OCM o helper `pos_daily.py`
  espejo de `pos-daily.ts`). Empezar por los 🔴 (crm, purchase, staffing, menu-engineering, stock).
- Degradación explícita cuando falte historia (< N semanas de POS) en vez de `no_data` mudo.
- **Resultado:** un clon con POS operando tiene chat + coach + voz + 17 agentes cruzando su info.

### Fase 1 — Alta self-serve (saca a Daniel del cuello)
- Piezas #1-#3 del `CLIENT-ONBOARDING-REQUIREMENTS`: wizard en `/platform` + import CSV de menú/staff
  + selector de connector (De cero / CSV / Wansoft-cookie / Otro).
- Reusa `provisionTenant()` (ya idempotente) + smoke test existente.

### Fase 2 — Hardware self-serve
- Provisioning de terminales por código (POS/KDS se autoconfiguran) — pieza #4.

### Fase 3 — Pulido y cobertura
- Limpiar hardcode P1 (`tarjetas-regalo`) + P3 residuales.
- Cerrar T4 (`pos_customers` write policy) si se requiere captura client-side.
- Import histórico concierge (cookie Wansoft guiada / CSV) — piezas #5-#7, opcional.
- Starter kits (categorías/roles/estaciones KDS por defecto).

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
