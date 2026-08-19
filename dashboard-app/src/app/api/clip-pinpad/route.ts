// Clip PinPad API — integración con terminales Clip.
// Auth: requires valid POS shift token or Supabase session (withPOSAuth).
// API key: reads CLIP_API_KEY env first; client-supplied fallback for migration.
// TODO P0-I Phase 2: drop client-supplied apiKey; read from credentials_vault by clientId.

import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

const CLIP_API_URL = 'https://api-gw.payclip.com/pinpad/v2'

export async function POST(request: NextRequest) {
  try {
    const auth = await withPOSAuth(request)
    if (!auth) return unauthorized()

    const { action, apiKey: clientApiKey, amount, orderId, deviceSerial, pinpadRequestId } = await request.json()

    const apiKey = process.env.CLIP_API_KEY || clientApiKey
    if (!apiKey) {
      return Response.json({ error: 'Clip API key no configurado' }, { status: 503 })
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
    console.error('[clip-pinpad]', e)
    return Response.json({ error: 'Error procesando el pago' }, { status: 500 })
  }
}
