// Solicitud de factura (CFDI) desde la página pública /factura (QR del ticket).
// pos_cfdi_requests tiene RLS sin policy de INSERT anon — este route inserta
// con la service key, con validación server-side de los campos.

import { requireAuth, getClientId } from '@/lib/api-auth'
import { NextRequest } from 'next/server'

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

function sbHeaders() {
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
  }
}

// Lista de solicitudes para el admin (/facturas).
export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request)
  if (authErr) return authErr
  try {
    const clientId = getClientId(request)
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const res = await fetch(
      `${sbUrl}/rest/v1/pos_cfdi_requests?client_id=eq.${encodeURIComponent(clientId)}&order=created_at.desc&limit=200`,
      { headers: sbHeaders(), cache: 'no-store' }
    )
    if (!res.ok) {
      console.error('[factura] list failed:', res.status, (await res.text()).slice(0, 300))
      return Response.json({ ok: false, error: 'No se pudieron cargar las solicitudes' }, { status: 500 })
    }
    return Response.json({ ok: true, requests: await res.json() })
  } catch {
    return Response.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}

// Actualiza status de una solicitud (pendiente → facturada / error).
export async function PATCH(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr
  try {
    const body = await req.json()
    const id = String(body.id || '')
    const status = String(body.status || '')
    if (!id) return Response.json({ ok: false, error: 'Falta id' }, { status: 400 })
    if (!['pendiente', 'facturada', 'error'].includes(status)) {
      return Response.json({ ok: false, error: 'Status inválido' }, { status: 400 })
    }

    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (body.folio_fiscal !== undefined) patch.folio_fiscal = String(body.folio_fiscal).trim().slice(0, 64) || null
    if (body.error_msg !== undefined) patch.error_msg = String(body.error_msg).trim().slice(0, 300) || null

    const clientId = getClientId(req)
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const res = await fetch(
      `${sbUrl}/rest/v1/pos_cfdi_requests?id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(clientId)}`,
      { method: 'PATCH', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(patch) }
    )
    if (!res.ok) {
      console.error('[factura] patch failed:', res.status, (await res.text()).slice(0, 300))
      return Response.json({ ok: false, error: 'No se pudo actualizar' }, { status: 500 })
    }
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const rfc = String(body.rfc || '').trim().toUpperCase()
    const razonSocial = String(body.razon_social || '').trim()
    const regimenFiscal = String(body.regimen_fiscal || '').trim()
    const usoCfdi = String(body.uso_cfdi || '').trim()
    const codigoPostal = String(body.codigo_postal || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const orderId = body.order_id ? String(body.order_id).slice(0, 64) : null

    if (!RFC_RE.test(rfc)) return Response.json({ ok: false, error: 'RFC inválido' }, { status: 400 })
    if (!razonSocial) return Response.json({ ok: false, error: 'Falta razón social' }, { status: 400 })
    if (!/^\d{5}$/.test(codigoPostal)) return Response.json({ ok: false, error: 'Código postal inválido' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ ok: false, error: 'Email inválido' }, { status: 400 })
    if (!orderId) return Response.json({ ok: false, error: 'Falta order_id' }, { status: 400 })

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const authHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' }

    // 1. Validate order exists and get real total
    const orderRes = await fetch(
      `${sbUrl}/rest/v1/pos_orders?id=eq.${encodeURIComponent(orderId)}&select=id,total,client_id&limit=1`,
      { headers: authHeaders, cache: 'no-store' }
    )
    if (!orderRes.ok) return Response.json({ ok: false, error: 'No se pudo verificar la orden' }, { status: 500 })
    const orders = await orderRes.json()
    if (!orders.length) return Response.json({ ok: false, error: 'Orden no encontrada' }, { status: 404 })

    const order = orders[0]
    const verifiedTotal = Number(order.total) || 0
    const clientId = order.client_id || ''

    // 2. Check no duplicate invoice for this order
    const dupRes = await fetch(
      `${sbUrl}/rest/v1/pos_cfdi_requests?order_id=eq.${encodeURIComponent(orderId)}&status=neq.error&select=id&limit=1`,
      { headers: authHeaders, cache: 'no-store' }
    )
    if (dupRes.ok) {
      const dups = await dupRes.json()
      if (dups.length > 0) return Response.json({ ok: false, error: 'Esta orden ya tiene una solicitud de factura' }, { status: 409 })
    }

    // 3. Insert with verified total (ignore client-sent total)
    const res = await fetch(`${sbUrl}/rest/v1/pos_cfdi_requests`, {
      method: 'POST',
      headers: { ...authHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        client_id: clientId,
        order_id: orderId,
        total: verifiedTotal,
        rfc,
        razon_social: razonSocial.slice(0, 200),
        regimen_fiscal: regimenFiscal.slice(0, 3),
        uso_cfdi: usoCfdi.slice(0, 4),
        codigo_postal: codigoPostal,
        email: email.slice(0, 200),
        status: 'pendiente',
        requested_by: 'qr_ticket',
      }),
    })

    if (!res.ok) {
      const txt = await res.text()
      console.error('[factura] insert failed:', res.status, txt.slice(0, 300))
      return Response.json({ ok: false, error: 'No se pudo guardar la solicitud' }, { status: 500 })
    }

    return Response.json({ ok: true, total: verifiedTotal })
  } catch {
    return Response.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
