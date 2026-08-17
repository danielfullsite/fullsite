// Service Worker — Fullsite POS offline-first
// Caches app shell, static assets, and API responses for true offline operation

const CACHE_VERSION = 'v35'
const STATIC_CACHE = `fullsite-static-${CACHE_VERSION}`
const DYNAMIC_CACHE = `fullsite-dynamic-${CACHE_VERSION}`
const API_CACHE = `fullsite-api-${CACHE_VERSION}`

// App shell — always cache these
const STATIC_ASSETS = [
  '/',
  '/pos',
  '/pos/mesas',
  '/pos/plano',
  '/pos/cocina',
  '/pos/barra',
  '/pos/kds',
  '/kds', // ruta top-level que carga la VENTANA KDS del Electron (createKdsWindow → KDS_URL=/kds). Distinta de /pos/kds. Sin esto, la maquina kds_only da pantalla negra offline (#35).
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

// API patterns to cache (Supabase REST) — network-first with offline fallback
const API_CACHE_PATTERNS = [
  /\/rest\/v1\/pos_menu/,
  /\/rest\/v1\/pos_ingredients/,
  /\/rest\/v1\/pos_recipes/,
  /\/rest\/v1\/pos_staff/,
  /\/rest\/v1\/pos_payment_methods/,
  /\/rest\/v1\/pos_turnos/,
]

// API patterns that should NEVER be cached (mutations, auth)
const NEVER_CACHE_PATTERNS = [
  /\/auth\//,
  /\/api\/mp-point/,
  // Datos dinámicos que NUNCA deben servirse viejos offline. El catch-all
  // (staleWhileRevalidate) servía cache stale de:
  //  - pos_orders: el phantom-check del POS creía que había orden en la mesa →
  //    addOrderItems (online-only) tronaba → la comanda no llegaba al KDS.
  //  - pos_mesas: el grid mostraba 1 mesa (respuesta vieja) en vez de las 33 reales.
  // Sin intercept, offline el fetch falla limpio y cada consumidor cae a su
  // propio fallback (phantom-check → crear+encolar+bridge; mesas → MESAS_CONFIG;
  // KDS → IndexedDB alimentado por el bridge).
  /\/rest\/v1\/pos_orders/,
  /\/rest\/v1\/pos_mesas/,
]

self.addEventListener('install', (event) => {
  console.log('[SW] Installing...')
  event.waitUntil(
    (async () => {
      // Phase 1: cache HTML app shells
      const staticCache = await caches.open(STATIC_CACHE)
      await Promise.allSettled(
        STATIC_ASSETS.map((url) => staticCache.add(url).catch(() => {
          console.warn(`[SW] Failed to cache: ${url}`)
        }))
      )

      // Phase 2: pre-cache all Next.js JS/CSS chunks. Cada ruta de Next.js hace
      // code-split → carga chunks DISTINTOS. Antes solo se cacheaba /pos, así que
      // entrar a /pos/kds, /pos/cocina, /pos/mesas… offline daba PANTALLA NEGRA
      // (el HTML carga pero falta el chunk de esa ruta → React no monta). Ahora
      // recorremos TODAS las rutas del POS y cacheamos la unión de sus chunks.
      try {
        const routesToWarm = STATIC_ASSETS.filter((u) => u === '/' || u.startsWith('/pos') || u === '/kds')
        const chunkUrls = new Set()
        await Promise.allSettled(
          routesToWarm.map(async (route) => {
            try {
              const res = await fetch(route, { cache: 'reload' })
              if (!res.ok) return
              const html = await res.text()
              const regex = /"(\/_next\/static\/[^"]+\.(js|css))"/g
              let m
              while ((m = regex.exec(html)) !== null) chunkUrls.add(m[1])
            } catch { /* ruta individual falla → seguimos con las demás */ }
          })
        )
        const urls = [...chunkUrls]
        const results = await Promise.allSettled(
          urls.map((url) =>
            fetch(url, { cache: 'reload' })
              .then((r) => { if (r.ok) return staticCache.put(url, r) })
              .catch(() => {})
          )
        )
        const ok = results.filter((r) => r.status === 'fulfilled').length
        console.log(`[SW] Pre-cached ${ok}/${urls.length} Next.js chunks across ${routesToWarm.length} routes`)
      } catch (e) {
        console.warn('[SW] Chunk pre-cache skipped (warm-cache will cover on next online load):', e.message)
      }

      self.skipWaiting()
    })()
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
    // Try exact URL first, then ignore query params (e.g. /pos?mesa=3 → /pos).
    // ignoreVary: las respuestas de Next.js App Router traen Vary: rsc, next-router-*
    // → una navegación cliente (router.push a /pos?mesa=1 con headers RSC) NO empataba
    // con el /pos cacheado (Vary mismatch) → caía a la página offline aunque /pos SÍ
    // estaba en cache. ignoreVary hace que empate sin importar esos headers.
    const cached = await caches.match(request) ||
      await caches.match(request, { ignoreSearch: true, ignoreVary: true })
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

  // Fallback offline: si el match exacto no dio y la red falló, intenta el mismo
  // recurso ignorando query y Vary (navegación RSC de Next.js → /pos cacheado).
  return cached || (await networkFetch) ||
    (await caches.match(request, { ignoreSearch: true, ignoreVary: true })) ||
    new Response('Offline', { status: 503 })
}

// ─── Offline HTML ──────────────────────────────────────────────────────────

function offlineHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Fullsite POS — Sin conexion</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .container { text-align: center; padding: 2rem; max-width: 420px; }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #999; margin-bottom: 1.5rem; line-height: 1.6; }
    .btn { display: block; width: 100%; padding: 0.75rem 1.5rem; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; margin-bottom: 0.75rem; }
    .btn-green { background: #10b981; color: #fff; font-weight: 600; }
    .btn-green:hover { background: #059669; }
    .btn-outline { background: transparent; color: #6b7280; border: 1px solid #374151; }
    .btn-outline:hover { color: #9ca3af; border-color: #6b7280; }
    .hint { font-size: 0.75rem; color: #6b7280; margin-bottom: 1rem; }
    .scene-c { background: #1c1000; border: 1px solid #713f12; border-radius: 8px; padding: 12px 14px; margin-bottom: 1rem; font-size: 0.8rem; color: #fbbf24; text-align: left; line-height: 1.5; display: none; }
    .status { margin-top: 1rem; font-size: 0.7rem; color: #444; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#128268;</div>
    <h1>Sin conexion</h1>
    <p>El POS sigue funcionando en modo offline.<br>Los pedidos se guardan localmente y se sincronizan cuando vuelva el internet.</p>
    <div class="scene-c" id="sceneC">
      Para usar modo offline necesitas haber abierto esta pagina con internet al menos una vez. Conecta internet y recarga para instalar la version local.
    </div>
    <button class="btn btn-green" id="btnContinue" style="display:none" onclick="goOffline()">
      Continuar en modo offline
    </button>
    <p class="hint" id="hint" style="display:none">Version local disponible — los pedidos se guardan aqui.</p>
    <button class="btn btn-outline" onclick="location.reload()">Reintentar conexion</button>
    <div class="status" id="status">Verificando version local...</div>
  </div>
  <script>
    // Read the original URL passed by Electron via ?target= query param.
    // goOffline() navigates TO that URL so the service worker (registered for
    // https://app.fullsite.mx) can intercept and serve the page from disk cache.
    // location.reload() would just reload this file:// page — SW never fires.
    var params = new URLSearchParams(window.location.search);
    var targetUrl = params.get('target') || 'https://app.fullsite.mx/pos';

    function checkCache() {
      // Cannot access cross-origin SW cache from file:// context.
      // Just show the button — if the SW has a cached version, navigation will succeed.
      document.getElementById('btnContinue').style.display = 'block';
      document.getElementById('hint').style.display = 'block';
      document.getElementById('status').textContent = 'Version local disponible';
      scheduleAutoRedirect();
    }

    var autoTimer = null;
    function scheduleAutoRedirect() {
      if (autoTimer) return;
      var secs = 3;
      var hint = document.getElementById('hint');
      function tick() {
        if (hint) hint.textContent = 'Abriendo en modo offline en ' + secs + 's...';
        if (secs <= 0) { clearInterval(autoTimer); goOffline(); }
        secs--;
      }
      tick();
      autoTimer = setInterval(tick, 1000);
    }

    function goOffline() {
      if (autoTimer) clearInterval(autoTimer);
      // Navigate to the original app URL — the SW intercepts and serves from cache.
      window.location.href = targetUrl;
    }

    // Auto-retry network every 10s
    setInterval(function() {
      fetch(targetUrl, { cache: 'no-store' })
        .then(function(r) { if (r.ok) window.location.reload(); })
        .catch(function() {});
    }, 10000);

    checkCache();
  </script>
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

// ─── Notification click handler ───────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/pos'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus()
      }
      // Otherwise open a new tab
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})

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
