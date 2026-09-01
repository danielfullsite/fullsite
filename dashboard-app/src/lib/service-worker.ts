// Service Worker registration and lifecycle management

// ⚠️ Offline PAUSADO — Service Worker neutralizado (P0 login iOS 2026-08-31).
//
// Un SW viejo atascado servía las navegaciones con bandera `redirected` → Safari/
// Chrome iOS: "Response served by service worker has redirections" al iniciar sesión
// (todas las cuentas menos admin). En vez de REGISTRAR el SW, esta función ahora
// DESREGISTRA cualquier SW existente y borra sus cachés en cada carga que la invoque
// (/pos/layout). No registra ninguno nuevo. Complementa el kill switch de
// public/sw.js (que se auto-elimina vía el update-check del navegador) y /reset.html
// (recuperación manual). Re-habilitar offline = revertir esto + public/sw.js, y mover
// la navegación offline al servidor local del Electron para que no vuelva a romper
// el login. Ver también el flag legacy FULLSITE_OFFLINE_DISABLED (ya redundante).
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    for (const reg of registrations) {
      try { await reg.unregister() } catch { /* seguir */ }
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})))
    }
    if (registrations.length > 0) {
      console.log('[SW] Offline pausado — desregistrados', registrations.length, 'service worker(s) y cachés limpiadas')
    }
  } catch (error) {
    console.error('[SW] Limpieza de service worker falló:', error)
  }
  return null
}

export async function updateServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  const registration = await navigator.serviceWorker.getRegistration()
  if (registration) {
    await registration.update()
    // Tell waiting SW to take over
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  }
}

export async function precacheUrls(urls: string[]) {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({ type: 'CACHE_URLS', urls })
}

// ─── Push Notifications (local — no FCM, no server) ───────────────────────

/**
 * Ask the user for notification permission.
 * Safe to call multiple times — no-ops if already granted/denied.
 * Returns true if granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false

  const result = await Notification.requestPermission()
  return result === 'granted'
}

/**
 * Show a local notification via the Service Worker registration (preferred —
 * works in installed PWA / Chrome kiosk) or falls back to new Notification().
 *
 * @param title  Notification title
 * @param body   Notification body text
 * @param url    Optional URL to open when the notification is clicked
 */
export async function sendNotification(title: string, body: string, url?: string): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  const options: NotificationOptions = {
    body,
    icon: '/icon-192v2.png',
    badge: '/icon-192v2.png',
    tag: title, // deduplicate same-title notifications
    data: { url: url || '/pos' },
  }

  // Prefer SW registration (persistent in PWA, required on mobile)
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        await registration.showNotification(title, options)
        return
      }
    } catch {
      // fall through to Notification API
    }
  }

  // Fallback: Notification API (works in regular browser tab)
  try {
    new Notification(title, options)
  } catch {
    // ignore — some browsers block Notification constructor in service worker scope
  }
}
