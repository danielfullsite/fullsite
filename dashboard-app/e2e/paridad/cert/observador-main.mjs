/**
 * OBSERVADOR AUTORITATIVO DEL MAIN — la frontera donde las escrituras SÍ se ven.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 * La sonda captura parcheando `window.fetch` del renderer. Eso ve
 * `/api/pos/db?path=pos_sessions` y no ve `POST /api/pos/save-order`, que es
 * justo donde viajan `items[].cantidad`, `modificadores` y `station`. Medido en
 * cert-g01-20260917T180532Z: `api_writes` trajo dos entradas de `pos_sessions`
 * y ninguna de save-order, así que M1, M2 y M3 salieron «no aplicable — categoría
 * vacía» sobre un journey que sí produjo el dato. La compuerta de 5/5 quedaba
 * insatisfacible: 2/5 para siempre, por ceguera del arnés y no por el producto.
 *
 * ── LA FRONTERA ─────────────────────────────────────────────────────────────
 * `session.webRequest.onBeforeRequest` en el proceso MAIN, la misma que el guard
 * ya usó con 13/13 de paridad contra Network y con capacidad de bloqueo PROBADA
 * (block-test2). Ve el cuerpo (`uploadData`) de toda petición mutante de la
 * sesión, venga del renderer o del propio MAIN. No se sustituye por window.fetch,
 * ni por el Network del renderer, ni por logs inferidos.
 *
 * ── LO QUE NO HACE ──────────────────────────────────────────────────────────
 * No muta nada. No bloquea nada. Si no puede instalarse, lo dice y el manifiesto
 * se queda sin save-order — que es exactamente lo que debe pasar: un arnés que
 * no ve el efecto reporta NOT_OBSERVED, nunca un aprobado.
 */

const INSPECTOR_POR_OMISION = process.env.CERT_MAIN_INSPECTOR || 'http://127.0.0.1:9331'

/* ═══════════════════════════════════════════════════════════════════════════
   NORMALIZACIÓN — raw y canónico, los dos
   ───────────────────────────────────────────────────────────────────────────
   El canónico es el que consumen M1-M3 (`q`, `mods`, `station`). El raw se
   conserva completo por renglón: `cantidad`, `modificadores`, `modifier_ids`
   son los nombres que el producto usa de verdad, y borrarlos convertiría el
   acta en una traducción sin original.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Los nombres crudos de cada renglón, tal cual llegan. */
export function llavesCrudas(item) {
  return item && typeof item === 'object' ? Object.keys(item) : []
}

/** Un modificador puede venir como texto o como objeto. Se reduce a su nombre. */
function nombreDeModificador(m) {
  if (m === null || typeof m !== 'object') return m
  return m.nombre ?? m.name ?? m.id ?? null
}

/**
 * Convierte un `POST /api/pos/save-order` crudo en la entrada de `api_writes`
 * que el manifiesto promete. Devuelve `null` si no es esa ruta o si el cuerpo
 * no es JSON — nunca inventa una entrada vacía.
 */
export function normalizarSaveOrder({ metodo, url, cuerpoTexto }) {
  if (String(metodo).toUpperCase() !== 'POST') return null
  if (!/\/api\/pos\/save-order/.test(String(url || ''))) return null
  let j = null
  try { j = JSON.parse(cuerpoTexto) } catch { return null }
  if (!j || typeof j !== 'object') return null

  const items = Array.isArray(j.items) ? j.items : []
  return {
    source: 'main_http',
    metodo: 'POST',
    url: '/api/pos/save-order',
    order_id: j.order_id ?? j.id ?? null,
    save_operation_id: j.save_operation_id ?? null,
    raw_body_bytes: typeof cuerpoTexto === 'string' ? cuerpoTexto.length : null,
    raw_item_keys: llavesCrudas(items[0]),
    items: items.map(it => ({
      // ── canónico: lo que M1-M3 leen ──────────────────────────────────────
      n: it?.nombre ?? it?.name ?? null,
      q: it?.cantidad ?? it?.qty ?? it?.q ?? 1,
      station: it?.station ?? it?.estacion ?? null,
      mods: (Array.isArray(it?.modificadores) ? it.modificadores
           : Array.isArray(it?.mods) ? it.mods : []).map(nombreDeModificador),
      // ── crudo: los nombres del producto, sin traducir ────────────────────
      raw: {
        cantidad: it?.cantidad ?? null,
        modificadores: Array.isArray(it?.modificadores) ? it.modificadores : null,
        modifier_ids: Array.isArray(it?.modifier_ids) ? it.modifier_ids : null,
        station: it?.station ?? null,
      },
    })),
  }
}

/**
 * Identidad estable de una escritura, para no contarla dos veces.
 *
 * `save_operation_id` y `order_id` entran cuando existen: son la identidad que
 * el producto ya asigna. El tiempo NO participa — dos capturas del mismo write
 * llegan con microsegundos distintos y eso las volvería «distintas».
 */
export function clave(entrada) {
  const url = String(entrada?.url ?? entrada?.endpoint ?? '')
  const ruta = url.split('?')[0]
  const cuerpo = entrada?.cuerpo ?? {}
  const op = entrada?.save_operation_id ?? cuerpo?.save_operation_id ?? ''
  const ord = entrada?.order_id ?? cuerpo?.order_id ?? cuerpo?.id ?? ''
  return [String(entrada?.metodo ?? '').toUpperCase(), ruta, op, ord].join('|')
}

