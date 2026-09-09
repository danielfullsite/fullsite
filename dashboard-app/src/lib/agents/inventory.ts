/**
 * Inventory Agent
 *
 * Detecta: faltantes, stock bajo mínimo, artículos auto-86, consumo inesperado.
 *
 * Inputs:  pos_inventory_products, pos_ingredients (fallback)
 * Outputs: AgentEvent[]
 * Freq:    Cada hora
 */
import type { AgentEvent } from './types'
import { masReciente } from './edad-del-dato'

interface InventoryProduct {
  id: string
  name: string
  unit: string
  stock: number
  reorder_point: number
  category: string | null
  cost_per_unit: number | null
  active: boolean
  /** Cuándo se movió esta fila por última vez. Es la frescura del hallazgo. */
  updated_at?: string | null
}

interface Ingredient {
  id: string
  name: string
  unit: string
  cost_per_unit: number | null
  category: string | null
  active: boolean
}

interface InventoryRow {
  ingredient_id: string
  stock: number
  reorder_point: number | null
  updated_at?: string | null
}

export async function runInventoryAgent(
  clientId: string,
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const now = Date.now()

  // ── DE DÓNDE SALE EL INVENTARIO ──────────────────────────────────────────
  //
  // Este orden estaba invertido, y eso hizo que el agente de mayor volumen del sistema
  // pasara meses diciendo cosas falsas en rojo. Medido en producción el 2026-09-08:
  //
  //   pos_inventory_products  último updated_at 2026-07-10 · 0 filas tocadas en 30 días
  //                           41 con stock 0: 33 PRODUCTOS MARKET, 5 BEBIDAS, 2 MARCA
  //                           PROPIA, 1 ABARROTES — libros, tazas, gomitas, kombucha
  //   pos_inventory           último updated_at 2026-09-03 · 39 filas tocadas en 7 días
  //                           17 con stock 0, y son ingredientes de cocina de verdad
  //
  // O sea que la tabla congelada es un catálogo de retail y la tabla viva es la despensa.
  // El agente leía la primera y titulaba «41 ingredientes sin stock — auto-86 activo», con
  // la explicación «los platillos que los requieren no se pueden preparar». Ningún platillo
  // los requiere: cruzados los 41 nombres contra las recetas, cero coincidencias.
  //
  // Y el camino correcto YA EXISTÍA en este archivo, muerto por diseño: sólo corría si la
  // primera consulta lanzaba excepción, y esa consulta responde 200 con 83 filas todos los
  // días. Un respaldo que nunca se activa no es un respaldo.
  //
  // Ahora la tabla viva va primero, y el catálogo sólo se usa si aquélla no trae nada —
  // que es el caso de un restaurante recién dado de alta.
  let products: { id: string; name: string; unit: string; stock: number; reorder_point: number; category: string | null; cost_per_unit: number | null; updated_at?: string | null }[] = []
  let fuente = ''

  try {
    const [ingredients, inventory] = await Promise.all([
      sbGet<Ingredient>(
        'pos_ingredients',
        `client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&select=id,name,unit,cost_per_unit,category&limit=300`,
      ),
      sbGet<InventoryRow>(
        'pos_inventory',
        `client_id=eq.${encodeURIComponent(clientId)}&select=ingredient_id,stock,reorder_point,updated_at&limit=300`,
      ),
    ])
    const invMap = new Map(inventory.map(r => [r.ingredient_id, r]))
    products = ingredients
      .map(ing => {
        const inv = invMap.get(ing.id)
        return {
          // `pos_ingredients.id` SÍ es la llave de `pos_inventory_movements.ingredient_id`
          // (los dos son texto). Ésta es la razón de fondo para preferir esta fuente: es
          // la única con la que el hallazgo se puede calificar solo contra la realidad.
          id: ing.id,
          name: ing.name,
          unit: ing.unit,
          stock: inv?.stock ?? 0,
          reorder_point: inv?.reorder_point ?? 0,
          category: ing.category,
          cost_per_unit: ing.cost_per_unit,
          updated_at: inv?.updated_at,
        }
      })
      .filter(p => p.reorder_point > 0)
    if (products.length > 0) fuente = 'pos_inventory'
  } catch {
    // Cae al catálogo.
  }

  if (products.length === 0) {
    try {
      const rows = await sbGet<InventoryProduct>(
        'pos_inventory_products',
        `client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&reorder_point=gt.0&select=id,name,unit,stock,reorder_point,category,cost_per_unit,updated_at&order=stock.asc&limit=200`,
      )
      products = rows.map(r => ({
        // OJO: este `id` es bigint y NO empata con `pos_inventory_movements.ingredient_id`,
        // que es texto. Un comentario de este archivo afirmaba lo contrario y era falso:
        // comprobado el 2026-09-08, 0 de 2,768 movimientos cruzan, y `product_id` viene
        // NULL en los 2,768. Por eso los hallazgos de esta rama son incalificables por
        // construcción, y por eso es el respaldo y no la fuente.
        id: r.id,
        name: r.name,
        unit: r.unit,
        stock: r.stock ?? 0,
        reorder_point: r.reorder_point ?? 0,
        category: r.category,
        cost_per_unit: r.cost_per_unit,
        updated_at: r.updated_at,
      }))
      if (products.length > 0) fuente = 'pos_inventory_products'
    } catch {
      return events // No hay inventario de ninguna de las dos fuentes
    }
  }
  if (products.length === 0) return events

  // DE CUÁNDO ES ESTE INVENTARIO.
  //
  // Todo lo que sigue habla en presente: qué está agotado HOY, qué no se puede cocinar
  // HOY. Medido el 2026-09-08, el último `updated_at` de pos_inventory_products para
  // AMALAY es del 2026-07-10 — hace 60 días. Este agente lleva dos meses emitiendo 71 de
  // los 155 hallazgos del sistema, 56 de ellos en rojo, sobre una tabla que no se mueve.
  //
  // No se calla el hallazgo: un almacén congelado sigue siendo información. Se fecha,
  // para que nadie lo lea como si fuera de esta mañana. Lo hace el engine al insertar.
  const datosHasta = masReciente(products, 'updated_at')

  // ── QUÉ INGREDIENTES SE PUEDEN JUZGAR ────────────────────────────────────
  //
  // «Stock en cero» tiene dos significados que en la base se ven idénticos:
  //
  //   agotado    — se consumió y no se ha repuesto            → hallazgo real
  //   nunca hubo — la fila se sembró y nadie la ha tocado     → no es un hallazgo
  //
  // De los 17 ingredientes en cero de AMALAY, DIEZ no tienen un solo movimiento en toda
  // su historia (romero, perejil liso, queso brie, queso manchego, sal del himalaya,
  // galletas marías, peperoni, cebolla cambray, pepita verde, mantequilla noche buena) y
  // los diez traen `reorder_point = 2`, que es un valor sembrado por omisión. Decir «no
  // hay romero» de algo que nunca entró ni salió del almacén no es informar: es leer una
  // fila vacía en voz alta.
  //
  // La regla: para hablar de un ingrediente hace falta que exista en el libro de
  // movimientos. Un ingrediente sin historia no está agotado — está sin capturar, que es
  // un problema distinto y de otra persona.
  //
  // Sólo aplica cuando la fuente es la viva; el catálogo de respaldo no comparte espacio
  // de llaves con el libro de movimientos y filtrar contra él dejaría todo fuera.
  const conHistoria = fuente === 'pos_inventory'
    ? await ingredientesConMovimiento(clientId, products.map(p => p.id), sbGet)
    : null
  const juzgables = conHistoria ? products.filter(p => conHistoria.has(p.id)) : products

  if (juzgables.length === 0) return events

  // ── 1. Out of stock (auto-86) ────────────────────────────────────────────
  const outOfStock = juzgables.filter(p => p.stock <= 0)
  if (outOfStock.length > 0) {
    const names = outOfStock.slice(0, 5).map(p => p.name).join(', ')
    const more = outOfStock.length > 5 ? ` y ${outOfStock.length - 5} más` : ''
    events.push({
      client_id: clientId,
      datos_hasta: datosHasta,
      agent_id: 'inventory',
      type: 'out_of_stock',
      severity: 'critical',
      title: `${outOfStock.length} ingrediente${outOfStock.length > 1 ? 's' : ''} sin stock — auto-86 activo`,
      // Se dice qué son y de dónde salió el número, en vez de prometer un efecto en
      // cocina que este agente no verificó. Con la fuente vieja la frase era falsa por
      // construcción: los 41 «ingredientes» eran libros, tazas y gomitas, y cruzados
      // contra las recetas daban CERO platillos afectados.
      explanation: `Sin existencias: ${names}${more}. Revisar qué platillos los usan antes de sacarlos del menú.`,
      evidence: {
        // El `id` que va aquí es el de `pos_ingredients`, que SÍ es la llave de
        // `pos_inventory_movements.ingredient_id`. Antes viajaba el de
        // `pos_inventory_products` —bigint contra texto— y el cruce daba 0 de 2,768: la
        // regla de calificación de abajo caía siempre en «no pasó nada», o sea que el
        // hallazgo era infalsificable. Ahora se puede refutar, que es el punto.
        items: outOfStock.map(p => ({ id: p.id, name: p.name, unit: p.unit, stock: p.stock, category: p.category })),
        count: outOfStock.length,

        // ── Cómo calificarme ──────────────────────────────────────────────────
        //
        // La regla se escribe AQUÍ, al momento de afirmar, no en el calificador. Es el
        // mismo principio que ya usa `close-predictor` con su `tolerancia_pct`: si la
        // regla viviera del lado de quien califica, se podría aflojar después de ver los
        // resultados y convertir un fallo en acierto. Quien afirma fija la vara.
        //
        // Verdad de campo para "no hay stock de X":
        //   · salió X (deduction / recipe_deduction / waste)  → SÍ había  → me equivoqué
        //   · entró X (restock / entry / invoice_entry)       → sí faltaba → acerté
        //   · se ajustó X (adjustment)                        → el número estaba mal → me equivoqué
        //   · no pasó nada                                    → no se puede saber → no se califica
        //
        // Ese último caso importa: dejarlo sin calificar es más honesto que empujarlo a
        // un bucket. Una precisión inflada con casos indeterminados no sirve para nada.
        verificacion: {
          metodo: 'pos_inventory_movements',
          ventana_dias: 3,
          ingrediente_ids: outOfStock.map(p => p.id),
          desmiente: ['deduction', 'recipe_deduction', 'waste', 'adjustment'],
          confirma: ['restock', 'entry', 'invoice_entry'],
        },
      },
      suggested_action: 'Verificar en cocina si hay stock físico no registrado. Notificar a meseros para desactivar platillos afectados.',
      confidence: 0.95,
      status: 'new',
      expires_at: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
    })
  }

  // ── 2. Below reorder point ───────────────────────────────────────────────
  const belowReorder = juzgables.filter(p => p.stock > 0 && p.stock <= p.reorder_point)
  if (belowReorder.length > 0) {
    const critical = belowReorder.filter(p => p.stock <= p.reorder_point * 0.5) // < 50% of minimum
    const warning  = belowReorder.filter(p => p.stock > p.reorder_point * 0.5)

    if (critical.length > 0) {
      const names = critical.slice(0, 4).map(p => `${p.name} (${p.stock.toFixed(1)} ${p.unit})`).join(', ')
      events.push({
        client_id: clientId,
        datos_hasta: datosHasta,
        agent_id: 'inventory',
        type: 'critical_low_stock',
        severity: 'critical',
        title: `${critical.length} ingrediente${critical.length > 1 ? 's' : ''} en stock crítico`,
        explanation: `Stock muy por debajo del mínimo: ${names}${critical.length > 4 ? ` y ${critical.length - 4} más` : ''}. Se agotarán durante el servicio si no se reabasteció.`,
        evidence: {
          items: critical.map(p => ({ name: p.name, stock: p.stock, reorder_point: p.reorder_point, unit: p.unit })),
          count: critical.length,
        },
        suggested_action: 'Ordenar compra urgente o verificar con proveedor disponibilidad inmediata.',
        confidence: 0.95,
        status: 'new',
        expires_at: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
      })
    }

    if (warning.length > 0 && warning.length <= 8) {
      const names = warning.slice(0, 4).map(p => p.name).join(', ')
      events.push({
        client_id: clientId,
        datos_hasta: datosHasta,
        agent_id: 'inventory',
        type: 'low_stock',
        severity: 'warning',
        title: `${warning.length} ingrediente${warning.length > 1 ? 's' : ''} bajo el mínimo de reorden`,
        explanation: `${names}${warning.length > 4 ? ` y ${warning.length - 4} más` : ''} han bajado del punto de reorden. Considerar compra antes de que se agoten.`,
        evidence: {
          items: warning.slice(0, 8).map(p => ({ name: p.name, stock: p.stock, reorder_point: p.reorder_point, unit: p.unit })),
          count: warning.length,
        },
        suggested_action: 'Revisar OC sugerida o contactar proveedor.',
        confidence: 0.90,
        status: 'new',
        expires_at: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
      })
    }
  }

  // ── 3. Near minimum (approaching reorder) ───────────────────────────────
  const nearMin = juzgables.filter(
    p => p.stock > p.reorder_point && p.stock <= p.reorder_point * 1.5,
  )
  if (nearMin.length >= 3) {
    events.push({
      client_id: clientId,
      datos_hasta: datosHasta,
      agent_id: 'inventory',
      type: 'approaching_minimum',
      severity: 'info',
      title: `${nearMin.length} ingredientes se acercan al mínimo de reorden`,
      explanation: `${nearMin.slice(0, 3).map(p => p.name).join(', ')}${nearMin.length > 3 ? ` y ${nearMin.length - 3} más` : ''} estarán bajo mínimo en el próximo turno si el consumo continúa al ritmo actual.`,
      evidence: {
        items: nearMin.slice(0, 6).map(p => ({ name: p.name, stock: p.stock, reorder_point: p.reorder_point, unit: p.unit })),
        count: nearMin.length,
      },
      suggested_action: 'Programar compra para mañana. Revisar el plan de menú del día.',
      confidence: 0.75,
      status: 'new',
      expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    })
  }

  return events
}


