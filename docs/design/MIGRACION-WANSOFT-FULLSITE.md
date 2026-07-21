# Migración Wansoft → Fullsite — Framework de Onboarding

**Fecha:** 2026-07-21
**Status:** Diagnóstico en progreso
**Scope:** Framework reutilizable para cualquier cliente, no exclusivo AMALAY

---

## 1. Inventario de Datos Wansoft

### Datos Maestros (catálogos)

| Dominio | Registros | Fuente Wansoft | Endpoint | Acceso | Tabla Fullsite | Status |
|---|---|---|---|---|---|---|
| Productos/ingredientes | 769 | wansoft_products.json | Inventory/GetProductsBySubsidiary | Cookie relay | pos_ingredients | ✅ Migrado (1,063 rows) |
| Platillos/menú | 522 | wansoft_platillos.json | Menu/GetSaucerList | Cookie relay | pos_menu_items | ✅ Migrado |
| Categorías menú | ~30 | Dentro de platillos | Menu/GetGroupList | Cookie relay | pos_menu_categories | ✅ Migrado |
| Proveedores | 202 | wansoft_proveedores.json | Purchasing/GetSupplierList | Cookie relay | pos_suppliers | ✅ Migrado (200 rows) |
| Modificadores | 114 | wansoft_modificadores.json | Menu/GetComplementaryList | Cookie relay | pos_modifier_groups + pos_modifiers | ⚠️ Parcial |
| Clientes facturación | 36 | wansoft_clientes_fe.json | Billing/GetDocumentList | Cookie relay | — | ❌ No migrado |
| Unidades de medida | ~10 | API | Inventory/GetUnitsOfMeasureBySubsidiary | Cookie relay | — (inline en pos_ingredients.unit) | ✅ Implícito |

### Recetas y Sub-recetas

| Dominio | Registros | Fuente Wansoft | Endpoint | Acceso | Tabla Fullsite | Status |
|---|---|---|---|---|---|---|
| Recetas (platillo → ingredientes) | 615 platillos, 4,067 líneas | wansoft_recetas.json | Production/GetSaucerRecipe | Cookie relay + page warm | pos_recipes_old | ✅ Migrado |
| Sub-recetas (preparaciones) | 2 extraídos (incompleto) | wansoft_subproductos.json | Production/GetSubProductRecipe | Cookie relay + JS discovery | pos_sub_recipes + pos_sub_recipe_ingredients | ⚠️ Parcial — tabla existe pero componentes vacíos |
| Asignación modificadores → platillos | 522 mappings | wansoft_asignacion_modificadores.json | Browser scrape | Playwright | pos_item_modifier_groups | ⚠️ Parcial |
| Routing almacén (platillo → estación) | 522 | wansoft_routing_almacen.json | Derivado | Scrape | Inline en pos-constants.ts | ⚠️ Hardcodeado |
| Presentaciones/conversiones | ~50 | API | Inventory/GetPresentationsBySubsidiary | Cookie relay | pos_presentations | ❌ No migrado |

### Inventario

| Dominio | Registros | Fuente Wansoft | Endpoint | Acceso | Tabla Fullsite | Status |
|---|---|---|---|---|---|---|
| Stock actual | 736 items | wansoft_existencias.json | Inventory/GetInventoryBySubsidiary | 500 error* | pos_inventory | ⚠️ Parcial — 1,000 rows pero muchos con stock=0 |
| Costos por producto | 878 items | wansoft_costos.json | Reports/GetCostBySaucer | Cookie relay | pos_ingredients.cost_per_unit | ✅ 88% cobertura |
| Reorder points | 90 items | wansoft_reorder_points.json | Inventory/GetReorderPointReport | Cookie relay | pos_inventory.reorder_point | ⚠️ Solo 90 de 1,000 |
| Almacenes | 5 | API | Inventory/GetWarehousesBySubsidiary | Cookie relay | — (no existe tabla) | ❌ No migrado |
| Movimientos/cardex | Resumen | wansoft_cardex_summary.json | Inventory/GetInventoryStatement | 500 error* | pos_inventory_movements | ⚠️ Solo movimientos Fullsite |
| Merma (físico vs sistema) | Snapshot | API | Inventory/GetPhysicalInventoryVsSystem | 500 error* | wansoft_shrinkage | ⚠️ Tabla existe, datos viejos |

*Los endpoints de inventario de Wansoft retornan error 500 desde el server.

### Ventas y Operación

