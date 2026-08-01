# ADR: Modelo Fiscal Generico

> Status: PROPUESTA — pendiente evidencia de Wansoft (XML CFDI real)
> Fecha: 2026-06-30
> Contexto: AMALAY vende alcohol con IEPS. Fullsite no calcula IEPS en
> ningun punto del sistema. Esto es un bloqueante legal P0.
> Principio: no parchar para IEPS — disenar un modelo fiscal que soporte
> cualquier impuesto mexicano para los proximos anos.

---

## El problema

Hoy Fullsite tiene un solo impuesto hardcodeado:

```typescript
const IVA_RATE = 0.16
const iva = subtotalAfterDiscount * IVA_RATE
const total = subtotalAfterDiscount + iva
```

Esto no soporta:
- IEPS (bebidas alcoholicas, tabaco, alimentos de alto contenido calorico)
- Productos exentos de IVA (canasta basica)
- Productos tasa 0% (exportacion, algunos alimentos)
- Cuotas fijas IEPS (por litro, por unidad)
- Retencion de IVA/ISR (servicios profesionales)
- Multiples impuestos en un mismo producto

Mexico tiene un sistema fiscal complejo. Un restaurante puede tener en
un solo ticket: cerveza (IVA 16% + IEPS 26.5%), chilaquiles (IVA 16%),
agua embotellada (IVA 0%), y un producto importado (IVA 16% + IEPS 8%).

---

## Evidencia pendiente antes de implementar

| # | Evidencia | Como obtenerla | Status |
|---|-----------|---------------|--------|
| 1 | Precio de cerveza en Wansoft: incluye IEPS o no | Revisar catalogo en BD restaurada o preguntar a AMALAY | Pendiente |
| 2 | Factura CFDI real de cerveza emitida por Wansoft | Pedir XML a AMALAY o extraer de Facturama/eGlobal | Pendiente |
| 3 | Ticket impreso de cerveza vs factura | Comparar precio mostrado vs desglose fiscal | Pendiente |
| 4 | Configuracion de IEPS por producto en Wansoft | Restaurar .bak, consultar tabla Platillos campo IEPS | Pendiente |

**No implementar hasta tener al menos #2 (XML CFDI real).**

---

## Modelo propuesto

### Schema de impuestos por producto

```sql
-- Reglas fiscales reutilizables
pos_tax_rules (
  id TEXT PK,
  client_id TEXT,
  name TEXT,                    -- 'IVA 16%', 'IEPS Cerveza', 'Exento'
  tax_type TEXT,                -- 'iva' | 'ieps' | 'retencion_iva' | 'retencion_isr'
  factor TEXT,                  -- 'tasa' | 'cuota' | 'exento'
  rate NUMERIC,                 -- 0.16 para IVA, 0.265 para IEPS cerveza, 0 para exento
  clave_sat TEXT,               -- '002' (IVA), '003' (IEPS)
  is_retention BOOLEAN DEFAULT false,
  is_federal BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Asignacion de reglas fiscales a productos (N:M)
pos_item_taxes (
  id TEXT PK,
  menu_item_id TEXT FK → pos_menu_items,
  tax_rule_id TEXT FK → pos_tax_rules,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(menu_item_id, tax_rule_id)
)
```

### Datos iniciales para AMALAY

```sql
-- Reglas fiscales base
INSERT INTO pos_tax_rules (id, client_id, name, tax_type, factor, rate, clave_sat) VALUES
  ('iva-16', 'amalay', 'IVA 16%', 'iva', 'tasa', 0.16, '002'),
  ('iva-0', 'amalay', 'IVA 0%', 'iva', 'tasa', 0, '002'),
  ('iva-exento', 'amalay', 'Exento IVA', 'iva', 'exento', 0, '002'),
  ('ieps-cerveza', 'amalay', 'IEPS Cerveza 26.5%', 'ieps', 'tasa', 0.265, '003'),
  ('ieps-licor', 'amalay', 'IEPS Licores 53%', 'ieps', 'tasa', 0.53, '003'),
  ('ieps-vino', 'amalay', 'IEPS Vino 26.5%', 'ieps', 'tasa', 0.265, '003');

-- Asignacion por defecto: todo tiene IVA 16%
-- Los items de alcohol se asignan manualmente con su IEPS
-- Ejemplo: una cerveza tiene DOS reglas: iva-16 + ieps-cerveza
```

### Calculo de impuestos

