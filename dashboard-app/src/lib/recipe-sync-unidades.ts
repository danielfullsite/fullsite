/**
 * Agregar las filas de una receta por ingrediente SIN mezclar unidades.
 *
 * Barrido 2026-09-10 (inventario LENTE-6): recipe-sync sumaba `quantity` de
 * filas del mismo insumo ignorando la unidad de cada una. Dos filas —100 g y
 * 1 kg— se proyectaban a R1 como 101 g, y convert_recipe_to_stock descontaba
 * 0.101 kg por venta en vez de 1.1 kg, sin error visible.
 *
 * Aquí cada fila se convierte a la unidad de la PRIMERA fila del ingrediente,
 * con la tabla del tenant (pos_unit_conversions) y, si no alcanza, las
 * conversiones métricas de cajón. Si no hay forma de convertir, se rechaza:
 * una receta falsa es peor que una receta sin sincronizar.
 */

export interface FilaDeReceta { ingredient_id: string; quantity: number; unit: string | null }
export interface Conversion { from_unit: string; to_unit: string; factor: number }

const METRICAS: Record<string, number> = {
  'G→KG': 0.001, 'KG→G': 1000,
  'MG→G': 0.001, 'G→MG': 1000,
  'MG→KG': 0.000001, 'KG→MG': 1000000,
  'ML→L': 0.001, 'L→ML': 1000,
  'GR→G': 1, 'G→GR': 1, 'GR→KG': 0.001, 'KG→GR': 1000,
  'LT→L': 1, 'L→LT': 1, 'ML→LT': 0.001, 'LT→ML': 1000,
}

function factor(from: string, to: string, tabla: Conversion[]): number | null {
  const f = from.trim().toUpperCase(), t = to.trim().toUpperCase()
  if (f === t) return 1
  const directa = tabla.find(c => c.from_unit?.toUpperCase() === f && c.to_unit?.toUpperCase() === t)
  if (directa && Number.isFinite(directa.factor) && directa.factor > 0) return directa.factor
  const inversa = tabla.find(c => c.from_unit?.toUpperCase() === t && c.to_unit?.toUpperCase() === f)
  if (inversa && Number.isFinite(inversa.factor) && inversa.factor > 0) return 1 / inversa.factor
  const metrica = METRICAS[`${f}→${t}`]
  return metrica ?? null
}

export type Agregado =
  | { ok: true; porIngrediente: Map<string, { quantity: number; unit: string | null }> }
  | { ok: false; detalle: string }

export function agregarPorIngrediente(filas: FilaDeReceta[], tabla: Conversion[] = []): Agregado {
  const porIngrediente = new Map<string, { quantity: number; unit: string | null }>()
  for (const r of filas) {
    const q = Number(r.quantity) || 0
    const prev = porIngrediente.get(r.ingredient_id)
    if (!prev) { porIngrediente.set(r.ingredient_id, { quantity: q, unit: r.unit }); continue }
    const de = r.unit ?? '', a = prev.unit ?? ''
    if (!de || !a) {
      if (de === a) { prev.quantity += q; continue }
      return { ok: false, detalle: `${r.ingredient_id}: una fila sin unidad y otra en ${de || a}` }
    }
    const f = factor(de, a, tabla)
    if (f == null) return { ok: false, detalle: `${r.ingredient_id}: no hay conversion de ${de} a ${a}` }
    prev.quantity = Math.round((prev.quantity + q * f) * 1e6) / 1e6
  }
  return { ok: true, porIngrediente }
}