/**
 * Qué ingredientes tienen al menos un movimiento registrado.
 *
 * Es la diferencia entre «se acabó» y «nunca lo hemos capturado». Sin esto el agente
 * confunde una fila sembrada con un desabasto, y quien lo lee va a la cocina a buscar algo
 * que nunca estuvo ahí.
 *
 * Si la consulta falla se devuelve `null`, y quien llama trata eso como «no sé filtrar» y
 * deja pasar todo: perder un hallazgo real por un error de red es peor que emitir uno de
 * más, y el hallazgo lleva su evidencia para que se pueda juzgar.
 */
async function ingredientesConMovimiento(
  clientId: string,
  ids: string[],
  sbGet: <T>(table: string, query: string) => Promise<T[]>,
): Promise<Set<string> | null> {
  if (ids.length === 0) return new Set()
  // Los ids de `pos_ingredients` son slugs de texto sin comas. Se codifican de todos
  // modos: un id con coma partiría la lista `in.()` y el filtro se leería en silencio como
  // otro distinto.
  const lista = ids.map(id => `"${encodeURIComponent(id)}"`).join(',')
  try {
    const filas = await sbGet<{ ingredient_id: string }>(
      'pos_inventory_movements',
      `client_id=eq.${encodeURIComponent(clientId)}&ingredient_id=in.(${lista})` +
        `&select=ingredient_id&limit=2000`,
    )
    return new Set(filas.map(f => f.ingredient_id))
  } catch {
    return null
  }
}
