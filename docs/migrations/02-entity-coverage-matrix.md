# 02 — Matriz de Cobertura de Entidades

> Fase 0 del Fullsite Migration Engine  
> Fecha: 2026-07-27  
> Fuentes: `docs/reference/wansoft/DATA-MODEL.md`, `scripts/sql/migrations/MANIFEST.json`, `agents/wansoft/*.json`, DDL en `scripts/sql/migrations/`

Leyenda: ✅ Sí / ❌ No / ⚠️ Parcial / ❓ DESCONOCIDO

---

## Matriz completa

| Entidad | En Wansoft | Se extrae hoy | Se transforma | En Fullsite | Tabla Fullsite | Tiene source_id | Tiene validaciones | Tiene histórico | Gaps conocidos |
|---|---|---|---|---|---|---|---|---|---|
| **sucursales** | ✅ HECHO (`Id_SucursalDestino` — 760 refs) | ❌ | ❌ | ⚠️ | `clients` (un registro = una sucursal/cliente) | ❌ | ❌ | ❌ | No hay tabla de sucursales separada. Multi-sucursal no modelado aún. |
| **terminales** | ✅ HECHO (`Id_Terminal` — 4942 refs, `Id_TerminalTemporal` — 202) | ❌ | ❌ | ⚠️ | `clients.features` (JSONB parcial) | ❌ | ❌ | ❌ | No hay tabla `pos_terminals`. Las terminales son inferidas por browser session. |
| **empleados** | ✅ HECHO (`Id_Usuario` — 1078 refs, múltiples roles) | ⚠️ | ⚠️ | ✅ | `pos_staff` | ❌ | ❌ | ⚠️ | `pos_staff` tiene nombre+PIN+rol pero no vincula con ID de Wansoft. Sin asistencia histórica activa. |
| **usuarios (auth)** | ✅ HECHO | ❌ | ❌ | ✅ | `client_users` (Supabase Auth) | ❌ | ❌ | ❌ | Usuarios Fullsite no relacionados con usuarios Wansoft. |
| **roles** | ✅ HECHO (`NetSilver.Seguridad.dll`) | ❌ | ❌ | ✅ | `pos_staff.role` (TEXT: admin/gerente/cajero/mesero) | ❌ | ❌ | ❌ | Roles de Wansoft (74 SPs de seguridad) no mapeados 1:1. Fullsite tiene roles simplificados. |
| **clientes** | ✅ HECHO (`Id_Cliente` — 1200 refs) | ⚠️ | ❌ | ✅ | `pos_customers` | ❌ | ❌ | ❌ | `wansoft_clientes_fe.json` capturado (clientes para factura). No hay migración automática activa. Sin historial de visitas importado. |
| **proveedores** | ✅ HECHO | ✅ | ✅ | ✅ | `pos_suppliers` | ❌ | ⚠️ | ❌ | Schema scrapeado tiene campos corridos (nombre↔RFC↔teléfono). Se corrige con heurísticas, no en origen. |
| **categorias** | ✅ HECHO (`Id_Grupo` — 2285 refs) | ✅ | ✅ | ✅ | `pos_menu_categories` | ❌ | ⚠️ | ❌ | Normalización existe en `categories.ts` (9 categorías canónicas). Categorías no mapeadas → "SIN CATEGORIA". |
| **productos (platillos)** | ✅ HECHO | ✅ | ✅ | ✅ | `pos_menu_items` | ❌ | ❌ | ❌ | `wansoft_platillos.json` capturado. No tiene pipeline activo de sync continuo al POS. |
| **modificadores** | ✅ HECHO | ✅ | ❌ | ✅ | `pos_modifiers`, `pos_modifier_groups` | ❌ | ❌ | ❌ | `wansoft_modificadores.json` y `wansoft_asignacion_modificadores.json` capturados. Sin pipeline activo de migración. |
| **grupos_modificadores** | ✅ HECHO | ✅ | ❌ | ✅ | `pos_modifier_groups` | ❌ | ❌ | ❌ | Ver modificadores. |
| **recetas** | ✅ HECHO (`spSelConsumoPorVenta` deduce inventario por receta) | ✅ | ✅ | ✅ | `pos_recipes_old` (legacy), `pos_recipe_lines` (nuevo) | ❌ | ⚠️ | ❌ | Pipeline dry-run rechazó 65% de records. `pos_recipes_old` tiene migración manual. Recetas nuevas van a `pos_recipe_lines`. |
| **componentes (ingredientes de receta)** | ✅ HECHO | ✅ | ✅ | ✅ | `pos_ingredients`, `pos_recipe_lines` | ❌ | ✅ | ❌ | Validators en `scripts/migration-pipeline/validators/index.ts` existen. Orphan references detectadas pero no resueltas. |
| **unidades** | ✅ HECHO | ✅ | ✅ | ✅ | `pos_unit_conversions` | ❌ | ✅ | ❌ | Mapa completo en `units.ts` (mass, volume, piece). Unidades desconocidas se marcan con warning. |
| **conversiones** | ✅ HECHO (rendimiento/yield en Wansoft) | ⚠️ | ⚠️ | ✅ | `pos_unit_conversions` | ❌ | ❌ | ❌ | `rendimiento` en `wansoft_products.json` es un porcentaje (100 = sin merma). No se importa como conversión formal. |
| **almacenes** | ✅ HECHO (`Id_SucursalDestino` para traspasos, 6 almacenes en AMALAY) | ✅ | ❌ | ⚠️ | `wansoft_data` (key: warehouses) | ❌ | ❌ | ❌ | Solo guardado como JSON en wansoft_data. No hay tabla `pos_warehouses`. |
| **inventario (stock actual)** | ✅ HECHO | ✅ | ✅ | ✅ | `pos_inventory_products` | ❌ | ❌ | ❌ | Stock importado como snapshot estático (2026-07-07). No hay sync continuo de existencias. |
| **movimientos de inventario** | ✅ HECHO (`spInsComandaProduccion`, `spSelConsumoPorVenta`) | ❌ | ❌ | ✅ | `pos_inventory_movements` | ❌ | ❌ | ❌ | Fullsite genera sus propios movimientos desde el POS. Histórico de movimientos de Wansoft no importado. |
| **compras** | ✅ HECHO (`wansoft_ordenes_compra.json`) | ✅ | ❌ | ⚠️ | `pos_purchase_orders`, `pos_purchase_order_items` | ❌ | ❌ | ❌ | OC capturadas en JSON. No hay pipeline activo que las importe a Fullsite. |
| **mesas** | ✅ HECHO (`Id_Comanda` — 545 refs, MapaDeMesas.dll) | ❌ | ❌ | ✅ | `pos_menu_categories` + layout en `clients.mesas` | ❌ | ❌ | ❌ | Layout de mesas no se migra de Wansoft — se reconfigura manualmente en Fullsite. |
| **areas** | ✅ HECHO (zonas en Wansoft) | ❌ | ❌ | ⚠️ | Parcial en `client_locations` | ❌ | ❌ | ❌ | DESCONOCIDO si Fullsite tiene tabla de áreas/zonas separada del mapa de mesas. |
| **estaciones** | ✅ HECHO (`Id_KdsEstacion` — 89 refs) | ❌ | ❌ | ✅ | `pos_menu_items.station` (TEXT) | ❌ | ❌ | ❌ | Wansoft tiene estaciones como configuración de routing. Fullsite las usa para imprimir comandas. No se migran automáticamente. |
| **menus** | ✅ HECHO | ✅ | ⚠️ | ✅ | `wansoft_menu_config`, `pos_menu_items` | ❌ | ❌ | ❌ | `wansoft_menu_sync.py` sincroniza menú activo. Sin versionado de menú histórico. |
| **precios** | ✅ HECHO (`TipoPrecio` — 303 refs: normal, evento, happy hour, delivery) | ⚠️ | ❌ | ⚠️ | `pos_menu_items.price` (un solo precio) | ❌ | ❌ | ❌ | Wansoft tiene múltiples tipos de precio. Fullsite tiene un solo precio por item. Gap confirmado. |
| **impuestos** | ✅ HECHO (IVA + IEPS separado — `TotalIeps` — 205 refs) | ❌ | ❌ | ⚠️ | `clients.iva_rate` (solo IVA) | ❌ | ❌ | ❌ | IEPS no modelado en Fullsite. Gap confirmado en `DATA-MODEL.md` como "Adoptar (A-2)". |
| **descuentos** | ✅ HECHO (`TotalDescontado` — 12705 refs, `CantidadDXU` — 115 refs) | ❌ | ❌ | ✅ | `pos_orders.discount` | ❌ | ❌ | ❌ | Descuento por unidad (DXU) no modelado. Solo descuento por orden. |
| **promociones** | ✅ HECHO (`Wansoft.Promociones.Motor`) | ❌ | ❌ | ⚠️ | `pos_promotions` (tabla existe) | ❌ | ❌ | ❌ | 13 SPs de promociones en Wansoft. Fullsite tiene tabla pero sin pipeline de migración. |
| **ordenes** | ✅ HECHO | ❌ | ❌ | ✅ | `pos_orders` | ❌ | ❌ | ❌ | Órdenes históricas de Wansoft no se migran. Fullsite empieza historial desde cero en cutover. |
| **items_orden** | ✅ HECHO | ❌ | ❌ | ✅ | `pos_orders.items` (JSONB) | ❌ | ❌ | ❌ | Ver órdenes. |
| **pagos** | ✅ HECHO (`Id_FormaPago` — 777 refs) | ❌ | ❌ | ✅ | `pos_orders.payment` (JSONB) | ❌ | ❌ | ❌ | Histórico de pagos de Wansoft no migrado. |
| **devoluciones** | ✅ HECHO | ❌ | ❌ | ✅ | Parcial en POS | ❌ | ❌ | ❌ | DESCONOCIDO el detalle de la tabla de devoluciones en Fullsite. |
| **cancelaciones** | ✅ HECHO | ❌ | ❌ | ✅ | `pos_staff_audit` (log de cancelaciones) | ❌ | ❌ | ❌ | No hay migración de cancelaciones históricas. |
| **cortes** | ✅ HECHO (`spInsCorteGlobal` — 8 variantes) | ❌ | ❌ | ✅ | `pos_cierres` | ❌ | ❌ | ❌ | Cortes históricos de Wansoft no migrados. Intentos de corte no modelados aún en Fullsite (gap D-3 en DATA-MODEL.md). |
| **retiros** | ✅ HECHO (`MontoRetirado` — 138 refs) | ❌ | ❌ | ✅ | `pos_cash_movements` | ❌ | ❌ | ❌ | |
| **depositos** | ✅ HECHO | ❌ | ❌ | ✅ | `pos_cash_movements` | ❌ | ❌ | ❌ | |

