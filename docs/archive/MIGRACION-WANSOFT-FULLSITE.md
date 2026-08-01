# Migración Wansoft → Fullsite — Documento Maestro

**Fecha:** 2026-07-21
**Status:** Diagnóstico completo. Pendiente revisión y aprobación del roadmap.
**Scope:** Framework reutilizable para cualquier cliente.

---

## Resumen Ejecutivo

### Cobertura de Migración: ~65%

De los 12 dominios de Wansoft, 4 están completamente migrados, 5 parcialmente, y 3 no migrados.

De las 96 tablas de Fullsite, ~66 tienen `client_id` correcto, ~30 no tienen `CREATE TABLE` reproducible (deuda de infraestructura).

### Top 7 Huecos Críticos (por impacto)

| # | Hueco | Bloquea AMALAY | Bloquea Cliente #2 | Esfuerzo |
|---|---|---|---|---|
| 1 | **Sub-recetas sin componentes** — `pos_sub_recipe_ingredients` vacía | Food cost parcial | Food cost | 2h (DevTools) |
| 2 | **Reorder points** — solo 90 de 1,000 items | Alertas de reorden inútiles | Compras | 1h (import) |
| 3 | **Modificadores incompletos** — asignación platillo→modifier no migrada | UX POS parcial | POS | 3h |
| 4 | **Almacenes no modelados** — no existe tabla de warehouses | Inventario sin filtro por área | Inventario multi-almacén | 2h |
| 5 | **30 tablas sin migrations SQL** — no reproducible | No (funciona en Supabase) | Setup de nuevo proyecto | 3-5 días |
| 6 | **Clientes facturación** — 36 RFCs no migrados | CFDI self-service sin pre-fill | CFDI | 1h |
| 7 | **Presentaciones/conversiones** — compras en cajas, recetas en kg | Compras manuales | Compras automatizadas | 2h |

### Resumen por tipo de bloqueo

**Bloquea cutover AMALAY:** #1, #2 (parcialmente), #3 (parcialmente)
**Bloquea cliente #2:** #4, #5, #7
**Deuda técnica:** #5 (migrations), inconsistencia `client_slug` vs `client_id`

---

## Matriz de Cruce: Wansoft → Fullsite (12 dominios)

### 1. Menú y Platillos

| Aspecto | Detalle |
|---|---|
| **Wansoft** | 522 platillos, 30 grupos, 114 modificadores |
| **Endpoints** | Menu/GetSaucerList, Menu/GetGroupList, Menu/GetComplementaryList, Menu/GetPromotionList |
| **Acceso** | Cookie relay |
| **Tablas Fullsite** | `pos_menu_categories` (30 cats), `pos_menu_items` (522+ items), `pos_modifier_groups`, `pos_modifiers`, `pos_category_modifiers`, `pos_item_modifier_groups`, `pos_combos`, `pos_promotions`, `pos_sizes`, `pos_schedules` |
| **Status** | ⚠️ PARCIAL |
| **Cobertura** | Platillos y categorías: 100%. Modificadores: ~60% (114 importados, asignación por platillo incompleta). Combos, horarios, sizes: schema existe pero sin datos. |
| **Huecos** | Asignación modificador→platillo (`wansoft_asignacion_modificadores.json` tiene 522 mappings, `pos_item_modifier_groups` parcial). Promociones: schema vacío. |
| **Riesgo** | Medio — POS funciona sin asignación, pero mesero no ve modificadores correctos por platillo |
| **Prioridad** | P2 — importante para UX pero no bloqueante |

### 2. Recetas y Sub-recetas

