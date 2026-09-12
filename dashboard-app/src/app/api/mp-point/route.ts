import { NextRequest } from 'next/server'
import { POS_ROLE_LVL, withPOSAuth, unauthorized } from '@/lib/api-auth'

// MP Point Smart API proxy.
// Auth: requires valid POS shift token or Supabase session (withPOSAuth).
// El token sólo vive en servidor. MP_CLIENT_ID ata esa cuenta de Mercado Pago
// a un único tenant hasta que exista credentials_vault por restaurante.

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()

    const { action, deviceId, amount, orderId, paymentIntentId, paymentId, installments, installments_cost, tip_enabled, print_on_terminal, mode } = await request.json()

    const accessToken = process.env.MP_ACCESS_TOKEN?.trim()
    const configuredClientId = process.env.MP_CLIENT_ID?.trim()
    if (!accessToken || !configuredClientId) {
      return Response.json({ error: 'Mercado Pago no configurado en servidor' }, { status: 503 })
    }
    if (configuredClientId !== auth.clientId) {
      return Response.json({ error: 'Mercado Pago no pertenece a este restaurante' }, { status: 403 })
    }

    const roleLevel = POS_ROLE_LVL[auth.role] ?? 0
    const managerActions = new Set(['devices', 'refund', 'device-status', 'change-mode'])
    const minLevel = managerActions.has(String(action)) ? POS_ROLE_LVL.gerente : POS_ROLE_LVL.cajero
    if (roleLevel < minLevel) {
      return Response.json({ error: 'El rol no autoriza esta operación de pago' }, { status: 403 })
    }

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }

    // List devices
    if (action === 'devices') {
      const res = await fetch('https://api.mercadopago.com/point/integration-api/devices', { headers })
      const data = await res.json()
      return Response.json(data, { status: res.status })
    }

    // Send payment intent (supports Point Smart options)
    if (action === 'payment') {
      const numericAmount = Number(amount)
      if (!deviceId || !orderId || !Number.isFinite(numericAmount) || numericAmount <= 0) {
        return Response.json({ error: 'deviceId, orderId y amount positivo requeridos' }, { status: 400 })
      }

      // Build payment body — Smart supports installments, tip, etc.
      const paymentBody: Record<string, unknown> = {
        amount: Math.round(numericAmount * 100),
        additional_info: {
          external_reference: String(orderId).slice(0, 64),
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
        `https://api.mercadopago.com/point/integration-api/devices/${encodeURIComponent(String(deviceId))}/payment-intents`,
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
        `https://api.mercadopago.com/point/integration-api/payment-intents/${encodeURIComponent(String(paymentIntentId))}`,
        { headers }
      )

      const data = await res.json()
      return Response.json(data, { status: res.status })
    }

    // Cancel payment intent
    if (action === 'cancel') {
      if (!deviceId) {
        return Response.json({ error: 'deviceId requerido' }, { status: 400 })
      }

      const res = await fetch(
        `https://api.mercadopago.com/point/integration-api/devices/${encodeURIComponent(String(deviceId))}/payment-intents`,
        { method: 'DELETE', headers }
      )

      if (res.ok || res.status === 204) {
        return Response.json({ success: true })
      }
      const data = await res.json().catch(() => ({}))
      return Response.json({ success: false, error: data.message || 'Error al cancelar' }, { status: res.status })
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
      return Response.json(data, { status: res.status })
    }

    // Refund a payment (Point Smart only)
    if (action === 'refund') {
      if (!paymentId) {
        return Response.json({ error: 'paymentId requerido' }, { status: 400 })
      }
      if (amount !== undefined && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
        return Response.json({ error: 'amount debe ser positivo' }, { status: 400 })
      }

      const refundBody: Record<string, unknown> = {}
      if (amount !== undefined) refundBody.amount = Math.round(Number(amount) * 100)

      const res = await fetch(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(paymentId))}/refunds`,
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
        `https://api.mercadopago.com/point/integration-api/devices/${encodeURIComponent(String(deviceId))}`,
        { headers }
      )

      const data = await res.json()
      return Response.json(data, { status: res.status })
    }

    // Change operating mode (Point Smart: PDV or STANDALONE)
    if (action === 'change-mode') {
      if (!deviceId || !['PDV', 'STANDALONE'].includes(String(mode))) {
        return Response.json({ error: 'deviceId y mode requeridos' }, { status: 400 })
      }

      const res = await fetch(
        `https://api.mercadopago.com/point/integration-api/devices/${encodeURIComponent(String(deviceId))}`,
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
      return Response.json({ success: false, error: data.message || 'Error al cambiar modo' }, { status: res.status })
    }

    return Response.json({ error: 'Accion no valida' }, { status: 400 })
  } catch (error) {
    console.error('MP Point API error:', error)
    return Response.json({ error: 'Error interno' }, { status: 500 })
  }
}
