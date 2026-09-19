// Tiempo — y por qué un módulo entero para restar dos fechas.
//
// ── EL DEFECTO, REPRODUCIDO ─────────────────────────────────────────────────
// La primera corrida reportó `sync_receipts` con edad **-1302 min** y estado
// HEALTHY. La aritmética estaba bien; la entrada no:
//
//   observed_at = 2026-09-19T05:59:42Z  →  epoch ms 1789797582000
//   now_ms      = 1789718382736         →  2026-09-18T07:59:42Z
//   desfase: 22 horas, escritas a mano en el archivo de observaciones
//
// Dos relojes en el mismo archivo y nada que comprobara si coincidían. Y lo
// peor no fue el número negativo: fue que `edad > umbral` daba false y la señal
// salía **HEALTHY**. Una observación corrupta producía un veredicto sano.
//
// ── LAS TRES REGLAS QUE SALEN DE AHÍ ────────────────────────────────────────
// 1. `now` se DERIVA de `observed_at`. Si además viene `now_ms` y no coinciden,
//    la observación se rechaza: no se elige un reloj y se calla el otro.
// 2. Una edad negativa nunca es salud. Es CLOCK_SKEW, y por encima de la
//    tolerancia es un fallo de la observación, no del sistema observado.
// 3. Un epoch en segundos donde se esperan milisegundos es UNIT_MISMATCH, no
//    una fecha de 1970. Se detecta por magnitud.

export const TIEMPO = Object.freeze({
  OK: 'OK',
  CLOCK_SKEW_TOLERATED: 'CLOCK_SKEW_TOLERATED',
  CLOCK_SKEW: 'CLOCK_SKEW',
  UNREADABLE: 'UNREADABLE',
  UNIT_MISMATCH: 'UNIT_MISMATCH',
})

/** Tolerancia por omisión para relojes que no están perfectamente sincronizados. */
export const TOLERANCIA_MIN = 5

/**
 * Un epoch de 10 dígitos son segundos; de 13, milisegundos. Confundirlos mueve
 * la fecha ~50 años y produce edades absurdas que parecen datos.
 */
export function normalizarEpochMs(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ms: null, state: TIEMPO.UNREADABLE }
  if (v > 0 && v < 1e12) return { ms: null, state: TIEMPO.UNIT_MISMATCH, hint: 'parece segundos, se esperaban milisegundos' }
  if (v >= 1e15) return { ms: null, state: TIEMPO.UNIT_MISMATCH, hint: 'parece microsegundos' }
  return { ms: v, state: TIEMPO.OK }
}

export function isoAMs(iso) {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? t : null
}

/**
 * Resuelve el «ahora» de una observación.
 *
 * `observed_at` manda. `now_ms` sólo se acepta si coincide con él dentro de la
 * tolerancia; si no, se devuelve el desacuerdo para que quien llame lo rechace.
 * Elegir uno en silencio es exactamente cómo nació el -1302.
 */
export function resolverAhora({ observed_at, now_ms }, toleranciaMin = TOLERANCIA_MIN) {
  const iso = isoAMs(observed_at)
  const norm = now_ms === undefined || now_ms === null ? null : normalizarEpochMs(now_ms)
  if (norm && norm.state !== TIEMPO.OK) return { ms: iso, state: norm.state, hint: norm.hint, source: 'observed_at' }
  if (iso === null && !norm) return { ms: null, state: TIEMPO.UNREADABLE, hint: 'ni observed_at ni now_ms legibles' }
  if (iso === null) return { ms: norm.ms, state: TIEMPO.OK, source: 'now_ms' }
  if (!norm) return { ms: iso, state: TIEMPO.OK, source: 'observed_at' }
  const difMin = Math.abs(iso - norm.ms) / 60000
  if (difMin > toleranciaMin) {
    return { ms: iso, state: TIEMPO.CLOCK_SKEW, source: 'observed_at',
      hint: `observed_at y now_ms discrepan ${Math.round(difMin)} min; se usa observed_at y la observación se marca` }
  }
  return { ms: iso, state: TIEMPO.OK, source: 'observed_at' }
}

/**
 * Edad de un instante respecto de un «ahora», en minutos.
 *
 * INVARIANTE: si el estado es OK, `minutes >= 0`. No hay otro camino a OK.
 */
export function evaluarEdad({ desde, hasta, toleranciaMin = TOLERANCIA_MIN }) {
  const a = typeof desde === 'number' ? normalizarEpochMs(desde) : { ms: isoAMs(desde), state: isoAMs(desde) === null ? TIEMPO.UNREADABLE : TIEMPO.OK }
  if (a.state !== TIEMPO.OK) return { minutes: null, state: a.state, hint: a.hint ?? 'fecha de origen ilegible' }
  const b = typeof hasta === 'number' ? normalizarEpochMs(hasta) : { ms: isoAMs(hasta), state: isoAMs(hasta) === null ? TIEMPO.UNREADABLE : TIEMPO.OK }
  if (b.state !== TIEMPO.OK) return { minutes: null, state: b.state, hint: b.hint ?? 'fecha de referencia ilegible' }

  const min = (b.ms - a.ms) / 60000
  if (min < 0) {
    const futuro = Math.abs(min)
    // Un instante en el futuro dentro de la tolerancia es ruido de reloj: se
    // trata como 0, pero se DICE. Más allá, la observación no es creíble.
    if (futuro <= toleranciaMin) return { minutes: 0, state: TIEMPO.CLOCK_SKEW_TOLERATED, hint: `${Math.round(futuro)} min en el futuro, dentro de tolerancia` }
    return { minutes: null, state: TIEMPO.CLOCK_SKEW, hint: `${Math.round(futuro)} min en el futuro; la observación no es creíble` }
  }
  return { minutes: Math.round(min), state: TIEMPO.OK }
}

/** Compatible con el uso anterior, pero sin devolver negativos en silencio. */
export function edadMin(iso, ahoraMs = Date.now()) {
  const r = evaluarEdad({ desde: iso, hasta: ahoraMs })
  return r.state === TIEMPO.OK || r.state === TIEMPO.CLOCK_SKEW_TOLERATED ? r.minutes : null
}
