'use strict'
// ─── mDNS Discovery ───────────────────────────────────────────────────────────
// Announces the local server on the LAN as _fullsite-pos._tcp so tablets can
// discover it without manual IP configuration.
//
// Service metadata in TXT records allows tablets to verify they found the right
// server before connecting (restaurant_id check).
//
// NOT assumed to work on all networks. The client falls back to:
//   1. last known IP (localStorage)
//   2. manual IP entry in settings
//
// Uses bonjour-service (pure JS, no native bindings).

let _bonjour = null
let _service = null

/**
 * Start mDNS advertisement.
 * @param {{ restaurantId: string, serverId: string, instanceName: string, version: string, protocolVersion: string, port: number, channel: string }} opts
 */
function start({ restaurantId, serverId, instanceName, version, protocolVersion, port, channel }) {
  try {
    const { Bonjour } = require('bonjour-service')
    _bonjour = new Bonjour()

    _service = _bonjour.publish({
      name: instanceName || `Fullsite POS — ${restaurantId.slice(0, 8)}`,
      type: 'fullsite-pos',
      port,
      txt: {
        restaurant_id:    restaurantId,
        server_id:        serverId,
        instance_name:    instanceName || '',
        protocol_version: protocolVersion,
        app_version:      version,
        environment:      channel,
      },
    })

    _service.on('up', () => {
      console.log(`[mdns] Announced: _fullsite-pos._tcp on port ${port} (${instanceName})`)
    })

    _service.on('error', (err) => {
      // mDNS errors are non-fatal — LAN IP fallback handles it
      console.warn('[mdns] Announcement error (non-fatal):', err.message)
    })
  } catch (err) {
    // bonjour-service not installed or multicast not supported
    console.warn('[mdns] Not available:', err.message)
  }
}

function stop() {
  try {
    if (_service)  _service.stop()
    if (_bonjour)  _bonjour.destroy()
  } catch {}
  _service = null
  _bonjour = null
}

module.exports = { start, stop }