| Aspecto | Detalle |
|---|---|
| **Wansoft** | 615 recetas (4,067 líneas), ~108 sub-recetas, presentaciones/conversiones |
| **Endpoints** | Production/GetSaucerRecipe, Production/GetSubProductRecipe, Inventory/GetRecipeProductsBySubsidiary, Inventory/GetUnitsOfMeasureBySubsidiary, Inventory/GetPresentationsBySubsidiary |
| **Acceso** | Cookie relay + page warm (recetas), JS discovery (sub-recetas) |
| **Tablas Fullsite** | `pos_recipes_old` (4,067 líneas), `pos_sub_recipes` (50 headers), `pos_sub_recipe_ingredients` (0 filas — VACÍA), `pos_unit_conversions` (8 sistema), `pos_presentations`, `pos_ingredient_presentations` |
| **Status** | ⚠️ PARCIAL |
| **Cobertura** | Recetas: 100% (615 platillos). Sub-recetas: headers 100%, **componentes 0%**. Conversiones: 8 sistema, sin datos de Wansoft. Presentaciones: schema vacío. |
| **Huecos** | **`pos_sub_recipe_ingredients` VACÍA** — cost engine no puede calcular sub-recetas. `wansoft_subproductos.json` solo tiene 2 items (extracción fallida). Food cost afectado. |
| **Riesgo** | **ALTO** — afecta directamente food cost. 44 sub-recetas sin costo calculable. |
| **Prioridad** | **P0** — mayor impacto en food cost |

### 3. Ingredientes y Catálogo de Productos

| Aspecto | Detalle |
|---|---|
| **Wansoft** | 769 productos con código, nombre, unidad, departamento, tipo, rendimiento, costo |
| **Endpoints** | Inventory/GetProductsBySubsidiary, Inventory/GetRecipeProductsBySubsidiary |
| **Acceso** | Cookie relay |
| **Tablas Fullsite** | `pos_ingredients` (1,063 activos), `pos_insumos` (flat Wansoft view) |
| **Status** | ✅ MIGRADO |
| **Cobertura** | 100% de Wansoft migrado + 294 items adicionales creados en Fullsite. 88% con costo. 97% del revenue con food cost. |
| **Huecos** | 312 sin costo (12%), 547 sin categoría (pendiente normalización P1), 79 duplicados, unidades inconsistentes. |
| **Riesgo** | Bajo — operativo, mejora con normalización |
| **Prioridad** | P1 — normalización |

### 4. Inventario y Stock

| Aspecto | Detalle |
|---|---|
| **Wansoft** | 736 items con stock, 5 almacenes, reorder points, cardex/movimientos, merma |
| **Endpoints** | Inventory/GetInventoryBySubsidiary (500 error), GetReorderPointReport, GetPhysicalInventoryVsSystem (500 error), GetInventoryStatementBySubsidiary (500 error), GetWarehousesBySubsidiary |
| **Acceso** | Cookie relay (endpoints de inventario retornan 500 — bug de Wansoft) |
| **Tablas Fullsite** | `pos_inventory` (1,000 filas), `pos_inventory_movements` (ledger), `pos_inventory_products` (deprecated, 745), `pos_inventory_snapshots`, `pos_inventory_alerts` |
| **Status** | ⚠️ PARCIAL |
| **Cobertura** | Stock: importado pero desactualizado (no hay sync automático por error 500). Reorder: 90 de 1,000 (9%). Almacenes: no modelados. Ledger: solo movimientos Fullsite (post Jul 20). |
| **Huecos** | **Reorder points al 9%**, almacenes sin tabla, stock requiere conteo físico o sync manual al cutover. Endpoints de inventario rotos en Wansoft. |
| **Riesgo** | Medio — stock se corrige con conteo físico al cutover |
| **Prioridad** | P1 — reorder points. P3 — almacenes (post-cutover) |

### 5. Compras y Proveedores

