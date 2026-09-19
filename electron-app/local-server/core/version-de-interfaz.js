'use strict'
/**
 * QUÉ INTERFAZ SIRVE ESTA TERMINAL — y por qué se decide UNA sola vez.
 *
 * El rediseño del POS (V2) va a convivir con el actual (V1) durante meses. Hace
 * falta un interruptor, y dónde vive el interruptor importa más que el
 * interruptor.
 *
 * ── POR QUÉ NO EN LA NUBE ───────────────────────────────────────────────────
 * `lib/platform-config.ts` ya tiene banderas con cohortes y porcentaje, y sirve
 * para el dashboard. Para el punto de venta NO sirve, y su propio código dice
 * por qué: lee de Supabase por red y, al fallar, devuelve `{}` — o sea que toda
 * bandera vale `false`. En un restaurante eso significa que la interfaz
 * cambiaría de identidad EXACTAMENTE cuando se cae el internet, que es el peor
 * momento posible. Una terminal no puede mudar de piel a media comida.
 *
 * ── POR QUÉ AQUÍ ────────────────────────────────────────────────────────────
 * `config.json` ya existe, ya se lee al arrancar, ya viaja con el instalador y
 * ya sobrevive sin red. Y es POR TERMINAL, que es la granularidad que hace
 * falta: se enciende una caja, se mira una noche, y se decide. No exige tocar
 * la base de datos.
 *
 * ── LA REGLA DEL CONGELADO ──────────────────────────────────────────────────
 * Se resuelve al arrancar Electron y NO se vuelve a leer: ni al desbloquear con
 * PIN, ni al abrir turno, ni al refrescar el catálogo, ni cuando vuelve el
 * internet. Cambiar de interfaz exige reiniciar la terminal — un gesto
 * deliberado y visible, no un efecto secundario.
 *
 * Sin eso, una orden podría empezar en V1 y terminar en V2, con dos modelos de
 * estado distintos a media captura. Es el defecto que este módulo existe para
 * hacer imposible.
 *
 * ── FALLA CERRADO HACIA LO QUE FUNCIONA ─────────────────────────────────────
 * Un valor ausente, mal escrito, con otro tipo o desconocido NO es un error: es
 * `v1`. Lo contrario —quedarse sin interfaz por una letra mal puesta— dejaría
 * una caja muerta por un typo.
 */

const VERSIONES = Object.freeze(['v1', 'v2'])
const POR_OMISION = 'v1'

/** Congelado del proceso. `null` = todavía no se resolvió. */
let _resuelta = null
let _procedencia = null

/**
 * Normaliza lo que venga. Todo lo que no sea exactamente 'v1' o 'v2' —con
 * espacios y mayúsculas perdonados— es `null`, y quien llama decide.
 */
function normalizar(crudo) {
  if (typeof crudo !== 'string') return null
  const v = crudo.trim().toLowerCase()
  return VERSIONES.includes(v) ? v : null
}

/**
 * Resuelve la versión de interfaz para todo el proceso.
 *
 * Orden, con parada determinista:
 *   1. `FULLSITE_UI_VERSION` — SÓLO en desarrollo. Para poder alternar en una
 *      sesión de pruebas sin editar la configuración de la terminal.
 *   2. `config.json` → `ui_version` — el control de producción.
 *   3. `v1`.
 *
 * `localStorage` NO aparece aquí a propósito: vive en el navegador, no en el
 * shell, y sólo se consulta en DEV desde el lado de la interfaz. Que no pueda
 * decidir en producción es el punto.
 *
 * @param {object} opciones
 * @param {object|null} opciones.config  la configuración de la terminal ya leída
 * @param {boolean}     opciones.dev     ¿corre en modo desarrollo?
 * @param {object}      opciones.env     el entorno (inyectable para poder probarlo)
 */
function resolverVersionDeInterfaz({ config = null, dev = false, env = process.env } = {}) {
  if (_resuelta) return { version: _resuelta, procedencia: _procedencia, congelada: true }

  let version = null
  let procedencia = null

  if (dev) {
    const deEntorno = normalizar(env.FULLSITE_UI_VERSION)
    if (deEntorno) { version = deEntorno; procedencia = 'entorno (dev)' }
  }

  if (!version && config) {
    const deConfig = normalizar(config.ui_version)
    if (deConfig) { version = deConfig; procedencia = 'config.json' }
    else if (config.ui_version !== undefined) procedencia = 'config.json ilegible → v1'
  }

  if (!version) {
    version = POR_OMISION
    procedencia = procedencia || 'por omisión'
  }

  _resuelta = version
  _procedencia = procedencia
  return { version, procedencia, congelada: false }
}

/**
 * Qué se resolvió. Si nadie la resolvió todavía, contesta `v1` y lo dice — nunca
 * resuelve por su cuenta, porque resolver es una decisión de arranque y hacerla
 * a medio camino sería justo lo que este módulo evita.
 */
function versionDeInterfaz() {
  return _resuelta || POR_OMISION
}

/** Sólo para las pruebas: descongela. En producción no lo llama nadie. */
function _olvidar() { _resuelta = null; _procedencia = null }

module.exports = { resolverVersionDeInterfaz, versionDeInterfaz, normalizar, VERSIONES, POR_OMISION, _olvidar }
