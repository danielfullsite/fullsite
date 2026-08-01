# 04 — Propuesta de Modelo Canónico

> Fase 0 del Fullsite Migration Engine  
> Fecha: 2026-07-27  
> Scope: Interfaces TypeScript conceptuales. Sin migraciones SQL productivas.  
> Nota: Estas interfaces son para diseño. No deben copiarse a producción sin revisión.

---

## Campos de provenance (todos los modelos)

Todos los modelos incluyen estos campos comunes de trazabilidad:

```typescript
interface ProvenanceFields {
  /** Sistema de origen: 'wansoft' | 'fullsite_pos' | 'csv_import' | 'manual' */
  source_system: string
  
  /** ID en el sistema de origen (ej: 'ABA002' en Wansoft, null si es creación nativa) */
  source_id: string | null
  
  /** Hash SHA-256 del registro raw al momento de la migración.
   *  Permite detectar si el dato cambió en el origen sin comparar campo por campo. */
  source_hash: string | null
  
  /** Timestamp UTC de cuando se ejecutó la migración que creó/actualizó este registro */
  migrated_at: string | null  // ISO 8601
  
  /** UUID de la sesión de migración que creó este registro.
   *  Permite rollback por sesión: DELETE WHERE migration_session_id = 'xxx' */
  migration_session_id: string | null
}
```

---

## Interfaces por entidad

### Category

```typescript
interface Category extends ProvenanceFields {
  id: string                  // slug: 'chilaquiles-enchiladas'
  client_id: string           // 'amalay'
  name: string                // 'CHILAQUILES & ENCHILADAS'
  canonical_name: string      // 'CHILAQUILES_ENCHILADAS' — normalizado, sin caracteres especiales
  display_order: number       // para ordenar en el POS grid
  color: string | null        // hex color para el POS grid
  active: boolean
  created_at: string
  updated_at: string
  
  // Diferencias con Wansoft:
  // Wansoft llama a esto "Grupo" (Id_Grupo). Fullsite usa "categoría" para el menú.
  // Wansoft también tiene "departamento" para ingredientes — son entidades distintas.
}

// Validación mínima (zod hint):
// z.object({ name: z.string().min(1), client_id: z.string().min(1) })
```

---

### Product (platillo del menú)

```typescript
interface Product extends ProvenanceFields {
  id: string                  // ej: 'chilaquiles-rojos'
  client_id: string
  sku: string | null          // código en Wansoft: 'CHI001'
  name: string                // 'Chilaquiles Rojos'
  category_id: string         // FK → Category
  price: number               // precio en MXN (NUMERIC en BD, nunca float)
  
  /** Precios por tipo. Wansoft soporta 4 tipos: normal, evento, happy_hour, delivery.
   *  Fullsite actualmente solo tiene 1. Campo para futura expansión. */
  prices: Record<'normal' | 'evento' | 'happy_hour' | 'delivery', number> | null
  
  station: 'cocina' | 'barra' | 'caja' | 'market' | null  // routing de comanda
  active: boolean
  has_recipe: boolean         // si tiene receta capturada
  prep_time_seconds: number | null
  created_at: string
  updated_at: string
  
  // Campos que Wansoft tiene pero Fullsite no (pendientes):
  // tipo_orden_permitido: ('mesa' | 'llevar' | 'delivery' | 'evento')[]
  // ieps_rate: number | null  // para productos con IEPS (bebidas alcohólicas)
}

// Validación mínima:
// z.object({ name: z.string().min(1), price: z.number().nonnegative(), category_id: z.string() })
```

---

### Unit

```typescript
interface Unit {
  code: string                // 'kg', 'lt', 'pz', 'g', 'ml'
  label: string               // 'Kilogramo', 'Litro', 'Pieza'
  dimension: 'mass' | 'volume' | 'piece' | 'other'
  
  /** Factor de conversión a la unidad base de la dimensión.
   *  mass base = kg: g → 0.001, kg → 1
   *  volume base = lt: ml → 0.001, lt → 1
   *  piece base = pz: pz → 1 */
  base_factor: number
  
  // Notas: El mapa actual en units.ts cubre los casos de Wansoft.
  // Falta: onzas (oz), cucharadas (tbsp), tazas (cup) — si algún proveedor los usa.
}
```

---

### Recipe

```typescript
interface Recipe extends ProvenanceFields {
  id: string                  // slug del platillo + versión: 'chilaquiles-rojos-v1'
  client_id: string
  product_id: string          // FK → Product
  version: number             // versión de la receta (empieza en 1)
  active: boolean             // solo una versión puede estar activa a la vez
  notes: string | null
  created_at: string
  deprecated_at: string | null
  
  // Campos que Wansoft tiene pero Fullsite no:
  // batch_size: number | null  // para ordenes de producción (batch cooking)
  // serving_size: number | null
}
```

