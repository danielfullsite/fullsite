// Service Worker registration and lifecycle management

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    console.warn('[SW] Service workers not supported')
    return null
  }

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
