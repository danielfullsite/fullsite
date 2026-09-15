// EL MANIFIESTO DE EFECTOS — qué tocó el POS al hacer algo.
//
// La paridad entre dos interfaces NO se mide comparando pantallas. Se mide en la
// frontera donde el POS toca el mundo: lo que escribe, lo que encola, lo que
// imprime, lo que le dice a cocina. Dos interfaces pueden verse distintas y ser
// idénticas; y —el caso peligroso— pueden verse idénticas y escribir distinto.
//
// Diez categorías, que son las diez maneras que tiene el POS de dejar huella:
//
//   1. order_state      el estado de la orden tras la acción
//   2. table_state      el estado de la mesa
//   3. api_writes       POST/PATCH/DELETE hacia /api/**
//   4. local_db_writes  IndexedDB (la cola durable y el caché de órdenes)
//   5. sync_queue       lo que quedó encolado para subir
//   6. pedro_events     lo que se le dijo al servidor local
//   7. kds_events       las comandas, por estación
//   8. audit_events     logAudit
//   9. print_jobs       trabajos de impresión
//  10. cash_drawer      intenciones de abrir el cajón
//
// ── LOS DOS MODOS ───────────────────────────────────────────────────────────
//
//   CAPTURE_ONLY  las escrituras se interceptan y NO salen. El sistema queda
//                 donde estaba. Prueba que la INTENCIÓN es idéntica. Se puede
//                 correr mil veces sin escribir un peso.
//
//   SANDBOX       las escrituras salen contra una base desechable. Prueba que
//                 el RESULTADO es idéntico. Cuesta más y da derecho a cerrar
//                 una fase.
//
// Este archivo implementa la captura y la comparación. El modo SANDBOX usa el
// mismo manifiesto sin interceptar.

export const CATEGORIAS = Object.freeze([
  'order_state', 'table_state', 'api_writes', 'local_db_writes', 'sync_queue',
  'pedro_events', 'kds_events', 'audit_events', 'print_jobs', 'cash_drawer',
])

export const vacio = () => Object.fromEntries(CATEGORIAS.map(c => [c, []]))

/* ═══════════════════════════════════════════════════════════════════════════
   NORMALIZACIÓN
   ───────────────────────────────────────────────────────────────────────────
   Dos corridas del mismo guion producen identificadores y relojes distintos.
   Compararlos crudos da diferencias en todo; normalizarlos de más esconde
   defectos reales. La línea entre las dos cosas es lo que decide si el arnés
   sirve.

   REGLA: se normaliza lo que es ACCIDENTAL (un uuid, un milisegundo) y jamás lo
   que es SUSTANCIAL (un importe, un estado, un método, una cantidad).

   Y un detalle que parece menor y no lo es: los identificadores se sustituyen
   por un ordinal ESTABLE que PRESERVA la repetición. Si V2 genera dos opId
   donde V1 generaba uno, ése es exactamente el defecto que se busca —cobro
   duplicado— y una normalización ingenua («todo opId vale OP») lo borraría.
   ═══════════════════════════════════════════════════════════════════════════ */

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const ISO  = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g
const OPID = /\bop_[a-z0-9]{6,}\b/gi
const IDGEN = /\b[a-z0-9]{10,14}\b/g          // los ids que genera generateId()

/** Sustituye por ordinales estables, recordando lo ya visto. */
function ordinalizador(prefijo) {
  const vistos = new Map()
  return (valor) => {
    if (!vistos.has(valor)) vistos.set(valor, `${prefijo}_${vistos.size + 1}`)
    return vistos.get(valor)
  }
}

/** Campos cuyo valor NUNCA se toca: son la sustancia de la comparación. */
const SUSTANCIALES = new Set([
  'subtotal', 'descuento', 'iva', 'total', 'propina', 'monto', 'importe', 'cambio',
  'status', 'payment_status', 'metodo_pago', 'metodo', 'mesa', 'personas',
  'cantidad', 'qty', 'q', 'estacion', 'station', 'action', 'method', 'table',
  'endpoint', 'transport', 'nombre', 'name', 'precio', 'price',
])

