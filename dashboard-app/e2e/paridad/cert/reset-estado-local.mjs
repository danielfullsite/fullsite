// RESET DETERMINÍSTICO DEL ESTADO DE CERTIFICACIÓN.
//
// La corrida cert-g01-20260915T205601Z dejó ver por qué hace falta: la corrida A
// terminó con «Asiento 1 $100.00» y la B arrancó de ahí y llegó a $200.00. Dos
// corridas que no parten del mismo estado no miden determinismo — miden
// acumulación, y su «diferencia» no dice nada del sistema.
//
// ── DÓNDE VIVE DE VERDAD EL ESTADO DE LA MESA ───────────────────────────────
// Trazado desde lo que se renderiza, no supuesto:
//   subtotal (page.tsx:5240) ← activeItems (:3301) ← orderItems (React state)
// y `orderItems` se puebla en cascada DESDE localStorage:
//   1. `pos_order_<mesa>`  — caché de la orden, TTL 8 h  (page.tsx:2326)
//   2. la DB remota por API
//   3. `pos_draft_<mesa>`  — borrador sin guardar, TTL 4 h (page.tsx:2265)
//   4. vacío
//
// La primera versión de este reset limpiaba la IndexedDB `fullsite_pos`, que NO
// participa en esa cadena: el contador daba 0, el reset se declaraba verificado
// y la mesa seguía acumulando un plato por corrida ($500 en A, $600 en B).
// Limpiar el sitio equivocado y verificarlo con una prueba que no prueba lo que
// dice es peor que no limpiar: da permiso de avanzar.
//
// ── LA GUARDA ───────────────────────────────────────────────────────────────
// Esto BORRA datos locales. Por eso falla cerrado: si no puede DEMOSTRAR que la
// terminal pertenece al tenant de laboratorio, no toca nada y lo dice. El tenant
// se lee de `localStorage['fullsite_client_id']` (data.ts:102), que es la misma
// fuente que usa el POS para decidir a qué restaurante pertenece.
//
// No borra el catálogo ni el turno: son el fixture, y volver a sembrarlos en
// cada corrida haría el reset lento y frágil. Sólo se va lo que una corrida
// ensucia — el borrador y su cola.

const TENANT_LABORATORIO = 'fullsite-cert-lab-v2'
const PROHIBIDOS = ['amalay', 'demo', 'lab-resto']

/**
 * Deja la terminal en el estado inicial de una corrida.
 * Devuelve `{ ok, tenant, borrados, verificacion, motivo }` — nunca lanza por
 * scope: un reset que no puede demostrar dónde está, no borra.
 */
