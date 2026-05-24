const CACHE_NAME = 'fullsite-v2';
const STATIC_ASSETS = [
  '/landing.html',
  '/pwa/icons/icon-192.png',
  '/pwa/icons/icon-512.png',
  '/pwa/icons/apple-touch-icon.png',
];

// Offline fallback page (inline)
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fullsite — Sin conexion</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Geist',system-ui,sans-serif;background:#060609;color:#efefed;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem;text-align:center}
.wrap{max-width:400px}
h1{font-size:1.5rem;font-weight:800;margin-bottom:.75rem;letter-spacing:.1em;text-transform:uppercase}
h1 em{color:#00ff88;font-style:normal}
p{color:#9090a8;line-height:1.6;margin-bottom:1.5rem;font-size:.95rem}
button{background:#00ff88;color:#000;border:none;padding:12px 28px;border-radius:100px;font-weight:700;font-size:.88rem;cursor:pointer;transition:transform .2s}
button:hover{transform:translateY(-2px)}
.dot{width:12px;height:12px;border-radius:50%;background:#ff4444;display:inline-block;margin-right:8px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style>
</head>
<body>
<div class="wrap">
<h1>FULL<em>SITE</em></h1>
<p><span class="dot"></span>Sin conexion a internet</p>
<p>Revisa tu conexion WiFi o datos moviles e intenta de nuevo.</p>
<button onclick="location.reload()">Reintentar</button>
</div>
</body>
</html>`;

// ── Install: cache static assets + offline page ──
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);
      // Cache offline fallback as a special key
      await cache.put('/_offline', new Response(OFFLINE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }));
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for navigation, stale-while-revalidate for assets ──
self.addEventListener('fetch', (e) => {
  const { request } = e;

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Navigation requests: network-first with offline fallback
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          // Cache successful navigation responses
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/_offline'))
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (request.url.match(/\.(js|css|png|jpg|jpeg|svg|woff2?|ico)$/)) {
    e.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return res;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: network-first
  e.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ── Push Notifications ──
self.addEventListener('push', (e) => {
  let data = { title: 'Fullsite', body: 'Nueva notificacion', icon: '/pwa/icons/icon-192.png' };

  if (e.data) {
    try {
      data = { ...data, ...e.data.json() };
    } catch {
      data.body = e.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/pwa/icons/icon-192.png',
    badge: '/pwa/icons/icon-96.png',
    vibrate: [100, 50, 100],
    data: data.url ? { url: data.url } : {},
    actions: data.actions || [],
    tag: data.tag || 'fullsite-notification',
    renotify: true,
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Notification click handler ──
self.addEventListener('notificationclick', (e) => {
  e.notification.close();

  const url = e.notification.data?.url || '/';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if possible
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});
