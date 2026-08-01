# Normalización de Inventario — Plan de Saneamiento

**Fecha:** 2026-07-20
**Status:** Diagnóstico completo. Pendiente aprobación antes de ejecutar.
**Scope:** Diseñado como pipeline reutilizable para cualquier cliente, no solo AMALAY.

---

## P0-A: Stock Negativo (28 items)

### Diagnóstico

| Causa raíz | Items | Ejemplo |
|---|---|---|
| Sub-recetas con inventario físico | 12 | `sub_jarabe_natural` (-240 ML) |
| Sobre-deducción sin restock | 16 | `miel_de_agave` (-870 ML) |

**Todas las sobre-deducciones** son del 16-17 julio, cuando se activó `deductIngredientsForOrder()` con stocks importados en 0. Las deducciones bajaron el stock a negativo porque `recordMovement()` no existía y la función legacy no tenía floor a 0.

### Regla de corrección

**Sub-recetas (12 items):**
- Poner stock = 0
- Registrar movimiento `adjustment` con nota "Corrección: sub-receta no tiene inventario físico"
- **Prevención:** agregar validación en `recordMovement()` que rechace deducciones de ingredientes con `product_type = 'subreceta'` o `id LIKE 'sub_%'`

**Sobre-deducción (16 items):**
- Poner stock = 0 (no sabemos el stock real — solo Alex en almacén lo sabe)
- Registrar movimiento `adjustment` con nota "Corrección: stock negativo por sobre-deducción sin restock. Requiere conteo físico."
- **Prevención:** ya implementado en `recordMovement()` → `Math.max(0, stock + quantity)`

### Rollback

Cada corrección genera un movimiento `adjustment` en el ledger con key `fix_negative_stock_YYYY-MM-DD`. Para revertir: crear movimiento inverso.

### Preview

| ID | Antes | Después | Nota |
|---|---|---|---|
| miel_de_agave | -870.00 | 0 | Requiere conteo físico |
| sub_jarabe_natural | -240.00 | 0 | Sub-receta, no tiene stock |
| pepino | -40.09 | 0 | Requiere conteo físico |

---

## P0-B: Costos Faltantes (311 items, 29.3%)

### Diagnóstico

| Grupo | Count | Ejemplo | Causa |
|---|---|---|---|
| Productos Market/marca | ~120 | ALMA VIVA, AMALAY CAFÉ, LMNT | Precio de reventa, no materia prima — el costo existe en Wansoft |
| Ingredientes base | ~100 | PAPA BLANCA, CHAYOTE, PEPINO | Nunca se importó el costo de Wansoft |
| Sub-recetas sin costo calculado | ~40 | SUB SALSA ROJA | Costo debería derivarse del cost engine |
| Ingredientes nuevos | ~50 | Items agregados después de la importación | Nunca se capturó costo |

### Estrategia de recuperación

1. **Intentar con cookie de Wansoft** — endpoint `GetSaucersWithCost` (requiere navegación completa, no funciona con cookie relay)
2. **Excel de Eduardo** — tiene los costos actualizados del catálogo Wansoft
3. **Cost engine** — para sub-recetas, calcular costo desde sus componentes
4. **Captura manual** — para items nuevos sin historial

### Regla

- Si Wansoft tiene el costo → importar
- Si es sub-receta → calcular desde cost engine
- Si no hay fuente → marcar como `cost_pending = true` para revisión manual
- **Nunca inventar un costo**

### Prevención

- En la página de Entradas, el `unit_cost` se pre-llena con el costo actual. Cada entrada actualiza el costo vía promedio ponderado → el catálogo se mantiene actualizado orgánicamente.
- Agregar validación: si un ingrediente tiene costo=0 y se usa en una receta, mostrar warning en food cost.

---

## P1-A: Categorías Inconsistentes (18 valores → 8 canónicos)

### Regla de normalización