export async function resetEstadoLocal(page, { baseUrl, mesa }) {
  // ── 1 · ¿Dónde estamos? ───────────────────────────────────────────────────
  const scope = await page.evaluate(() => {
    try {
      return { tenant: (localStorage.getItem('fullsite_client_id') || '').toLowerCase().trim(),
               origen: location.origin }
    } catch { return { tenant: null, origen: location.origin } }
  }).catch(() => ({ tenant: null, origen: null }))

  if (!scope.tenant) {
    return { ok: false, tenant: null, borrados: null,
      motivo: 'no se pudo leer el tenant de la terminal: no se borra nada (fail closed)' }
  }
  if (PROHIBIDOS.includes(scope.tenant)) {
    return { ok: false, tenant: scope.tenant, borrados: null,
      motivo: `la terminal pertenece a «${scope.tenant}», que está prohibido: no se borra nada` }
  }
  if (scope.tenant !== TENANT_LABORATORIO) {
    return { ok: false, tenant: scope.tenant, borrados: null,
      motivo: `la terminal pertenece a «${scope.tenant}», no a «${TENANT_LABORATORIO}»: no se borra nada` }
  }

  // ── 2 · Vaciar SÓLO lo que una corrida ensucia ────────────────────────────
  //    Primero localStorage, que es la fuente real de lo que se ve.
  const claves = await page.evaluate(() => {
    const borradas = []
    try {
      for (const k of Object.keys(localStorage)) {
        // `pos_order_*` y `pos_draft_*` son el estado por mesa. `pos_turno_id` y
        // `pos_mesero` NO se tocan: el turno es fixture y la sesión es
        // precondición, no suciedad de la corrida.
        if (/^pos_(order|draft)_/.test(k)) { localStorage.removeItem(k); borradas.push(k) }
      }
    } catch { /* almacenamiento bloqueado */ }
    return borradas
  }).catch(() => [])

  const borrados = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('fullsite_pos')
    req.onerror = () => resolve({ error: 'no se pudo abrir fullsite_pos' })
    req.onsuccess = () => {
      const db = req.result
      const objetivo = ['orders', 'sync_queue'].filter(s => db.objectStoreNames.contains(s))
      if (!objetivo.length) { db.close(); return resolve({ stores: [], contados: {} }) }
      const tx = db.transaction(objetivo, 'readwrite')
      const contados = {}
      let pendientes = objetivo.length
      for (const nombre of objetivo) {
        const store = tx.objectStore(nombre)
        const cuenta = store.count()
        cuenta.onsuccess = () => {
          contados[nombre] = cuenta.result
          store.clear()
          if (--pendientes === 0) { /* espera al oncomplete */ }
        }
      }
      tx.oncomplete = () => { db.close(); resolve({ stores: objetivo, contados }) }
      tx.onerror = () => { db.close(); resolve({ error: 'la transacción falló' }) }
    }
  })).catch(e => ({ error: String(e?.message || e) }))

  if (borrados?.error) {
    return { ok: false, tenant: scope.tenant, borrados, motivo: `no se pudo limpiar: ${borrados.error}` }
  }

  // ── 3 · Recargar para que el POS lea el estado ya vacío ───────────────────
  await page.goto(`${baseUrl}/pos/mesas`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(5000)

  // ── 4 · DEMOSTRARLO, no suponerlo ────────────────────────────────────────
  //    Un `clear()` que devolvió sin error no es prueba de que la pantalla esté
  //    limpia: el POS pudo repoblar desde otra fuente.
  const verificacion = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('fullsite_pos')
    req.onerror = () => resolve({ ordenesLocales: null })
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('orders')) { db.close(); return resolve({ ordenesLocales: 0 }) }
      const tx = db.transaction(['orders'], 'readonly')
      const c = tx.objectStore('orders').count()
      c.onsuccess = () => { const n = c.result; db.close(); resolve({ ordenesLocales: n }) }
      c.onerror = () => { db.close(); resolve({ ordenesLocales: null }) }
    }
  })).catch(() => ({ ordenesLocales: null }))

  // Que las claves ya no estén es condición necesaria, NO suficiente: el
  // invariante que importa —ticket vacío, 0 items, subtotal $0.00— sólo se puede
  // observar con la mesa abierta, y de eso se encarga el conductor en S2.
  const quedan = await page.evaluate(() => {
    try { return Object.keys(localStorage).filter(k => /^pos_(order|draft)_/.test(k)) } catch { return null }
  }).catch(() => null)

  const limpio = Array.isArray(quedan) && quedan.length === 0 && verificacion.ordenesLocales === 0
  return {
    ok: limpio,
    tenant: scope.tenant,
    borrados,
    claves_borradas: claves,
    claves_restantes: quedan,
    verificacion,
    motivo: limpio ? null
      : (quedan === null ? 'no se pudo releer localStorage'
        : quedan.length ? `quedaron claves de mesa: ${quedan.join(', ')}`
        : `tras limpiar quedan ${verificacion.ordenesLocales} órdenes locales`),
  }
}

/**
 * El ticket TAL COMO SE VE con la mesa abierta. Es el único sitio donde el
 * invariante del reset se puede observar de verdad: `Sub $0.00` y cero items.
 */
export async function ticketVisible(page) {
  return page.evaluate(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ')
    const sub = (t.match(/Sub\s*\$([\d,]+\.\d{2})/) || [])[1] ?? null
    // Cada renglón del ticket trae el control de cantidad; contarlos es contar
    // items sin depender de cómo se llame la clase CSS de esta versión.
    const items = document.querySelectorAll('[data-testid^="item-"]').length
    return {
      subtotal: sub === null ? null : Number(sub.replace(/,/g, '')),
      itemsPorTestid: items,
      // Los importes que se ven, para poder demostrar $100 y no $200.
      importes: (t.match(/\$[\d,]+\.\d{2}/g) || []).slice(0, 8),
    }
  }).catch(() => ({ subtotal: null, itemsPorTestid: null, importes: [] }))
}

/**
 * El estado de la mesa TAL COMO SE VE, que es lo que se compara entre corridas.
 * Se usa para probar la secuencia A($100) → reset($0) → B($100), nunca $200.
 */
export async function estadoDeMesa(page, mesa) {
  return page.evaluate(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ')
    const importes = (t.match(/\$[\d,]+\.\d{2}/g) || [])
    // El subtotal que el POS rotula como «Sub $…»; si no está, no se inventa.
    const sub = (t.match(/Sub\s*\$([\d,]+\.\d{2})/) || [])[1] ?? null
    return {
      subtotal: sub === null ? null : Number(sub.replace(/,/g, '')),
      importes: importes.slice(0, 6),
      textoCorto: t.trim().slice(0, 160),
    }
  }).catch(() => ({ subtotal: null, importes: [], textoCorto: '' }))
}

export { TENANT_LABORATORIO, PROHIBIDOS }
