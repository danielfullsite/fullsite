'use strict'

// Sólo el shell propio puede recibir la identidad instalada. Ni query params,
// ni iframes, ni una navegación externa deciden a qué restaurante pertenece.
function rendererIdentity({ url, config, port = 7717, dev = false, posUrl }) {
  let actual
  try { actual = new URL(url) } catch { return null }
  const localKds = actual.origin === `http://127.0.0.1:${port}` && actual.pathname === '/kds'
  let devOrigin = null
  if (dev && posUrl) {
    try {
      const target = new URL(posUrl)
      if (['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) devOrigin = target.origin
    } catch {}
  }
  if (!localKds && actual.origin !== 'https://app.fullsite.mx' && actual.origin !== devOrigin) return null
  const restaurantId = config.restaurant_id || config.restaurantId || config.client_id || config.clientId
  if (!restaurantId) return null
  return {
    fullsite_client_id: String(restaurantId).toLowerCase().trim(),
    pos_terminal_id: config.terminal_id || config.terminalId || '',
    FULLSITE_TERMINAL_ID: config.terminal_id || config.terminalId || '',
    FULLSITE_LOCATION_ID: config.location_id || config.branch_id || config.branchId || '',
    FULLSITE_LAN_SECRET: config.lan_secret || config.lanSecret || '',
    FULLSITE_BRIDGE_URL: `http://127.0.0.1:${port}`,
    pos_bridge_host: '',
  }
}

module.exports = { rendererIdentity }