```
Para cada item en la orden:
  1. Obtener tax_rules del item (via pos_item_taxes)
  2. Si no tiene reglas asignadas → default IVA 16%
  
  base = item.precio * item.cantidad
  
  Para cada tax_rule del item:
    if factor == 'tasa':
      tax_amount = base * rate
    elif factor == 'cuota':
      tax_amount = rate * item.cantidad  (cuota fija por unidad)
    elif factor == 'exento':
      tax_amount = 0
  
  item.taxes = [
    { rule_id: 'iva-16', type: 'iva', amount: base * 0.16 },
    { rule_id: 'ieps-cerveza', type: 'ieps', amount: base * 0.265 },
  ]

Para la orden:
  subtotal = SUM(item.precio * item.cantidad)
  iva_total = SUM(item.taxes WHERE type='iva')
  ieps_total = SUM(item.taxes WHERE type='ieps')
  total = subtotal + iva_total + ieps_total
```

**Nota critica sobre la base gravable:**

En Mexico, IVA e IEPS se calculan ambos sobre el precio de venta
(en paralelo), NO en cascada. Es decir:

```
Cerveza precio menu: $120
  IEPS = $120 * 0.265 = $31.80
  IVA  = $120 * 0.16  = $19.20
  Total = $120 + $31.80 + $19.20 = $171.00
```

**PERO** esto depende de como el restaurante configura sus precios.
Si el precio de menu YA incluye impuestos (como es comun en restaurantes),
entonces el calculo es inverso:

```
Cerveza precio menu (con impuestos): $120
  Precio base = $120 / (1 + 0.16 + 0.265) = $120 / 1.425 = $84.21
  IEPS = $84.21 * 0.265 = $22.32
  IVA  = $84.21 * 0.16  = $13.47
  Total = $84.21 + $22.32 + $13.47 = $120.00 ✓
```

**Esta es la pregunta que debemos responder con el XML de Wansoft.**

### Configuracion por restaurante

```sql
-- Agregar a pos_client_config o similar
pos_fiscal_config (
  client_id TEXT PK,
  prices_include_taxes BOOLEAN DEFAULT true,  -- precios de menu incluyen impuestos?
  default_tax_rule_id TEXT DEFAULT 'iva-16',  -- regla por defecto si no hay asignacion
  rfc_emisor TEXT,
  razon_social_emisor TEXT,
  regimen_fiscal_emisor TEXT,
  codigo_postal_expedicion TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

### Interface TypeScript

```typescript
interface TaxRule {
  id: string
  name: string
  taxType: 'iva' | 'ieps' | 'retencion_iva' | 'retencion_isr'
  factor: 'tasa' | 'cuota' | 'exento'
  rate: number
  claveSat: string
  isRetention: boolean
}

interface ItemTax {
  ruleId: string
  type: string
  base: number
  amount: number
  rate: number
}

interface OrderItem {
  // ... campos existentes ...
  taxes: ItemTax[]  // calculados al agregar el item
}

interface Order {
  // ... campos existentes ...
  subtotal: number
  iva: number       // SUM de taxes WHERE type='iva'
  ieps: number      // SUM de taxes WHERE type='ieps'
  total: number     // subtotal + iva + ieps
}
```

### CFDI con multiples impuestos

```typescript
function buildCfdiBody(order, items) {
  const conceptos = items.map(item => ({
    ClaveProdServ: item.claveSat || '90101501',
    Cantidad: item.cantidad,
    ClaveUnidad: 'ACT',
    Descripcion: item.nombre,
    ValorUnitario: item.precioBase,  // precio SIN impuestos
    Importe: item.precioBase * item.cantidad,
    Taxes: item.taxes.map(tax => ({
      Name: tax.type === 'iva' ? 'IVA' : 'IEPS',
      Rate: tax.rate,
      Base: tax.base,
      Total: tax.amount,
      IsRetention: false,
      IsFederalTax: true,
    })),
  }))
  
  return {
    // ... emisor, receptor, etc.
    Items: conceptos,
    // Totales globales
    Taxes: aggregateTaxes(conceptos),
  }
}
```

### Descuentos e impuestos

```
Cuando hay descuento:
  1. El descuento se aplica al subtotal (precio base * cantidad)
  2. Los impuestos se recalculan sobre el subtotal CON descuento
  
  Ejemplo: Cerveza $120, descuento 10%
    subtotal = $120
    descuento = $12
    base_gravable = $108
    IEPS = $108 * 0.265 = $28.62
    IVA  = $108 * 0.16  = $17.28
    total = $108 + $28.62 + $17.28 = $153.90
