'use strict'
// Encontrar la caja otra vez cuando el router le cambió la IP.
//
// ── EL HUECO QUE CIERRA (T-09 de la matriz offline) ──────────────────────────
//
// `enlace-con-caja.js` recibe `cajaUrl` UNA VEZ, construida desde
// `config.pos_server_ip` (index.js), y su propia documentación lo dice:
// "Reconecta solo, con espera creciente, PARA SIEMPRE". Siempre a la misma IP.
//
// Cuando el router renueva la concesión DHCP y la caja amanece en otra IP, cada
// terminal secundaria reintenta contra una dirección muerta cada 10 segundos, sin
// fin. La operación local sigue —el enlace es aditivo— pero las terminales dejan
// de verse entre ellas. Es el reporte de campo del 2026-09-02 palabra por palabra:
// «no hay comunicación correcta entre los puntos de venta, no muestran lo mismo»,
// con otra causa.
//
// La matriz decía que el arreglo iba en el navegador (`useBridgeClient` +
// `ServerDiscovery`). Ese análisis es de julio y quedó viejo: la arquitectura
// posterior puso a cada terminal a hablar con SU PROPIO Pedro en 127.0.0.1
// (OFFLINE-LAN-FIELD-PROVEN §5.1, "REGLA (corrige §5.1)"), así que el navegador
// nunca ve la IP de la caja. El único que la ve es este proceso.
//
// ── POR QUÉ NO mDNS ─────────────────────────────────────────────────────────
//
// `bonjour-service` está en las dependencias de electron-app desde hace tiempo y
// NO SE USA en ningún lado — ni anuncia ni busca. El comentario de `/identity`
// dice "the information is already in mDNS TXT records"; no hay tales registros.
// Encenderlo pide que la caja anuncie, que las terminales busquen, y que el
// multicast sobreviva al AP del restaurante — tres cosas que no se pueden
// comprobar sin estar ahí.
//
// Esto usa lo que YA está probado: `GET /identity` de la caja, que devuelve
// `restaurant_id`, `protocol_version` y sus `lan_ips`. Y es el mismo algoritmo que
// el navegador ya trae en `server-discovery.ts:_subnetScan` —prioridad, tope,
// validación de identidad, ambigüedad— sólo que aquí corre en Node, sin las
// restricciones del navegador, y sabiendo su propia subred en vez de adivinarla.

const { PROTOCOL_VERSION } = require('../protocol')

const LOG = '[buscar-caja]'

/** Tope de hosts a probar. Un /24 son 254; con 64 se cubren los repartos típicos. */
const MAX_HOSTS = 64

/** Direcciones donde suele quedar un servidor. `.71` es la de la caja de AMALAY. */
const PRIORIDAD = [1, 2, 10, 20, 50, 71, 100, 101, 150, 200, 254]

/** Cada sonda es corta: se lanzan todas a la vez y la caja contesta en milisegundos. */
const TIMEOUT_SONDA_MS = 800

/**
 * La /24 de cada IP local. Un restaurante con la caja en otra subred no se
 * resuelve así — y no se intenta adivinar: se devuelve vacío y el enlace sigue
 * reintentando donde estaba, que es el comportamiento de antes.
 */
function subredesDe(ipsLocales) {
  const vistas = new Set()
  for (const ip of ipsLocales || []) {
    const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(String(ip))
    if (m) vistas.add(m[1])
  }
  return [...vistas]
}

/**
 * Los hosts a sondear en una subred, en orden: primero los probables, después
 * relleno secuencial, sin repetir lo ya probado y con tope.
 */
function hostsDe(subred, yaProbadas) {
  const fuera = new Set(yaProbadas || [])
  const lista = []
  for (const n of PRIORIDAD) {
    const ip = `${subred}.${n}`
    if (!fuera.has(ip)) lista.push(ip)
  }
  const enPrioridad = new Set(PRIORIDAD)
  for (let n = 1; n <= 254 && lista.length < MAX_HOSTS; n++) {
    if (enPrioridad.has(n)) continue
    const ip = `${subred}.${n}`
    if (!fuera.has(ip)) lista.push(ip)
  }
  return lista.slice(0, MAX_HOSTS)
}

/** `GET /identity` con tope de tiempo. Cualquier fallo es `null`, nunca lanza. */
async function identidadDe(ip, puerto, fetchImpl, timeoutMs) {
  const control = new AbortController()
  const alarma = setTimeout(() => control.abort(), timeoutMs)
  try {
    const r = await fetchImpl(`http://${ip}:${puerto}/identity`, { signal: control.signal })
    if (!r || !r.ok) return null
    return await r.json()
  } catch {
    return null
  } finally {
    clearTimeout(alarma)
  }
}

/**
 * Busca la caja de ESTE restaurante en las subredes locales.
 *
 * @param {object} opts
 * @param {string}   opts.restaurantId  identidad que debe coincidir
 * @param {number}   opts.puerto        puerto del servidor local (7717)
 * @param {string[]} opts.ipsLocales    IPs LAN de esta máquina (networkAdapter.getAllLanIps())
 * @param {string[]} [opts.yaProbadas]  IPs que ya se sabe que no responden
 * @param {Function} [opts.fetchImpl]   inyectable para pruebas
 * @param {number}   [opts.timeoutMs]
 * @returns {Promise<{ip:string, identidad:object}|null>} la caja, o `null`
 */
async function buscarLaCaja({ restaurantId, puerto, ipsLocales, yaProbadas, fetchImpl, timeoutMs }) {
  const traer = fetchImpl || globalThis.fetch
  if (typeof traer !== 'function') return null
  if (!restaurantId) return null

  const espera = timeoutMs || TIMEOUT_SONDA_MS
  const propias = new Set(ipsLocales || [])

  for (const subred of subredesDe(ipsLocales)) {
    // No se sondea a uno mismo: este Pedro ya sabe que no es la caja (si lo fuera,
    // `index.js` no habría levantado el enlace ascendente).
    const hosts = hostsDe(subred, [...(yaProbadas || []), ...propias])
    if (hosts.length === 0) continue

    const sondas = await Promise.all(hosts.map(async (ip) => {
      const id = await identidadDe(ip, puerto, traer, espera)
      if (!id || id.ok !== true) return null
      // Las tres condiciones, no una: un Pedro de OTRO restaurante en la misma red
      // —o de una versión incompatible— no es "la caja".
      if (id.restaurant_id !== restaurantId) return null
      if (id.protocol_version !== PROTOCOL_VERSION) return null
      return { ip, identidad: id }
    }))

    const encontradas = sondas.filter(Boolean)
    if (encontradas.length === 1) {
      console.warn(`${LOG} caja encontrada en ${encontradas[0].ip} (subred ${subred})`)
      return encontradas[0]
    }
    if (encontradas.length > 1) {
      // DOS CAJAS DEL MISMO RESTAURANTE EN LA MISMA RED. Elegir una al azar es
      // partir el restaurante en dos historias que después no se pueden juntar.
      // Se reporta y NO se elige: esto lo resuelve una persona.
      console.error(
        `${LOG} AMBIGUO: ${encontradas.length} cajas para ${restaurantId} — ` +
        encontradas.map(c => c.ip).join(', ') + '. No se elige ninguna.',
      )
      return null
    }
  }
  return null
}

module.exports = { buscarLaCaja, subredesDe, hostsDe, MAX_HOSTS, PRIORIDAD, TIMEOUT_SONDA_MS }
