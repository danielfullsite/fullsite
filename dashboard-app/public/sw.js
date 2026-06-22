// Service Worker — Fullsite POS offline-first
// Caches app shell, static assets, and API responses for true offline operation

const CACHE_VERSION = 'v2'
const STATIC_CACHE = `fullsite-static-${CACHE_VERSION}`
const DYNAMIC_CACHE = `fullsite-dynamic-${CACHE_VERSION}`
const API_CACHE = `fullsite-api-${CACHE_VERSION}`

// App shell — always cache these
const STATIC_ASSETS = [
  '/',
  '/pos',
  '/pos/mesas',
  '/pos/cocina',
  '/pos/barra',
  '/pos/kds',
  '/pos/corte',
  '/pos/historial',
  '/pos/inventario',
  '/pos/compras',
  '/pos/recetas',
  '/pos/turno',
  '/pos/panaderia',
  '/pos/delivery',
  '/pos/cliente',
  '/pos/facturacion',
  '/pos/auditoria',
  '/manifest.json',
  '/icon-192v2.png',
  '/icon-512v2.png',
]

// API patterns to cache (Supabase REST)
const API_CACHE_PATTERNS = [
  /\/rest\/v1\/pos_menu/,
  /\/rest\/v1\/pos_ingredients/,
  /\/rest\/v1\/pos_recipes/,
  /\/rest\/v1\/pos_staff/,
]

// API patterns that should NEVER be cached (mutations, auth)
const NEVER_CACHE_PATTERNS = [
  /\/auth\//,
  /\/api\/mp-point/,
]

self.addEventListener('install', (event) => {
  console.log('[SW] Installing...')
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Cache static assets — don't fail install if some are missing
      return Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => {
          console.warn(`[SW] Failed to cache: ${url}`)
        }))
      )
    }).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...')
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => {
          return key !== STATIC_CACHE && key !== DYNAMIC_CACHE && key !== API_CACHE
        }).map((key) => {
          console.log(`[SW] Deleting old cache: ${key}`)
          return caches.delete(key)
        })
      )
    }).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests (mutations go to sync queue)
  if (request.method !== 'GET') return

  // Skip chrome-extension and other non-http
  if (!url.protocol.startsWith('http')) return

  // Print bridge local (127.0.0.1:7717): nunca interceptar —
  // printer.ts maneja su propia detección y fallback (BT/CSS)
  if (url.port === '7717') return

  // Never cache auth or payment endpoints
  if (NEVER_CACHE_PATTERNS.some((p) => p.test(url.pathname))) return

  // API requests: network-first with cache fallback
  if (url.hostname.includes('supabase.co') && API_CACHE_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(networkFirstWithCache(request, API_CACHE))
    return
  }

  // Next.js data/API: network-first
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data/')) {
    event.respondWith(networkFirstWithCache(request, DYNAMIC_CACHE))
    return
  }

  // Static assets (JS, CSS, images): cache-first
  if (url.pathname.startsWith('/_next/static/') || url.pathname.match(/\.(png|jpg|svg|ico|woff2?)$/)) {
    event.respondWith(cacheFirstWithNetwork(request, STATIC_CACHE))
    return
  }

  // HTML pages: network-first (always try fresh)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithCache(request, DYNAMIC_CACHE))
    return
  }

  // Everything else: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE))
})

// ─── Caching Strategies ────────────────────────────────────────────────────

async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    // Return offline page for HTML requests
    if (request.headers.get('accept')?.includes('text/html')) {
      return new Response(offlineHTML(), {
        headers: { 'Content-Type': 'text/html' },
      })
    }
    return new Response('Offline', { status: 503 })
  }
}

async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const networkFetch = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  }).catch(() => null)

  return cached || (await networkFetch) || new Response('Offline', { status: 503 })
}

// ─── Offline HTML ──────────────────────────────────────────────────────────

function offlineHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Fullsite POS — Offline</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .container { text-align: center; padding: 2rem; }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #999; margin-bottom: 1.5rem; }
    button { padding: 0.75rem 2rem; background: #2563eb; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .status { margin-top: 1rem; font-size: 0.875rem; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#128268;</div>
    <h1>Sin conexion</h1>
    <p>El POS sigue funcionando en modo offline.<br>Las ordenes se sincronizaran cuando vuelva el internet.</p>
    <button onclick="location.reload()">Reintentar</button>
    <div class="status">Modo offline activo — datos guardados localmente</div>
  </div>
</body>
</html>`
}

// ─── Background Sync ───────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingOrders())
  }
})

async function syncPendingOrders() {
  // Notify all clients to trigger their sync queues
  const clients = await self.clients.matchAll()
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_REQUESTED' })
  }
}

// ─── Push Notifications (future) ───────────────────────────────────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
  if (event.data?.type === 'CACHE_URLS') {
    const urls = event.data.urls || []
    caches.open(DYNAMIC_CACHE).then((cache) => {
      cache.addAll(urls).catch(() => {})
    })
  }
})