/**
 * Une lo que vio la sonda con lo que vio el MAIN. Ante la misma escritura, el
 * MAIN gana: es la frontera autoritativa, y la de la sonda es diagnóstico.
 */
export function fusionarApiWrites(legacy = [], main = []) {
  const porClave = new Map()
  for (const e of legacy) porClave.set(clave(e), e)
  for (const e of main) porClave.set(clave(e), e)   // el MAIN sobreescribe
  return [...porClave.values()]
}

/* ═══════════════════════════════════════════════════════════════════════════
   INSTALACIÓN — INSTALL → ACK → READ-BACK
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Abre el observador en el MAIN. Devuelve siempre un objeto: cuando no se puede
 * instalar, `disponible:false` con el motivo, para que el arnés lo reporte en
 * vez de silenciarlo.
 */
export async function abrirObservadorMain({ inspectorUrl = INSPECTOR_POR_OMISION, runId = 'obs' } = {}) {
  let ws = null
  const fallo = (motivo) => ({ disponible: false, motivo, leer: async () => [], cerrar: async () => {} })
  let lista
  try {
    const r = await fetch(`${inspectorUrl}/json/list`, { signal: AbortSignal.timeout(4000) })
    lista = await r.json()
  } catch (e) {
    return fallo(`no hay inspector del MAIN en ${inspectorUrl}: ${e?.message ?? e}`)
  }
  const destino = (lista || []).find(t => t.webSocketDebuggerUrl)
  if (!destino) return fallo(`el inspector de ${inspectorUrl} no expone un destino`)

  ws = new WebSocket(destino.webSocketDebuggerUrl)
  try {
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = () => rej(new Error('no se pudo abrir el WebSocket del inspector'))
      setTimeout(() => rej(new Error('timeout abriendo el inspector')), 5000)
    })
  } catch (e) { return fallo(String(e?.message ?? e)) }

  let id = 0
  const pend = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) }
  }
  /** Evalúa en el MAIN y FALLA DURO: una excepción nunca se vuelve `undefined`. */
  const ev = (expr) => new Promise((res, rej) => {
    const i = ++id
    pend.set(i, (d) => {
      const ex = d?.result?.exceptionDetails
      if (ex) return rej(new Error(String(ex.exception?.description || ex.text || 'excepción').slice(0, 300)))
      res(d?.result?.result?.value)
    })
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true } }))
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout evaluando en el MAIN')) } }, 15000)
  })

  const SENTINEL = '__FULLSITE_CERT_OBS_MAIN__'
  let ack
  try {
    ack = await ev(`(() => {
      const { webContents, session } = require('electron')
      const ses = webContents.getAllWebContents()[0]?.session ?? session.defaultSession
      const G = global.${SENTINEL} = { run_id: ${JSON.stringify(runId)}, writes: [], otras: 0 }
      const MUT = ['POST', 'PUT', 'PATCH', 'DELETE']
      ses.webRequest.onBeforeRequest((d, cb) => {
        try {
          if (MUT.indexOf(d.method) >= 0) {
            const u = String(d.url)
            const esSaveOrder = u.indexOf('/api/pos/save-order') >= 0
            const esEventoLan = u.indexOf('/events') >= 0 && u.indexOf('127.0.0.1') >= 0
            if (esSaveOrder || esEventoLan) {
              const ud = d.uploadData || []
              let t = ''
              for (let i = 0; i < ud.length; i++) if (ud[i].bytes) t += ud[i].bytes.toString('utf8')
              G.writes.push({ clase: esSaveOrder ? 'save_order' : 'lan_event',
                              metodo: d.method, url: u, cuerpoTexto: t })
            } else { G.otras++ }
          }
        } catch (e) {}
        cb({ cancel: false })
      })
      return { installed: true, run_id: G.run_id }
    })()`)
  } catch (e) {
    try { ws.close() } catch {}
    return fallo(`no se pudo instalar el observador: ${e?.message ?? e}`)
  }

  // READ-BACK: el acuse de la propia expresión no basta; se relee del proceso.
  let sentinel
  try {
    sentinel = await ev(`(() => { const g = global.${SENTINEL}
      return g ? { present: true, run_id: g.run_id, writes: g.writes.length } : { present: false } })()`)
  } catch (e) {
    try { ws.close() } catch {}
    return fallo(`read-back falló: ${e?.message ?? e}`)
  }
  if (!ack?.installed || !sentinel?.present || sentinel.run_id !== runId) {
    try { ws.close() } catch {}
    return fallo('handshake incompleto: el sentinel no se pudo releer del MAIN')
  }

  return {
    disponible: true,
    motivo: null,
    ack,
    sentinel,
    /** Lo capturado hasta ahora, ya normalizado. */
    async leer() {
      const crudo = await ev(`JSON.stringify(global.${SENTINEL} ? global.${SENTINEL}.writes : [])`)
      const writes = JSON.parse(crudo || '[]')
      return writes
    },
    async cerrar() {
      try {
        await ev(`(() => {
          const { webContents, session } = require('electron')
          const ses = webContents.getAllWebContents()[0]?.session ?? session.defaultSession
          ses.webRequest.onBeforeRequest(null)
          delete global.${SENTINEL}
          return { removido: true }
        })()`)
      } catch { /* el proceso pudo morir; el listener muere con él */ }
      try { ws.close() } catch {}
    },
  }
}
