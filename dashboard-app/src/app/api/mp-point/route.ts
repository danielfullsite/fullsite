import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { action, accessToken, deviceId, amount, orderId, description } = await request.json()

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
            description: description || 'Fullsite POS',
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

    return Response.json({ error: 'Accion no valida' }, { status: 400 })
  } catch (error) {
    console.error('MP Point API error:', error)
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
