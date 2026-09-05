'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { ORIGIN, digest, safeRelative } = require('./package-store')
const { withLocalBridgeCsp } = require('../local-server/core/bridge-csp')

const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/x-component; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:", "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.posthog.com",
  "media-src 'self' blob:", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join('; ')

// Resolve Next static export navigation and RSC separately. Query strings never
// become filesystem paths; missing chunks never fall back to a different cloud build.
function resolveRequest(request, manifest) {
  const url = new URL(request.url)
  if (url.origin !== ORIGIN || url.pathname === '/api' || url.pathname.startsWith('/api/')) return { network: true }
  if (!['GET', 'HEAD'].includes(request.method)) return { status: 405 }
  let decoded
  try { decoded = decodeURIComponent(url.pathname) } catch { return { status: 400 } }
  const relative = decoded.replace(/^\//, '').replace(/\/$/, '')
  if (!relative) return { redirect: `${ORIGIN}/pos` }
  if (!safeRelative(relative)) return { status: 400 }
  const isRsc = request.headers.get('rsc') === '1' || url.searchParams.has('_rsc')
  const candidates = isRsc ? [`${relative}.txt`, relative] : [relative, `${relative}.html`]
  for (const file of candidates) {
    if (Object.hasOwn(manifest.files, file)) return { file }
  }
  return { status: 404 }
}

function createHandler(bundle, forward, port = 7717) {
  // Custom protocol responses do not consistently pass through Chromium's
  // onHeadersReceived hook. Include the installed bridge port at the source.
  const csp = withLocalBridgeCsp({ 'content-security-policy': CSP }, port)['content-security-policy'][0]
  return async request => {
    const resolved = resolveRequest(request, bundle.manifest)
    if (resolved.network) return forward(request)
    if (resolved.redirect) return Response.redirect(resolved.redirect, 307)
    if (resolved.status) return new Response('Recurso no disponible en esta versión instalada de Fullsite.', { status: resolved.status, headers: { 'cache-control': 'no-store' } })
    const file = resolved.file
    try {
      const bytes = fs.readFileSync(path.join(bundle.directory, file))
      const entry = bundle.manifest.files[file]
      if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error('UI file changed after activation')
      return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': csp, 'x-fullsite-ui-revision': bundle.manifest.revision,
      } })
    } catch { return new Response('El paquete instalado no pasó su verificación. Reinicia Fullsite para recuperar la versión anterior.', { status: 503, headers: { 'cache-control': 'no-store' } }) }
  }
}

async function installProtocol(session, bundle, port = 7717) {
  // Clear only executable caches, never cookies, localStorage or IndexedDB.
  // A SW from the old web app could otherwise replace our verified HTML/chunks.
  await session.clearStorageData({ origin: ORIGIN, storages: ['serviceworkers', 'cachestorage'] })
  await session.protocol.handle('https', createHandler(bundle, request => session.fetch(request, { bypassCustomProtocolHandlers: true }), port))
}

module.exports = { resolveRequest, createHandler, installProtocol }
