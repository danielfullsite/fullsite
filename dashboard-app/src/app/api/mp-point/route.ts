import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    // Auth gate: require either a Supabase session cookie or the x-pos-staff header
    // that the POS sets from sessionStorage after PIN login.
    const hasPosStaff = !!request.headers.get('x-pos-staff')
    const hasSession = request.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))
    if (!hasPosStaff && !hasSession) {
      return Response.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { action, accessToken, deviceId, amount, orderId, paymentIntentId, paymentId, installments, installments_cost, tip_enabled, print_on_terminal, mode } = await request.json()

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

    // Send payment intent (supports Point Smart options)
    if (action === 'payment') {
      if (!deviceId || !amount) {
        return Response.json({ error: 'deviceId y amount requeridos' }, { status: 400 })
      }

      // Build payment body — Smart supports installments, tip, etc.
      const paymentBody: Record<string, unknown> = {
        amount: Math.round(amount * 100),
        additional_info: {
          external_reference: orderId || 'fullsite-pos',
          print_on_terminal: print_on_terminal ?? true,
        },
      }

      // Point Smart: installments
      if (installments && installments > 1) {
        paymentBody.installments = installments
        if (installments_cost) {
          paymentBody.installments_cost = installments_cost
        }
      }

      // Point Smart: tip enabled on terminal
      if (tip_enabled) {
        paymentBody.tip_enabled = true
      }

      const res = await fetch(
        `https://api.mercadopago.com/point/integration-api/devices/${deviceId}/payment-intents`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(paymentBody),
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

    // Refund a payment (Point Smart only)
    if (action === 'refund') {
      if (!paymentId) {
        return Response.json({ error: 'paymentId requerido' }, { status: 400 })
      }

      const refundBody: Record<string, unknown> = {}
      if (amount) refundBody.amount = Math.round(amount * 100)

      const res = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}/refunds`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(refundBody),
        }
      )

      const data = await res.json()
      if (res.ok) {
        return Response.json({ success: true, id: data.id })
      }
      return Response.json({ success: false, error: data.message || 'Error al reembolsar' }, { status: res.status })
    }

    // Get device status/info
    if (action === 'device-status') {
      if (!deviceId) {
        return Response.json({ error: 'deviceId requerido' }, { status: 400 })
      }

      const res = await fetch(
        `https://api.mercadopago.com/point/integration-api/devices/${deviceId}`,
        { headers }
      )

      const data = await res.json()
      return Response.json(data)
    }

    // Change operating mode (Point Smart: PDV or STANDALONE)
    if (action === 'change-mode') {
      if (!deviceId || !mode) {
        return Response.json({ error: 'deviceId y mode requeridos' }, { status: 400 })
      }

      const res = await fetch(
        `https://api.mercadopago.com/point/integration-api/devices/${deviceId}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ operating_mode: mode }),
        }
      )

      if (res.ok) {
        return Response.json({ success: true })
      }
      const data = await res.json().catch(() => ({}))
      return Response.json({ success: false, error: data.message || 'Error al cambiar modo' })
    }

    return Response.json({ error: 'Accion no valida' }, { status: 400 })
  } catch (error) {
    console.error('MP Point API error:', error)
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
