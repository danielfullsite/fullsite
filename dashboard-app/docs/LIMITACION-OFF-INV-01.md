# LIMITACION-OFF-INV-01: Deducciones de inventario no se ejecutan offline

Status: **conocida, no bloquea operacion**
Prioridad: **P1** (mejora futura)
Detectada: 2026-06-26 durante certificacion OFF-02

## Comportamiento actual

Cuando una orden se envia offline, `deductIngredientsForOrder()` falla porque
necesita hacer fetch de `pos_recipes_old` desde Supabase para saber que
ingredientes descontar. Sin internet, el fetch lanza `TypeError: Failed to fetch`
y la funcion retorna `{ success: false }`.

La orden si se guarda en la sync queue y se sincroniza correctamente al
reconectar. Pero los movimientos de inventario (`pos_inventory_movements`)
y las actualizaciones de stock (`pos_inventory`) no se encolan.

## Impacto

- El stock en `pos_inventory` no se actualiza hasta que la orden se reenvie
  online o se haga un conteo fisico.
- No se registra movimiento de deduccion en `pos_inventory_movements`.
- En un escenario de offline prolongado (>1 hora), el stock puede divergir
  significativamente del real.

## Por que no bloquea AMALAY

- El restaurante rara vez pierde internet mas de 2-3 minutos.
- El conteo fisico semanal corrige divergencias.
- El POS ya muestra alertas de stock insuficiente: `(stock insuficiente)` en
  las notas del movimiento, lo que indica que el sistema es tolerante a
  discrepancias temporales.

## Solucion propuesta

Cachear `pos_recipes_old` e `pos_inventory` en IndexedDB para que
`deductIngredientsForOrder()` pueda operar completamente offline:

1. Al cargar el POS online, cachear recetas e inventario en IndexedDB.
2. Cuando `getRecipes()` o `getInventory()` fallen por offline, leer del cache.
3. Las operaciones de `updateInventoryStock()` y `logInventoryMovement()` ya se
   encolan correctamente (validado en OFF-02).
4. Al reconectar, el stock real se recalcula desde los movimientos.

Esto requiere cambios en `getRecipes()`, `getInventory()`, y posiblemente un
mecanismo de invalidacion de cache (TTL o version).
