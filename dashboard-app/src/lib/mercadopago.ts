// Mercado Pago Point — full integration via /api/mp-point proxy

export interface MPConfig {
  accessToken: string
  deviceId: string
}

export interface MPDevice {
  id: string
  pos_id: number
  store_id: string
  external_pos_id: string
  operating_mode: string
}

export type PaymentStatus = 'pending' | 'processing' | 'approved' | 'rejected' | 'cancelled' | 'error'

export function getMPConfig(): MPConfig | null {
  if (typeof window === 'undefined') return null
  const config = localStorage.getItem('mp_point_config')
  return config ? JSON.parse(config) : null
}

export function saveMPConfig(config: MPConfig) {
  localStorage.setItem('mp_point_config', JSON.stringify(config))
}

export function clearMPConfig() {
  localStorage.removeItem('mp_point_config')
}

export async function fetchMPDevices(accessToken: string): Promise<{ success: boolean; devices?: MPDevice[]; error?: string }> {
  try {
    const res = await fetch('/api/mp-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'devices', accessToken }),
    })
    if (res.ok) {
      const data = await res.json()
      return { success: true, devices: data.devices || data }
    }
    const err = await res.json().catch(() => ({}))
    return { success: false, error: err.message || err.error || `Error ${res.status}` }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Error de conexion' }
  }
}

export async function sendPaymentToPoint(
  amount: number,
  orderId: string,
): Promise<{ success: boolean; intentId?: string; error?: string }> {
  const config = getMPConfig()
  if (!config) return { success: false, error: 'Point no configurado' }

  try {
    const res = await fetch('/api/mp-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'payment',
        accessToken: config.accessToken,
        deviceId: config.deviceId,
        amount,
        orderId,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      return { success: true, intentId: data.data?.id }
    }
    const err = await res.json().catch(() => ({}))
    return { success: false, error: err.error || err.message || `Error ${res.status}` }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Error de conexion' }
  }
}

export async function checkPaymentStatus(
  paymentIntentId: string
): Promise<{ status: PaymentStatus; paymentId?: string; error?: string }> {
  const config = getMPConfig()
  if (!config) return { status: 'error', error: 'Point no configurado' }

  try {
    const res = await fetch('/api/mp-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'status',
        accessToken: config.accessToken,
        paymentIntentId,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      // MP returns status: open, on_terminal, processing, processed, cancelled, abandoned, error
      const statusMap: Record<string, PaymentStatus> = {
        open: 'pending',
        on_terminal: 'processing',
        processing: 'processing',
        processed: 'approved',
        cancelled: 'cancelled',
        abandoned: 'cancelled',
        error: 'error',
      }
      return {
        status: statusMap[data.state || data.status] || 'pending',
        paymentId: data.payment?.id?.toString(),
      }
    }
    return { status: 'error', error: 'Error al verificar status' }
  } catch {
    return { status: 'error', error: 'Error de conexion' }
  }
}

export async function cancelPaymentIntent(): Promise<{ success: boolean; error?: string }> {
  const config = getMPConfig()
  if (!config) return { success: false, error: 'Point no configurado' }

  try {
    const res = await fetch('/api/mp-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'cancel',
        accessToken: config.accessToken,
        deviceId: config.deviceId,
      }),
    })

    const data = await res.json()
    return { success: data.success || false, error: data.error }
  } catch {
    return { success: false, error: 'Error de conexion' }
  }
}

// Poll payment status until resolved (approved/rejected/cancelled/error)
export function pollPaymentStatus(
  intentId: string,
  onUpdate: (status: PaymentStatus, paymentId?: string) => void,
  intervalMs = 2000,
  maxAttempts = 60 // 2 min max
): () => void {
  let attempts = 0
  let cancelled = false

  const poll = async () => {
    if (cancelled || attempts >= maxAttempts) {
      if (!cancelled) onUpdate('error')
      return
    }
    attempts++

    const result = await checkPaymentStatus(intentId)
    onUpdate(result.status, result.paymentId)

    if (result.status === 'approved' || result.status === 'rejected' || result.status === 'cancelled' || result.status === 'error') {
      return // Done polling
    }

    setTimeout(poll, intervalMs)
  }

  poll()

  // Return cancel function
  return () => { cancelled = true }
}
