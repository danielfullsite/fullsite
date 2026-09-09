import { describe, it, expect } from 'vitest'
import { runInventoryAgent } from '@/lib/agents/inventory'

// El agente de inventario emite 71 de los 155 hallazgos del sistema, 56 de ellos en rojo.
// Medido en producción el 2026-09-08, casi todos eran falsos, y por dos razones distintas:
//
// 1. LEÍA LA TABLA EQUIVOCADA. `pos_inventory_products` no se toca desde el 2026-07-10 y
//    es un catálogo de RETAIL: de los 41 artículos «sin stock», 33 son PRODUCTOS MARKET,
//    5 BEBIDAS, 2 MARCA PROPIA y 1 ABARROTES — libros, tazas de cerámica, gomitas,
//    kombucha. Cruzados contra las recetas: CERO platillos afectados. Mientras tanto
//    `pos_inventory` —la despensa de verdad, tocada el 2026-09-03— decía 17.
//
//    El camino correcto ya existía en el archivo, muerto por diseño: sólo corría si la
//    consulta al catálogo lanzaba excepción, y esa consulta responde 200 todos los días.
//
// 2. CONFUNDÍA «SE ACABÓ» CON «NUNCA HUBO». De los 17 en cero de la tabla viva, DIEZ no
//    tienen un solo movimiento en su historia y traen `reorder_point = 2`, un valor
//    sembrado. Decir «no hay romero» de una fila que nadie ha tocado nunca es leer el
//    catálogo en voz alta, no informar.
//
// Y una consecuencia que hacía todo esto indetectable: `pos_inventory_products.id` es
// bigint y `pos_inventory_movements.ingredient_id` es texto. 0 de 2,768 cruzan. La regla
// de autocalificación que el propio hallazgo declara caía siempre en «no pasó nada → no se
// puede saber», así que el agente era infalsificable por construcción. Un comentario del
// archivo afirmaba que las dos llaves eran la misma; era falso y nadie lo comprobó.

type Consulta = { tabla: string; query: string }

/** Un sbGet falso que devuelve lo que se le diga por tabla y anota qué se le preguntó. */
function fakeSbGet(porTabla: Record<string, unknown[] | Error>, log: Consulta[] = []) {
  return async <T>(tabla: string, query: string): Promise<T[]> => {
    log.push({ tabla, query })
    const r = porTabla[tabla]
    if (r instanceof Error) throw r
    return (r ?? []) as T[]
  }
}

// La despensa viva: dos ingredientes agotados CON historia, uno sin historia.
const INGREDIENTES = [
  { id: 'pechuga_de_pavo', name: 'PECHUGA DE PAVO', unit: 'kg', cost_per_unit: 180, category: 'CARNES' },
  { id: 'chai_base', name: 'CHAI BASE EN POLVO', unit: 'kg', cost_per_unit: 90, category: 'BEBIDAS' },
  { id: 'romero', name: 'romero', unit: 'pza', cost_per_unit: 12, category: 'HIERBAS' },
]
const INVENTARIO = [
  { ingredient_id: 'pechuga_de_pavo', stock: -0.73, reorder_point: 1.38, updated_at: '2026-09-03T02:48:21Z' },
  { ingredient_id: 'chai_base', stock: -25.945, reorder_point: 0.53, updated_at: '2026-09-03T02:48:21Z' },
  // Sembrado y jamás tocado: reorder_point 2 es el valor por omisión.
  { ingredient_id: 'romero', stock: 0, reorder_point: 2, updated_at: '2026-07-10T21:05:09Z' },
]
const MOVIMIENTOS = [
  { ingredient_id: 'pechuga_de_pavo' }, { ingredient_id: 'pechuga_de_pavo' },
  { ingredient_id: 'chai_base' },
  // romero no aparece: cero movimientos en toda su historia.
]

// El catálogo de retail congelado, con lo que de verdad hay en él.
const CATALOGO = [
  { id: 315, name: 'LIBRO - THE HIDDEN POWER', unit: 'pza', stock: 0, reorder_point: 1,
    category: 'PRODUCTOS MARKET', cost_per_unit: 250, active: true, updated_at: '2026-07-10T21:05:09Z' },
  { id: 86, name: 'AMALAY - TAZA CERAMICA IMPRESA BLANCA', unit: 'pza', stock: 0, reorder_point: 1,
    category: 'MARCA PROPIA', cost_per_unit: 90, active: true, updated_at: '2026-07-10T21:05:09Z' },
]

