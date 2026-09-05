'use strict'
// Relay identity may differ after failover/retry from another authorized terminal.
// Actor/device authorization belongs to the transport; business payload and tenant
// must still match the original operation.
function sameCommand(a, b) {
  function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical)
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]))
    return v
  }
  const content = e => canonical({ type: e.type, restaurant_id: e.restaurant_id, payload: e.payload })
  return JSON.stringify(content(a)) === JSON.stringify(content(b))
}
module.exports = { sameCommand }
