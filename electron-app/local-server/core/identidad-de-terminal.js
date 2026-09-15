'use strict'
/**
 * QUÉ ESTÁ INSTALADO EN ESTA CAJA — la respuesta completa, en un solo lugar.
 *
 * `identidad-de-build.js` ya contesta «qué commit es el ejecutable». Falta el
 * resto, y el resto es lo que más se pregunta cuando algo sale mal en el
 * restaurante:
 *
 *   · ¿qué interfaz está sirviendo? (V1 o V2 — el rediseño va a convivir meses)
 *   · ¿qué paquete de interfaz exactamente? (dos builds del mismo commit pueden
 *     traer distinto contenido si el bundle se rearmó)
 *   · ¿de cuándo es el catálogo que tiene cacheado?
 *   · ¿qué terminal es, con qué rol, de qué restaurante?
 *
 * Hoy nada de esto se puede preguntar junto, y esta misma jornada se pagó el
 * precio: afirmé «la compilación de AMALAY no registra su commit» midiendo mi
 * propia instancia de desarrollo. Con este bloque a la vista, esa confusión no
 * ocurre — se lee de quién es cada número.
 *
 * TODO CAMPO ES OPCIONAL Y SE DICE CUANDO FALTA. Un `null` honesto vale más que
 * un valor inventado: es exactamente la lección de `identidad-de-build.js`, que
 * descarta un sello a medias en vez de rellenarlo.
 */

const { identidadDeBuild } = require('./identidad-de-build')
const { versionDeInterfaz } = require('./version-de-interfaz')

/**
 * @param {object} p
 * @param {string}      p.version        la de package.json
 * @param {object|null} p.config         configuración de la terminal
 * @param {string|null} p.serverId       id de este Pedro
 * @param {number}      p.protocolo      PROTOCOL_VERSION
 * @param {object|null} p.paqueteUi      { revision } del paquete servido, si lo hay
 * @param {object|null} p.catalogo       { revision, actualizado_en } si está cacheado
 * @param {string}      p.origenUi       'paquete' | 'red' | 'dev'
 */
function identidadDeTerminal({
  version, config = null, serverId = null, protocolo = null,
  paqueteUi = null, catalogo = null, origenUi = 'paquete',
  // Dónde buscar el sello. En producción es el valor por omisión —junto al
  // ejecutable—; se puede fijar para que una prueba no dependa de si alguien
  // corrió `npm run sellar` en su copia de trabajo. Esa dependencia hacía que
  // la prueba del caso «sin sellar» pasara o fallara según el estado del disco.
  raizDelSello = undefined,
} = {}) {
  const build = raizDelSello === undefined ? identidadDeBuild(version) : identidadDeBuild(version, raizDelSello)

  // La edad del catálogo importa más que su existencia: `catalog.ready` ya dice
  // que HAY catálogo, no de cuándo es. Una caja con el menú de hace tres
  // semanas se ve igual de sana que una al día, y cobra precios viejos.
  let catalogoEdadS = null
  if (catalogo && catalogo.actualizado_en) {
    const t = Date.parse(catalogo.actualizado_en)
    if (!Number.isNaN(t)) catalogoEdadS = Math.max(0, Math.round((Date.now() - t) / 1000))
  }

  return {
    app: {
      version,
      git_sha:   build.sha,          // null si se corre desde el código fuente
      branch:    build.rama,
      clean:     build.limpio,       // false = se empaquetó con cambios sin guardar
      built_at:  build.sellado_en,
      etiqueta:  build.etiqueta,     // «1.4.0 · 97e2b30b» o «1.4.0 (sin sellar)»
    },
    ui: {
      version:          versionDeInterfaz(),         // 'v1' | 'v2'
      // El hash del CONTENIDO servido y el COMMIT son dos cosas distintas, y la
      // segunda no se deduce de la primera: no hay forma de traducir un sha256
      // de contenido a un commit sin recompilar y comparar. Por eso el commit
      // viene sellado desde `build:ui`, y si no vino es `null` — nunca el de la
      // cáscara «porque salen del mismo repo». Esa suposición es la que impidió
      // saber qué interfaz corría en cada terminal.
      content_revision: paqueteUi?.revision ?? build.ui_revision ?? null,
      git_sha:          build.ui_sha ?? null,
      origen:           origenUi,
    },
    // ¿Cáscara e interfaz salieron del mismo commit?
    //   true  — demostrado: los dos sellos existen y coinciden
    //   false — demostrado lo contrario: existen y NO coinciden
    //   null  — indemostrable: falta alguno de los dos sellos
    // El tercer estado no es un hueco: es la respuesta correcta para un
    // instalador armado a mano o un paquete traído de otra compilación.
    coherente: build.coherente ?? null,
    pedro: {
      version,
      protocol_version: protocolo,
      server_id:        serverId,
    },
    config: {
      config_version:   config?.config_version ?? null,
      catalog_revision: catalogo?.revision ?? null,
      catalog_edad_s:   catalogoEdadS,
    },
    terminal: {
      terminal_id:    config?.terminal_id ?? null,
      terminal_role:  config?.terminal_role ?? null,
      terminal_name:  config?.terminal_name ?? null,
      restaurant_id:  config?.restaurant_id ?? null,
    },
  }
}

/**
 * Una línea que cabe en el pie de la pantalla de bloqueo.
 *
 * Es la pieza que de verdad cierra el hueco: todo lo de arriba vive en
 * `:7717/health`, detrás de la credencial de red local. Quien está parado
 * frente a la caja —que es quien reporta el problema— no puede verlo. Esta
 * línea se lee SIN entrar al sistema y SIN permisos.
 *
 *   «1.4.0 · 97e2b30b · UI v1 · caja-01»
 */
function lineaDeIdentidad(id) {
  const partes = [id.app.version]
  if (id.app.git_sha) partes.push(id.app.git_sha + (id.app.clean ? '' : '+cambios'))
  else partes.push('sin sellar')
  partes.push(`UI ${id.ui.version}`)
  if (id.terminal.terminal_id) partes.push(id.terminal.terminal_id)
  return partes.join(' · ')
}

module.exports = { identidadDeTerminal, lineaDeIdentidad }
