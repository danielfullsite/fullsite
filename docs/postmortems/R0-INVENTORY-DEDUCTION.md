# Post-Mortem: R0 Inventory Deduction Suspension

**Incidente:** Jul 16-17, 2026
**Resolución:** Jul 20, 2026
**Duración de la suspensión:** 4 días

---

## Síntoma observado

Al activar `deductIngredientsForOrder()` el 16 de julio, múltiples ingredientes cayeron a stock negativo (hasta -870 unidades). Se reportó como "sobre-deducción 2-4x por orden."

La deducción fue suspendida inmediatamente (R0 containment) y la reversión también (R0.5).

## Hipótesis inicial (incorrecta)

Se asumió que `pos_recipes_old` contenía "duplicate import generations" — múltiples filas para el mismo par (platillo, ingrediente) por importaciones repetidas. Esto habría causado que `deductIngredientsForOrder()` dedujera N veces por cada duplicado.

## Evidencia que descartó la hipótesis

Análisis del 20 de julio confirmó: **0 duplicados**. Las 4,067 filas de `pos_recipes_old` son 4,067 pares únicos de (menu_item_id, ingredient_id). No hay ni una sola fila repetida.

## Causa raíz confirmada

Dos problemas combinados:

### 1. Sub-recetas clasificadas como ingredientes físicos

436 filas de recetas tenían `ingredient_type = 'ingredient'` cuando su `ingredient_id` empezaba con `sub_` (sub-recetas como SUB SALSA ROJA, SUB POLLO COCIDO, etc.). La función `deductIngredientsForOrder()` las trataba como stock físico y deducía directamente.

Como las sub-recetas también tienen componentes (ingredientes base), se producía deducción doble: una por la sub-receta como "ingrediente" y otra por los ingredientes base de la misma sub-receta.

### 2. Stock inicial en 0

La mayoría de los ingredientes tenían stock=0 al momento de activar la deducción (importación incompleta de Wansoft). Cualquier deducción los llevaba a negativo porque no había floor a 0.

## Corrección aplicada

1. **436 filas** en `pos_recipes_old` reclasificadas: `ingredient_type = 'sub_recipe'`
2. **92 ingredientes** en `pos_ingredients` reclasificados: `product_type = 'subproducto'`
3. **Sub-recipe guard** en `deductIngredientsForOrder()`: skip ingredientes con `id.startsWith('sub_')` o `category = 'subreceta'`
4. **Sub-recipe guard** en `recordMovement()`: bloquea deducciones de `product_type = 'subproducto'`
5. **Floor a 0**: `Math.max(0, stock + quantity)` en `recordMovement()`
6. **UNDERFLOW_PREVENTED** alerts en el ledger cuando se aplica el floor
7. **29 stocks negativos** corregidos a 0 con movimientos de ajuste documentados

## Cómo evitaremos que vuelva a ocurrir

| Prevención | Implementada |
|---|---|
| `recordMovement()` nunca permite stock negativo | ✓ `Math.max(0, ...)` |
| Sub-recetas no reciben deducciones | ✓ Guard por `product_type` + prefijo |
| UNDERFLOW_PREVENTED se registra en ledger | ✓ Evento automático |
| `ingredient_type` correcto en recetas | ✓ 436 filas corregidas |
| `product_type` correcto en ingredientes | ✓ 92 filas corregidas |

## Lecciones

1. **No asumir la causa raíz sin evidencia.** "Duplicate import generations" se repitió en comentarios de código y documentos sin que nadie verificara si realmente existían duplicados.
2. **Clasificación de datos > lógica de código.** El bug no estaba en la función — estaba en los datos. La función hacía exactamente lo correcto con datos incorrectos.
3. **Floor a 0 debió existir desde el inicio.** Un sistema de inventario nunca debería permitir stock negativo, independientemente del bug.
