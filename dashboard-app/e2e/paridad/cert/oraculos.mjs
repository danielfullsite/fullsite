// LOS ORÁCULOS — quién vio el efecto, aparte del que lo causó.
//
// El manifiesto dice qué INTENTÓ hacer el POS. Un oráculo dice qué QUEDÓ. Son
// preguntas distintas y hace falta contestar las dos: un journey puede emitir
// el POST correcto y no dejar nada en la base, y el manifiesto no lo notaría.
//
// ── LA REGLA QUE ORDENA ESTE ARCHIVO ────────────────────────────────────────
// Un oráculo que no pudo mirar devuelve NOT_OBSERVED con su motivo. Nunca
// devuelve `true` por defecto, nunca «probablemente sí». El contrato (V-7) hace
// el resto: NOT_OBSERVED jamás convive con PASS.
//
// ── DE DÓNDE SALE CADA EXPECTATIVA ──────────────────────────────────────────
// QUÉ se espera sale del payload que arma `pos-data.ts:1365` (mesa, status,
// turno, items con sus modificadores). CÓMO se llama cada cosa en la base sale
// de la BASE, no de ese payload: los dos vocabularios NO coinciden, y darlo por
// hecho dejó al oráculo ciego una vez —`order_id` y `save_operation_id` no son
// columnas de `pos_orders`—. El ruteo a estación es `items[].station`, el mismo
// campo que el KDS lee, calculado por `getStationForItem` (pos-constants.ts:158).
//
// SEGURIDAD: el PIN se lee del entorno y no se imprime; el shift token vive en
// memoria de este proceso y de él sólo se reporta el tenant y el rol.

const TIMEOUT_MS = Number(process.env.CERT_HTTP_TIMEOUT_MS || 8000)

/** NOT_OBSERVED con motivo: el único resultado honesto cuando no se pudo mirar. */
const ciego = (motivo) => ({ clase: 'NOT_OBSERVED', ok: false, motivo, detalle: null })
const visto = (ok, detalle, motivo = null) => ({
  clase: ok ? 'EXPECTED_BEHAVIOR' : 'PRODUCT_DEFECT', ok, motivo, detalle,
})

/* ═══════════════════════════════════════════════════════════════════════════
   EL ACCESO — un shift token del laboratorio, y nada más
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Obtiene un shift token del tenant. Devuelve `{ token, tenant, rol }` o
 * `{ error }`. El token NO se devuelve en logs ni se escribe a disco.
 */
