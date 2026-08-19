# Revisión OCM — despegar la IA de `wansoft_daily` (2026-08-19)

> Revisión FULL antes de construir (regla del esqueleton). Todo read-only, cero cambios.
> Objetivo: que el "experto de IA" (chat, coach, voice, predict, agentes) corra sobre **data viva
> y por-tenant**, para que funcione en AMALAY **y** en cualquier cliente nuevo. Hoy no lo hace.

## TL;DR

Son **dos problemas superpuestos**, con **una raíz**:
1. **Staleness:** la IA lee tablas agregadas que **murieron en el switchover a Fullsite POS** — `wansoft_daily` (última: **jul-20**) y `ops_daily` (última: **jul-12**). El `pos_daily_aggregator` que las alimentaría está BLOCKED.
2. **Fuga cross-tenant:** varias rutas de IA leen `wansoft_daily` / `wansoft_waiter_categories` **sin filtro `client_id`**. Hoy "funciona" porque solo existe AMALAY; con Cliente #2, **mezclarían datos de clientes.** Y como usan **service_role** (server-side), **RLS/BUG-019 NO las protege** — el filtro tiene que estar en la query.

**Raíz:** la capa de IA nació atada al scraper de Wansoft. Ese scraper murió al pasar a POS propio. **OCM es la cura y ya está medio construido** — pero le falta el eslabón diario y no está en prod.

## Estado del OCM (verificado en staging + prod)

| Vista OCM | Lee de | ¿Viva? | ¿En prod? |
|---|---|---|---|
| `ocm_orders` | `pos_orders` | ✅ viva | ❌ solo staging |
| `ocm_order_consumption` | `pos_orders` + movimientos | ✅ viva | ❌ |
| `ocm_service_kitchen` | `pos_orders` (kds) | ✅ viva | ❌ |
| `ocm_cash` | turnos + cierres | ✅ viva | ❌ |
| `ocm_shifts` | staff shifts | ✅ viva | ❌ |
| `ocm_customers` / `ocm_customer_journey` | `pos_customers` | ✅ viva | ❌ |
| `ocm_suppliers` | `pos_suppliers` | ✅ viva | ❌ |
| **`ocm_daily`** | **`ops_daily`** (tabla) | ❌ **muerta (jul-12)** | ❌ |

**Bueno:** 7 de 8 vistas ya leen data VIVA de `pos_*`. **Malo:** `ocm_daily` depende de la tabla muerta `ops_daily`, y **ninguna está desplegada a prod.**

## Qué lee cada componente de IA hoy (mapa del código)

| Componente | Fuente principal | Filtro client_id | Problema |
|---|---|---|---|
| `/api/chat` | `wansoft_daily` (L138) + waiter_categories (L140) + pos_orders (L146) | ⚠️ parcial (YoY L716 sin filtro) | 🔴 stale + fuga YoY |
| `/api/coach` | `wansoft_daily` (L17) + waiter_categories (L28) | ❌ **NINGUNO** | 🔴🔴 **fuga cross-tenant + stale** |
| `/api/voice` | `wansoft_daily` (L59) + waiter_categories (L136) | ❌ **NINGUNO** | 🔴🔴 **fuga cross-tenant + stale** |
| `/api/inventory/predict` | `wansoft_daily` (L35) | ❌ **NINGUNO** | 🔴 fuga + stale |
| `/api/health` | `ops_daily` | ⚠️ revisar | 🟡 stale (jul-12) |
| `/api/export/polizas` | `pos_orders` | ✅ | 🟢 vivo, ok |
| **Agentes Python** (anomaly/close/kitchen/table/upsell) | `ops_daily_live` + `ops_daily_history` | ✅ `get_client()` dinámico | 🟡 dinámico y por-tenant, pero `ops_daily` está stale |
| `waste_detector.py` / `purchase_predictor.py` | `wansoft_*` sin filtro | ❌ | 🔴 fuga + stale |

**Nota:** los agentes Python están mejor (client_id dinámico vía `client_config.get_client()`), pero leen `ops_daily_*` que también está congelado. Las **rutas TS** (coach/voice/predict) son las peores: sin filtro + tabla muerta.

## Plan de repunte (fases, en orden)

### Fase 0 — Hotfix de aislamiento `[P0 seguridad, rápido]`
Agregar filtro `client_id` en las queries de `coach`, `voice`, `inventory/predict`, y el YoY de `chat` (L716), y en `waste_detector.py` / `purchase_predictor.py`. **Va sí o sí antes de Cliente #2** — son service_role, RLS no las cubre. No depende de OCM; es puro filtro.

### Fase 1 — `ocm_daily` vivo `[el eslabón clave]`
Reescribir `ocm_daily` para **agregar `pos_orders` directamente** (como vista), matando la dependencia de la tabla muerta `ops_daily` y del `pos_daily_aggregator` bloqueado. Resultado: ventas/tickets/ticket-promedio/tendencias **vivas para cualquier tenant, sin job intermedio**. Para AMALAY, `UNION` con la historia de `wansoft_daily` (source_system) para no perder el histórico rico pre-cutover.

### Fase 2 — vistas que faltan
Crear `ocm_waiter_rankings` (equiv. `wansoft_waiter_categories`, desde `pos_orders.mesero`) y `ocm_menu_groups` (equiv. `ventas_por_grupo`, desde items de `pos_orders`). Son las 2 piezas que la IA usa y que aún no tienen equivalente OCM vivo.

### Fase 3 — repuntar las rutas de IA
`chat/coach/voice/predict` → leer `ocm_daily` / `ocm_waiter_rankings` / `ocm_menu_groups` en vez de `wansoft_*`. Los agentes Python → `ocm_*` en vez de `ops_daily_*`.

### Fase 4 — desplegar OCM a prod + deprecar
Aplicar las vistas OCM a prod (AMALAY). Deprecar `wansoft_*` como fuente de IA (mantener solo para reporting histórico de AMALAY).

## Lo que sorprende (bueno)
La inteligencia de **órdenes, servicio, caja, clientes** puede correr **viva HOY** (esas vistas ya leen `pos_orders`). Lo único roto es el **agregado diario** + waiter/grupos. O sea: OCM está **~70% hecho**; falta 1 vista clave + 2 nuevas + el repunte + deploy.

## Recomendación de arranque
Empezar por **Fase 0 (aislamiento)** — es un P0 de seguridad real, rápido, y no depende de nada. Luego Fase 1 (`ocm_daily` vivo) que desbloquea el "¿cómo vamos hoy?" para cualquier tenant. Las vistas se validan en staging (`supabase-fullsite-staging`, writable) antes de prod; el deploy a prod lo aplica Daniel.

## Fuentes verificadas
- Vistas OCM: `information_schema.views` en staging (leen `pos_*`) + ausentes en prod AMALAY.
- Staleness: `wansoft_daily` MAX(fecha)=jul-20; `ops_daily` MAX(fecha)=jul-12 (prod AMALAY); `pos_orders` 165 filas, 24/7d, última ayer.
- Mapa de código: barrido de `/api/{chat,coach,voice,inventory/predict,health,export/polizas}` + `.github/scripts/*.py`.
