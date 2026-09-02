'use strict'
// ─── Política del auto-update ────────────────────────────────────────────────
//
// Todo lo que DECIDE vive aquí, puro y sin efectos: comparar versiones y decidir si
// se puede instalar ahora. Se separa del manager por una razón concreta — el manager
// hace peticiones HTTPS al construirse, así que probarlo exige salir a la red. Esto
// se prueba con una llamada y un objeto.
//
// Es la misma lección de los cuatro fallos del 2026-08-31: cuando la política vive
// mezclada con la red, nadie la prueba, y los bugs se descubren en un restaurante.

// ─── Comparar versiones (semver, con prerelease) ──────────────────────────────
//
// LA VERSION ANTERIOR ROMPIA EL CANAL PILOTO. Hacía:
//
//   const parse = v => v.replace(/^v/,'').split('.').map(Number)
//
// Con '1.4.0-pilot.1' eso da [1, 4, NaN, 1], y toda comparación con NaN devuelve
// NaN, que nunca es > 0. Medido el 2026-09-01:
//
//   1.3.10-pilot.1 vs 1.3.9         -> NaN  (un piloto de patch NUNCA se detecta)
//   1.4.0-pilot.2  vs 1.4.0-pilot.1 -> NaN  (un piloto nunca pasa a otro piloto)
//   1.4.0          vs 1.4.0-pilot.1 -> NaN  (una terminal en piloto NUNCA
//                                            graduaba a estable — se quedaba en la
//                                            versión de prueba para siempre)
//
// El canal piloto es TODO el mecanismo de seguridad del auto-update: probar en un
// restaurante antes de tocar a los demás. Roto así, no servía.

/** Separa '1.4.0-pilot.1' en { nucleo: [1,4,0], prerelease: ['pilot',1] }. */
function analizar(v) {
  const limpio = String(v || '0.0.0').replace(/^v/, '').trim()
  const [nucleoStr, ...resto] = limpio.split('-')
  const nucleo = nucleoStr.split('.').map(n => {
    const x = Number(n)
    return Number.isFinite(x) ? x : 0
  })
  while (nucleo.length < 3) nucleo.push(0)
  const pre = resto.join('-')
  const prerelease = pre
    ? pre.split('.').map(p => {
        const x = Number(p)
        return Number.isFinite(x) ? x : p
      })
    : []
  return { nucleo: nucleo.slice(0, 3), prerelease }
}

/**
 * Devuelve > 0 si `a` es más nueva que `b`, < 0 si es más vieja, 0 si son iguales.
 *
 * Regla de semver que importa aquí: una versión SIN prerelease es MAYOR que la misma
 * con prerelease. `1.4.0 > 1.4.0-pilot.1`. Así una terminal en piloto sí gradúa a
 * estable cuando sale.
 */
function compararVersiones(a, b) {
  const va = analizar(a)
  const vb = analizar(b)

  for (let i = 0; i < 3; i++) {
    if (va.nucleo[i] !== vb.nucleo[i]) return va.nucleo[i] - vb.nucleo[i]
  }

  const pa = va.prerelease
  const pb = vb.prerelease
  if (pa.length === 0 && pb.length === 0) return 0
  if (pa.length === 0) return 1   // 1.4.0 es MAYOR que 1.4.0-pilot.1
  if (pb.length === 0) return -1

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNum = typeof x === 'number'
    const yNum = typeof y === 'number'
    if (xNum && yNum) return x - y
    if (xNum) return -1            // numérico < alfanumérico (semver)
    if (yNum) return 1
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

// ─── ¿Se puede instalar AHORA? ───────────────────────────────────────────────
//
// Instalar reinicia Electron, y Pedro muere con Electron (regla dura #4 de
// OFFLINE-LAN-FIELD-PROVEN §4). Reiniciar a media operación deja al restaurante sin
// imprimir y sin KDS en el peor momento posible.
//
// Falla CERRADO a propósito: si no se puede saber el estado, NO se instala. Un
// restaurante que se actualiza un día tarde no pierde nada; uno que se reinicia con
// mesas abiertas, sí.

/**
 * @param {{ turno?: object|null, mesas?: Array, kds_orders?: Array }} snapshot
 *        El `state.toSnapshot()` del servidor local.
 * @returns {{ permitido: boolean, motivo: string }}
 */
function puedeInstalarAhora(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { permitido: false, motivo: 'no se pudo leer el estado del restaurante' }
  }

  if (snapshot.turno) {
    return { permitido: false, motivo: 'hay un turno abierto' }
  }

  const kds = Array.isArray(snapshot.kds_orders) ? snapshot.kds_orders : []
  if (kds.length > 0) {
    return { permitido: false, motivo: `hay ${kds.length} comanda(s) en la cocina` }
  }

  // `mesas` llega como pares [numero, {status}] desde toSnapshot().
  const mesas = Array.isArray(snapshot.mesas) ? snapshot.mesas : []
  const ocupadas = mesas.filter(m => {
    const v = Array.isArray(m) ? m[1] : m
    return v && v.status && v.status !== 'libre'
  })
  if (ocupadas.length > 0) {
    return { permitido: false, motivo: `hay ${ocupadas.length} mesa(s) ocupada(s)` }
  }

  return { permitido: true, motivo: 'sin turno, sin comandas y sin mesas ocupadas' }
}

module.exports = { compararVersiones, puedeInstalarAhora, analizar }
