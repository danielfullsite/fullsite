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
//
// ── T-09: "PARA SIEMPRE" ERA EL PROBLEMA ────────────────────────────────────
//
// Reconectaba para siempre A LA MISMA URL, la que `index.js` construye una vez
// desde `config.pos_server_ip`. Cuando el router renueva la concesión DHCP y la
// caja amanece en otra IP, esta terminal golpea una dirección muerta cada diez
// segundos hasta que alguien la reinstala. La operación local aguanta —el enlace
// es aditivo— pero las terminales dejan de verse entre ellas, que es justo el
// síntoma de campo del 2026-09-02.
//
// Ahora, tras `INTENTOS_ANTES_DE_BUSCAR` fracasos SEGUIDOS, se le pide a quien
// llama que vuelva a resolver la dirección (`resolverCaja`). Si aparece otra, se
// cambia y se reinicia la cuenta. Si no aparece, se sigue reintentando donde
// estaba: la regla 2 manda, y no encontrar la caja nunca puede volverse un error.

const RECONEXION_MS = [500, 1000, 2000, 5000, 10000]

/**
 * Cuántos fracasos SEGUIDOS antes de sospechar de la dirección.
 *
 * Con la escalera de arriba, cinco intentos son ~18 s: bastante para descartar un
 * parpadeo del AP o un reinicio de la caja, y poco para que un cambio de IP se
 * note dentro del minuto que pide la matriz. Buscar antes desperdicia sondas en
 * la red del restaurante cada vez que alguien tropieza con un cable.
 */
