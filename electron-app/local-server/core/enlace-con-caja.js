'use strict'
// El canal ASCENDENTE: un Pedro secundario escuchando a la caja.
//
// ── EL HUECO QUE CIERRA ──────────────────────────────────────────────────────
//
// Campo, 2026-09-02 (Eduardo Esquivel, AMALAY, tres cajas, WAN caído):
//   «no hay comunicación correcta entre los puntos de venta, no muestran lo mismo»
//
// El reenvío HTTP ya llevaba las escrituras de una terminal secundaria a la caja.
// Pero NADA regresaba. Los tableros (cocina, barra, plano) se conectan por
// WebSocket a SU Pedro local, y ese Pedro no tenía forma de enterarse de lo que
// pasaba en otra terminal. Una comanda enviada desde POS 3 no llegaba nunca a las
// pantallas de POS 2: no tarde, nunca.
//
// ── POR QUÉ ES TAN POCO CÓDIGO ───────────────────────────────────────────────
//
// Porque el protocolo ya servía. `SUBSCRIBE` acepta `last_sequence` y el hub
// contesta `SNAPSHOT` con `{state, deltas}` — o sea, el catch-up ya estaba
// construido del lado del servidor (ws-hub.js:88-95). Lo que faltaba era que
// alguien se conectara. Esto es ese alguien.
//
// ── LAS DOS REGLAS QUE NO SE PUEDEN ROMPER ───────────────────────────────────
//
// 1. NO DUPLICAR. El cursor es la única defensa: un evento con secuencia <= la
//    última vista se descarta. Sin esto, cada reconexión reproduce el día entero
//    y la cocina ve la misma comanda cinco veces.
//
// 2. NO BLOQUEAR. Si la caja no está, el secundario sigue operando con lo suyo.
//    Este enlace es aditivo: su caída degrada la vista compartida, no la
//    operación local. Reconecta solo, con espera creciente, para siempre.

const RECONEXION_MS = [500, 1000, 2000, 5000, 10000]
const { PROTOCOL_VERSION } = require('../protocol')

const LOG = '[enlace-caja]'

/**
 * @param {object} opts
 * @param {string} opts.cajaUrl        ws://ip:puerto de la caja
 * @param {string} opts.serverId       identidad de ESTA terminal
 * @param {string} opts.restaurantId
 * @param {(ev:object)=>void} opts.alRecibirEvento  qué hacer con cada evento nuevo
 * @param {(estado:object)=>void} [opts.alRecibirEstado] el salón completo, al (re)conectar
 * @param {() => number} [opts.leerCursor]      cursor guardado del arranque anterior
 * @param {(n:number) => void} [opts.guardarCursor] persistir el cursor al avanzar
 * @param {object} [opts.wsInyectado]  sólo para pruebas
 */
