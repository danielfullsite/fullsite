'use strict'
/**
 * Qué versión es EXACTAMENTE ésta.
 *
 * `package.json` dice 1.4.0 tanto en producción como en el candidato: dos
 * ejecutables distintos con el mismo número. Cuando alguien reporta algo desde
 * el restaurante no hay forma de saber con qué versión pasó, ni de comprobar que
 * las cuatro terminales quedaron con el mismo instalador.
 *
 * El sello lo escribe el build en `build-info.json`, junto al ejecutable. Si no
 * existe —porque se está corriendo desde el código fuente— se dice así, en vez
 * de inventar un número.
 */
const fs = require('node:fs')
const path = require('node:path')

const SHA_VALIDO = /^[0-9a-f]{7,40}$/

/** Un sello ilegible o a medias vale menos que ninguno: se descarta entero. */
function normalizar(crudo) {
  if (!crudo || typeof crudo !== 'object') return null
  const sha = typeof crudo.sha === 'string' ? crudo.sha.trim().toLowerCase() : ''
  if (!SHA_VALIDO.test(sha)) return null
  const sellado = typeof crudo.sellado_en === 'string' ? crudo.sellado_en : null
  // La revisión del paquete de interfaz es un sha256 del CONTENIDO servido. Un
  // valor con otra forma se descarta en vez de propagarse: un identificador a
  // medias en un reporte de campo es peor que su ausencia, porque parece dato.
  const uiRev = typeof crudo.ui_revision === 'string' && /^[0-9a-f]{64}$/.test(crudo.ui_revision)
    ? crudo.ui_revision : null
  // El commit de la interfaz se LEE del sello; jamás se deduce del de la
  // cáscara ni del hash de contenido. Si no viene, es `null` — y `coherente`
  // será `null` también, que es la verdad: no se puede demostrar.
  const uiSha = typeof crudo.ui_sha === 'string' && SHA_VALIDO.test(crudo.ui_sha.trim().toLowerCase())
    ? crudo.ui_sha.trim().toLowerCase() : null
  return {
    sha: sha.slice(0, 12),
    rama: typeof crudo.rama === 'string' && crudo.rama ? crudo.rama : null,
    sellado_en: sellado && !Number.isNaN(Date.parse(sellado)) ? sellado : null,
    limpio: crudo.limpio === true,
    ui_version: crudo.ui_version === 'v2' ? 'v2' : 'v1',
    ui_revision: uiRev,
    ui_sha: uiSha ? uiSha.slice(0, 12) : null,
    // Tres estados, no dos. Se recalcula sobre los sellos normalizados en vez
    // de confiar en el booleano del archivo: un `coherente:true` escrito a mano
    // en el JSON no debe poder mentirle a `/health`.
    coherente: (uiSha && sha) ? (uiSha === sha) : null,
  }
}

function leerSello(directorio) {
  try {
    const ruta = path.join(directorio, 'build-info.json')
    if (!fs.existsSync(ruta)) return null
    return normalizar(JSON.parse(fs.readFileSync(ruta, 'utf8')))
  } catch { return null }
}

/**
 * @param {string} version  la de package.json
 * @param {string} raiz     dónde buscar el sello (junto al ejecutable)
 */
function identidadDeBuild(version, raiz = path.join(__dirname, '..', '..')) {
  const sello = leerSello(raiz)
  if (!sello) {
    return { version, sha: null, rama: null, sellado_en: null, limpio: false,
      ui_version: 'v1', ui_revision: null, ui_sha: null, coherente: null,
      etiqueta: `${version} (sin sellar)` }
  }
  // El sufijo del sello importa: un ejecutable armado con cambios sin guardar no
  // corresponde a ningún commit, y eso hay que poder verlo en el restaurante.
  const sufijo = sello.limpio ? '' : '+cambios'
  return { version, ...sello, etiqueta: `${version} · ${sello.sha}${sufijo}` }
}

module.exports = { identidadDeBuild, normalizar }