| Aspecto | Detalle |
|---|---|
| **Wansoft** | 202 proveedores, 93 órdenes de compra, 3,282 facturas (1 año), 342 compras sugeridas, 376 compras por producto |
| **Endpoints** | Purchasing/GetSupplierList, Purchasing/GetPurchaseOrderIssued, Reports/ShopBySupplier, Reports/ShopByProduct, Account/MyDocumentsList (Playwright) |
| **Acceso** | Cookie relay (excepto facturas que requieren Playwright) |
| **Tablas Fullsite** | `pos_suppliers` (200), `pos_purchase_orders` (schema), `pos_purchase_order_items` (schema), `pos_facturas` (0 datos), `pos_gastos` |
| **Status** | ⚠️ PARCIAL |
| **Cobertura** | Proveedores: 100%. Órdenes de compra: schema existe, sin datos migrados. Facturas proveedor: schema existe, 0 datos. Compras sugeridas: no modelado. |
| **Huecos** | Sin historial de compras en Fullsite. Las compras futuras se registran vía flujo de Entradas (ya funciona). Facturas históricas: deliberadamente no migramos. |
| **Riesgo** | Bajo — operación futura ya funciona (Entradas + factura proveedor) |
| **Prioridad** | P3 — historial no es crítico |

### 6. Ventas y Reportes

| Aspecto | Detalle |
|---|---|
| **Wansoft** | 887 días de histórico, ventas por mesero/grupo/platillo/hora/área/terminal/método/tipo |
| **Endpoints** | Reports/GetConsolidatedSales, SalesByUser, SalesByGroup, SalesBySaucer, SalesByHours, SalesByPaymentType, SalesByTypeOfOrder, SalesByArea, SalesByTerminal, SalesByModifiers, GetMonitoringInfo |
| **Acceso** | Cookie relay (todos) |
| **Tablas Fullsite** | `wansoft_daily` (887 filas), `wansoft_kpis`, `wansoft_hourly`, `wansoft_tips`, `wansoft_food_cost`, `wansoft_persons_hourly`, `wansoft_waiter_categories`, `pos_orders` (Fullsite nativo) |
| **Status** | ✅ MIGRADO |
| **Cobertura** | 100% de histórico disponible. `intraday_sales.py` sincroniza diario vía cookie relay. Dashboard lee de `wansoft_daily`. |
| **Huecos** | `wansoft_kpis` congelado en Jun 15 (no se actualiza — usa tabla diferente). Algunos días faltantes (4 gaps en 33 días). Sesión Wansoft expira en ~55 min. |
| **Riesgo** | Bajo — datos históricos suficientes, Fullsite genera sus propios datos vía POS |
| **Prioridad** | P3 — mantenimiento |

### 7. Descuentos, Cancelaciones, Cortesías

| Aspecto | Detalle |
|---|---|
| **Wansoft** | Detalle por período de descuentos, cancelaciones, anulaciones, cortesías |
| **Endpoints** | Reports/DiscountsDetail, CancelSalesDetail, SaleNullificationDetail, CourtesiesDetail |
| **Acceso** | Cookie relay |
| **Tablas Fullsite** | `wansoft_data` (data_keys: discounts_detail, cancel_sales, voids, courtesies), `pos_audit_log` (Fullsite nativo) |
| **Status** | ✅ MIGRADO |
| **Cobertura** | Histórico en wansoft_data. Fullsite genera sus propios registros vía pos_audit_log con detalle completo (razón, aprobador, PIN/biométrico). |
| **Huecos** | Ninguno operativo. Histórico de Wansoft es referencia, no operativo. |
| **Riesgo** | Ninguno |
| **Prioridad** | N/A — cerrado |

### 8. Staff y Labor

| Aspecto | Detalle |
|---|---|
| **Wansoft** | 35 empleados, asistencia, horas trabajadas, turnos, usuarios POS |
| **Endpoints** | Staff/GetPosUsersList, Staff/GetAccessControlReport, Staff/GetUserHoursWorkedReport, Staff/GetShiftList |
| **Acceso** | Cookie relay |
| **Tablas Fullsite** | `pos_staff` (activo), `pos_staff_audit`, `pos_attendance`, `pos_staff_shifts`, `pos_sessions`, `pos_webauthn_credentials` |
| **Status** | ✅ MIGRADO |
| **Cobertura** | Staff: 100% (nombres, roles, PINs). Huellas: 3 terminales con WebAuthn. Asistencia: runtime vía Fullsite (no historial Wansoft). |
| **Huecos** | Historial de asistencia Wansoft no migrado (deliberado — Fullsite genera el suyo). |
| **Riesgo** | Ninguno |
| **Prioridad** | N/A — cerrado |