| Valores actuales | Categoría canónica | Items afectados |
|---|---|---|
| `abarrote`, `ABARRROTE`, `ABARROTES` | `ABARROTE` | 127 |
| `proteina`, `PROTEINA`, `CARNES` | `PROTEINA` | 47 |
| `FRUTAS Y VERDURAS`, `vegetal` | `FRUTAS Y VERDURAS` | 185 |
| `subreceta`, `SUBRECETA` | `SUBRECETA` | 55 |
| `lacteo`, `LACTEOS`, `QUESOS` | `LACTEOS` | 19 |
| `bebida` | `BEBIDAS` | 6 |
| `PANADERIA` | `PANADERIA` | 3 |
| `market`, `otro` | `MARKET` | 11 |
| `(null)` — 547 items | Requiere clasificación manual o importación | 547 |

### Justificación

- ALL CAPS para consistencia visual
- Singular para categorías de tipo (`PROTEINA`, `ABARROTE`)
- Plural para categorías de grupo (`LACTEOS`, `BEBIDAS`, `FRUTAS Y VERDURAS`)
- Corregir typo `ABARRROTE` → `ABARROTE`

### Preview

| Antes | Después |
|---|---|
| `abarrote` | `ABARROTE` |
| `ABARRROTE` | `ABARROTE` |
| `proteina` | `PROTEINA` |
| `vegetal` | `FRUTAS Y VERDURAS` |
| `lacteo` | `LACTEOS` |

### Rollback

Guardar un snapshot de todas las categorías antes del cambio en `wansoft_data` con key `category_snapshot_pre_normalization`.

---

## P1-B: Unidades Fragmentadas (18 valores → 5 canónicos)

### Regla de normalización

| Valores actuales | Unidad canónica | Items afectados |
|---|---|---|
| `kg`, `KG`, `kilo`, `k` | `kg` | 547 |
| `g`, `GR`, `gramos`, `gr` | `g` | 22 |
| `lt`, `LT` | `lt` | 41 |
| `ML`, `ml` | `ml` | 35 |
| `pz`, `PZ`, `PZA`, `pza.` | `pz` | 347 |
| `BTA`, `paq`, `PQ`, `BL`, `porción` | Revisar manualmente (8 items) | 8 |

### Justificación

- Minúsculas para consistencia
- Abreviatura estándar: `kg`, `g`, `lt`, `ml`, `pz`
- 8 items con unidades raras requieren revisión: `BTA` (botella?), `paq` (paquete?), `BL` (bolsa?), `porción`

### Riesgos

- Si un ingrediente tiene recetas que asumen `KG` y lo cambiamos a `kg`, no hay impacto funcional (las comparaciones son case-sensitive en algunos queries)
- Verificar que ningún query haga `unit=eq.KG` hardcodeado

### Rollback

Snapshot de unidades antes del cambio.

---

## P1-C: Ingredientes Duplicados (79 grupos, 55 exactos)

### Regla de deduplicación

1. Identificar el ingrediente "ganador" — el que tiene más movimientos en el ledger, o el que tiene costo/stock/recetas
2. Migrar todas las recetas que referencian al "perdedor" hacia el "ganador"
3. Sumar stock del perdedor al ganador
4. Marcar perdedor como `active = false`
5. **Nunca DELETE** — solo desactivar (regla anti-fraude de Eduardo)

### Casos ambiguos (requieren revisión manual)

| Grupo | IDs | Diferencia |
|---|---|---|
| pechuga de pollo | `pechuga_de_pollo` (slug) + `3023` (numérico) | Diferentes costos y stock |
| aceite vegetal | `aceite_vegetal` + `1005` | Diferentes unidades (kg vs LT) |
| flor comestible | `flor_comestible` + `3042` | Stock 920 + 692 = ¿1,613 flores? |

Estos 24 grupos con unidades diferentes necesitan decisión humana: ¿son el mismo producto en diferentes presentaciones, o son productos distintos?

### Rollback

Snapshot completo de `pos_ingredients` + `pos_recipes_old` antes de deduplicar.

---

## P2: Otros problemas

### Sub-recetas con stock (34 items)

**Regla:** Poner stock = 0 para todos los `sub_*` con stock > 0. Registrar adjustment.
**Prevención:** Excluir `sub_*` de auto-deducción en `deductIngredientsForOrder()`.

### Filas huérfanas de inventario (39)

