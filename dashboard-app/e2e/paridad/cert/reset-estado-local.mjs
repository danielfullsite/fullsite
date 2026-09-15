// RESET DETERMINÍSTICO DEL ESTADO DE CERTIFICACIÓN.
//
// La corrida cert-g01-20260915T205601Z dejó ver por qué hace falta: la corrida A
// terminó con «Asiento 1 $100.00» y la B arrancó de ahí y llegó a $200.00. Dos
// corridas que no parten del mismo estado no miden determinismo — miden
// acumulación, y su «diferencia» no dice nada del sistema.
//
// Navegar hacia atrás NO alcanza: el borrador vive en la IndexedDB `fullsite_pos`
// (store `orders`, pos-offline-db.ts:57) y sobrevive a la navegación, que es
// justamente lo que el POS promete para no perder órdenes sin internet.
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

  return {
    ok: verificacion.ordenesLocales === 0,
    tenant: scope.tenant,
    borrados,
    verificacion,
    motivo: verificacion.ordenesLocales === 0 ? null
      : `tras limpiar quedan ${verificacion.ordenesLocales} órdenes locales`,
  }
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