| Dominio | Registros | Fuente Wansoft | Endpoint | Acceso | Tabla Fullsite | Status |
|---|---|---|---|---|---|---|
| Ventas diarias | 887 días | Múltiples endpoints | Cookie relay | wansoft_daily | ✅ Migrado |
| Ventas por mesero | Dentro de daily | SalesByUser | Cookie relay | wansoft_daily.meseros | ✅ |
| Ventas por grupo | Dentro de daily | SalesByGroup | Cookie relay | wansoft_daily.ventas_por_grupo | ✅ |
| Ventas por platillo | Top 30/día + full | SalesBySaucer | Cookie relay | wansoft_daily.platillos_top + wansoft_data.platillos_full | ✅ |
| Ventas por hora | Snapshots | SalesByHours | Cookie relay | wansoft_hourly | ⚠️ Intermitente |
| Ventas por método de pago | Dentro de daily | SalesByPaymentType | Cookie relay | wansoft_daily.pago_metodos | ✅ |
| Ventas por tipo de orden | Dentro de daily | SalesByTypeOfOrder | Cookie relay | wansoft_daily.tickets_count/personas | ✅ |
| Descuentos detalle | Por período | DiscountsDetail | Cookie relay | wansoft_data.discounts_detail | ✅ |
| Cancelaciones detalle | Por período | CancelSalesDetail | Cookie relay | wansoft_data.cancel_sales | ✅ |
| Cortesías detalle | Por período | CourtesiesDetail | Cookie relay | wansoft_data.courtesies | ✅ |
| Propinas | Por día | SalesByUser | Cookie relay | wansoft_tips | ✅ |

### Compras y Proveedores

| Dominio | Registros | Fuente Wansoft | Endpoint | Acceso | Tabla Fullsite | Status |
|---|---|---|---|---|---|---|
| Compras por proveedor | Período | ShopBySupplier | Cookie relay | wansoft_suppliers | ✅ |
| Compras por producto | 376 items | ShopByProduct | Cookie relay | wansoft_data.purchases_by_product | ✅ |
| Órdenes de compra | 93 | wansoft_ordenes_compra.json | Purchasing/GetPurchaseOrderIssued | Cookie relay | pos_purchase_orders | ⚠️ Parcial |
| Facturas proveedor | 3,282 (1 año) | wansoft_facturas_proveedores.json | Account/MyDocumentsList | Playwright | pos_facturas | ⚠️ Tabla existe, sin datos migrados |
| Compras sugeridas | 342 items | wansoft_compras_sugeridas.json | Derivado | Scrape | — | ❌ No migrado |

### Staff y Labor

| Dominio | Registros | Fuente Wansoft | Endpoint | Acceso | Tabla Fullsite | Status |
|---|---|---|---|---|---|---|
| Usuarios POS | ~35 | API | Staff/GetPosUsersList | Cookie relay | pos_staff | ✅ Migrado |
| Asistencia | 35 | wansoft_asistencia.json | Staff/GetAccessControlReport | Cookie relay | wansoft_labor | ⚠️ Solo histórico |
| Turnos/shifts | Definiciones | API | Staff/GetShiftList | Cookie relay | pos_turnos | ✅ (runtime) |
| Horas trabajadas | Por período | Staff/GetUserHoursWorkedReport | Cookie relay | wansoft_data.hours_worked | ⚠️ |
| Huellas digitales | Per-device | HID reader | Hardware | pos_webauthn_credentials | ✅ (3 terminales) |

### Financiero

| Dominio | Registros | Fuente Wansoft | Endpoint | Acceso | Tabla Fullsite | Status |
|---|---|---|---|---|---|---|
| Corte de caja | Por día | ClosingCash | Cookie relay | wansoft_data.cash_closing | ⚠️ |
| Estado de resultados | Por mes | GetIncomeStatemetByMonthInYear | Cookie relay | wansoft_pnl | ⚠️ |
| Flujo de efectivo | Lista | GetCashFlowList | Cookie relay | wansoft_data.cash_flow | ⚠️ |
| Retiros de caja | Por período | GetCashWithdrawalReport | Cookie relay | wansoft_data.cash_withdrawals | ⚠️ |
| Depósitos bancarios | Lista | GetBankDepositList | Cookie relay | wansoft_data.bank_deposits | ⚠️ |

### CFDI / Facturación

