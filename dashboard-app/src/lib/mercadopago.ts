// Mercado Pago Point — full integration via /api/mp-point proxy
// Supports Point Smart (full API) and Point Mini (basic only)

export type DeviceModel = 'SMART' | 'MINI' | 'UNKNOWN'

export interface MPConfig {
  accessToken: string
  deviceId: string
  deviceModel: DeviceModel
}

export interface MPDevice {
  id: string
  pos_id: number
  store_id: string
  external_pos_id: string
  operating_mode: string
  model?: string
}

export type PaymentStatus = 'pending' | 'processing' | 'approved' | 'rejected' | 'cancelled' | 'error'

export interface PointSmartPaymentOptions {
  installments?: number          // Cuotas (1, 3, 6, 9, 12, 18)
  installments_cost?: 'buyer' | 'seller'  // Quien paga las cuotas
  tip_enabled?: boolean          // Permitir propina en terminal
  print_on_terminal?: boolean    // Imprimir voucher en terminal
}

export interface RefundResult {
  success: boolean
  refundId?: string
  error?: string
}

export interface DeviceStatus {
  id: string
  operating_mode: string
  model?: string
  battery_level?: number
  wifi_connected?: boolean
  firmware_version?: string
}

export function getMPConfig(): MPConfig | null {
  if (typeof window === 'undefined') return null
  const config = localStorage.getItem('mp_point_config')
  if (!config) return null
  const parsed = JSON.parse(config)
  // Migration: add deviceModel if missing
  if (!parsed.deviceModel) parsed.deviceModel = 'UNKNOWN'
  return parsed
}

export function saveMPConfig(config: MPConfig) {
  localStorage.setItem('mp_point_config', JSON.stringify(config))
}

export function clearMPConfig() {
  localStorage.removeItem('mp_point_config')
}

export function isPointSmart(): boolean {
  const config = getMPConfig()
  return config?.deviceModel === 'SMART'
}

export function detectDeviceModel(device: MPDevice): DeviceModel {
  const model = (device.model || '').toUpperCase()
  if (model.includes('SMART') || model.includes('S1')) return 'SMART'
  if (model.includes('MINI') || model.includes('M1')) return 'MINI'
  // Smart supports PDV mode, Mini doesn't
  if (device.operating_mode === 'PDV') return 'SMART'
  return 'UNKNOWN'
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
  smartOptions?: PointSmartPaymentOptions,
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
        // Point Smart options (ignored for Mini)
        ...(config.deviceModel === 'SMART' && smartOptions ? {
          installments: smartOptions.installments,
          installments_cost: smartOptions.installments_cost,
          tip_enabled: smartOptions.tip_enabled,
          print_on_terminal: smartOptions.print_on_terminal ?? true,
        } : {}),
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

// ─── POINT SMART EXCLUSIVE FEATURES ────────────────────────────────────────

export async function refundPayment(
  paymentId: string,
  amount?: number // partial refund amount, omit for full refund
): Promise<RefundResult> {
  const config = getMPConfig()
  if (!config) return { success: false, error: 'Point no configurado' }
  if (config.deviceModel !== 'SMART') return { success: false, error: 'Reembolsos solo disponibles en Point Smart' }

  try {
    const res = await fetch('/api/mp-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'refund',
        accessToken: config.accessToken,
        paymentId,
        amount,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      return { success: true, refundId: data.id?.toString() }
    }
    const err = await res.json().catch(() => ({}))
    return { success: false, error: err.error || err.message || `Error ${res.status}` }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Error de conexion' }
  }
}

export async function getDeviceStatus(): Promise<DeviceStatus | null> {
  const config = getMPConfig()
  if (!config) return null

  try {
    const res = await fetch('/api/mp-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'device-status',
        accessToken: config.accessToken,
        deviceId: config.deviceId,
      }),
    })

    if (res.ok) return await res.json()
    return null
  } catch {
    return null
  }
}

export async function changeOperatingMode(
  mode: 'PDV' | 'STANDALONE'
): Promise<{ success: boolean; error?: string }> {
  const config = getMPConfig()
  if (!config) return { success: false, error: 'Point no configurado' }
  if (config.deviceModel !== 'SMART') return { success: false, error: 'Solo Point Smart soporta cambio de modo' }

  try {
    const res = await fetch('/api/mp-point', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'change-mode',
        accessToken: config.accessToken,
        deviceId: config.deviceId,
        mode,
      }),
    })

    const data = await res.json()
    return { success: data.success || res.ok, error: data.error }
  } catch {
    return { success: false, error: 'Error de conexion' }
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