**Regla:** Marcar como inactivas o eliminar. No tienen ingrediente activo asociado.
**Prevención:** Foreign key constraint (si no existe) o validación en `recordMovement()`.

### Reorder points (718 sin configurar)

**Regla:** Importar de Wansoft si existen. Esto es configuración operativa, no normalización — cada restaurante configura sus propios puntos de reorden.
**Prevención:** Ninguna. Es configuración.

---

## Pipeline de Saneamiento — Diseño Reutilizable

```
┌─────────────────────────────────────────────────────┐
│         FULLSITE CATALOG SANITIZER                  │
│         (reutilizable por cliente)                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. SNAPSHOT   → Guardar estado actual completo     │
│  2. DIAGNOSE   → Generar reporte de calidad         │
│  3. PREVIEW    → Mostrar cambios propuestos         │
│  4. APPROVE    → Revisión humana de ambiguos        │
│  5. EXECUTE    → Aplicar cambios con ledger trail   │
│  6. VALIDATE   → Verificar post-ejecución           │
│  7. PREVENT    → Agregar constraints/validaciones   │
│                                                     │
│  Inputs:                                            │
│  - client_id                                        │
│  - source: 'wansoft' | 'excel' | 'manual'           │
│  - category_map: {old → new}                        │
│  - unit_map: {old → new}                            │
│  - duplicate_decisions: [{keep, merge}]             │
│                                                     │
│  Outputs:                                           │
│  - diagnostic_report.json                           │
│  - changes_preview.json                             │
│  - execution_log (in pos_inventory_movements)       │
│  - snapshot (in wansoft_data)                        │
└─────────────────────────────────────────────────────┘
```

### Configuración por cliente

```typescript
// Cada cliente define su mapa de normalización
const CATEGORY_MAP: Record<string, string> = {
  'abarrote': 'ABARROTE',
  'ABARRROTE': 'ABARROTE',
  'ABARROTES': 'ABARROTE',
  'proteina': 'PROTEINA',
  // ...
}

const UNIT_MAP: Record<string, string> = {
  'KG': 'kg',
  'kilo': 'kg',
  'k': 'kg',
  'GR': 'g',
  'gramos': 'g',
  'PZ': 'pz',
  'PZA': 'pz',
  'pza.': 'pz',
  'LT': 'lt',
  'ML': 'ml',
}
```

---

## Orden de ejecución

| Paso | Acción | Riesgo | Reversible |
|---|---|---|---|
| 1 | Snapshot completo | Ninguno | N/A |
| 2 | Fix stock negativo (28 items) | Bajo | Sí (ledger) |
| 3 | Fix sub-recetas con stock (34 items) | Bajo | Sí (ledger) |
| 4 | Normalizar unidades (547 items) | Medio — verificar queries | Sí (snapshot) |
| 5 | Normalizar categorías (516 items con valor) | Bajo | Sí (snapshot) |
| 6 | Importar costos de Wansoft/Excel (311 items) | Medio — matching | Sí (snapshot) |
| 7 | Deduplicar ingredientes (55 exactos) | Alto — afecta recetas | Sí (snapshot + inactive) |
| 8 | Clasificar 547 sin categoría | Manual | Sí |
| 9 | Limpiar huérfanos (39 filas) | Bajo | Sí |
| 10 | Importar reorder points | Bajo | Sí |

---

## Validaciones preventivas (post-ejecución)

| Regla | Dónde implementar |
|---|---|
| Stock nunca negativo | `recordMovement()` → `Math.max(0, ...)` ✅ ya implementado |
| Sub-recetas no reciben deducciones | `deductIngredientsForOrder()` → skip `sub_*` |
| Costo 0 warning en food cost | `/food-cost` page → banner si ingrediente tiene cost=0 |
| Unidad debe ser canónica | CHECK constraint en DB: `unit IN ('kg','g','lt','ml','pz','paq','bt','porcion')` |
| Categoría debe ser canónica | CHECK constraint o validación en UI de ingredientes |
| No duplicar ingredient_id | UNIQUE constraint ✅ ya existe |
| Toda fila de inventario debe tener ingrediente activo | FK constraint o cron de limpieza |
