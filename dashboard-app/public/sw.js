// ⚠️ KILL SWITCH — Service Worker DESACTIVADO a propósito (P0 login iOS 2026-08-31).
//
// Qué pasó: un Service Worker viejo quedaba atascado en Safari/Chrome iOS y servía
// las NAVEGACIONES con la bandera `redirected` puesta → WebKit las rechaza con
// "Response served by service worker has redirections". Efecto: al iniciar sesión,
// TODAS las cuentas menos admin (admin va a /platform, no pre-cacheada; el resto a
// / o /pos, sí pre-cacheadas) tronaban. El servidor NO redirige ninguna ruta
// (verificado server-side: /, /pos, /login → 200), así que un navegador SIN service
// worker inicia sesión sin problema. El intento de auto-sanar (v42 stripRedirect +
// #275) no alcanzaba al dispositivo porque el SW viejo servía el /login viejo desde
// su propia caché y el código nuevo nunca corría — callejón sin salida.
//
// Este SW es un "kill switch": al activarse borra TODAS las cachés, se DESREGISTRA
// solo y recarga las ventanas para que queden sin controlador. Cualquier navegador
// que lo adopte (por el update-check del navegador, que re-baja /sw.js porque se
// sirve `must-revalidate`) queda limpio y permanente sin SW. Además
// registerServiceWorker() (ver src/lib/service-worker.ts) quedó neutralizado: en vez
// de registrar, desregistra — así nada lo vuelve a poner. Y /reset.html cura a mano
// los dispositivos cuyo update-check no dispara.
//
// El offline del POS queda PAUSADO. Re-habilitarlo requiere revertir esto Y mover la
// navegación offline fuera del Service Worker (al servidor local del Electron, como
// FloCafe), para que el offline nunca vuelva a poder romper el login. AMALAY sigue
// operando en Wansoft, así que esta pausa no afecta operación en vivo.
//
// Rollback: revertir este commit (vuelve el SW offline v42) — pero primero resolver
// la adopción, o el bug de login vuelve.

self.addEventListener('install', () => {
  // Tomar control de inmediato, sin quedarse en "waiting".
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1) Borrar TODAS las cachés (ahí viven /login y las navegaciones viejas).
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } catch (e) { /* continuar */ }

    // 2) Desregistrar este propio Service Worker.
    try { await self.registration.unregister() } catch (e) { /* continuar */ }

    // 3) Recargar las ventanas abiertas para que carguen SIN controlador
    //    (con el SW ya fuera, la navegación va directo a la red → sin el error).
    try {
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const c of clients) {
        try { await c.navigate(c.url) } catch (e) { /* algunas no permiten navigate */ }
      }
    } catch (e) { /* continuar */ }
  })())
})

// Sin handler de 'fetch': el navegador resuelve TODO directo contra la red.
// (Un SW sin fetch handler no intercepta nada; combinado con el unregister de
//  arriba, el origen queda efectivamente sin Service Worker.)
