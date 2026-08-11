'use strict'
// ─── Static UI bundle server (Offline Shell) ─────────────────────────────────
// Serves the Next.js `output: export` bundle (dashboard-app/out) from disk so:
//   1. The POS opens with ZERO internet (kills the black screen), and
//   2. LAN clients (KDS, secondary terminals) load from an http:// origin,
//      which unblocks ws:// + http:// calls to this bridge (no mixed-content).
//
// SAFE BY DEFAULT: disabled unless `staticRoot` is provided. When absent,
// serveStatic() returns false and the router falls through to its 404 —
// i.e. the current cloud-loading behavior is unchanged until Electron opts in.
//
// Next export writes one .html per route (out/pos.html, out/pos/cocina.html),
// so route → file resolution is deterministic; no SPA rewrite needed for hard
// loads. A text/html fallback to pos.html covers unknown navigations.

const fs   = require('fs')
const path = require('path')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico':  'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8',
}

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

// Resolve a URL pathname to a real file inside `rootAbs` (absolute, normalized),
// following Next export conventions. Returns an absolute path or null.
// Guards against path traversal: the resolved path must stay within rootAbs.
function resolveFile(rootAbs, pathname) {
  let rel
  try { rel = decodeURIComponent(pathname) } catch { rel = pathname }
  rel = rel.replace(/^\/+/, '')
  if (rel === '') rel = 'index.html'

  const candidates = [
    rel,                          // exact asset: /_next/..., /icon.png
    `${rel}.html`,                // route: /pos/cocina → pos/cocina.html
    path.join(rel, 'index.html'), // dir: /pos → pos/index.html
  ]

  for (const c of candidates) {
    const abs = path.resolve(rootAbs, c)
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) continue // traversal guard
    try {
      if (fs.statSync(abs).isFile()) return abs
    } catch { /* try next candidate */ }
  }
  return null
}

// Serve a static file for GET/HEAD. Returns true if it wrote a response,
// false to let the caller fall through (API routes, unknown assets, disabled).
function serveStatic(staticRoot, req, res) {
  if (!staticRoot) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') return false

  const rootAbs = path.resolve(staticRoot)
  const pathname = (req.url || '/').split('?')[0]
  const file = resolveFile(rootAbs, pathname)

  if (!file) {
    // Navigation fallback: serve the POS shell for html requests we can't map.
    const accept = req.headers['accept'] || ''
    if (accept.includes('text/html')) {
      const shell = path.resolve(rootAbs, 'pos.html')
      if (shell.startsWith(rootAbs) && fs.existsSync(shell)) {
        const body = fs.readFileSync(shell)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
        res.end(req.method === 'HEAD' ? undefined : body)
        return true
      }
    }
    return false
  }

  const isHashedAsset = file.includes(`${path.sep}_next${path.sep}`)
  res.writeHead(200, {
    'Content-Type': contentType(file),
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') { res.end(); return true }
  fs.createReadStream(file).pipe(res)
  return true
}

module.exports = { serveStatic, resolveFile, contentType }
