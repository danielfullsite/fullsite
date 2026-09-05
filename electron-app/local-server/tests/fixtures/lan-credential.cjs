'use strict'
// Credencial sintética compartida exclusivamente por los servidores de pruebas.
const SECRET = 'fullsite-test-only-lan-credential'
const headers = { 'x-fullsite-lan': SECRET }
const wsOptions = { headers }
const localFetch = (url, init = {}) => {
  const h = new Headers(headers)
  new Headers(init.headers).forEach((value, key) => h.set(key, value))
  return globalThis.fetch(url, { ...init, headers: h })
}
module.exports = { SECRET, headers, wsOptions, localFetch }
