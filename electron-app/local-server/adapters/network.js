'use strict'
// ─── Network Adapter ─────────────────────────────────────────────────────────
// Detects the machine's LAN IP(s) for mDNS and health reporting.
// Never assumes a fixed subnet — queries the OS network interfaces directly.

const os = require('os')

/**
 * Returns the first non-loopback IPv4 address found on this machine.
 * Prefers addresses in common private ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x).
 * Falls back to any non-loopback IPv4 if no private range is found.
 * @returns {string|null}
 */
function getLanIp() {
  const ifaces = os.networkInterfaces()
  const candidates = []

  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      candidates.push(addr.address)
    }
  }

  // Prefer common private ranges
  const preferred = candidates.find(ip =>
    ip.startsWith('192.168.') ||
    ip.startsWith('10.')      ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  )

  return preferred || candidates[0] || null
}

/**
 * Returns all non-loopback IPv4 addresses.
 * @returns {string[]}
 */
function getAllLanIps() {
  const ifaces = os.networkInterfaces()
  const result = []
  for (const iface of Object.values(ifaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) result.push(addr.address)
    }
  }
  return result
}

module.exports = { getLanIp, getAllLanIps }
