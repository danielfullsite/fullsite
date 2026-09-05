'use strict'

/** Extend only connect-src for the installed localhost bridge. The caller must
 * first verify that this response belongs to the application's trusted origin.
 * Electron webSecurity:false does not disable CSP; port 7717 is not universal.
 */
function withLocalBridgeCsp(responseHeaders, port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local bridge port')
  const headers = { ...responseHeaders }
  for (const key of Object.keys(headers)) {
    if (!['content-security-policy', 'content-security-policy-report-only'].includes(key.toLowerCase())) continue
    const policies = Array.isArray(headers[key]) ? headers[key] : [headers[key]]
    headers[key] = policies.map(policy => {
      const directives = String(policy).split(';').map(part => part.trim()).filter(Boolean)
      const index = directives.findIndex(part => /^connect-src(?:\s|$)/i.test(part))
      const fallback = directives.find(part => /^default-src(?:\s|$)/i.test(part))
      // Without either directive, network connections are already unrestricted.
      if (index < 0 && !fallback) return policy
      const sources = (index >= 0 ? directives[index] : fallback).split(/\s+/).slice(1).filter(s => s !== "'none'")
      const allowed = [...new Set([...sources, `http://127.0.0.1:${port}`, `ws://127.0.0.1:${port}`])]
      const next = `connect-src ${allowed.join(' ')}`
      if (index >= 0) directives[index] = next
      else directives.push(next)
      return directives.join('; ')
    })
  }
  return headers
}

module.exports = { withLocalBridgeCsp }
