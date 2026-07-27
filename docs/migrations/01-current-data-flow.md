# 01 — Flujos de Datos Actuales

> Fase 0 del Fullsite Migration Engine  
> Fecha: 2026-07-27  
> Basado en código real, no en suposiciones.

---

## Diagrama ASCII — Vista general

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         WANSOFT POS (AMALAY)                             │
│   wansoft.net/Wansoft.Web  —  SQL Server local (NetSilver, ~80 tablas)  │
└───────────────────────────────────────┬──────────────────────────────────┘
                                        │
              ┌─────────────────────────┼──────────────────────────────┐
              │  HTTP POST              │  HTML scrape              │  Playwright
              ▼                         ▼                            ▼
┌──────────────────────┐  ┌──────────────────────────┐  ┌─────────────────────┐
│  wansoft_backfill.py  │  │ wansoft_inventory_sync.py│  │ wansoft-explorer    │
│  wansoft_menu_sync.py │  │ wansoft_inventory_scrape │  │ (manual / ad-hoc)   │
│  (GitHub Actions)     │  │ (GitHub Actions)         │  │                     │
└──────────┬───────────┘  └───────────┬──────────────┘  └──────────┬──────────┘
           │                          │                             │
           │ Supabase REST API        │ Supabase REST API           │ Supabase REST API
           ▼                          ▼                             ▼
┌──────────────────────┐  ┌──────────────────────────┐  ┌─────────────────────┐
│    wansoft_daily     │  │      wansoft_data         │  │   wansoft_catalog   │
│    wansoft_kpis      │  │  (key-value genérico)     │  │                     │
│   wansoft_menu_config│  │                           │  │                     │
└──────────┬───────────┘  └──────────────────────────┘  └─────────────────────┘
           │
           │  (lectura por agentes)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│           AGENTES (GitHub Actions cron / Telegram)               │
│  daily_briefing, weekly_amalay, wansoft_query, anomaly_detector, │
│  close_predictor, tips_analyzer, menu_engineering, etc.          │
└──────────────────────────────────────────────────────────────────┘

FLUJO PARALELO — migración de catálogo (no conectado al anterior):

