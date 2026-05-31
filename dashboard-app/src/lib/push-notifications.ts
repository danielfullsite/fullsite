// Push Notification utilities
// VAPID key pair should be generated and stored in env vars:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY — for client subscription
//   VAPID_PRIVATE_KEY — for server-side push sending

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
}

export async function getPushPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) return 'denied'
  return Notification.permission
}

export async function requestPushPermission(): Promise<boolean> {
  if (!isPushSupported()) return false
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) return null

  const permission = await requestPushPermission()
  if (!permission) return null

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  })

  // Send subscription to backend
  await saveSubscription(subscription)

  return subscription
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function unsubscribeFromPush(): Promise<boolean> {
  const subscription = await getExistingSubscription()
  if (!subscription) return true
  const success = await subscription.unsubscribe()
  if (success) {
    await removeSubscription(subscription)
  }
  return success
}

// Save subscription to Supabase
async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return

  await fetch(`${supabaseUrl}/rest/v1/push_subscriptions`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: JSON.stringify(subscription.toJSON().keys),
      client_id: typeof window !== 'undefined' ? (localStorage.getItem('fullsite_client_id') || 'amalay') : 'amalay',
      created_at: new Date().toISOString(),
    }),
  })
}

async function removeSubscription(subscription: PushSubscription): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return

  await fetch(
    `${supabaseUrl}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    }
  )
}

// Send a local notification (no server required)
export async function sendLocalNotification(title: string, body: string, url?: string): Promise<void> {
  if (!isPushSupported()) return
  if (Notification.permission !== 'granted') return

  const registration = await navigator.serviceWorker.ready
  await registration.showNotification(title, {
    body,
    icon: '/pwa/icons/icon-192.png',
    badge: '/pwa/icons/icon-96.png',
    data: url ? { url } : {},
    tag: 'fullsite-local',
  })
}
