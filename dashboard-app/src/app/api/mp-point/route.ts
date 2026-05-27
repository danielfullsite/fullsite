import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { action, accessToken, deviceId, amount, orderId, paymentIntentId } = await request.json()

    if (!accessToken) {
      return Response.json({ error: 'Access token requerido' }, { status: 400 })
    }

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    // List devices
    if (action === 'devices') {
      const res = await fetch('https://api.mercadopago.com/point/integration-api/devices', { headers })
      const data = await res.json()
      return Response.json(data)
    }

    // Send payment intent
    if (action === 'payment') {
      if (!deviceId || !amount) {
        return Response.json({ error: 'deviceId y amount requeridos' }, { status: 400 })
      }

      const res = await fetch(
        `https://api.mercadopago.com/point/integration-api/devices/${deviceId}/payment-intents`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            amount: Math.round(amount * 100),
            additional_info: {
              external_reference: orderId || 'fullsite-pos',
              print_on_terminal: true,
            },
          }),
        }
      )

      const data = await res.json()
      if (res.ok) {
        return Response.json({ success: true, data })
      } else {
        return Response.json({ success: false, error: data.message || 'Error de Mercado Pago', data }, { status: res.status })
      }
    }

    // Check payment intent status
    if (action === 'status') {
      if (!paymentIntentId) {
        return Response.json({ error: 'paymentIntentId requerido' }, { status: 400 })
      }

      const res = await fetch(
        `https://api.mercadopago.com/point/integration-api/payment-intents/${paymentIntentId}`,
        { headers }
      )

      const data = await res.json()
      return Response.json(data)
    }

    // Cancel payment intent
    if (action === 'cancel') {
      if (!deviceId) {
        return Response.json({ error: 'deviceId requerido' }, { status: 400 })
      }

      const res = await fetch(
        `https://api.mercadopago.com/point/integration-api/devices/${deviceId}/payment-intents`,
        { method: 'DELETE', headers }
      )

      if (res.ok || res.status === 204) {
        return Response.json({ success: true })
      }
      const data = await res.json().catch(() => ({}))
      return Response.json({ success: false, error: data.message || 'Error al cancelar' })
    }

    // Get last payment status for device
    if (action === 'last-payment') {
      if (!deviceId) {
        return Response.json({ error: 'deviceId requerido' }, { status: 400 })
      }

      const res = await fetch(
        `https://api.mercadopago.com/point/integration-api/payment-intents/events?startDate=${new Date(Date.now() - 3600000).toISOString()}&endDate=${new Date().toISOString()}`,
        { headers }
      )

      const data = await res.json()
      return Response.json(data)
    }

    return Response.json({ error: 'Accion no valida' }, { status: 400 })
  } catch (error) {
    console.error('MP Point API error:', error)
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
