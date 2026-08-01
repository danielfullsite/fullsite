# Arquitectura Canónica de Inventario

**Fecha:** 2026-07-20
**Status:** Propuesta — pendiente aprobación Daniel

---

## Principio rector

Un solo stock, un solo ledger, todo lo demás es derivado.

---

## 1. ¿Cuál es la única fuente de verdad del stock?

**`pos_inventory`** — una fila por ingrediente, una columna `stock`.

```
pos_inventory
├── id              BIGSERIAL PK
├── client_id       TEXT
├── ingredient_id   TEXT FK → pos_ingredients(id)   ← identidad del producto
├── stock           NUMERIC                          ← EL NÚMERO
├── stock_unit      TEXT                             ← kg, g, lt, ml, pz
├── reorder_point   NUMERIC
├── reorder_quantity NUMERIC
├── last_restock    TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ
    UNIQUE(client_id, ingredient_id)
```

El catálogo vive en **`pos_ingredients`** — nombre, unidad, costo, categoría, yield, etc. Es la identidad del producto. `pos_inventory` es su estado actual.

**¿Por qué esta y no otra?**
- Ya tiene escrituras reales desde el POS (merma, inventario-físico, facturas-proveedor)
- Ya la leen el Copilot, alerts, cierre-inventario, 5+ agents
- Tiene realtime habilitado (`supabase_realtime`)
- 1050 ingredientes activos
- Las funciones `updateInventoryStock()` y `deductIngredientsForOrder()` ya existen en `pos-data.ts`

---

## 2. ¿Cuál es el ledger de movimientos?

**`pos_inventory_movements`** — append-only, inmutable.

```
pos_inventory_movements
├── id              BIGSERIAL PK
├── client_id       TEXT
├── ingredient_id   TEXT                              ← qué se movió
├── movement_type   TEXT                              ← tipo de operación
├── quantity         NUMERIC                          ← positivo = entrada, negativo = salida
├── order_id        UUID                              ← si fue por una orden del POS
├── actor           TEXT                              ← quién lo hizo
├── notes           TEXT                              ← contexto libre
├── created_at      TIMESTAMPTZ
└── [product_id     BIGINT — deprecar, ver §5]
```

**RLS:** SELECT + INSERT solamente. No UPDATE, no DELETE. Esto es por diseño (regla anti-fraude de Eduardo). El historial es inmutable.

**Tipos de movimiento existentes:**
| movement_type | Origen | quantity |
|---|---|---|
| `restock` | Entrada de mercancía / factura proveedor | +N |
| `waste` | Merma (caducado, dañado, robo, preparación) | -N |
| `adjustment` | Toma física (diferencia vs sistema) | ±N |
| `deduction` | Venta POS (receta auto-deduce) | -N |

**Tipos a agregar para las páginas del dashboard:**
| movement_type | Origen | quantity |
|---|---|---|
| `entry` | Entrada manual desde dashboard (sin factura) | +N |
| `invoice_entry` | Entrada por CFDI desde dashboard | +N |
| `transfer_out` | Transferencia entre almacenes (salida) | -N |
| `transfer_in` | Transferencia entre almacenes (entrada) | +N |
| `return` | Devolución a proveedor | -N |

---

## 3. ¿Qué tablas son derivadas o de lectura?

| Tabla | Rol | Acción |
|---|---|---|
| `pos_inventory_products` | **DEPRECAR** — duplicado congelado de Wansoft (745 rows). Nadie escribe. | Migrar `/inventario` y `/compras` a leer de `pos_inventory` + `pos_ingredients`. Después DROP. |
| `pos_inventory_snapshots` | Derivada — foto del stock al momento del cierre | Solo lectura. Se genera desde `pos_inventory` en cierre-inventario. Mantener. |
| `wansoft_data` (inventory blobs) | Historial de eventos + snapshots Wansoft | Ver §4. Mantener como historial, nunca como estado operativo. |

---

## 4. ¿Qué es de Wansoft y qué es de Fullsite?