---

### RecipeComponent (ingrediente de una receta)

```typescript
interface RecipeComponent extends ProvenanceFields {
  id: string
  recipe_id: string           // FK → Recipe
  ingredient_id: string       // FK → Ingredient (slug del nombre: 'queso-panela')
  quantity: number            // cantidad en la unidad especificada
  unit: string                // unidad en que se mide (ej: 'kg', 'pz')
  
  /** Factor de rendimiento/merma. 0.8 = 20% de merma.
   *  Fullsite usa esto para calcular el costo real.
   *  Wansoft lo llama "rendimiento" como porcentaje (80 = 0.80). */
  yield_factor: number        // default 1.0 (sin merma)
  
  is_optional: boolean        // para modificadores opcionales
  notes: string | null
  
  // Validación mínima:
  // quantity > 0, yield_factor entre 0.01 y 1.0, unit debe ser válido
}
```

---

### Supplier (proveedor)

```typescript
interface Supplier extends ProvenanceFields {
  id: string
  client_id: string
  name: string                // nombre comercial
  rfc: string | null          // RFC mexicano — validar con regex /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/
  phone: string | null
  email: string | null
  category: string | null     // 'PESCADOS Y MARISCOS', 'LACTEOS', etc.
  credit_days: number         // días de crédito (default 0)
  active: boolean
  created_at: string
  updated_at: string
  
  // Nota sobre Wansoft:
  // El scraper actual tiene los campos corridos (ver R-02 en risk register).
  // source_id debería ser el campo "clave" del JSON Wansoft (ej: 'CAM240411880').
}

// Validación mínima:
// name.length > 0; if rfc: must match RFC regex
```

---

### InventoryLocation (almacén)

```typescript
interface InventoryLocation extends ProvenanceFields {
  id: string
  client_id: string
  name: string                // 'ALMACEN PRINCIPAL', 'BARRA', 'PANADERIA'
  location_type: 'almacen' | 'estacion' | 'barra' | 'cocina' | 'market'
  active: boolean
  
  // Nota: Wansoft tiene 6 almacenes para AMALAY.
  // Fullsite actualmente no tiene tabla de almacenes.
  // source_id = ID de sucursal en Wansoft (de GetWarehousesBySubsidiary).
}
```

---

### StockBalance (existencia actual)

```typescript
interface StockBalance extends ProvenanceFields {
  id: string
  client_id: string
  ingredient_id: string       // FK → Ingredient
  location_id: string         // FK → InventoryLocation
  
  quantity: number            // stock actual en la unidad del ingrediente
  unit: string
  
  /** Costo unitario promedio ponderado en MXN.
   *  Calculado como saldo_mxn / existencia en Wansoft.
   *  ADVERTENCIA: cálculo con float puede tener error. Usar NUMERIC en BD. */
  unit_cost: number
  
  reorder_point: number       // punto de reorden (de GetReOrderListByWareHouse)
  reorder_max: number | null  // máximo deseado
  
  snapshot_date: string       // fecha del snapshot (YYYY-MM-DD)
  is_live: boolean            // true = sync continuo, false = snapshot histórico
  
  created_at: string
  updated_at: string
}
```

---

### Order

```typescript
interface Order extends ProvenanceFields {
  id: string
  client_id: string
  table_number: string | null
  order_type: 'mesa' | 'llevar' | 'delivery' | 'evento'
  status: 'open' | 'sent' | 'paid' | 'cancelled'
  
  waiter_id: string           // FK → Employee
  cashier_id: string | null   // FK → Employee (al cobrar)
  
  opened_at: string
  closed_at: string | null
  
  subtotal: number
  discount: number            // descuento total
  tax: number                 // IVA
  ieps: number                // IEPS (bebidas alcohólicas) — actualmente no modelado
  tips: number
  total: number
  
  // En Wansoft: NombreDeCliente en CADA orden (no solo en clientes)
  customer_name: string | null
  customer_id: string | null  // FK → Customer (si fue capturado)
  
  notes: string | null
  
  // Nota: Wansoft tiene TipoOrden con más variantes (consumo interno, evento, programado).
  // Fullsite simplifica a 4 tipos.
}
```

---

### OrderItem

