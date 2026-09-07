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
  return {
    sha: sha.slice(0, 12),
    rama: typeof crudo.rama === 'string' && crudo.rama ? crudo.rama : null,
    sellado_en: sellado && !Number.isNaN(Date.parse(sellado)) ? sellado : null,
    limpio: crudo.limpio === true,
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
      etiqueta: `${version} (sin sellar)` }
  }
  // El sufijo del sello importa: un ejecutable armado con cambios sin guardar no
  // corresponde a ningún commit, y eso hay que poder verlo en el restaurante.
  const sufijo = sello.limpio ? '' : '+cambios'
  return { version, ...sello, etiqueta: `${version} · ${sello.sha}${sufijo}` }
}

module.exports = { identidadDeBuild, normalizar }