### 9. Financiero

| Aspecto | Detalle |
|---|---|
| **Wansoft** | Cortes de caja, P&L mensual, flujo de efectivo, retiros, depósitos bancarios |
| **Endpoints** | Reports/ClosingCash, GetIncomeStatemetByMonthInYear, Finance/GetCashFlowList, GetCashWithdrawalReport, Finance/GetBankDepositList |
| **Acceso** | Cookie relay |
| **Tablas Fullsite** | `pos_cierres` (Fullsite nativo), `pos_cash_movements`, `pos_turnos`, `wansoft_pnl` (P&L histórico), `wansoft_data` (cash_closing, etc.) |
| **Status** | ⚠️ PARCIAL |
| **Cobertura** | Corte de caja: Fullsite genera los suyos. P&L: histórico en wansoft_pnl. Retiros/depósitos: Fullsite tiene pos_cash_movements. |
| **Huecos** | Sin estado de resultados nativo en Fullsite (usa datos de Wansoft). Sin conciliación bancaria. |
| **Riesgo** | Bajo — operación diaria funciona, reportes financieros avanzados pendientes |
| **Prioridad** | P3 — post-cutover |

### 10. CFDI / Facturación

| Aspecto | Detalle |
|---|---|
| **Wansoft** | Lista de CFDIs emitidos, 36 clientes frecuentes con RFC |
| **Endpoints** | Billing/GetDocumentList |
| **Acceso** | Cookie relay |
| **Tablas Fullsite** | `pos_cfdi_requests`, `pos_billing_clients` (6 clientes seed), `pos_invoices` |
| **Status** | ⚠️ PARCIAL |
| **Cobertura** | Arquitectura CFDI completa (Facturama). QR en ticket. Self-service. Pero: 0 CFDIs emitidos en producción (Facturama no activado). Clientes facturación: 6 de 36 migrados. |
| **Huecos** | **Facturama no activado** ($1,650/año). 30 clientes RFC no migrados. Sin endpoint de cancelación. |
| **Riesgo** | Medio — depende de decisión de pago |
| **Prioridad** | P1 — activar antes del cutover |

### 11. Mesas, Layout y Configuración

| Aspecto | Detalle |
|---|---|
| **Wansoft** | 33 mesas en layout físico, 5 almacenes, estaciones de cocina |
| **Endpoints** | No aplica — configuración visual/manual |
| **Acceso** | Manual |
| **Tablas Fullsite** | No existe tabla de mesas (hardcodeado en `pos-data.ts` y `mesas/page.tsx`). `clients` tiene campo `mesas`. No existe tabla de almacenes. Estaciones en `pos-constants.ts`. |
| **Status** | ⚠️ PARCIAL |
| **Cobertura** | Mesas: funciona con default genérico (1-20). Layout visual: hardcodeado a AMALAY. Estaciones: hardcodeadas (cocina/barra/caja). |
| **Huecos** | **Sin tabla configurable de mesas** — bloquea cliente #2 con layout diferente. Sin modelo de almacenes. |
| **Riesgo** | Alto para cliente #2 (ve layout de AMALAY) |
| **Prioridad** | P1 para cliente #2 |

### 12. CRM, Reservaciones y Delivery

