'use strict'
//
// Catálogo de un restaurante de verdad dentro del laboratorio.
//
// ── POR QUÉ ──────────────────────────────────────────────────────────────────
//
// El laboratorio traía una categoría y un platillo. Sirve para afirmar cosas de
// protocolo y no sirve para encontrar bugs de DATOS — que son la mitad de los que
// muerden en campo. El 2026-09-14, en AMALAY, seis categorías del Market (132
// productos) no tenían estación asignada: en modo legacy sus productos se van a
// COCINA por el `return 'cocina'` del final de la cascada, y en modo Caja la orden
// completa se rechaza (`operational-domain.js:78`). Con un catálogo de juguete ese
// defecto no existe, porque su única categoría sí está ruteada.
//
// Con el catálogo real, el laboratorio ve lo que ve la caja: 38 categorías, 464
// productos, 61 grupos de modificadores y un ruteo con huecos.
//
// ── DE DÓNDE SALE EL ARCHIVO ─────────────────────────────────────────────────
//
// De la propia Caja, que ya lo tiene preparado y lo sirve:
//
//   GET http://<caja>:7717/catalog     (cabecera x-fullsite-lan: <secreto>)
//
// Es su forma normalizada —la que consume el POS—, no una reconstrucción desde
// Supabase. Se guarda FUERA del repositorio: `danielfullsite/fullsite` es público
// y el catálogo trae precios, RFC, dirección y teléfono del cliente (CLAUDE.md §13).
//
// ── QUÉ SE SANEA Y QUÉ NO ────────────────────────────────────────────────────
//
// SE QUITA lo que identifica al cliente: RFC, domicilio, teléfono, razón social,
// redes y logo, y el `restaurant_id` se reemplaza por el del laboratorio para que
// ninguna escritura pueda alcanzar al restaurante real.
//
// NO SE TOCA nada de lo que produce comportamiento: categorías, productos,
// precios, modificadores, métodos de pago y —sobre todo— `pos.station_routing`
// **con sus huecos incluidos**. Sanear el ruteo sería borrar el bug que este
// módulo existe para reproducir.

const fs = require('node:fs')

const CAMPOS_QUE_IDENTIFICAN = ['rfc', 'razon_social', 'address', 'phone', 'social_media', 'logo_url', 'receipt_footer']

/** Acepta la respuesta cruda de `/catalog` o el catálogo desnudo. */
function leerCatalogo(ruta) {
  const crudo = JSON.parse(fs.readFileSync(ruta, 'utf8'))
  const cat = crudo.catalog && typeof crudo.catalog === 'object' ? crudo.catalog : crudo
  if (!Array.isArray(cat.categories)) throw new Error(`${ruta}: no parece un catálogo (sin \`categories\`)`)
  return cat
}

/**
 * @param {object} args
 * @param {string} args.catalogo  ruta al JSON del catálogo
 * @param {string} [args.mesas]   ruta al JSON del plano (arreglo de mesas)
 * @param {string} args.tenant    id del restaurante DEL LABORATORIO
 * @param {object} args.staff     el operador sintético del laboratorio
 */
function cargar({ catalogo: rutaCatalogo, mesas: rutaMesas, tenant, staff }) {
  const cat = leerCatalogo(rutaCatalogo)

  const categorias = cat.categories.map(({ items, ...resto }) => ({ ...resto, active: resto.active !== false }))
  const items = cat.categories.flatMap(c => (c.items || []).map(i => ({ ...i, category_id: i.category_id ?? c.id })))
  const metodos = Array.isArray(cat.payment_methods) ? cat.payment_methods : []

  // La identidad del cliente se sustituye entera; sólo sobreviven los números que
  // cambian cómo se comporta el POS (IVA, zona horaria, banderas de producto).
  const configOriginal = cat.config || {}
  const config = { id: tenant, display_name: 'Restaurante de laboratorio',
    timezone: configOriginal.timezone || 'America/Monterrey',
    iva_rate: typeof configOriginal.iva_rate === 'number' ? configOriginal.iva_rate : 0.16,
    features: configOriginal.features && typeof configOriginal.features === 'object' ? configOriginal.features : { pos: true, posRestaurant: true },
    meseros: [staff.name] }
  for (const campo of CAMPOS_QUE_IDENTIFICAN) {
    if (campo in configOriginal) config[`_${campo}_removido`] = true
  }

  let mesas = null
  if (rutaMesas) {
    const plano = JSON.parse(fs.readFileSync(rutaMesas, 'utf8'))
    if (!Array.isArray(plano)) throw new Error(`${rutaMesas}: se esperaba un arreglo de mesas`)
    mesas = plano.map(m => ({ ...m, id: `mesa-${m.number}`, client_id: tenant, active: m.active !== false }))
  }
  config.mesas = mesas ? mesas.length : (configOriginal.mesas ?? 0)

  const construir = () => ({
    schema_version: cat.schema_version ?? 1,
    complete: true,
    catalog_scope: cat.catalog_scope || 'restaurant',
    restaurant_id: tenant,
    refreshed_at: new Date().toISOString(),
    config,
    // El ruteo viaja TAL CUAL, huecos incluidos: es el dato que reproduce el bug.
    settings: cat.settings || {},
    categories: categorias.map(c => ({ ...c, items: items.filter(i => i.category_id === c.id) })),
    payment_methods: metodos,
    modifiers: cat.modifiers || { groups: [], mods: [], item_links: [], category_links: [] },
  })

  /** Lo que el laboratorio imprime al arrancar, para que quede en la bitácora. */
  const resumen = () => {
    const ruteo = (cat.settings || {})['pos.station_routing'] || {}
    const ruteadas = new Set(Object.values(ruteo).flat().map(String))
    const huerfanas = categorias.filter(c => !ruteadas.has(String(c.id)) &&
      ![...ruteadas].some(v => v.toLowerCase() === String(c.name || '').toLowerCase()))
    const m = cat.modifiers || {}
    return {
      categorias: categorias.length,
      productos: items.length,
      grupos_modificadores: (m.groups || []).length,
      modificadores: (m.mods || []).length,
      vinculos: (m.item_links || []).length,
      metodos_pago: metodos.length,
      mesas: mesas ? mesas.length : 0,
      estaciones: Object.keys(ruteo),
      categorias_sin_estacion: huerfanas.map(c => ({ id: c.id, nombre: c.name,
        productos: items.filter(i => i.category_id === c.id).length })),
    }
  }

  return { categorias, items, metodos, mesas, catalogo: construir, resumen }
}

module.exports = { cargar }