function conectarConLaCaja({ cajaUrl, serverId, restaurantId, alRecibirEvento, alRecibirEstado, leerCursor, guardarCursor, wsInyectado }) {
  let WS
  try {
    WS = wsInyectado || require('ws')
  } catch (e) {
    // Sin `ws` no hay enlace, y el POS local debe seguir funcionando igual.
    console.warn(`${LOG} sin modulo ws: ${e.message}`)
    return { detener: () => {}, cursor: () => -1, conectado: () => false }
  }

  // -1 y no 0: `0` es una secuencia válida, y arrancar en 0 se saltaría el primer
  // evento del historial. `-1` significa "no he visto nada".
  //
  // EL CURSOR TIENE QUE SOBREVIVIR AL REINICIO. Si vive sólo en memoria, una
  // terminal que se reinicia vuelve con -1, y el hub NO le manda catch-up
  // (ws-hub.js:88: `lastClientSeq >= 0 ? readAfter(...) : []`): se pierde
  // silenciosamente todo lo que pasó mientras estuvo apagada. Es exactamente el
  // escenario "POS 3 apagado durante el servicio".
  //
  // Quién lo guarda es decisión de quien llama — este módulo no toca disco.
  let cursor = (() => {
    try {
      const guardado = typeof leerCursor === 'function' ? Number(leerCursor()) : NaN
      return Number.isInteger(guardado) && guardado >= 0 ? guardado : -1
    } catch { return -1 }
  })()
  let socket = null
  let intento = 0
  let vivo = true
  let abierto = false
  let temporizador = null
  let ultimoMotivo = null
  let conectadoDesde = null
  let eventosRecibidos = 0

  // El hub escucha SOLO en /ws (ws-hub.js:35: `if (req.url === '/ws')`, si no
  // `socket.destroy()`). Conectarse a la raiz da "socket hang up" sin ningun
  // mensaje util — costo una corrida entera de la E2E. Se normaliza aqui para que
  // quien llame pueda pasar la URL base de la caja, como en el resto del codigo.
  const urlDelHub = /\/ws$/.test(cajaUrl) ? cajaUrl : `${cajaUrl.replace(/\/$/, '')}/ws`

  const abrir = () => {
    if (!vivo) return
    try {
      socket = new WS(urlDelHub)
    } catch (e) {
      return reintentar(e.message)
    }

    socket.on('open', () => {
      abierto = true
      intento = 0
      ultimoMotivo = null
      conectadoDesde = Date.now()
      // Se manda el cursor: la caja contesta con lo que falta desde ahí. Es el
      // catch-up de la terminal que estuvo apagada.
      socket.send(JSON.stringify({
        // OBLIGATORIO. `parseClientMessage` (protocol.js:73) descarta cualquier
        // mensaje sin `protocol_version` devolviendo null — SIN error, sin cerrar
        // el socket y sin log. El cliente queda conectado y mudo para siempre.
        // Costó dos corridas de la E2E: `clientCount()` daba 0 con el socket
        // abierto.
        protocol_version: PROTOCOL_VERSION,
        type: 'SUBSCRIBE',
        client_id: serverId,
        client_type: 'pedro-secundario',
        restaurant_id: restaurantId,
        last_sequence: cursor,
      }))
      console.log(`${LOG} conectado a ${urlDelHub}, desde secuencia ${cursor}`)
    })

    socket.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }

      // SNAPSHOT trae el estado y los deltas que faltaban tras reconectar.
      if (msg.type === 'SNAPSHOT') {
        // EL ESTADO COMPLETO, PRIMERO. Se ignoraba, y era un P0: una terminal
        // secundaria no escribe en su propio log los eventos que vienen de la
        // caja, asi que al REINICIAR su estado queda sin las ordenes de las demas.
        // Con el cursor persistido pedia "dame desde N", la caja contestaba "nada
        // nuevo" con razon, y el salon se quedaba vacio PARA SIEMPRE.
        // El hub siempre lo mando (ws-hub.js:99-102); nadie lo recogia.
        if (msg.payload?.state && typeof alRecibirEstado === 'function') {
          try { alRecibirEstado(msg.payload.state) }
          catch (e) { console.warn(`${LOG} no se pudo hidratar el estado:`, e.message) }
        }
        const deltas = Array.isArray(msg.payload?.deltas) ? msg.payload.deltas : []
        for (const ev of deltas) aplicar(ev)
        // La secuencia del sobre manda: si no venían deltas (primera conexión sin
        // cursor), igual hay que quedar al día para no pedir el historial otra vez.
        if (typeof msg.sequence === 'number' && msg.sequence > cursor) avanzarCursor(msg.sequence)
        return
      }

      if (msg.type === 'DELTA') {
        const ev = msg.payload?.event
        if (ev) aplicar(ev, msg.sequence)
      }
    })

    socket.on('close', () => { abierto = false; reintentar('cerrado') })
    socket.on('error', (e) => { abierto = false; reintentar(e?.message || 'error') })
  }

  /**
   * Aplica un evento UNA vez. El cursor es lo que impide que una reconexión
   * reproduzca lo ya visto.
   */
  const aplicar = (ev, seqDelSobre) => {
    const seq = typeof ev?.sequence === 'number' ? ev.sequence
      : (typeof seqDelSobre === 'number' ? seqDelSobre : null)

    // Sin secuencia no se puede deduplicar. Se aplica igual —perder una comanda
    // es peor que repetirla— pero no se mueve el cursor, que quedaría mintiendo.
    if (seq === null) { entregar(ev); return }

    if (seq <= cursor) return   // ya lo vimos
    avanzarCursor(seq)
    entregar(ev)
  }

  const avanzarCursor = (seq) => {
    cursor = seq
    // Se persiste ANTES de entregar: si el consumidor truena, el cursor ya avanzó
    // y no se reprocesa. Perder un evento en un consumidor roto es preferible a
    // reproducir el día entero en cada arranque.
    try { guardarCursor?.(seq) } catch (e) { console.warn(`${LOG} no se pudo guardar el cursor:`, e.message) }
  }

  const entregar = (ev) => {
    eventosRecibidos++
    try { alRecibirEvento(ev) } catch (e) {
      // Un consumidor que truena no puede tumbar el enlace ni detener el resto
      // del catch-up.
      console.warn(`${LOG} el consumidor fallo:`, e.message)
    }
  }

  const reintentar = (motivo) => {
    if (!vivo) return
    if (temporizador) return   // ya hay un reintento en vuelo: 'close' y 'error'
                               // llegan juntos y agendarian dos.
    const base = RECONEXION_MS[Math.min(intento, RECONEXION_MS.length - 1)]
    // JITTER. Sin el, las tres terminales de un restaurante se caen juntas cuando
    // se reinicia la caja y vuelven a golpearla EXACTAMENTE al mismo milisegundo,
    // una y otra vez. +-25% las separa.
    const espera = Math.round(base * (0.75 + Math.random() * 0.5))
    intento++
    ultimoMotivo = motivo
    console.warn(`${LOG} sin caja (${motivo}) — reintento ${intento} en ${espera}ms`)
    temporizador = setTimeout(() => { temporizador = null; abrir() }, espera)
  }

  abrir()

  return {
    /** Cierre limpio: corta el reintento agendado ANTES de cerrar el socket, si no
     *  el 'close' agenda otro y el proceso no termina nunca. */
    detener: () => {
      vivo = false
      if (temporizador) { clearTimeout(temporizador); temporizador = null }
      try { socket?.close() } catch {}
      abierto = false
    },
    cursor: () => cursor,
    conectado: () => abierto,
    /** Estado observable, para /health y para diagnosticar en el restaurante. */
    estado: () => ({
      conectado: abierto,
      caja: urlDelHub,
      cursor,
      eventos_recibidos: eventosRecibidos,
      reintentos: intento,
      ultimo_motivo: ultimoMotivo,
      conectado_desde: conectadoDesde,
    }),
  }
}

module.exports = { conectarConLaCaja, RECONEXION_MS }