---

## Notas por entidad destacada

### proveedores
El JSON scrapeado tiene columnas corridas — el campo `"rfc"` contiene el nombre real, `"nombre"` contiene el RFC. Esto es un bug del scraper, no del portal. El script de migración lo compensa con heurísticas. RIESGO: si el portal cambia su HTML, el scraper correrá los campos de nuevo sin que haya una señal de error clara.

### recetas
El pipeline dry-run (`scripts/migration-pipeline/dry-run.ts`) rechazó 1456 de 2225 registros cuando se corrió con datos reales. El motivo más probable: los datos de recetas vienen de `wansoft_recetas.json` en formato `{code, dish, ingredients: [{product, unit, qty}]}` pero el validator espera `{menu_item_name, ingredient_id, quantity}` — el script de `dry-run.ts` hace la conversión correctamente. Los errores provienen probablemente de `ingredient_id` orphan references (ingredientes en recetas que no existen en el catálogo de productos). DESCONOCIDO si se resolvió.

### precios
Wansoft soporta `TipoPrecio` con al menos 4 tipos (normal, evento, happy hour, delivery). Fullsite tiene un solo `price` por `pos_menu_items`. Esto significa que si AMALAY tiene precios diferenciados en Wansoft, se perderán en la migración.

### impuestos (IEPS)
AMALAY vende alcohol. Wansoft separa IVA e IEPS (`TotalIeps` con 205 referencias en el modelo). Fullsite solo tiene `iva_rate` en `clients`. Gap documentado y clasificado como "Adoptar (A-2)" en `DATA-MODEL.md`.

### inventario / almacenes
AMALAY tiene 6 almacenes en Wansoft (confirmado en `project_wansoft_inventory_structure.md` de memoria). Solo se tiene snapshot estático del 2026-07-07. No hay sincronización continua de existencias a `pos_inventory_products`.