### Wansoft → Fullsite (importación, solo lectura)

| data_key | Contenido | Uso correcto |
|---|---|---|
| `inventory_parsed` | Snapshot del stock en Wansoft | Comparación/validación. "¿Cuánto dice Wansoft que hay?" No es fuente de verdad. |
| `products_catalog` | Catálogo de productos Wansoft | Referencia para mapear productos al registrar entradas. No reemplaza `pos_ingredients`. |
| `proveedores_catalog` | Catálogo de proveedores Wansoft | Referencia para seleccionar proveedor. Complementa `pos_suppliers`. |

### Fullsite propio (operacional)

| Tabla | Es de Fullsite | Notas |
|---|---|---|
| `pos_ingredients` | ✓ | Catálogo canónico. Importado de Wansoft inicialmente pero ahora es propio. |
| `pos_inventory` | ✓ | Stock canónico. Fullsite lo mantiene. |
| `pos_inventory_movements` | ✓ | Ledger canónico. Inmutable. |

### Eventos del dashboard (historial, no estado)

Las páginas del dashboard (`entradas`, `merma`, `toma-fisica`, etc.) seguirán guardando el evento completo en `wansoft_data` como respaldo/historial. Pero **además** deben actualizar `pos_inventory` y registrar en `pos_inventory_movements`.

```
Dashboard: "Registrar entrada"
     │
     ├──→ pos_inventory.stock += cantidad          ← ESTADO (fuente de verdad)
     ├──→ pos_inventory_movements.INSERT(entry)    ← LEDGER (inmutable)
     └──→ wansoft_data.INSERT(blob)                ← HISTORIAL (backup, trazabilidad)
```

La regla es: **el stock SIEMPRE se puede reconstruir** sumando todos los movimientos del ledger desde cero. `pos_inventory.stock` es un cache materializado del ledger.

---

## 5. Modelo destino (diagrama)

```
┌─────────────────────────────────┐
│       pos_ingredients           │  ← CATÁLOGO (identidad)
│  id, name, unit, cost, category │
│  yield_factor, product_type     │
│  1050 productos                 │
└──────────┬──────────────────────┘
           │ ingredient_id (TEXT FK)
           │
┌──────────▼──────────────────────┐
│        pos_inventory            │  ← ESTADO (stock actual)
│  ingredient_id, stock           │
│  stock_unit, reorder_point      │
│  UNIQUE(client_id, ingredient_id)│
└──────────┬──────────────────────┘
           │ ingredient_id
           │
┌──────────▼──────────────────────┐
│   pos_inventory_movements       │  ← LEDGER (inmutable)
│  ingredient_id, movement_type   │
│  quantity, actor, notes         │
│  NO UPDATE, NO DELETE           │
└─────────────────────────────────┘

Derivadas / Deprecadas:
┌─────────────────────────────────┐
│   pos_inventory_products        │  ← DEPRECAR (duplicado congelado)
│   745 rows, nadie escribe       │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│   wansoft_data (inventory_*)    │  ← HISTORIAL (no operativo)
│   JSON blobs de eventos         │
│   Snapshots de Wansoft          │
└─────────────────────────────────┘
```

---

## 6. Qué cambia en cada página

### Dashboard — inventario-real (4 páginas que HOY son decorativas)

| Página | Hoy escribe a | Debe escribir a | movement_type |
|---|---|---|---|
| `/inventario-real/entradas` | `wansoft_data` solamente | `pos_inventory` (stock += qty) + `pos_inventory_movements` + `wansoft_data` | `entry` |
| `/inventario-real/entradas-factura` | `wansoft_data` solamente | `pos_inventory` (stock += qty) + `pos_inventory_movements` + `wansoft_data` | `invoice_entry` |
| `/inventario-real/merma` | `wansoft_data` solamente | `pos_inventory` (stock -= qty) + `pos_inventory_movements` + `wansoft_data` | `waste` |
| `/inventario-real/toma-fisica` | `wansoft_data` solamente | `pos_inventory` (stock = conteo) + `pos_inventory_movements` + `wansoft_data` | `adjustment` |