| Aspecto | Detalle |
|---|---|
| **Wansoft** | E-commerce orders, menu status por plataforma, conciliación |
| **Endpoints** | ECommerce/GetGeneralOrderStatusList, GetECommerceMenuStatusList |
| **Acceso** | Cookie relay |
| **Tablas Fullsite** | `reservaciones` (23 filas, migrada de amalay_reservaciones), `delivery_orders`, `delivery_platform_payments`, `crm_clients` (12.2K), `crm_campaigns`, `whatsapp_conversations`, `whatsapp_messages_log`, `pos_customers`, `pos_customer_visits`, `pos_customer_notes` |
| **Status** | ⚠️ PARCIAL |
| **Cobertura** | Reservaciones: 100% migrado. CRM WhatsApp: funciona independiente. Delivery: schema existe, integración Uber/Rappi en progreso. |
| **Huecos** | Integración Rappi bloqueada (contrato perdido). Uber Eats pendiente validación producción. |
| **Riesgo** | Bajo — operación core no depende de delivery |
| **Prioridad** | P3 |

---

## Tablas Fullsite sin Migrations SQL (Deuda de Infraestructura)

### Diagnóstico

De 96 tablas en Supabase, ~30 no tienen archivo `CREATE TABLE` en el repositorio. Fueron creadas directamente en el SQL Editor de Supabase.

**Impacto:** Si necesitamos replicar el proyecto para un nuevo cliente en un Supabase diferente, no hay forma automatizada de recrear estas tablas.

### Tablas sin migration file

| Tabla | Grupo | Importancia |
|---|---|---|
| `pos_orders` | POS Core | Crítica |
| `pos_staff` | POS Core | Crítica |
| `pos_turnos` | POS Core | Crítica |
| `pos_cash_movements` | POS Core | Alta |
| `pos_attendance` | Staff | Media |
| `pos_staff_audit` | Staff | Media |
| `pos_staff_shifts` | Staff | Media |
| `pos_inventory_alerts` | Inventario | Media |
| `pos_inventory_snapshots` | Inventario | Media |
| `pos_gastos` | Finanzas | Media |
| `pos_cfdi_requests` | CFDI | Alta |
| `pos_invoices` | CFDI | Alta |
| `delivery_orders` | Delivery | Media |
| `delivery_platform_payments` | Delivery | Baja |
| `push_subscriptions` | Notificaciones | Baja |
| `chat_logs` | IA | Baja |
| `agent_runs` | Agentes | Alta |
| `agent_results` | Agentes | Alta |
| `agent_insights` | Agentes | Baja |
| `ops_daily` | Agentes | Media |
| `clients` | Infraestructura | Crítica |
| `client_locations` | Infraestructura | Alta |
| `prospects` | CRM | Baja |
| `credentials_vault` | Admin | Media |
| `events` | Event store | Media |
| `calendar_sync_log` | Sync | Baja |
| `wansoft_daily` | Pipeline | Alta |
| `wansoft_kpis` | Pipeline | Alta |
| `wansoft_hourly` | Pipeline | Media |
| `wansoft_tips` | Pipeline | Media |

### Estrategia de Resolución

**No resolver ahora.** Resolver como parte del onboarding pipeline (Fase 6 del roadmap):

1. Exportar schema actual de Supabase: `pg_dump --schema-only`
2. Generar migrations reproducibles por tabla
3. Almacenar en `scripts/sql/migrations/`
4. Validar que un proyecto nuevo se puede crear desde cero corriendo los migrations
5. Agregar al wizard de onboarding

**Esfuerzo estimado:** 3-5 días (una vez, reutilizable para siempre)

---

## Inconsistencias de Schema

