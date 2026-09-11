'use strict'
// ─── La foto de la nube NO es un evento del restaurante ───────────────────────
//
// El poll de Supabase (index.js, startSupabasePoll) construye cada 5 s un
// STATE_SYNC con TODAS las filas de pos_orders del turno y lo escribia con
// `appendInternal` en events.ndjson, con fsync, aunque nada hubiera cambiado.
// Medido el 2026-09-10 (barrido previo al instalador): 315 KB por evento con 150
// filas -> ~220 MB por hora -> 2.6 GB por turno de 12 h. El adaptador ndjson carga
// el log ENTERO en memoria al arrancar (adapters/storage/ndjson.js, `_adopt`) y
// `markSynced` reescribe el archivo completo: tras un dia de servicio Pedro
// tardaba minutos en arrancar o moria por memoria, y la caja amanecia "Sin
// conexion con Caja", sin impresion, sin KDS y sin reenvio para las secundarias.
//
// Una foto de la nube es una OBSERVACION, no un hecho del restaurante: no la
// origino una terminal, no tiene command_id, y la siguiente la reemplaza entera.
// Por eso no va al log durable. Va a la memoria, se transmite a las terminales
// cuando cambia, y se guarda en UN archivo que se reemplaza (`replaceFile`) para
// que un reinicio sin internet arranque con la ultima foto y no con el salon
// vacio.
//
// Las secundarias deduplican por secuencia (enlace-con-caja.js, `aplicar`): un
// evento transitorio no tiene secuencia y NO mueve el cursor. Lleva la marca
// `transient: true` para que el enlace lo aplique sin intentar deduplicarlo.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { EVENT } = require('../protocol')
const { replaceFile } = require('../adapters/storage/durable-file')

const ARCHIVO = 'cloud-snapshot.json'
const VERSION = 1

function rutaDeLaFoto(dataDir) { return path.join(dataDir, ARCHIVO) }

/** Un STATE_SYNC que vive en memoria y en la red, nunca en el log. */
function eventoTransitorio(restaurantId, payload) {
  return {
    id: crypto.randomUUID(),
    type: EVENT.STATE_SYNC,
    ts: Date.now(),
    client_id: 'server',
    restaurant_id: restaurantId,
    payload,
    transient: true,
  }
}

/** Guarda la ultima foto reemplazando el archivo entero (nunca append). */
function guardarFotoDeNube(dataDir, restaurantId, payload) {
  replaceFile(rutaDeLaFoto(dataDir), JSON.stringify({
    version: VERSION, restaurant_id: restaurantId, saved_at: new Date().toISOString(), payload,
  }))
}

/**
 * Lee la foto guardada. Devuelve el payload, o null con el motivo. Una foto
 * corrupta o de otro restaurante NO tumba el arranque: es un cache, no un
 * registro; el siguiente poll la reemplaza.
 */
function leerFotoDeNube(dataDir, restaurantId) {
  const ruta = rutaDeLaFoto(dataDir)
  if (!fs.existsSync(ruta)) return { payload: null, motivo: 'sin foto' }
  let foto
  try { foto = JSON.parse(fs.readFileSync(ruta, 'utf8')) }
  catch (e) { return { payload: null, motivo: `foto ilegible: ${e.message}` } }
  if (!foto || foto.version !== VERSION || !foto.payload || typeof foto.payload !== 'object') return { payload: null, motivo: 'foto de otra version o sin payload' }
  if (foto.restaurant_id !== restaurantId) return { payload: null, motivo: `foto de otro restaurante (${foto.restaurant_id})` }
  return { payload: foto.payload, motivo: null, saved_at: foto.saved_at }
}

/**
 * Aplica una foto nueva: la mete al estado, la transmite a las terminales SOLO
 * si el estado cambio, y la guarda en disco SOLO si la foto cambio. Devuelve la
 * huella de la foto para comparar la siguiente.
 *
 * `huellaAnterior` es lo que devolvio la llamada previa (null la primera vez).
 */
async function aplicarFotoDeNube({ state, wsHub, dataDir, restaurantId, payload, huellaAnterior = null, huellaDe = null }) {
  const evento = eventoTransitorio(restaurantId, payload)
  // `last_supabase_sync` cambia en CADA poll: compararlo hacia que el estado
  // "cambiara" siempre y la caja transmitiera la foto completa (cientos de KB) a
  // todas las terminales cada 5 s aunque nada se hubiera movido.
  const sinReloj = snap => { const { last_supabase_sync: _ls, ...resto } = snap; return JSON.stringify(resto) }
  const antes = sinReloj(state.toSnapshot())
  state.apply(evento)
  const despues = sinReloj(state.toSnapshot())
  const cambioElEstado = antes !== despues
  if (cambioElEstado && wsHub) await wsHub.broadcast(evento)

  // `huellaDe` permite excluir campos que cambian en cada poll (synced_at).
  const huella = typeof huellaDe === 'string' ? huellaDe : JSON.stringify(payload)
  const cambioLaFoto = huella !== huellaAnterior
  let guardada = false
  if (cambioLaFoto && dataDir) {
    try { guardarFotoDeNube(dataDir, restaurantId, payload); guardada = true }
    catch (e) { console.warn('[foto-de-nube] no se pudo guardar la foto:', e.message) }
  }
  return { evento, cambioElEstado, cambioLaFoto, guardada, huella }
}

module.exports = { ARCHIVO, rutaDeLaFoto, eventoTransitorio, guardarFotoDeNube, leerFotoDeNube, aplicarFotoDeNube }