| Dominio | Registros | Fuente Wansoft | Endpoint | Acceso | Tabla Fullsite | Status |
|---|---|---|---|---|---|---|
| Lista de CFDIs emitidos | Por período | Billing/GetDocumentList | Cookie relay | wansoft_data.invoices | ⚠️ |
| Clientes frecuentes RFC | 36 | wansoft_clientes_fe.json | Derivado | Scrape | — | ❌ No migrado |
| Conciliación fiscal | Resumen | wansoft_conciliacion_fe.json | Derivado | Scrape | — | ❌ No migrado |

### Configuración

| Dominio | Registros | Fuente Wansoft | Endpoint | Acceso | Tabla Fullsite | Status |
|---|---|---|---|---|---|---|
| Sucursal | 1 | Config | — | Manual | clients table | ✅ |
| Mesas/layout | 33 mesas | Visual | — | Manual | Hardcodeado en mesas/page.tsx | ⚠️ |
| Impresoras | 3 | Config | — | Manual | printers.json (Electron) | ✅ |
| Estaciones cocina | 3 | Config | — | Hardcoded | pos-constants.ts | ⚠️ |
| Promociones | Variable | GetPromotionList | Cookie relay | pos_promos | ⚠️ Parcial |

### No Disponible en Wansoft (sin scraper ni endpoint)

| Dominio | Nota |
|---|---|
| Nómina completa | Solo existe asistencia, no cálculo de nómina |
| Encuestas cliente | Módulo existe en Wansoft pero sin scraper |
| Tarjetas de regalo | Módulo existe pero sin scraper |
| Notas de crédito | Sin endpoint |
| Tablajería | Módulo especializado, sin scraper |

---

## 2. Clasificación de Migración

### Dato maestro (migrar una vez, mantener en Fullsite)

| Dato | Fuente | Prioridad | Dependencia |
|---|---|---|---|
| Catálogo de ingredientes | wansoft_products | ✅ Hecho | Base para todo |
| Catálogo de platillos | wansoft_platillos | ✅ Hecho | Menú del POS |
| Categorías de menú | Dentro de platillos | ✅ Hecho | Navegación POS |
| Proveedores | wansoft_proveedores | ✅ Hecho | Compras, entradas |
| Recetas | wansoft_recetas | ✅ Hecho | Food cost, deducción |
| Sub-recetas + componentes | wansoft_subproductos | ⚠️ Pendiente | Food cost completo |
| Modificadores | wansoft_modificadores | ⚠️ Parcial | POS modificadores |
| Asignación modif. → platillo | wansoft_asignacion_modificadores | ⚠️ Parcial | Flujo de modificadores |
| Staff (nombres, roles, PINs) | wansoft_asistencia + manual | ✅ Hecho | Login POS |
| Clientes facturación (RFC) | wansoft_clientes_fe | ❌ Pendiente | CFDI self-service |
| Almacenes | wansoft API | ❌ Pendiente | Inventario multi-almacén |
| Unidades y conversiones | wansoft API + wansoft_products | ⚠️ Parcial | Recetas, inventario |

### Saldo inicial (snapshot al momento del cutover)

| Dato | Fuente | Prioridad | Nota |
|---|---|---|---|
| Stock actual por ingrediente | wansoft_existencias | ⚠️ Parcial | Requiere conteo físico o sync al cutover |
| Costos por ingrediente | wansoft_costos + recipe extract | ✅ 88% | Mejora con normalización |
| Reorder points | wansoft_reorder_points | ⚠️ 90 de 1,000 | Configuración operativa |

### Historial completo (migrar para continuidad)

| Dato | Registros | Prioridad | Nota |
|---|---|---|---|
| Ventas diarias (wansoft_daily) | 887 días | ✅ Hecho | Base para dashboard, tendencias, IA |
| Propinas por mesero | ~300 días | ✅ Hecho | Reportes |
| Descuentos/cancelaciones | Por período | ✅ Hecho | Anti-fraude, auditoría |

### Historial resumido (solo métricas, no detalle)

| Dato | Nota |
|---|---|
| P&L mensual | Solo totales por mes, no línea por línea |
| Compras por proveedor | Solo totales por período |
| Asistencia staff | Solo resumen, no punch-by-punch |

### Dato que deliberadamente NO migraremos