export async function abrirSesion({ baseUrl, tenant, pin }) {
  if (!pin) return { error: 'sin PIN: no se puede consultar ningún oráculo' }
  try {
    const r = await fetch(`${baseUrl}/api/pos/pin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, client_id: tenant, device_id: 'cert-oraculo' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const d = await r.json().catch(() => ({}))
    const token = d.shiftToken || d.token
    if (!token) return { error: `PIN rechazado (HTTP ${r.status})` }
    let meta = null
    try { meta = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')) } catch { /* token opaco */ }
    // El tenant del token manda sobre el que pidió quien llama: si no coinciden,
    // el oráculo estaría mirando otro restaurante.
    if (meta?.cid && meta.cid !== tenant) {
      return { error: `el token pertenece a «${meta.cid}», no a «${tenant}»` }
    }
    return { token, tenant, rol: meta?.rol ?? null }
  } catch (e) {
    return { error: `no se pudo abrir sesión: ${e.name === 'TimeoutError' ? 'timeout' : e.message}` }
  }
}

/** Lectura por el proxy del producto. Nunca escribe. */
async function leer(baseUrl, token, ruta) {
  const r = await fetch(`${baseUrl}/api/pos/db?path=${encodeURIComponent(ruta)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!r.ok) return { error: `HTTP ${r.status}`, filas: null }
  return { error: null, filas: await r.json().catch(() => null) }
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · DB ORACLE — ¿quedó la orden, y es la del journey?
   ───────────────────────────────────────────────────────────────────────────
   No basta con «hay una orden nueva». Se exige que sea LA orden: la mesa del
   objetivo, el producto del objetivo, y el modificador obligatorio realmente
   elegido. Una orden nueva sin el modificador probaría lo contrario de lo que
   G01 quiere probar.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function dbOracle({ baseUrl, token, objetivo, desde, turnoId = null }) {
  if (!token) return ciego('sin sesión: no se pudo consultar la base')

  /* ── LOS NOMBRES DE LA TABLA NO SON LOS DEL PAYLOAD ──────────────────────
     Este select pedía `order_id` y `save_operation_id` porque así se llaman en
     el payload que arma `pos-data.ts:1365`. En la TABLA no existen, y PostgREST
     rechaza el select entero con 400: el oráculo quedaba ciego y G01 fallaba
     por su propio instrumento.

     El mapeo real está en `save-order/route.ts:129`, que hace
     `pos_orders?id=eq.${order_id}`: el `order_id` que manda el POS se guarda en
     la columna `id`. `save_operation_id` viaja como parámetro RPC
     (`p_save_operation_id`, línea 103) hacia `r1_save_order_idempotent`, y no es
     columna de esta tabla.

     La lección, que ya costó una vez con una columna `saldo` inventada: el
     esquema se le pregunta a la tabla, no se deduce de quien le escribe. */
  const filtro = [
    'pos_orders?select=id,mesa,status,turno_id,items,comanda_batches,created_at',
    `created_at=gte.${encodeURIComponent(desde)}`,
    turnoId ? `turno_id=eq.${turnoId}` : null,
    'order=created_at.desc', 'limit=20',
  ].filter(Boolean).join('&')

  const { error, filas } = await leer(baseUrl, token, filtro)
  if (error) return ciego(`no se pudo leer pos_orders: ${error}`)
  if (!Array.isArray(filas)) return ciego('pos_orders no devolvió una lista')
  if (filas.length === 0) {
    // ESTO SÍ ES UN DEFECTO, no una ceguera: se miró y no había nada.
    return { clase: 'PRODUCT_DEFECT', ok: false,
      motivo: `el journey envió a cocina pero no quedó ninguna orden desde ${desde}`,
      detalle: { ordenes_encontradas: 0, desde, turno_id: turnoId } }
  }

  // ── ¿Cuál de las órdenes es la del journey? La que trae el producto objetivo.
  const traeProducto = (o) => (Array.isArray(o.items) ? o.items : [])
    .some(it => String(it?.nombre ?? it?.name ?? '').toUpperCase().includes(objetivo.producto.toUpperCase()))
  const orden = filas.find(traeProducto) ?? null

  if (!orden) {
    return { clase: 'PRODUCT_DEFECT', ok: false,
      motivo: `hay ${filas.length} orden(es) nuevas pero ninguna contiene «${objetivo.producto}»`,
      detalle: { candidatas: filas.map(o => ({ id: o.id, mesa: o.mesa,
        items: (o.items || []).map(i => i?.nombre ?? i?.name).slice(0, 5) })) } }
  }

  const items = Array.isArray(orden.items) ? orden.items : []
  const item = items.find(it => String(it?.nombre ?? it?.name ?? '').toUpperCase().includes(objetivo.producto.toUpperCase()))
  const mods = Array.isArray(item?.modificadores) ? item.modificadores
             : Array.isArray(item?.mods) ? item.mods : []
  const textoMods = mods.map(m => String(m?.nombre ?? m?.name ?? m)).join(' | ')

  const comprobaciones = [
    { id: 'orden-existe',   ok: true,
      esperado: 'una orden con el producto objetivo', observado: `pos_orders.id ${orden.id}` },
    { id: 'mesa-correcta',  ok: String(orden.mesa) === String(objetivo.mesa),
      esperado: `mesa ${objetivo.mesa}`, observado: `mesa ${orden.mesa}` },
    { id: 'producto',       ok: true,
      esperado: objetivo.producto, observado: String(item?.nombre ?? item?.name) },
    { id: 'modificador',    ok: mods.length > 0 && textoMods.toUpperCase().includes(objetivo.opcion.toUpperCase()),
      esperado: objetivo.opcion, observado: textoMods || '(sin modificadores)' },
    { id: 'estado',         ok: ['abierta', 'enviada', 'en_preparacion'].includes(String(orden.status)),
      esperado: 'abierta | enviada | en_preparacion', observado: String(orden.status) },
    { id: 'turno-enlazado', ok: !!orden.turno_id,
      esperado: 'turno_id presente', observado: orden.turno_id ?? '(nulo)' },
  ]
  const todo = comprobaciones.every(c => c.ok)
  return {
    clase: todo ? 'EXPECTED_BEHAVIOR' : 'PRODUCT_DEFECT', ok: todo,
    motivo: todo ? null : comprobaciones.filter(c => !c.ok).map(c => `${c.id}: esperaba «${c.esperado}», vio «${c.observado}»`).join('; '),
    detalle: {
      comprobaciones, order_id: orden.id, turno_id: orden.turno_id, mesa: orden.mesa,
      // Se DECLARA la ausencia en vez de callarla. `save_operation_id` no es
      // columna de pos_orders; correlacionarlo exigiría otra fuente, y hoy
      // `pos_save_operations` devuelve 400 por el proxy (investigación aparte,
      // POS_SAVE_OPERATIONS_PROXY_400). Ni se infiere ni se fabrica.
      save_operation_id_observation: 'NOT_EXPOSED_BY_CURRENT_ORACLE',
    },
    correlacion: { order_id: orden.id, save_operation_id: null, turno_id: orden.turno_id },
    orden,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · PEDRO ORACLE — ¿el puente recibió y procesó el evento?
   ───────────────────────────────────────────────────────────────────────────
   El ancla es `last_sequence`, que es monotónica: si el journey mandó un evento
   y la secuencia no se movió, nadie lo procesó.
   ───────────────────────────────────────────────────────────────────────────
   LÍMITE CONOCIDO, DECLARADO A PROPÓSITO: `/events` y `/status` exigen la
   credencial de la red local (HTTP 401 sin ella). Este oráculo NO la maneja
   —una credencial de LAN no entra a un arnés de certificación—, así que
   correlaciona por secuencia, no por el contenido del evento. Cuando la
   secuencia no alcanza para decidir, devuelve NOT_OBSERVED en vez de suponer.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function pedroOracle({ bridge, seqInicial, tenantEsperado }) {
  let salud
  try {
    const r = await fetch(`${bridge}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    salud = r.ok ? await r.json().catch(() => null) : null
    if (!salud) return ciego(`Pedro /health no respondió con JSON (HTTP ${r.status})`)
  } catch (e) {
    return ciego(`Pedro no respondió: ${e.name === 'TimeoutError' ? 'timeout' : e.message}`)
  }

  // La regla del blanco: un puente de otro tenant no acredita nada de este.
  const suyo = String(salud.restaurant_id ?? '').toLowerCase()
  if (suyo !== String(tenantEsperado).toLowerCase()) {
    return ciego(`el puente pertenece a «${suyo || 'sin declarar'}», no a «${tenantEsperado}»: `
      + 'no puede atestiguar por este journey')
  }

  const seqFinal = salud.last_sequence ?? salud.seq ?? null
  if (seqFinal === null) return ciego('Pedro no expone last_sequence')
  if (seqInicial === null || seqInicial === undefined) return ciego('no se ancló la secuencia inicial')

  const avanzo = Number(seqFinal) > Number(seqInicial)
  return {
    clase: avanzo ? 'EXPECTED_BEHAVIOR' : 'PRODUCT_DEFECT', ok: avanzo,
    motivo: avanzo ? null : `la secuencia no avanzó (${seqInicial} → ${seqFinal}): el evento no se procesó`,
    detalle: { seq_inicial: seqInicial, seq_final: seqFinal, avance: Number(seqFinal) - Number(seqInicial),
               cola_pendiente: salud.sync_queue_size ?? null, server_id: salud.server_id ?? null },
    correlacion: { pedro_seq_final: seqFinal },
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · KDS ORACLE — ¿el item quedó ruteado a cocina y visible?
   ───────────────────────────────────────────────────────────────────────────
   El ruteo no es una opinión del arnés: es `items[].station`, el mismo campo
   que el KDS lee para decidir en qué tablero aparece. Se comprueba sobre la
   orden que el DB oracle ya identificó, para que los dos hablen de la misma.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function kdsOracle({ orden, objetivo, estacionEsperada = 'cocina' }) {
  if (!orden) return ciego('sin orden identificada por el DB oracle: no hay qué mirar')

  const items = Array.isArray(orden.items) ? orden.items : []
  const item = items.find(it => String(it?.nombre ?? it?.name ?? '').toUpperCase().includes(objetivo.producto.toUpperCase()))
  if (!item) return ciego(`la orden ${orden.id} no contiene «${objetivo.producto}»`)

  const estacion = item.station ?? item.estacion ?? null
  if (estacion === null) {
    return { clase: 'PRODUCT_DEFECT', ok: false,
      motivo: 'el item no trae estación: el KDS no puede rutearlo a ningún tablero',
      detalle: { order_id: orden.id, item: item.nombre ?? item.name } }
  }

  // ¿Quedó constancia de que se ENVIÓ, no sólo de que se agregó? `comanda_batches`
  // es lo que el POS escribe al mandar a cocina.
  const lotes = Array.isArray(orden.comanda_batches) ? orden.comanda_batches : []
  const comprobaciones = [
    { id: 'estacion',  ok: String(estacion) === estacionEsperada,
      esperado: estacionEsperada, observado: String(estacion) },
    { id: 'enviado',   ok: ['enviada', 'en_preparacion'].includes(String(orden.status)) || lotes.length > 0,
      esperado: 'status enviada/en_preparacion o comanda_batches no vacío',
      observado: `status=${orden.status} lotes=${lotes.length}` },
  ]
  const todo = comprobaciones.every(c => c.ok)
  return {
    clase: todo ? 'EXPECTED_BEHAVIOR' : 'PRODUCT_DEFECT', ok: todo,
    motivo: todo ? null : comprobaciones.filter(c => !c.ok).map(c => `${c.id}: esperaba «${c.esperado}», vio «${c.observado}»`).join('; '),
    detalle: { comprobaciones, order_id: orden.id, estacion, lotes: lotes.length },
  }
}
