// Mercado Pago Point integration
// Config stored in localStorage for now (device ID + access token)

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
    const res = await fetch('https://api.mercadopago.com/point/integration-api/devices', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })
    if (res.ok) {
      const data = await res.json()
      return { success: true, devices: data.devices || data }
    } else {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.message || `Error ${res.status}` }
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Error de conexion' }
  }
}

export async function sendPaymentToPoint(
  amount: number,
  orderId: string,
  description?: string
): Promise<{ success: boolean; intentId?: string; error?: string }> {
  const config = getMPConfig()
  if (!config) return { success: false, error: 'Point no configurado' }

  try {
    const res = await fetch(
      `https://api.mercadopago.com/point/integration-api/devices/${config.deviceId}/payment-intents`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100),
          additional_info: {
            external_reference: orderId,
            print_on_terminal: true,
          },
          description: description || 'Fullsite POS',
        }),
      }
    )

    if (res.ok) {
      const data = await res.json()
      return { success: true, intentId: data.id }
    } else {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.message || `Error ${res.status}` }
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Error de conexion' }
  }
}
