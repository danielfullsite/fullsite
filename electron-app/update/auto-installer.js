'use strict'
// ─── Auto-update: descarga e instalación ─────────────────────────────────────
//
// Fase 2 de lo que `local-server/update/manager.js` dejó a medias. El manager
// DETECTA que hay versión nueva; esto la baja y la instala.
//
// ── LA REGLA QUE MANDA ───────────────────────────────────────────────────────
//
// Instalar reinicia Electron, y **Pedro muere con Electron** (regla dura #4 de
// OFFLINE-LAN-FIELD-PROVEN §4). Un reinicio a media operación deja al restaurante
// sin imprimir y sin KDS, en el peor momento posible.
//
// Por eso NUNCA se instala por el hecho de haber descargado. Se instala cuando el
// restaurante está en reposo: sin turno abierto, sin comandas en cocina, sin mesas
// ocupadas. La decisión vive en `local-server/update/politica.js`, pura y probada.
//
// En la práctica eso significa: **se instala después del corte**, que es
// exactamente cuando un restaurante quiere que pase.
//
// ── FALLA CERRADO ────────────────────────────────────────────────────────────
//
// Si no se puede leer el estado, NO se instala. Si no se puede consultar la lista de
// versiones bloqueadas, NO se instala. Un restaurante que se actualiza un día tarde
// no pierde nada; uno que se reinicia con mesas abiertas, sí.
//
// Nota sobre el freno: `manager.js` falla ABIERTO al consultar versiones bloqueadas
// (para no impedir OPERAR si Supabase no responde). Aquí es al revés, y a propósito:
// una cosa es dejar trabajar, otra es instalar software a ciegas.

const INTERVALO_REVISION_MS = 5 * 60 * 1000   // cada 5 min se pregunta "¿ya se puede?"

let _autoUpdater = null
let _timer = null
let _descargada = null      // { version } cuando ya está en disco, lista para instalar
let _instalando = false

/**
 * @param {object} opts
 * @param {string} opts.canal              'stable' | 'pilot' | 'development'
 * @param {() => object|null} opts.getSnapshot   estado vivo del restaurante
 * @param {(v:string)=>Promise<boolean>} opts.estaBloqueada  consulta el freno
 * @param {(info:object)=>void} [opts.onEvento]  para avisar a la UI por WS
 * @param {object} [opts.updaterInyectado]  sólo para pruebas
 */
function iniciar({ canal, getSnapshot, estaBloqueada, onEvento, updaterInyectado }) {
  try {
    _autoUpdater = updaterInyectado || require('electron-updater').autoUpdater
  } catch (e) {
    // En desarrollo, o si el paquete no está, no se rompe el arranque del POS.
    console.warn('[auto-update] electron-updater no disponible:', e.message)
    return { detener: () => {} }
  }

  const avisar = (info) => { try { onEvento && onEvento(info) } catch {} }

  _autoUpdater.autoDownload = true
  // NUNCA instalar solo al cerrar: el operador puede cerrar el POS a media
  // operación (un reinicio de Windows, un cierre accidental) y eso no es un momento
  // seguro. La instalación la decide la política, no el ciclo de vida de la app.
  _autoUpdater.autoInstallOnAppQuit = false
  _autoUpdater.allowPrerelease = canal === 'pilot' || canal === 'development'
  _autoUpdater.logger = { info: () => {}, warn: console.warn, error: console.error, debug: () => {} }

  _autoUpdater.on('update-downloaded', (info) => {
    _descargada = { version: info?.version || 'desconocida' }
    console.log(`[auto-update] Descargada ${_descargada.version} — esperando a que el restaurante esté en reposo`)
    avisar({ descargada: true, version: _descargada.version })
  })

  _autoUpdater.on('error', (err) => {
    // Nunca fatal. Un fallo del updater no puede tumbar el POS.
    console.warn('[auto-update] error (no fatal):', err?.message || err)
    avisar({ error: String(err?.message || err) })
  })

  _timer = setInterval(() => {
    intentarInstalar({ getSnapshot, estaBloqueada, avisar }).catch(() => {})
  }, INTERVALO_REVISION_MS)

  return {
    detener: () => { if (_timer) { clearInterval(_timer); _timer = null } },
    // Expuesto para que el HTTP del servidor local pueda reportarlo.
    estado: () => ({ descargada: _descargada, instalando: _instalando }),
  }
}

/**
 * ¿Ya se puede instalar? Si sí, reinicia e instala. Exportada aparte para poder
 * probarla sin temporizadores.
 */
async function intentarInstalar({ getSnapshot, estaBloqueada, avisar = () => {} }) {
  if (!_descargada || _instalando) return { instalo: false, motivo: 'no hay nada descargado' }

  const { puedeInstalarAhora } = require('../local-server/update/politica')

  let snapshot = null
  try {
    snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null
  } catch {
    // Falla cerrado: `puedeInstalarAhora(null)` devuelve permitido:false.
    snapshot = null
  }

  const cuando = puedeInstalarAhora(snapshot)
  if (!cuando.permitido) return { instalo: false, motivo: cuando.motivo }

  // El freno de emergencia, JUSTO antes de instalar. Se consulta aquí y no sólo al
  // detectar, porque entre la descarga y este momento pueden pasar horas — y una
  // versión puede bloquearse en ese rato, que es precisamente para lo que sirve.
  try {
    if (typeof estaBloqueada === 'function' && await estaBloqueada(_descargada.version)) {
      console.warn(`[auto-update] ${_descargada.version} está BLOQUEADA — no se instala`)
      avisar({ bloqueada: true, version: _descargada.version })
      _descargada = null
      return { instalo: false, motivo: 'version bloqueada' }
    }
  } catch {
    // Falla CERRADO: si no se puede consultar el freno, no se instala.
    return { instalo: false, motivo: 'no se pudo consultar el freno de versiones' }
  }

  _instalando = true
  console.log(`[auto-update] Restaurante en reposo (${cuando.motivo}) — instalando ${_descargada.version}`)
  avisar({ instalando: true, version: _descargada.version })

  try {
    // isSilent=true, isForceRunAfter=true: reinstala y vuelve a abrir el POS solo.
    // Sin isForceRunAfter, la terminal se quedaría apagada hasta que alguien la abra.
    _autoUpdater.quitAndInstall(true, true)
    return { instalo: true, version: _descargada.version }
  } catch (e) {
    _instalando = false
    console.warn('[auto-update] quitAndInstall fallo:', e.message)
    return { instalo: false, motivo: e.message }
  }
}

/** Sólo para pruebas: limpia el estado del módulo. */
function _reset() {
  if (_timer) { clearInterval(_timer); _timer = null }
  _autoUpdater = null
  _descargada = null
  _instalando = false
}

/** Sólo para pruebas: simula que ya se descargó una versión. */
function _marcarDescargada(version) { _descargada = version ? { version } : null }

module.exports = { iniciar, intentarInstalar, _reset, _marcarDescargada, INTERVALO_REVISION_MS }