| Inconsistencia | Tablas afectadas | Impacto | Fix |
|---|---|---|---|
| `client_slug` vs `client_id` | `wansoft_daily`, `crm_clients`, `crm_campaigns`, `google_reviews` | Queries inconsistentes, joins complicados | Renombrar a `client_id` o crear vista |
| `pos_inventory_products` (deprecated) | 1 tabla | Confusión, datos duplicados | Deprecar formalmente, redirect reads |
| `amalay_reservaciones` (legacy) | 1 tabla | Datos duplicados con `reservaciones` | Ya migrado, puede dropearse |
| `pos_recipes` vs `pos_recipes_old` vs `pos_recipe_versions` | 3 tablas para lo mismo | Confusión sobre cuál es canónica | `pos_recipes_old` es la activa, las otras son legacy o futuro |
| `pos_insumos` sin `client_id` | 1 tabla | No es multi-tenant | Agregar `client_id` o deprecar |

---

## Arquitectura de Migración

```
┌─────────────────────────────────────────────────────────────┐
│                 FULLSITE MIGRATION PIPELINE                 │
│                 (reutilizable por cliente)                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  EXTRACT                                                    │
│  ├── Wansoft DevTools (bookmarklet en browser)              │
│  ├── Excel/CSV upload                                       │
│  ├── API directa (otro POS)                                 │
│  └── Manual (wizard UI)                                     │
│           │                                                 │
│           ▼                                                 │
│  STAGE (staging_import table)                               │
│  ├── client_id, domain, source_system, source_id            │
│  ├── data (JSONB raw)                                       │
│  ├── status: pending → validated → imported → error         │
│  └── migration_batch                                        │
│           │                                                 │
│           ▼                                                 │
│  NORMALIZE                                                  │
│  ├── category_map: {old → canonical}                        │
│  ├── unit_map: {old → canonical}                            │
│  ├── dedup rules                                            │
│  └── name normalization                                     │
│           │                                                 │
│           ▼                                                 │
│  VALIDATE                                                   │
│  ├── Dry run (sin escribir a producción)                    │
│  ├── Conflict detection (duplicados, orphans)               │
│  ├── Reference integrity (FK checks)                        │
│  └── Report: OK / WARNING / ERROR por fila                  │
│           │                                                 │
│           ▼                                                 │
│  IMPORT                                                     │
│  ├── Idempotente (re-run safe)                              │
│  ├── Batch by domain                                        │
│  ├── Cada fila: source_system + source_id + imported_at     │
│  └── Rollback: soft-delete o reversal log                   │
│           │                                                 │
│           ▼                                                 │
│  RECONCILE                                                  │
│  ├── Count verification (source vs target)                  │
│  ├── Total verification (sumas, valores)                    │
│  ├── Sample spot-check (top 20 por dominio)                 │
│  └── Diff report: matches / mismatches / missing            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Orden de importación (respeta dependencias)

```
1. clients (configuración del restaurante)
2. pos_staff (roles, PINs)
3. pos_ingredients (catálogo de productos)
4. pos_inventory (stock inicial)
5. pos_menu_categories + pos_menu_items (menú)
6. pos_modifier_groups + pos_modifiers (modificadores)
7. pos_suppliers (proveedores)
8. pos_recipes_old (recetas)
9. pos_sub_recipes + pos_sub_recipe_ingredients (sub-recetas)
10. reservaciones (si aplica)
11. wansoft_daily (histórico de ventas, si viene de Wansoft)
```

---

## Plan de Migración: AMALAY

### Fase 1: Cerrar Huecos Maestros (1 día)

| Paso | Qué | Fuente | Criterio de aceptación |
|---|---|---|---|
| 1.1 | Importar reorder points | wansoft_reorder_points.json + compras_sugeridas | 30%+ items con reorder point |
| 1.2 | Normalizar categorías (18 → 8) | category_map ya definido | 0 categorías con typos |
| 1.3 | Normalizar unidades (18 → 5) | unit_map ya definido | 5 valores canónicos |
| 1.4 | Importar clientes facturación | wansoft_clientes_fe.json | 36 RFCs en pos_billing_clients |
| 1.5 | Deduplicación P1-C (55 exactos) | Diagnóstico ya hecho | 0 duplicados exactos |

### Fase 2: Completar Recetas (1 día)

| Paso | Qué | Fuente | Criterio |
|---|---|---|---|
| 2.1 | Extraer sub-recetas completas | DevTools bookmarklet en Wansoft | 100+ sub-recetas con componentes |
| 2.2 | Poblar pos_sub_recipe_ingredients | Import desde extracción | Cost engine calcula todas |
| 2.3 | Importar asignación modificadores | wansoft_asignacion_modificadores.json | Cada platillo tiene sus mods |
| 2.4 | Food cost > 90% (platillo count) | Validación cruzada | 90%+ platillos con costo |

### Fase 3: Sync Pre-Cutover (día del cutover)

| Paso | Qué | Criterio |
|---|---|---|
| 3.1 | Conteo físico de inventario | Stock real en pos_inventory |
| 3.2 | Verificar costos actuales | <5% diferencia vs Wansoft en top 50 |
| 3.3 | Verificar menú y precios | 0 diferencias de precio |
| 3.4 | Activar Facturama producción | 1 CFDI de prueba emitido |

### Fase 4: Validación Post-Cutover

| Paso | Qué | Criterio |
|---|---|---|
| 4.1 | Orden completa end-to-end | POS → cocina → cobro → ticket → QR |
| 4.2 | Deducción de inventario | Stock baja correctamente |
| 4.3 | Merma | Registro + stock baja |
| 4.4 | Entrada de mercancía | Registro + stock sube + costo actualiza |
| 4.5 | CFDI | Timbrado exitoso |
| 4.6 | Dashboard | Datos del día visibles |
| 4.7 | Chat IA | Responde con datos correctos |

---

## Framework para Cliente #2

### Inputs mínimos requeridos

| Input | Formato | Quién lo provee |
|---|---|---|
| Nombre del restaurante | Texto | Cliente |
| Menú con precios | CSV o captura en wizard | Cliente |
| Staff (nombres, roles) | Wizard UI | Cliente |
| Número de mesas | Número | Cliente |
| Impresoras (IPs) | Config JSON | Técnico Fullsite |
| Ingredientes + costos | CSV o POS anterior | Cliente + Fullsite |
| Recetas (opcional) | CSV o captura manual | Cliente |
| Proveedores (opcional) | CSV | Cliente |
| Stock inicial | Conteo físico | Cliente |

### Para clientes CON Wansoft

Mismo pipeline que AMALAY: DevTools bookmarklet → staging → normalize → import.
**Tiempo estimado de onboarding:** 2-4 horas (con datos) + 1 día de validación.

### Para clientes SIN POS anterior

Wizard de onboarding → CSV import → captura manual de recetas.
**Tiempo estimado de onboarding:** 4-8 horas + 1 día de validación.

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Endpoints de inventario Wansoft siguen en 500 | Alta | Sin sync automático de stock | Conteo físico manual |
| Sesión Wansoft expira (55 min) | Alta | Extracción larga se corta | Re-login + idempotencia |
| Duplicados causan food cost incorrecto | Confirmada | Error en pricing decisions | Deduplicación antes de cutover |
| Excel de cliente tiene formato inesperado | Media | Parser falla | Validación de schema en staging |
| Recetas incorrectas causan sobre-deducción | Baja (ya mitigada) | Stock incorrecto | Sub-recipe guard + underflow alerts |
| 30 tablas sin migrations | Alta para cliente #2 | No se puede recrear DB | pg_dump + migrations |

---

## Recomendación: Siguiente Paso

**Para AMALAY:** Ejecutar Fase 1 (normalización + reorder points + clientes facturación). Es 1 día de trabajo y cierra los huecos más visibles.

**Para Cliente #2:** Antes de vender, resolver el hueco #5 (migrations reproducibles). Sin esto, no se puede crear un proyecto nuevo de Supabase automáticamente.

**Mayor ROI inmediato:** Fase 1.1-1.3 (normalización) porque mejora la percepción de calidad del producto para cualquier demo o revisión operativa.
