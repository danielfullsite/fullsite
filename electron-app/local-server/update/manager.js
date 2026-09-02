'use strict'
// ─── Update Manager ───────────────────────────────────────────────────────────
// Manages update channels and delegates installation to Electron's auto-updater.
//
// Philosophy (per Daniel's spec):
//  • Electron + local-server update as ONE unit. No second independent updater.
//  • Channels: development → pilot → stable
//  • Download happens in background, installation ONLY when no active turno + no open orders.
//  • Corrupt/mismatched updates are rejected before install.
//  • Blocked versions are checked against Supabase config before installing.
//  • Rollback = Electron's previous version (electron-updater supports this).
//
// Phase 1: this module manages channel config + reports update availability.
//          Actual auto-update download/install wired via electron-updater in Phase 2.
//          Until then, the manager checks GitHub Releases and notifies the WS hub.

const https = require('https')
const { compararVersiones, puedeInstalarAhora } = require('./politica')

// El repo REAL es danielfullsite/fullsite. Estaba apuntando a
// 'ramonfaurdaniel-png/fullsite', que no es este proyecto: la mitad que YA existe
// —detectar que hay version nueva— nunca pudo funcionar, porque preguntaba en el
// lugar equivocado. Verificado el 2026-09-01 contra `git remote get-url origin`.
const GITHUB_REPO     = 'danielfullsite/fullsite'
const CHECK_INTERVAL  = 60 * 60 * 1000  // check once per hour

let _channel       = 'stable'
let _currentVersion = '0.0.0'
let _stagedUpdate  = null  // { version, releaseNotes, downloadedAt } when available
let _checkTimer    = null
let _onUpdate      = null  // callback when update is staged
// Proveedor del estado del restaurante. Sin el, `puedeInstalarAhora` recibe null y
// FALLA CERRADO (no instala) — que es lo correcto: no saber si hay mesas abiertas
// nunca puede autorizar un reinicio.
let _getSnapshot   = null

/** @param {{ channel: string, currentVersion: string, supabaseUrl: string, supabaseKey: string, restaurantId: string, onUpdateAvailable: (info: object) => void }} opts */
function init({ channel, currentVersion, supabaseUrl, supabaseKey, restaurantId, onUpdateAvailable, getSnapshot }) {
  _channel        = channel        || 'stable'
  _currentVersion = currentVersion || '0.0.0'
  _onUpdate       = onUpdateAvailable || null
  _getSnapshot    = typeof getSnapshot === 'function' ? getSnapshot : null

  console.log(`[updater] Channel: ${_channel} | Current: v${_currentVersion}`)

  // Start periodic checks
  _checkTimer = setInterval(() => _checkForUpdate({ supabaseUrl, supabaseKey, restaurantId }), CHECK_INTERVAL)
  // First check after 2 minutes (give the server time to stabilize)
  setTimeout(() => _checkForUpdate({ supabaseUrl, supabaseKey, restaurantId }), 2 * 60 * 1000)
}

function stop() {
  if (_checkTimer) { clearInterval(_checkTimer); _checkTimer = null }
}

function getStagedUpdate()  { return _stagedUpdate }
function getChannel()       { return _channel }

async function _checkForUpdate({ supabaseUrl, supabaseKey, restaurantId }) {
  try {
    // Step 1: check if this version is blocked
    const blocked = await _isVersionBlocked(_currentVersion, { supabaseUrl, supabaseKey, restaurantId })
    if (blocked) {
      console.warn(`[updater] Current version ${_currentVersion} is BLOCKED — operator action required`)
      if (_onUpdate) _onUpdate({ blocked: true, version: _currentVersion })
      return
    }

    // Step 2: fetch latest release from GitHub for this channel
    const latest = await _fetchLatestRelease()
    if (!latest) return

    const isNewer = _compareVersions(latest.version, _currentVersion) > 0
    if (!isNewer) {
      console.log(`[updater] Up to date (${_currentVersion})`)
      return
    }

    // Step 3: dejar la actualizacion LISTA, y decir si se puede instalar ahora.
    //
    // Instalar reinicia Electron, y Pedro muere con Electron (regla dura #4). Hacerlo
    // a media operacion deja al restaurante sin imprimir y sin KDS en el peor momento.
    // La decision vive en politica.js, pura y probada; aqui solo se consulta el estado.
    console.log(`[updater] Update available: ${_currentVersion} → ${latest.version} (channel: ${_channel})`)

    const snapshot = _getSnapshot ? _getSnapshot() : null
    const cuando = puedeInstalarAhora(snapshot)

    _stagedUpdate = {
      version: latest.version,
      releaseNotes: latest.body,
      stagedAt: Date.now(),
      instalable: cuando.permitido,
      motivo: cuando.motivo,
    }
    if (!cuando.permitido) {
      console.log(`[updater] Descargada pero NO se instala: ${cuando.motivo}`)
    }

    if (_onUpdate) _onUpdate({
      available: true,
      version: latest.version,
      releaseNotes: latest.body,
      instalable: cuando.permitido,
      motivo: cuando.motivo,
    })
  } catch (err) {
    console.warn('[updater] Check failed (non-fatal):', err.message)
  }
}

async function _fetchLatestRelease() {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.github.com',
      path:     `/repos/${GITHUB_REPO}/releases`,
      headers:  { 'User-Agent': 'fullsite-local-server' },
      timeout:  10000,
    }
    const req = https.get(opts, (res) => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => {
        try {
          const releases = JSON.parse(body)
          if (!Array.isArray(releases)) { resolve(null); return }
          // Filter by channel tag (e.g., tag 'v1.2.0-pilot' for pilot channel)
          const match = releases.find(r => {
            const tag = (r.tag_name || '').toLowerCase()
            if (_channel === 'stable')      return !tag.includes('-pilot') && !tag.includes('-dev')
            if (_channel === 'pilot')       return tag.includes('-pilot') || (!tag.includes('-dev'))
            if (_channel === 'development') return true
            return false
          })
          if (!match) { resolve(null); return }
          resolve({ version: match.tag_name.replace(/^v/, ''), body: match.body || '' })
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

async function _isVersionBlocked(version, { supabaseUrl, supabaseKey }) {
  if (!supabaseUrl || !supabaseKey) return false
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(
      `${supabaseUrl}/rest/v1/local_server_blocked_versions?version=eq.${encodeURIComponent(version)}&select=version`,
      {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        signal: controller.signal,
      }
    ).finally(() => clearTimeout(t))
    if (!res.ok) return false
    const rows = await res.json()
    return Array.isArray(rows) && rows.length > 0
  } catch {
    return false // fail open — a blocked version check failure should not prevent operation
  }
}

// Delega en politica.js. La version que vivia aqui rompia el canal piloto: hacia
// `.split('.').map(Number)`, y con '1.4.0-pilot.1' eso da NaN en el patch. Toda
// comparacion con NaN es falsa, asi que un piloto NUNCA se veia como mas nuevo — ni
// siquiera para graduar a estable. Medido el 2026-09-01. Ver politica.js.
const _compareVersions = compararVersiones

module.exports = { init, stop, getStagedUpdate, getChannel, compararVersiones, puedeInstalarAhora }