```typescript
interface OrderItem extends ProvenanceFields {
  id: string
  order_id: string            // FK → Order
  product_id: string          // FK → Product
  
  product_name: string        // desnormalizado para historial
  quantity: number
  unit_price: number          // precio al momento de la venta (puede diferir del precio actual)
  
  /** Tipo de precio aplicado. Wansoft soporta: normal, evento, happy_hour, delivery.
   *  Fullsite actualmente no usa esto pero se documenta para futura implementación. */
  price_type: 'normal' | 'evento' | 'happy_hour' | 'delivery'
  
  discount_per_unit: number   // descuento por unidad (CantidadDXU de Wansoft)
  discount_total: number
  
  modifiers: {
    modifier_id: string
    name: string
    price: number
  }[]
  
  status: 'active' | 'cancelled' | 'returned'
  cancelled_at: string | null
  cancel_reason: string | null
  
  station: string | null      // estación a la que se envió la comanda
  sent_at: string | null
}
```

---

### Payment

```typescript
interface Payment extends ProvenanceFields {
  id: string
  order_id: string            // FK → Order
  
  method: 'efectivo' | 'credito' | 'debito' | 'transferencia' | 'ubereats' | 'rappi' | 'otro'
  amount: number
  
  tip: number                 // propina de este pago específico
  
  reference: string | null    // referencia de terminal bancaria, número de transferencia
  
  // En Wansoft: MontoRestante para pagos parciales/CxC
  is_partial: boolean
  
  processed_at: string
  
  // Nota: Wansoft separa la forma de pago (FormaPago) del tipo de terminal (OEL, NetPay, Clip).
  // Fullsite actualmente solo registra el método, no la terminal física.
}
```

---

### Employee (staff)

```typescript
interface Employee extends ProvenanceFields {
  id: string
  client_id: string
  name: string
  pin: string                 // hash del PIN (nunca en claro en logs)
  role: 'admin' | 'gerente' | 'cajero' | 'mesero' | 'cocina' | 'market'
  role_display: string        // nombre mostrable del rol
  
  hourly_rate: number         // para análisis de costo por hora
  weekly_salary: number
  
  active: boolean
  fingerprint_enrolled: boolean
  
  created_at: string
  updated_at: string
  
  // Campos que Wansoft tiene pero Fullsite no tiene formalizados:
  // liquidation_balance: number  // TotalAPagarMesero — lo que debe/se le debe al mesero
  // tip_pool_share: number       // porcentaje del fondo de propinas
}
```

---

### Table (mesa)

```typescript
interface Table extends ProvenanceFields {
  id: string
  client_id: string
  number: string              // número o nombre visible
  area: string | null         // 'terraza', 'interior', 'barra'
  capacity: number            // personas máximas
  active: boolean
  
  // Layout visual (para el mapa de mesas)
  x: number | null
  y: number | null
  width: number | null
  height: number | null
}
```

---

### Station (estación de impresión / KDS)

```typescript
interface Station extends ProvenanceFields {
  id: string
  client_id: string
  name: string                // 'cocina', 'barra', 'caja', 'market'
  printer_id: string | null   // FK a configuración de impresora (CFG-01)
  is_kds: boolean             // tiene pantalla KDS
  active: boolean
  
  /** Categorías de menú que se enrutan a esta estación.
   *  Wansoft lo llama Id_KdsEstacion y lo configura por platillo. */
  category_ids: string[]
}
```

---

## Modelo de provenance

### Qué existe hoy en el repo

- **HECHO:** Las tablas `wansoft_daily` y `wansoft_kpis` tienen `client_slug` y `location_id` — provenance de cliente pero no de registro individual.
- **HECHO:** El pipeline TypeScript agrega `source_system: 'wansoft'` y `source_id: String(raw.codigo || raw.id || '')` al normalizar ingredientes (`dry-run.ts:97-98`).
- **HECHO:** La tabla `wansoft_catalog` tiene `explorer_version` para versionado del origen.
- **INFERENCIA:** Ninguna tabla de destino de migración (`pos_suppliers`, `pos_recipes_old`, `pos_inventory_products`) tiene columnas `source_id`, `source_hash`, ni `migration_session_id`.

### Qué falta

1. Columnas de provenance en tablas productivas: `source_system`, `source_id`, `source_hash`, `migrated_at`, `migration_session_id`.
2. Tabla `migration_sessions`: log de cada sesión de migración con timestamp, resultado, stats.
3. Guardado del registro raw antes de transformar (para poder re-derivar o hacer rollback).
4. `source_hash` calculado en el scraper para detectar cambios sin re-comparar todos los campos.

### Estimación de dificultad

| Item | Esfuerzo | Notas |
|---|---|---|
| Agregar columnas de provenance a 3 tablas existentes | 1h | Migration SQL simple, sin romper nada |
| Tabla migration_sessions | 2h | DDL + insertar al inicio de cada script |
| source_hash en scraper | 3h | Agregar `hashlib.sha256(json.dumps(row)).hexdigest()` |
| Guardar raw previo al UPSERT | 4h | SELECT + comparar + INSERT raw en tabla de archivo |
| migration_session_id end-to-end | 4h | Pasar UUID como contexto a todos los escritores |