export function normalizar(manifiesto) {
  const id = ordinalizador('ID')
  const op = ordinalizador('OP')
  let t0 = null

  const tiempoRelativo = (iso) => {
    const t = Date.parse(iso)
    if (Number.isNaN(t)) return iso
    if (t0 === null) t0 = t
    return `T+${Math.round((t - t0) / 1000)}s`
  }

  const limpiarTexto = (s) => String(s)
    .replace(OPID, m => op(m))
    .replace(UUID, m => id(m))
    .replace(ISO, m => tiempoRelativo(m))
    .replace(IDGEN, m => id(m))

  const caminar = (valor, clave = null) => {
    if (valor === null || valor === undefined) return valor
    if (Array.isArray(valor)) return valor.map(v => caminar(v))
    if (typeof valor === 'object') {
      const salida = {}
      for (const k of Object.keys(valor).sort()) salida[k] = caminar(valor[k], k)
      return salida
    }
    // Un número o booleano sustancial se deja tal cual, siempre.
    if (typeof valor !== 'string') return valor
    if (clave && SUSTANCIALES.has(clave)) return valor
    return limpiarTexto(valor)
  }

  return Object.fromEntries(CATEGORIAS.map(c => [c, caminar(manifiesto[c] ?? [])]))
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPARACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

/** Diferencias entre dos manifiestos ya normalizados, por categoría. */
export function comparar(a, b) {
  const diffs = []
  for (const cat of CATEGORIAS) {
    const ja = JSON.stringify(a[cat] ?? [], null, 1)
    const jb = JSON.stringify(b[cat] ?? [], null, 1)
    if (ja === jb) continue
    const na = (a[cat] ?? []).length, nb = (b[cat] ?? []).length
    diffs.push({
      categoria: cat,
      motivo: na !== nb ? `distinta cantidad de efectos: ${na} vs ${nb}` : 'mismo número de efectos, contenido distinto',
      a: ja.length > 700 ? ja.slice(0, 700) + '…' : ja,
      b: jb.length > 700 ? jb.slice(0, 700) + '…' : jb,
    })
  }
  return diffs
}

/* ═══════════════════════════════════════════════════════════════════════════
   LAS MUTACIONES DELIBERADAS
   ───────────────────────────────────────────────────────────────────────────
   Un arnés que nunca encontró una diferencia no sirve de nada: no se distingue
   de uno roto que siempre dice «cero». Antes de creerle un «cero diferencias»
   hay que verlo delatar diferencias que sabemos que existen.

   Cada mutación imita un defecto REAL y plausible de una reimplementación:
   mandar de más a cocina, olvidar la auditoría, enrutar a la estación
   equivocada, no encolar sin red, y duplicar el identificador de operación
   —que es el que evita el cobro doble—.
   ═══════════════════════════════════════════════════════════════════════════ */

export const MUTACIONES = [
  {
    id: 'M1',
    nombre: 'el envío manda 2 donde V1 mandaba 1',
    porQue: 'una reimplementación que reenvía la partida completa en vez de la diferencia',
    // Vigila el PAYLOAD REAL de /api/pos/save-order, que es el que persiste y
    // acaba alimentando al KDS. Antes miraba `kds_events`, que en la topología
    // de G01 está vacío: el POS escribe a la nube y Pedro sincroniza, no hay
    // POST directo al puente. La mutación quedaba «no aplicable» sobre un
    // journey que sí produce el dato.
    esperada: ['api_writes'],
    aplicar(m) {
      const c = structuredClone(m)
      const w = (c.api_writes || []).find(e => Array.isArray(e.items) && e.items.length)
      if (!w) return null
      w.items[0].q = (Number(w.items[0].q) || 1) + 1
      return c
    },
  },
  {
    id: 'M2',
    nombre: 'se pierde el modificador obligatorio al enviar',
    porQue: 'es el control que G01 existe para ejercitar: un rediseño que arma el '
          + 'payload sin los modificadores manda a cocina un platillo sin su opción, '
          + 'y nadie lo nota hasta que sale mal el plato',
    esperada: ['api_writes'],
    aplicar(m) {
      const c = structuredClone(m)
      const w = (c.api_writes || []).find(e => Array.isArray(e.items)
        && e.items.some(it => Array.isArray(it.mods) && it.mods.length))
      if (!w) return null
      const it = w.items.find(x => Array.isArray(x.mods) && x.mods.length)
      it.mods = []
      return c
    },
  },
  {
    id: 'M3',
    nombre: 'el renglón se rutea a la estación equivocada',
    porQue: 'el ruteo por estación se recalcula mal y la comida sale en barra',
    // `items[].station` viaja en el payload que persiste y es el campo que el
    // KDS lee para decidir tablero: corromperlo ahí es corromper el ruteo real.
    esperada: ['api_writes'],
    aplicar(m) {
      const c = structuredClone(m)
      const w = (c.api_writes || []).find(e => Array.isArray(e.items)
        && e.items.some(it => it.station))
      if (!w) return null
      const it = w.items.find(x => x.station)
      it.station = it.station === 'barra' ? 'cocina' : 'barra'
      return c
    },
  },
  {
    id: 'M4',
    nombre: 'no se encola nada cuando no hay red',
    porQue: 'el peor defecto posible: la orden se pierde en silencio',
    esperada: ['sync_queue', 'local_db_writes'],
    aplicar(m) {
      const c = structuredClone(m)
      if (!c.sync_queue.length && !c.local_db_writes.length) return null
      c.sync_queue = []
      c.local_db_writes = []
      return c
    },
  },
  {
    id: 'M5',
    nombre: 'se generan DOS opId donde V1 generaba uno',
    porQue: 'rompe la idempotencia: el servidor aplica el mismo cobro dos veces',
    esperada: ['api_writes', 'sync_queue'],
    aplicar(m) {
      const c = structuredClone(m)
      const fuente = c.api_writes.length ? 'api_writes' : 'sync_queue'
      if (!c[fuente].length) return null
      c[fuente].push(structuredClone(c[fuente][0]))
      return c
    },
  },
]