┌─────────────────────────────┐
│  agents/wansoft/*.json      │  ← snapshots manuales del portal
│  (wansoft_products.json,    │
│   wansoft_recetas.json,     │
│   wansoft_existencias*.json,│
│   wansoft_proveedores.json) │
└──────────────┬──────────────┘
               │
     ┌─────────┴──────────────────────────────┐
     │                                        │
     ▼                                        ▼
┌─────────────────────────┐     ┌──────────────────────────────────────┐
│ migrate-wansoft-to-     │     │  scripts/migration-pipeline/         │
│ supabase.py             │     │  dry-run.ts                          │
│ (genera SQL manual)     │     │  (valida, normaliza, NO escribe)     │
└────────────┬────────────┘     └──────────────────────────────────────┘
             │
             ▼ (ejecutar manualmente en SQL Editor)
┌────────────────────────────────────────────┐
│  pos_suppliers                             │
│  pos_recipes_old                           │
│  pos_inventory_products                    │
└────────────────────────────────────────────┘
             │
             │ (lectura por POS + agentes)
             ▼
┌────────────────────────────────────────────┐
│   Dashboard Next.js / POS                  │
│   (food cost, inventory, purchase orders)  │
└────────────────────────────────────────────┘
```

---

## Flujo 1 — Ventas diarias (wansoft_daily)

**Script:** `.github/scripts/wansoft_backfill.py`  
**Trigger:** `wansoft-backfill.yml` manual con `start_date`/`end_date`, o `wansoft-daily-mesero.yml` cron (3pm avance, 8:30pm / 11pm cierre)  
**Frecuencia:** Diaria (3 veces), backfill on-demand  
**Idempotente:** Sí — usa `ON CONFLICT (fecha) DO UPDATE` vía `Prefer: resolution=merge-duplicates`

```
[Wansoft Reports HTTP] → [HTML parse (BeautifulSoup)] → [Normalización Python] → [Supabase REST UPSERT] → [wansoft_daily]
```

Endpoints Wansoft consultados por `scrape_day()`:
1. `Reports/GetConsolidatedSales` — ventas totales (JSON, más confiable)
2. `Reports/SalesByTypeOfOrder` — personas, órdenes
3. `Reports/SalesByUser` — ventas por mesero
4. `Reports/SalesByGroup` — ventas por grupo de menú
5. `Reports/SalesByPaymentType` — métodos de pago
6. `Reports/SalesBySaucer` — top platillos
7. `Reports/SalesByHours` — ventas por hora

Transformaciones:
- `parse_num()`: convierte "$1,234.56" a float
- Filtro de meseros: excluye staff de `staff_exclude_meseros` y `staff_market` del client config
- `ticket_promedio_restaurant = ventas_dia / tickets_count` (calculado, no campo Wansoft)
- Propinas: DESCONOCIDO si vienen de este endpoint o de otro scraper

Validaciones: Ninguna formal. Si un endpoint falla, se loguea el error y el campo queda vacío.

Rollback: No existe. Una sobreescritura incorrecta no tiene deshacer automático.

---

## Flujo 2 — KPIs en tiempo real (wansoft_kpis)

**Estado:** DESCONOCIDO — no fue posible identificar el script exacto que escribe `wansoft_kpis`.  
El scraper `wansoft-daily-mesero.yml` (Playwright) probablemente lo alimenta, pero el script `wansoft_browser_scraper.py` no fue leído en detalle.

```
[Wansoft portal — vista de KPIs en tiempo real] → [Playwright scrape] → [parser] → [wansoft_kpis] → [Dashboard]
```

Frecuencia: INFERENCIA — intraday (3pm, 8:30pm, 11pm por configuración del workflow)  
Idempotente: DESCONOCIDO  
Rollback: No existe

---

## Flujo 3 — Productos / ingredientes (catálogo)

**Script:** `agents/wansoft-explorer/` (histórico) + `agents/wansoft/*.json` (snapshots)

El flujo tiene dos subprocesos que no están coordinados:

### 3a — Captura manual de snapshots JSON

```
[Wansoft portal — sección inventario/catálogo] → [Playwright / HTTP manual] → [agents/wansoft/*.json]
```

Los archivos JSON son snapshots estáticos capturados en diferentes fechas:
- `wansoft_products.json` — catálogo de ingredientes (código, nombre, unidad, departamento, costo)
- `wansoft_existencias.json` — existencias con `codigo`, `nombre`, `unidad`, `departamento`, `existencia`, `saldo_mxn`
- `wansoft_existencias_20260707.json` — snapshot del 2026-07-07 con `department`, `code`, `product`, `unit`, `stock`, `value`

NOTA: Los dos archivos de existencias tienen schemas diferentes entre sí (campos en inglés vs español).

### 3b — SQL generator ad-hoc

```
[agents/wansoft/wansoft_products.json] → [migrate-wansoft-to-supabase.py] → [scripts/sql/03-existencias.sql]
                                                                             → [Supabase SQL Editor manual]
                                                                             → [pos_inventory_products]
```

Frecuencia: Manual (una sola vez)  
Idempotente: Sí — usa `ON CONFLICT (client_id, name) DO UPDATE`  
Rollback: No existe  
Nota crítica: `CLIENT_ID = "amalay"` hardcoded en línea 22

---

## Flujo 4 — Recetas e ingredientes

**Script:** `scripts/migrate-wansoft-to-supabase.py` (función `migrate_recetas()`)

```
[agents/wansoft/wansoft_recetas.json] → [migrate-wansoft-to-supabase.py] → [scripts/sql/02-recetas.sql]
                                                                           → [Supabase SQL Editor manual]
                                                                           → [pos_recipes_old]
```

Estructura de `wansoft_recetas.json`: `{code, dish, ingredients: [{product, unit, qty}]}`

Transformaciones:
- `menu_item_id = code.lower()`
- `ingredient_id = slugify(product)` (re.sub para caracteres especiales)
- Unidad tomada tal cual del JSON

Validaciones: Ninguna. No se verifica que `ingredient_id` exista en `pos_inventory_products`.

Frecuencia: Manual (una sola vez por restaurante)  
Idempotente: Sí — `ON CONFLICT (client_id, menu_item_id, ingredient_id) DO UPDATE`

**Pipeline alternativo (no productivo):**

```
[agents/wansoft/wansoft_recetas.json] → [scripts/migration-pipeline/dry-run.ts --real]
                                       → [validators/index.ts] → [ValidationReport]
                                       → [dry-run-report.json] → (no escribe a BD)
```

El dry-run rechazó 1456/2225 records (65%) cuando se corrió con datos reales.

---

## Flujo 5 — Proveedores

**Script:** `scripts/migrate-wansoft-to-supabase.py` (función `migrate_proveedores()`)

```
[agents/wansoft/wansoft_proveedores.json] → [migrate-wansoft-to-supabase.py]
    → [scripts/sql/01-proveedores.sql] → [Supabase SQL Editor manual] → [pos_suppliers]
```

NOTA CRÍTICA: Los campos en `wansoft_proveedores.json` están corridos:
- JSON `"rfc"` = nombre real del proveedor
- JSON `"nombre"` = RFC (a veces)
- JSON `"telefono"` = RFC duplicado o teléfono
- JSON `"email"` = teléfono real
- JSON `"giro"` = email real
- JSON `"dias_credito"` = giro/categoría (cuando es string)

El script compensa esto con heurísticas (regex para RFC, validación de teléfono, etc.), pero el origen del desajuste (scraper con columnas corridas) no ha sido corregido.

Frecuencia: Manual  
Idempotente: Sí — `ON CONFLICT (client_id, name) DO UPDATE`

---

## Flujo 6 — Inventario / Existencias (sync continuo)

**Script:** `.github/scripts/wansoft_inventory_sync.py`

```
[Wansoft REST endpoints] → [POST con session cookies] → [JSON response]
    → [Supabase REST UPSERT] → [wansoft_data (key-value: inventory_state, warehouses, reorder_points)]
```

Endpoints consultados:
- `Inventory/GetWarehousesBySubsidiarySortedByName`
- `Inventory/GetInventoryStatementBySubsidiary`
- `Inventory/GetProductsBySubsidiary`
- `Inventory/GetReOrderListByWareHouse`

Frecuencia: DESCONOCIDO (workflow no leído completamente)  
Idempotente: DESCONOCIDO  
Rollback: No existe

---

## Flujo 7 — Modificadores

**Estado:** Solo existe el snapshot `agents/wansoft/wansoft_modificadores.json`. No hay un flujo activo que escriba modificadores a una tabla Fullsite de forma regular.

```
[agents/wansoft/wansoft_modificadores.json] → [DESCONOCIDO / sin pipeline activo]
```

La tabla `wansoft_asignacion_modificadores.json` también existe como snapshot pero sin pipeline.

---

## Flujo 8 — Meseros

Meseros no se migran como entidad separada. El flujo es:

```
[clients.meseros JSONB] → [client_config.py] → [filtro en wansoft_backfill.py] → [wansoft_daily.meseros JSONB]
```

El staff de POS se gestiona en `pos_staff` (con PIN, rol, etc.) de forma independiente al scraping de Wansoft.

---

## Flujo 9 — Catálogo del portal (wansoft_explorer)

```
[Wansoft portal — navegación completa] → [Playwright + HTTP interceptor] → [artifacts JSON locales]
    → [agents/wansoft-explorer/src/supabase_client.py] → [UPSERT wansoft_catalog]
```

Frecuencia: Manual (run único o bajo demanda)  
Idempotente: Sí — `ON CONFLICT (path, explorer_version) DO UPDATE`

---

## Resumen de características por flujo

| Flujo | Frecuencia | Trigger | Idempotente | Rollback | Credenciales en GH Secrets |
|---|---|---|---|---|---|
| Ventas diarias | 3x/día | cron GH Actions | Sí | No | Sí |
| KPIs real-time | Intraday | cron GH Actions | DESCONOCIDO | No | Sí |
| Catálogo productos | Manual (una vez) | manual CLI | Sí | No | No (local) |
| Recetas | Manual (una vez) | manual CLI | Sí | No | No (local) |
| Proveedores | Manual (una vez) | manual CLI | Sí | No | No (local) |
| Inventario sync | DESCONOCIDO | GH Actions | DESCONOCIDO | No | Sí |
| Inventario scrape | DESCONOCIDO | GH Actions | DESCONOCIDO | No | Sí |
| Modificadores | No activo | — | — | — | — |
| Portal catalog | Manual | manual CLI | Sí | No | No (local) |