describe('la fuente: la despensa viva, no el catálogo congelado', () => {
  it('lee pos_inventory ANTES que pos_inventory_products', async () => {
    const log: Consulta[] = []
    await runInventoryAgent('amalay', fakeSbGet({
      pos_ingredients: INGREDIENTES,
      pos_inventory: INVENTARIO,
      pos_inventory_movements: MOVIMIENTOS,
      pos_inventory_products: CATALOGO,
    }, log))
    const tablas = log.map(c => c.tabla)
    expect(tablas).toContain('pos_inventory')
    // El catálogo ni se consulta cuando la despensa respondió.
    expect(tablas).not.toContain('pos_inventory_products')
  })

  it('NO habla de libros ni de tazas cuando existe la despensa', async () => {
    const eventos = await runInventoryAgent('amalay', fakeSbGet({
      pos_ingredients: INGREDIENTES,
      pos_inventory: INVENTARIO,
      pos_inventory_movements: MOVIMIENTOS,
      pos_inventory_products: CATALOGO,
    }))
    const texto = JSON.stringify(eventos)
    expect(texto).not.toContain('LIBRO')
    expect(texto).not.toContain('TAZA')
    expect(texto).toContain('PECHUGA DE PAVO')
  })

  it('el catálogo sigue siendo el respaldo de un restaurante recién dado de alta', async () => {
    const eventos = await runInventoryAgent('amalay', fakeSbGet({
      pos_ingredients: [],
      pos_inventory: [],
      pos_inventory_products: CATALOGO,
      pos_inventory_movements: [],
    }))
    // Sin despensa, el catálogo se usa. Y como sus ids no cruzan con el libro de
    // movimientos, no se filtra por historia: filtrar ahí dejaría todo fuera siempre.
    expect(eventos.length).toBeGreaterThan(0)
  })

  it('sin ninguna de las dos fuentes no inventa nada', async () => {
    const eventos = await runInventoryAgent('amalay', fakeSbGet({
      pos_ingredients: [], pos_inventory: [],
      pos_inventory_products: new Error('500'),
    }))
    expect(eventos).toEqual([])
  })
})

describe('«se acabó» y «nunca hubo» no son lo mismo', () => {
  const correr = () => runInventoryAgent('amalay', fakeSbGet({
    pos_ingredients: INGREDIENTES,
    pos_inventory: INVENTARIO,
    pos_inventory_movements: MOVIMIENTOS,
  }))

  it('no reporta agotado un ingrediente sin un solo movimiento en su historia', async () => {
    const texto = JSON.stringify(await correr())
    expect(texto).not.toContain('romero')
  })

  it('sí reporta los que sí tienen historia', async () => {
    const oos = (await correr()).find(e => e.type === 'out_of_stock')
    expect(oos).toBeDefined()
    expect(oos!.title).toContain('2 ')
    expect(oos!.explanation).toContain('PECHUGA DE PAVO')
  })

  it('no promete un efecto en cocina que no verificó', async () => {
    const oos = (await correr()).find(e => e.type === 'out_of_stock')
    // La frase vieja —«los platillos que los requieren no se pueden preparar»— era falsa
    // por construcción con el catálogo: cero recetas afectadas.
    expect(oos!.explanation).not.toContain('no se pueden preparar')
  })

  it('el hallazgo lleva ids que SÍ cruzan con el libro de movimientos', async () => {
    const oos = (await correr()).find(e => e.type === 'out_of_stock')
    const ev = oos!.evidence as { verificacion: { ingrediente_ids: string[] } }
    // Con los ids del catálogo (bigint) el cruce daba 0 de 2,768 y el hallazgo no se podía
    // refutar nunca. Con los de pos_ingredients sí.
    expect(ev.verificacion.ingrediente_ids).toContain('pechuga_de_pavo')
    for (const id of ev.verificacion.ingrediente_ids) {
      expect(typeof id).toBe('string')
    }
  })

  it('si el libro de movimientos falla, no se pierde el hallazgo', async () => {
    // Perder una alerta real por un error de red es peor que emitir una de más: el
    // hallazgo lleva su evidencia y se puede juzgar.
    const eventos = await runInventoryAgent('amalay', fakeSbGet({
      pos_ingredients: INGREDIENTES,
      pos_inventory: INVENTARIO,
      pos_inventory_movements: new Error('timeout'),
    }))
    expect(JSON.stringify(eventos)).toContain('PECHUGA DE PAVO')
  })
})

describe('la frescura de la despensa viaja con el hallazgo', () => {
  it('declara el updated_at más nuevo que leyó', async () => {
    const eventos = await runInventoryAgent('amalay', fakeSbGet({
      pos_ingredients: INGREDIENTES,
      pos_inventory: INVENTARIO,
      pos_inventory_movements: MOVIMIENTOS,
    }))
    expect(eventos[0].datos_hasta).toBe('2026-09-03T02:48:21Z')
  })
})