### Dashboard — lectura (2 páginas que leen de tabla equivocada)

| Página | Hoy lee de | Debe leer de |
|---|---|---|
| `/inventario` | `pos_inventory_products` | `pos_inventory` + `pos_ingredients` |
| `/compras` | `pos_inventory_products` | `pos_inventory` + `pos_ingredients` |

### POS — sin cambios (ya funciona correcto)

| Página | Ya escribe a | Status |
|---|---|---|
| `/pos/merma` | `pos_inventory` + `pos_inventory_movements` | ✓ Correcto |
| `/pos/inventario-fisico` | `pos_inventory` + `pos_inventory_movements` | ✓ Correcto |
| `/pos/facturas-proveedor` | `pos_inventory` + `pos_inventory_movements` | ✓ Correcto |

---

## 7. Problema de mapeo: ingredient_id

Las páginas del dashboard usan catálogos de Wansoft (`products_catalog` en `wansoft_data`) que tienen `Value` y `Text` como identificadores. El POS usa `pos_ingredients.id` (slug TEXT como `pechuga_de_pollo`).

**Para que las páginas del dashboard escriban a `pos_inventory`, necesitan mapear** el producto Wansoft al `ingredient_id` de `pos_ingredients`.

Opciones:
- **A)** Agregar columna `wansoft_code` a `pos_ingredients` para mapear por código Wansoft
- **B)** Mapear por nombre normalizado (fuzzy match)
- **C)** Las páginas del dashboard dejan de usar `products_catalog` de Wansoft y pasan a usar `pos_ingredients` directamente como catálogo

**Recomendación: Opción C.** Las páginas del dashboard deben usar `pos_ingredients` como catálogo de productos, igual que el POS. Esto elimina el problema de mapeo y unifica la experiencia. El catálogo Wansoft (`products_catalog`) solo se usa para importación inicial.

---

## 8. Orden de implementación

1. **Migrar lecturas** — `/inventario` y `/compras` leen de `pos_inventory` + `pos_ingredients` en vez de `pos_inventory_products`
2. **Migrar catálogo en dashboard** — las 4 páginas de operaciones usan `pos_ingredients` como catálogo de productos (no `products_catalog` de Wansoft)
3. **Conectar escrituras** — las 4 páginas escriben a `pos_inventory` + `pos_inventory_movements` (además de `wansoft_data` para historial)
4. **Verificar** — que stock cambie de verdad, que el ledger registre todo, que el POS siga funcionando
5. **Deprecar** — `pos_inventory_products` se marca como deprecated, se quita de `/inventario` y `/compras`

---

## 9. Lo que NO cambia

- `pos_ingredients` — sin cambios de schema
- `pos_inventory` — sin cambios de schema
- `pos_inventory_movements` — solo se agregan nuevos `movement_type` values
- POS pages — sin cambios, ya funcionan correcto
- `wansoft_data` — sigue recibiendo blobs como historial
- Agents que leen `pos_inventory` — sin cambios
- `cierre-inventario` — sin cambios (ya lee `pos_inventory`)

---

## 10. Invariantes del sistema

1. **`pos_inventory.stock` siempre refleja la realidad** — toda operación que afecte stock DEBE actualizar esta tabla
2. **`pos_inventory_movements` es inmutable** — no UPDATE, no DELETE, solo INSERT
3. **El stock se puede reconstruir** — `SUM(quantity) GROUP BY ingredient_id` desde `pos_inventory_movements` debe igualar `pos_inventory.stock`
4. **Un solo catálogo** — `pos_ingredients` es la identidad de todo producto. Las páginas del dashboard usan el mismo catálogo que el POS.
5. **`wansoft_data` nunca es fuente de verdad operativa** — es historial, snapshots, respaldo. Si contradice `pos_inventory`, gana `pos_inventory`.
