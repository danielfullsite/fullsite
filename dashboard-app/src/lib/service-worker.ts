// Service Worker registration and lifecycle management
let registrationTask: Promise<ServiceWorkerRegistration | null> | null = null
let stopLifecycle: (() => void) | null = null

function offlineDisabled() {
  // Electron serves one verified installed release. A web SW must never mix
  // older cached HTML/chunks into that release. Main clears this marker on exit
  // from packaged mode; browser installations keep the existing SW lifecycle.
  return localStorage.getItem('FULLSITE_OFFLINE_DISABLED') === '1' || Boolean(localStorage.getItem('FULLSITE_UI_PACKAGE'))
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }

  // Rollback: DevTools → localStorage.setItem('FULLSITE_OFFLINE_DISABLED','1') → reload
  if (offlineDisabled()) {
    // Wait out a registration already started by another mounted component.
    // Otherwise it could finish AFTER unregister and silently undo rollback.
    await registrationTask
    stopLifecycle?.()
    stopLifecycle = null
    registrationTask = null
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const reg of registrations) await reg.unregister()
      if (registrations.length > 0) console.log('[SW] Disabled via flag, unregistered', registrations.length, 'workers')
    } catch {}
    return null
  }

  if (!registrationTask) {
    registrationTask = registerAndManageWorker().then(registration => {
      if (!registration) registrationTask = null // transient failures may retry
      return registration
    })
  }
  return registrationTask
}

async function registerAndManageWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    })

    if (offlineDisabled()) {
      await registration.unregister()
      return null
    }

    console.log('[SW] Registered, scope:', registration.scope)

    // Listen for updates
    const onUpdateFound = () => {
      const newWorker = registration.installing
      if (!newWorker) return

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          console.log('[SW] New version activated')
        }
      })
    }
    registration.addEventListener('updatefound', onUpdateFound)

    // Auto-update: check every 30 min so mid-day deploys are picked up even if offline
    const update = () => { if (!offlineDisabled()) void registration.update().catch(() => {}) }
    const updateTimer = setInterval(update, 30 * 60 * 1000)

    // Also check when the tab comes back to foreground
    const onVisibility = () => { if (document.visibilityState === 'visible') update() }
    document.addEventListener('visibilitychange', onVisibility)

    // When a new SW takes control, reload automatically if on a safe page (not mid-order)
    const onControllerChange = () => {
      if (offlineDisabled()) return
      const path = window.location.pathname
      if (path === '/pos/mesas') {
        console.log('[SW] New version ready — reloading mesas')
        window.location.reload()
      } else {
        console.log('[SW] New version ready — will activate on next navigation to mesas')
      }
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    // Register for background sync if supported
    if ('sync' in registration) {
      try {
        await (registration as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register('sync-orders')
      } catch {
        // Background sync not supported in all browsers
      }
    }

    // Listen for sync messages from SW
    const onMessage = (event: MessageEvent) => {
      if (!offlineDisabled() && event.data?.type === 'SYNC_REQUESTED') {
        // Trigger sync from the main thread
        window.dispatchEvent(new CustomEvent('sw-sync-requested'))
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    stopLifecycle = () => {
      clearInterval(updateTimer)
      registration.removeEventListener('updatefound', onUpdateFound)
      document.removeEventListener('visibilitychange', onVisibility)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      navigator.serviceWorker.removeEventListener('message', onMessage)
    }

    return registration
  } catch (error) {
    console.error('[SW] Registration failed:', error)
    return null
  }
}

export async function updateServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || offlineDisabled()) return

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
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || offlineDisabled() || !navigator.serviceWorker.controller) return
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
