// Service Worker registration and lifecycle management

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }

  // Unregister any existing service worker — SW caching causes stale code issues
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    for (const reg of registrations) {
      await reg.unregister()
    }
    if (registrations.length > 0) console.log('[SW] Unregistered', registrations.length, 'service workers')
  } catch {}

  return null

  // Registration disabled — SW caching causes stale POS code
  /* eslint-disable no-unreachable */
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    })

    console.log('[SW] Registered, scope:', registration.scope)

    // Listen for updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing
      if (!newWorker) return

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          console.log('[SW] New version activated')
        }
      })
    })

    // Register for background sync if supported
    if ('sync' in registration) {
      try {
        await (registration as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register('sync-orders')
      } catch {
        // Background sync not supported in all browsers
      }
    }

    // Listen for sync messages from SW
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SYNC_REQUESTED') {
        // Trigger sync from the main thread
        window.dispatchEvent(new CustomEvent('sw-sync-requested'))
      }
    })

    return registration
  } catch (error) {
    console.error('[SW] Registration failed:', error)
    return null
  }
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