const INTENTOS_ANTES_DE_BUSCAR = 5
const { PROTOCOL_VERSION } = require('../protocol')
const { cabecerasDeCredencial } = require('./credencial-lan')

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
function conectarConLaCaja({ cajaUrl, serverId, restaurantId, lanSecret, branchId, alRecibirEvento, alRecibirEstado, leerCursor, guardarCursor, wsInyectado, resolverCaja, alCambiarDeCaja, intentosAntesDeBuscar }) {
  // Con la escalera real, cinco intentos son ~18 s (500+1000+2000+5000+10000).
  // Una prueba que quiera ver la mudanza sin esperar 19 segundos baja el umbral;
  // esperar de verdad haría una prueba lenta y, con el jitter, intermitente.
  // Misma convención que `wsInyectado`, que ya existía para eso.
  const umbralDeBusqueda = Number.isInteger(intentosAntesDeBuscar) && intentosAntesDeBuscar >= 0
    ? intentosAntesDeBuscar
    : INTENTOS_ANTES_DE_BUSCAR
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
  //
  // EL CURSOR ES UN NÚMERO DENTRO DE LA HISTORIA DE **UNA** CAJA. Sin atarlo a
  // cuál, reinstalar la Caja (o cambiarla de máquina, o borrarle su carpeta)
  // deja su historia arrancando otra vez desde cero: esta terminal pedía "dame
  // desde 500", la Caja nueva iba en 3, y todo lo vivo se descartaba por
  // `seq <= cursor` hasta que la Caja rebasara los 500. El mapa de mesas
  // sobrevivía porque va por HTTP; los tableros de esta terminal se quedaban
  // ciegos. El sobre ya traía `server_id` (protocol.js:71); sólo faltaba mirarlo.
  const guardadoInicial = (() => {
    try { return typeof leerCursor === 'function' ? leerCursor() : null } catch { return null }
  })()
  // Formato anterior: sólo el número. Se acepta, y la identidad se aprende en el
  // primer SNAPSHOT.
  // OJO con el "no hay cursor": tiene que quedar en -1, no en 0. Con 0 el hub sí
  // manda catch-up (ws-hub.js: `lastClientSeq >= 0 ? readAfter(...) : []`) y la
  // terminal reprocesa el historial entero en cada arranque. `Number(null)` es 0,
  // así que aquí sólo se acepta un número de verdad.
  const normalizar = g => (g !== null && typeof g === 'object')
    ? { cursor: Number(g.cursor), cajaId: typeof g.cajaId === 'string' ? g.cajaId : null }
    : { cursor: typeof g === 'number' ? g : NaN, cajaId: null }
  let { cursor, cajaId } = normalizar(guardadoInicial)
  if (!Number.isInteger(cursor) || cursor < 0) cursor = -1
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
  const aUrlDeHub = (u) => (/\/ws$/.test(u) ? u : `${String(u).replace(/\/$/, '')}/ws`)
  // `let`, no `const`: la dirección de la caja puede cambiar bajo los pies (T-09).
  let urlDelHub = aUrlDeHub(cajaUrl)
  let buscando = false
  let cambiosDeDireccion = 0

  const abrir = () => {
    if (!vivo) return
    try {
      socket = new WS(urlDelHub, { headers: cabecerasDeCredencial({ secreto: lanSecret, restaurantId, terminalId: serverId, branchId }) })
    } catch (e) {
      return reintentar(e.message)
    }

    socket.on('open', () => {
      // Conectar TCP no significa estar autenticado: esperar SNAPSHOT.
      //
      // Por eso `intento` YA NO se reinicia aqui. Lo hacia, y tenia dos costos:
      //
      //   1. Un servidor que ESCUCHA pero rechaza —credencial LAN equivocada, o
      //      un Pedro de otro restaurante en la misma IP— abria el socket, moria
      //      sin SNAPSHOT, y la cuenta volvia a cero: ciclo cerrado a 500 ms para
      //      siempre, sin escalera de espera y sin llegar nunca al umbral de
      //      busqueda. Un servidor equivocado se veia igual que uno bueno.
      //   2. "Cinco fracasos seguidos" no significaba nada si abrir el TCP ya
      //      contaba como exito.
      //
      // Se reinicia en SNAPSHOT, que es donde el resto del archivo ya define
      // "conectado" (`abierto = true`).
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
        abierto = true
        // AQUI se reinicia la cuenta, no en 'open': esto es una conexion de verdad,
        // autenticada y con estado. Ver el comentario largo en `socket.on('open')`.
        intento = 0
        // ¿Seguimos hablando con la misma historia? Dos señales independientes:
        // la identidad de la Caja cambió, o su última secuencia es MENOR que
        // nuestro cursor, cosa que sólo puede pasar si su log volvió a empezar.
        // En ambos casos el cursor guardado ya no significa nada: el estado que
        // viene en este mismo SNAPSHOT es la nueva línea base.
        const cajaDelSobre = typeof msg.server_id === 'string' && msg.server_id ? msg.server_id : null
        const cambioDeCaja = cajaId !== null && cajaDelSobre !== null && cajaDelSobre !== cajaId
        // UNA SECUENCIA MENOR NO PRUEBA QUE LA CAJA SE REINSTALÓ. Si es la MISMA
        // caja (mismo server_id), un número más bajo sólo significa que algo se
        // adelantó por la red — pasaba con un DELTA emitido mientras el hub
        // armaba este SNAPSHOT (ws-hub.js). Interpretarlo como «historia nueva»
        // ponía el cursor en -1 y re-aplicaba todo el catch-up: cada comanda dos
        // veces. La identidad manda; el número sólo cuenta si no la tenemos.
        const mismaCaja = cajaId !== null && cajaDelSobre !== null && cajaDelSobre === cajaId
        const secuenciaRetrocedio = !mismaCaja && typeof msg.sequence === 'number' && msg.sequence < cursor
        if (cambioDeCaja || secuenciaRetrocedio) {
          console.warn(`${LOG} la caja reinició su historia (${cambioDeCaja ? 'otra instalación' : `secuencia ${msg.sequence} < cursor ${cursor}`}); se reinicia el cursor`)
          cursor = -1
        }
        if (cajaDelSobre) cajaId = cajaDelSobre
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
    // Una foto de la nube (core/foto-de-nube.js) no esta en el log de la caja: no
    // tiene secuencia propia y el sobre trae la ultima secuencia GUARDADA, que
    // puede ser <= cursor. Deduplicarla por ese numero la descartaria siempre que
    // no hubiera eventos nuevos, que es justo cuando mas llega. Se aplica sin
    // tocar el cursor: la siguiente foto la reemplaza entera.
    if (ev?.transient === true) { entregar(ev); return }
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
    // Se guarda junto a la identidad de la Caja: un número suelto no dice de
    // qué historia es, que fue justo el defecto.
    try { guardarCursor?.(seq, cajaId) } catch (e) { console.warn(`${LOG} no se pudo guardar el cursor:`, e.message) }
  }

  const entregar = (ev) => {
    eventosRecibidos++
    try { alRecibirEvento(ev) } catch (e) {
      // Un consumidor que truena no puede tumbar el enlace ni detener el resto
      // del catch-up.
      console.warn(`${LOG} el consumidor fallo:`, e.message)
    }
  }

  /**
   * ¿Seguirá la caja donde creemos? Se pregunta SÓLO tras varios fracasos seguidos.
   *
   * No bloquea ni se encadena con el reintento: se dispara aparte y, si encuentra
   * otra dirección, la deja puesta para el siguiente intento. Si no encuentra
   * nada, todo sigue igual — no encontrar la caja no es un error, es el martes.
   */
  const quizaSeMovio = () => {
    if (buscando || typeof resolverCaja !== 'function') return
    buscando = true
    Promise.resolve()
      .then(() => resolverCaja({ urlActual: urlDelHub, intentos: intento }))
      .then((nueva) => {
        if (!vivo || !nueva) return
        const destino = aUrlDeHub(nueva)
        if (destino === urlDelHub) return   // la misma: no es un cambio de IP
        console.warn(`${LOG} la caja se movio: ${urlDelHub} -> ${destino}`)
        urlDelHub = destino
        cambiosDeDireccion++
        // La cuenta se reinicia: la escalera de espera vuelve a 500 ms y la nueva
        // dirección estrena sus propios cinco intentos antes de volver a dudar.
        intento = 0
        if (typeof alCambiarDeCaja === 'function') {
          try { alCambiarDeCaja(destino) } catch (e) { console.warn(`${LOG} alCambiarDeCaja fallo:`, e.message) }
        }
        // Se adelanta el reintento pendiente: esperar los 10 s de la escalera
        // vieja para estrenar una dirección que ya sabemos buena es tiempo regalado.
        if (temporizador) { clearTimeout(temporizador); temporizador = null; abrir() }
      })
      .catch((e) => { console.warn(`${LOG} la busqueda fallo:`, e && e.message) })
      .finally(() => { buscando = false })
  }

  const reintentar = (motivo) => {
    if (!vivo) return
    if (temporizador) return   // ya hay un reintento en vuelo: 'close' y 'error'
                               // llegan juntos y agendarian dos.
    // Tras varios fracasos SEGUIDOS, la dirección es sospechosa. Va antes de
    // agendar para que la búsqueda corra durante la espera, no después.
    if (intento >= umbralDeBusqueda) quizaSeMovio()
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
      // T-09. Sin esto, "la caja se movio y la encontramos sola" es invisible: se
      // ve igual que si nunca hubiera pasado nada. En el restaurante, `/health`
      // es lo unico que se puede mirar sin ir a la maquina.
      cambios_de_direccion: cambiosDeDireccion,
      buscando_caja: buscando,
    }),
  }
}

module.exports = { conectarConLaCaja, RECONEXION_MS, INTENTOS_ANTES_DE_BUSCAR }
