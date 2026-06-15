// Clip PinPad API — integración con terminales Clip de AMALAY
// Flujo: POS envía monto → API crea intención de pago → terminal Clip carga orden → cliente paga → webhook
// Docs: developer.clip.mx

import { NextRequest } from 'next/server'

const CLIP_API_URL = 'https://api-gw.payclip.com/pinpad/v2'

export async function POST(request: NextRequest) {
  try {
    const { action, apiKey, amount, orderId, deviceSerial, pinpadRequestId } = await request.json()

    if (!apiKey) {
      return Response.json({ error: 'Clip API key requerido' }, { status: 400 })
    }

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }

    // List devices — recupera terminales Clip registradas
    if (action === 'devices') {
      const res = await fetch(`${CLIP_API_URL}/devices`, { headers })
      const data = await res.json()
      return Response.json(data)
    }

    // Create payment intent — envía cobro a la terminal
    if (action === 'payment') {
      if (!amount || amount <= 0) {
        return Response.json({ error: 'Monto requerido' }, { status: 400 })
      }

      const body = {
        amount: Math.round(amount * 100) / 100, // Clip usa pesos con decimales
        currency: 'MXN',
        reference: orderId || `fullsite-${Date.now()}`,
        ...(deviceSerial ? { device_serial: deviceSerial } : {}),
      }

      const res = await fetch(`${CLIP_API_URL}/payment-request`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        return Response.json({ error: data.message || `Clip error ${res.status}`, details: data }, { status: res.status })
      }

      return Response.json({
        ok: true,
        pinpadRequestId: data.pinpad_request_id || data.id,
        status: data.status,
        ...data,
      })
    }

    // Check payment status
    if (action === 'status') {
      if (!pinpadRequestId) {
        return Response.json({ error: 'pinpadRequestId requerido' }, { status: 400 })
      }

      const res = await fetch(`${CLIP_API_URL}/payment-request/${pinpadRequestId}`, { headers })
      const data = await res.json()
      return Response.json(data)
    }

    // Cancel payment
    if (action === 'cancel') {
      if (pinpadRequestId) {
        const res = await fetch(`${CLIP_API_URL}/payment-request/${pinpadRequestId}`, {
          method: 'DELETE',
          headers,
        })
        return Response.json({ ok: res.ok, status: res.status })
      }
      if (deviceSerial) {
        const res = await fetch(`${CLIP_API_URL}/devices/${deviceSerial}/cancel`, {
          method: 'POST',
          headers,
        })
        return Response.json({ ok: res.ok, status: res.status })
      }
      return Response.json({ error: 'pinpadRequestId o deviceSerial requerido' }, { status: 400 })
    }

    return Response.json({ error: `Acción desconocida: ${action}` }, { status: 400 })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
