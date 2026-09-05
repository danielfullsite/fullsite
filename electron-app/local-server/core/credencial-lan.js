'use strict'
// Quién puede hablarle a Pedro dentro del restaurante.
//
// ── EL HUECO ────────────────────────────────────────────────────────────────
//
// Pedro escucha en 0.0.0.0:7717 y hasta ahora las rutas operativas no pedían
// nada. Cualquier equipo en la misma red —el WiFi de invitados, el teléfono de
// un cliente, la laptop de un proveedor— podía leer las órdenes del día, emitir
// un cierre de mesa, mandar a imprimir o abrir el cajón de dinero.
//
// El `restaurant_id` y el `terminal_id` IDENTIFICAN, no demuestran identidad:
// los dos viajan en el propio mensaje y cualquiera los puede escribir.
//
// ── LO QUE ESTO ES, Y LO QUE NO ─────────────────────────────────────────────
//
// ES: un secreto por INSTALACIÓN, generado por la caja en su primer arranque,
// que las terminales presentan en cada petición operativa. Cierra la puerta a
// cualquiera que no tenga el secreto.
//
// NO ES: una credencial por terminal con revocación individual. Para eso hace
// falta un flujo de emparejamiento (la caja muestra un código, la terminal lo
// captura, recibe su propio token firmado) — más seguro y más trabajo. El
// camino queda abierto: `verificarCredencial` recibe el `terminal_id`, así que
// una lista de revocación entra sin cambiar a quien la llama.
//
// La diferencia práctica: hoy, revocar una terminal obliga a rotar el secreto
// en todas. Se dice aquí para que nadie lo descubra el día que haga falta.
//
// ── COMPARACIÓN EN TIEMPO CONSTANTE ─────────────────────────────────────────
//
// Se usa `timingSafeEqual`. Un `===` sobre secretos filtra su contenido por el
// tiempo de respuesta: se puede adivinar carácter por carácter. Es barato
// hacerlo bien y caro descubrirlo tarde.

const crypto = require('crypto')

const CABECERA = 'x-fullsite-lan'
const LOG = '[credencial-lan]'

/** Rutas que exigen credencial. Todo lo que lee o mueve dinero, comida o papel. */
const RUTAS_PROTEGIDAS = ['/state', '/events', '/print', '/drawer', '/ws', '/kds', '/config', '/test']

/**
 * Rutas que NO la exigen, y por qué. La lista es corta a propósito: cada entrada
 * es una puerta que se queda abierta.
 *
 *   /health    diagnóstico. No revela operación y hace falta cuando algo falla,
 *              que es justo cuando la credencial puede ser el problema.
 *   /identity  descubrimiento. Una terminal necesita saber a quién encontró
 *              ANTES de poder autenticarse contra ella.
 * El KDS enrolado carga /kds con cabeceras desde Electron. La página autenticada
 * recibe la credencial para su poll HTTP; nunca se entrega en una página abierta.
 */
const RUTAS_ABIERTAS = ['/health', '/identity']

/** Genera el secreto de una instalación. 32 bytes: no se adivina. */
function generarSecreto() {
  return crypto.randomBytes(32).toString('hex')
}

/** Compara sin filtrar el contenido por el tiempo que tarda. */
function igualesEnTiempoConstante(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8')
  const bb = Buffer.from(String(b || ''), 'utf8')
  // `timingSafeEqual` EXIGE longitudes iguales o lanza. Se comparan los largos
  // aparte: el largo de un secreto no es un dato útil para quien ataca.
  if (ba.length !== bb.length) return false
  try { return crypto.timingSafeEqual(ba, bb) } catch { return false }
}

/**
 * ¿Esta petición puede pasar?
 *
 * @param {object} args
 * @param {string} args.ruta          la ruta SIN query
 * @param {string} args.metodo
 * @param {object} args.cabeceras     req.headers
 * @param {string|null} args.secreto  el de esta instalación; null = sin configurar
 * @param {string} args.restaurantId
 * @returns {{permitido: boolean, motivo?: string, terminalId?: string}}
 */