```

### Cortesias

```
Cortesia = descuento 100%. Impuestos = 0.
No hay impuesto sobre lo que no se cobra.
```

---

## UI afectada

### Ticket impreso

```
  Subtotal:        $1,200.00
  Descuento:         -$85.00
  ─────────────────────────
  IVA (16%):        $178.40
  IEPS:              $74.20
  ─────────────────────────
  TOTAL:          $1,367.60
```

### Corte de caja

```
  Ventas brutas:   $12,500.00
  Descuentos:        -$850.00
  ─────────────────────────
  Subtotal:       $11,650.00
  IVA (16%):       $1,864.00
  IEPS:              $742.00
  ─────────────────────────
  Total ventas:   $14,256.00
```

### POS (pantalla de orden)

```
  Sub $1,200.00  IVA $178.40  IEPS $74.20  $1,367.60
```

---

## Migracion sin romper lo existente

### Fase 1: Schema + datos (sin cambiar UI)

1. Crear tablas `pos_tax_rules` y `pos_item_taxes`
2. Insertar reglas base (IVA 16%, IEPS cerveza/licor/vino)
3. Asignar IVA 16% por defecto a TODOS los items existentes
4. Agregar campos `ieps` a `pos_orders` (default 0)
5. NO cambiar el calculo todavia — todo sigue como esta

### Fase 2: Asignar IEPS a productos (configuracion)

1. Identificar que productos de AMALAY tienen IEPS (cervezas, licores, vinos, cocktails)
2. Asignar reglas IEPS correspondientes via `pos_item_taxes`
3. Esto se puede hacer desde Supabase SQL, no necesita UI

### Fase 3: Actualizar calculo (cambio de codigo)

1. Cargar tax rules con el menu al iniciar
2. Calcular impuestos por item al agregar a la orden
3. Mostrar desglose en UI (subtotal + IVA + IEPS = total)
4. El precio al cliente NO cambia (si precios incluyen impuestos)

### Fase 4: Facturacion

1. Actualizar `buildCfdiBody` para incluir nodos IEPS
2. Items con IEPS van como conceptos separados
3. Verificar contra XML de Wansoft

### Fase 5: Reportes

1. Agregar columna IEPS al corte
2. Agregar al CierreCajaWizard
3. Agregar al ticket impreso

---

## Compatibilidad futura

Este modelo soporta:

| Escenario | Como se configura |
|---|---|
| Restaurante sin alcohol | Solo regla `iva-16` por defecto. IEPS = 0 siempre |
| Restaurante con cerveza | Regla `ieps-cerveza` (26.5%) en cervezas |
| Restaurante con bar completo | Reglas separadas por tipo: cerveza, vino, licor |
| Cafeteria (IVA 0% en alimentos) | Regla `iva-0` en alimentos, `iva-16` en bebidas |
| Tienda de conveniencia | IEPS en refrescos, cigarros, comida chatarra |
| Exportacion (tasa 0%) | Regla `iva-0` con factor `tasa` |
| Servicios profesionales | Regla `retencion_iva` + `retencion_isr` |
| Cuota fija (litros de alcohol) | Regla con factor `cuota`, rate = pesos por litro |

No hay limite de reglas por producto ni por cliente.

---

## Tiempo estimado

| Fase | Esfuerzo | Dependencia |
|---|---|---|
| 1. Schema + datos | 2h | Ninguna |
| 2. Asignar IEPS | 1h | Saber que productos tienen IEPS |
| 3. Calculo | 4h | Saber si precios incluyen impuestos |
| 4. Facturacion | 3h | XML de Wansoft como referencia |
| 5. Reportes | 2h | Ninguna |
| **Total** | **12h (~2 dias)** | **XML de Wansoft** |

---

## Decision pendiente

**No implementar hasta tener:**

1. XML CFDI real de una cerveza facturada por Wansoft
2. Confirmacion de si precios de menu incluyen impuestos
3. Lista de productos con IEPS y su tasa correspondiente

**Accion inmediata:** pedir a AMALAY una factura reciente que incluya
cerveza o bebida alcoholica. El XML nos dice exactamente como calcular.

---

> ADR generado 2026-06-30.
> Modelo diseñado para soportar cualquier configuracion fiscal mexicana.
> No es un parche para IEPS — es la base fiscal de Fullsite para los
> proximos anos y los proximos 100 restaurantes.
