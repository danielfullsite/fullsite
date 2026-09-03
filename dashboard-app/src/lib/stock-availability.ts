// ─── Disponibilidad por stock (AGOTADO) ─────────────────────────────────────
// Contrato: un platillo se marca AGOTADO cuando algún insumo de su receta está
// en cero — PERO sólo si el restaurante realmente lleva inventario.
//
// Por qué la condición: al dar de alta un cliente se siembran sus insumos con
// stock 0 (el Excel que entrega es COSTEO, no conteo físico). Sin la guarda,
// "0" se lee como "se acabó" y el POS tacha el MENÚ COMPLETO — el cliente nuevo
// no puede vender nada el día 1. Le pasó a ChickIn: 46/46 platillos AGOTADO.
//
// Stock 0 sin línea base = "no contado", no "agotado". La distinción se hace
// a nivel restaurante: si NINGÚN insumo tiene stock positivo, nadie ha hecho
// conteo y la señal no significa nada. En cuanto capturan su primer conteo,
// la bandera se enciende sola.

export interface StockRow { ingredient_id: string; stock: number | string | null }
export interface RecipeLine { menu_item_id: string; ingredient_id: string }

/** ¿El restaurante lleva inventario de verdad? (algún insumo con stock > 0) */
export function hasInventoryBaseline(rows: StockRow[]): boolean {
  return rows.some(r => Number(r.stock) > 0)
}

/**
 * IDs de platillos a marcar AGOTADO. Devuelve vacío si no hay línea base de
 * inventario — preferimos dejar vender que bloquear al cliente por un dato
 * que nadie capturó.
 */
export function computeOutOfStockItems(rows: StockRow[], recipes: RecipeLine[]): Set<string> {
  const oos = new Set<string>()
  if (!hasInventoryBaseline(rows)) return oos

  const zeroIds = new Set<string>()
  for (const r of rows) {
    if (Number(r.stock) <= 0) zeroIds.add(r.ingredient_id)
  }
  for (const line of recipes) {
    if (zeroIds.has(line.ingredient_id)) oos.add(line.menu_item_id)
  }
  return oos
}