function verificarCredencial({ ruta, metodo, cabeceras = {}, secreto, restaurantId, branchId }) {
  // OPTIONS es el preflight de CORS: si se rechazara, el navegador nunca llegaría
  // a mandar la petición real con su cabecera.
  if (metodo === 'OPTIONS') return { permitido: true }

  if (metodo === 'GET' && RUTAS_ABIERTAS.includes(ruta)) return { permitido: true }

  // Cualquier ruta nueva queda cerrada también, incluidas /fp/*. Una secundaria
  // aún no emparejada ofrece diagnóstico, nunca operación anónima.
  if (!secreto) return { permitido: false, motivo: 'terminal sin emparejar' }

  const presentado = cabeceras[CABECERA] || cabeceras[CABECERA.toUpperCase()]
  if (!presentado) {
    return { permitido: false, motivo: 'falta la credencial de la red local' }
  }
  if (!igualesEnTiempoConstante(presentado, secreto)) {
    return { permitido: false, motivo: 'credencial invalida' }
  }

  // El tenant se valida DESPUÉS del secreto: quien no tiene la llave no merece
  // saber si acertó el restaurante.
  const tenantPedido = cabeceras['x-fullsite-restaurante']
  if (tenantPedido && restaurantId && tenantPedido !== restaurantId) {
    return { permitido: false, motivo: 'esa peticion es de otro restaurante' }
  }
  const sucursalPedida = cabeceras['x-fullsite-sucursal']
  if (sucursalPedida && (!branchId || sucursalPedida !== branchId)) {
    return { permitido: false, motivo: 'esa peticion es de otra sucursal' }
  }

  return { permitido: true, terminalId: cabeceras['x-fullsite-terminal'] || undefined }
}

/** Lo que una terminal manda en cada petición operativa. */
function cabecerasDeCredencial({ secreto, restaurantId, terminalId, branchId }) {
  if (!secreto) return {}
  const h = { [CABECERA]: secreto }
  if (restaurantId) h['x-fullsite-restaurante'] = restaurantId
  if (terminalId) h['x-fullsite-terminal'] = terminalId
  if (branchId) h['x-fullsite-sucursal'] = branchId
  return h
}

/**
 * NUNCA registrar el secreto ni fragmentos. Sólo informar si está configurado.
 */
function paraLog(secreto) {
  if (!secreto) return '(sin configurar)'
  return '(configurada)'
}

/** La instalación autoriza el transporte; el scope declarado tampoco puede mentir. */
function verificarScope(mensaje, { restaurantId, branchId }) {
  const payload = mensaje?.payload || mensaje || {}
  const scope = payload.scope || mensaje?.scope || {}
  const tenants = [mensaje?.restaurant_id, payload.restaurant_id, scope.clientId, scope.client_id]
  if (tenants.some(id => id !== undefined && id !== restaurantId)) return 'otro restaurante'
  const sucursales = [mensaje?.location_id, payload.location_id, scope.locationId, scope.location_id]
  if (sucursales.some(id => id !== undefined && (!branchId || id !== branchId))) return 'otra sucursal'
  return null
}

/** Resolver antes de crear el router/hub; un error de disco nunca abre la LAN. */
function prepararCredencial({ dataDir, config }) {
  if (config.lanSecret) return config.lanSecret
  if (config.terminalRole !== 'server_pos' && (config.posServerIp || config.terminalRole)) return null
  const fs = require('fs')
  const ruta = require('path').join(dataDir, 'lan-secret')
  fs.mkdirSync(dataDir, { recursive: true })
  try { fs.writeFileSync(ruta, generarSecreto(), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
  const secreto = fs.readFileSync(ruta, 'utf8').trim()
  if (!secreto) throw new Error('Credencial LAN persistida vacia; requiere recuperar el emparejamiento')
  config.lanSecret = secreto
  return secreto
}

module.exports = {
  CABECERA,
  RUTAS_PROTEGIDAS,
  RUTAS_ABIERTAS,
  generarSecreto,
  verificarCredencial,
  cabecerasDeCredencial,
  paraLog,
  verificarScope,
  prepararCredencial,
  LOG,
}