| Dato | Razón |
|---|---|
| Facturas proveedor históricas (3,282) | No aportan a operación futura; consultar en Wansoft si se necesitan |
| Movimientos de inventario históricos | Nuevo ledger empieza con Fullsite; histórico en Wansoft |
| Cortes de caja históricos | Fullsite genera sus propios cortes |
| Órdenes POS históricas de Wansoft | Fullsite tiene sus propias órdenes |
| Sincronización/logs de Wansoft | No relevante |

---

## 3. Arquitectura de Migración

```
┌─────────────────────────────────────────────────────────────┐
│                 FULLSITE MIGRATION PIPELINE                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌───────────┐             │
│  │ EXTRACT  │ →  │  STAGE   │ →  │ NORMALIZE │             │
│  │          │    │          │    │           │             │
│  │ Wansoft  │    │ staging_ │    │ category  │             │
│  │ DevTools │    │ tables   │    │ unit map  │             │
│  │ Excel    │    │ (raw)    │    │ dedup     │             │
│  │ API      │    │          │    │ validate  │             │
│  └──────────┘    └──────────┘    └───────────┘             │
│                                        │                    │
│  ┌───────────┐   ┌──────────┐   ┌─────▼─────┐             │
│  │ RECONCILE │ ← │  IMPORT  │ ← │ VALIDATE  │             │
│  │           │   │          │   │           │             │
│  │ count     │   │ prod     │   │ dry run   │             │
│  │ totals    │   │ tables   │   │ conflicts │             │
│  │ diff      │   │ (final)  │   │ orphans   │             │
│  │ report    │   │          │   │ report    │             │
│  └───────────┘   └──────────┘   └───────────┘             │
│                                                             │
│  Config per client:                                         │
│  - source: 'wansoft' | 'excel' | 'manual'                  │
│  - category_map: {old → new}                               │
│  - unit_map: {old → canonical}                              │
│  - staging_schema: 'staging_{client_id}'                    │
│                                                             │
│  Every row carries:                                         │
│  - source_system: 'wansoft'                                 │
│  - source_id: original Wansoft code/key                     │
│  - client_id: target client                                 │
│  - imported_at: timestamp                                   │
│  - migration_batch: batch identifier                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Staging Tables

```sql
-- Generic staging table for any domain
CREATE TABLE staging_import (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  domain TEXT NOT NULL,        -- 'ingredients', 'menu', 'recipes', etc.
  source_system TEXT NOT NULL, -- 'wansoft', 'excel', 'manual'
  source_id TEXT,              -- original ID from source
  data JSONB NOT NULL,         -- raw extracted data
  status TEXT DEFAULT 'pending', -- pending, validated, imported, skipped, error
  error_msg TEXT,
  migration_batch TEXT,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Huecos Críticos

| # | Hueco | Impacto | Esfuerzo | Bloqueante |
|---|---|---|---|---|
| 1 | Sub-recetas sin componentes | Food cost incompleto para platillos con preparaciones | 2h (DevTools extraction) | Para food cost 100% |
| 2 | Reorder points (solo 90 de 1,000) | Alertas de reorden no funcionan para 91% del catálogo | 1h (import) | Para operación de compras |
| 3 | Almacenes no modelados | No se puede filtrar inventario por almacén | 2h (tabla + migración) | Para inventario multi-almacén |
| 4 | Modificadores asignación incompleta | POS no muestra modificadores correctos por platillo | 3h (import + validación) | Para UX del POS |
| 5 | Clientes facturación no migrados | Self-service CFDI no pre-llena datos del cliente | 1h (import) | Para CFDI |
| 6 | Presentaciones/conversiones | Compras en cajas, recetas en kg — sin tabla de conversión | 2h (tabla + import) | Para compras automatizadas |
| 7 | Inventario endpoints rotan 500 | No podemos sincronizar stock actual automáticamente | Depende de Wansoft | Para sync pre-cutover |

---

## 5. Plan de Migración para AMALAY

### Fase 1: Cerrar Huecos Maestros (1 día)

| Paso | Qué | Cómo | Criterio |
|---|---|---|---|
| 1.1 | Importar reorder points (90 → ~300+) | wansoft_reorder_points.json + compras_sugeridas | 30%+ items con reorder point |
| 1.2 | Normalizar categorías | category_map aplicado | 0 categorías con typos |
| 1.3 | Normalizar unidades | unit_map aplicado | 5 valores canónicos |
| 1.4 | Importar clientes facturación | wansoft_clientes_fe.json | 36 clientes con RFC |

### Fase 2: Completar Recetas (1 día)

| Paso | Qué | Cómo | Criterio |
|---|---|---|---|
| 2.1 | Extraer sub-recetas completas | DevTools en Wansoft (GetSubProductRecipe) | 100+ sub-recetas con componentes |
| 2.2 | Poblar pos_sub_recipe_ingredients | Import desde extracción | Food cost calculable para todas |
| 2.3 | Importar asignación modificadores | wansoft_asignacion_modificadores.json | Cada platillo tiene sus modifiers |

### Fase 3: Sync Pre-Cutover (día del cutover)

| Paso | Qué | Cómo | Criterio |
|---|---|---|---|
| 3.1 | Conteo físico de inventario | Alex hace conteo o sync desde Wansoft existencias | Stock real en pos_inventory |
| 3.2 | Verificar costos actuales | Cruzar wansoft_costos vs pos_ingredients | <5% de diferencia en top 50 items |
| 3.3 | Verificar menú y precios | Cruzar wansoft_platillos vs pos_menu_items | 0 diferencias de precio |

### Fase 4: Validación Post-Migración

| Paso | Qué | Criterio |
|---|---|---|
| 4.1 | Food cost top 20 platillos | Matches con Wansoft ±3% |
| 4.2 | Inventario: stock total | Matches con conteo físico ±5% |
| 4.3 | Menú: todos los platillos con precio | 0 faltantes |
| 4.4 | Recetas: deducción test order | Stock baja correctamente |
| 4.5 | Modificadores: test order con mods | Modificadores correctos |

---

## 6. Framework Reutilizable para Cliente #2

### Inputs requeridos por cliente

| Input | Fuente | Formato |
|---|---|---|
| Catálogo de productos/ingredientes | POS anterior o Excel | CSV/JSON |
| Menú con precios | POS anterior o Excel | CSV/JSON |
| Recetas | POS anterior o captura manual | CSV/JSON |
| Proveedores | POS anterior o Excel | CSV/JSON |
| Staff (nombres, roles) | Manual | UI wizard |
| Configuración (mesas, impresoras, estaciones) | Manual | UI wizard |
| Stock inicial | Conteo físico | CSV/UI |

### Para clientes SIN Wansoft

El pipeline se simplifica:
1. **Extract** → Excel/CSV upload
2. **Stage** → staging_import table
3. **Normalize** → category_map + unit_map configurables
4. **Validate** → dry run report
5. **Import** → production tables
6. **Reconcile** → count verification

### Para clientes CON Wansoft

1. **Extract** → DevTools bookmarklet (como hicimos para AMALAY)
2. Mismo pipeline de staging → normalize → validate → import

### Para clientes CON otro POS

1. **Extract** → Adaptador específico por POS (soft-restaurant, wansoft, micros, etc.)
2. Mismo pipeline downstream

---

## 7. Riesgos y Bloqueantes

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Endpoints de inventario Wansoft siguen en 500 | Alta | No se puede sync stock automáticamente | Conteo físico manual |
| Sesión Wansoft expira durante extracción larga | Alta | Extracción incompleta | Re-login + idempotencia |
| Duplicados en pos_ingredients (79 grupos) | Confirmada | Food cost incorrecto, confusión | Deduplicación P1-C |
| Sub-recetas vacías | Confirmada | Food cost parcial | DevTools extraction |
| Costos desactualizados | Media | Food cost drift | Entradas con costo promedio ponderado |
| Formato Excel no estándar (cliente #2) | Media | Parser falla | Validación de schema antes de import |

---

## 8. Recomendación: Qué Migrar Primero

**Para AMALAY (ya en progreso):**
1. ✅ Ingredientes — hecho
2. ✅ Recetas — hecho
3. ✅ Menú — hecho
4. ✅ Proveedores — hecho
5. ✅ Ventas históricas — hecho
6. ⬜ Normalización (categorías, unidades, duplicados) — siguiente
7. ⬜ Sub-recetas completas — siguiente
8. ⬜ Reorder points — siguiente
9. ⬜ Stock sync al cutover — día del cutover

**Para Cliente #2 (nuevo):**
1. Staff + config (onboarding wizard)
2. Menú + precios (CSV import)
3. Ingredientes + recetas (CSV import o DevTools)
4. Stock inicial (conteo físico)
5. Impresoras + mesas (manual config)
6. Go live

El pipeline se construye UNA vez y se reutiliza. La diferencia entre clientes es solo el **adaptador de extracción** (Wansoft DevTools vs Excel vs otro POS).
