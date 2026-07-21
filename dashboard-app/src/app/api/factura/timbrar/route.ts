// Timbra una solicitud CFDI pendiente vía Facturama (sandbox/producción).
// POST { id, payment_form? } → timbra, guarda folio fiscal + URLs de descarga
// y manda el PDF/XML por email al cliente (best-effort).

import { stampCfdi, emailCfdi, isFacturamaConfigured, type CfdiRequestRow } from '@/lib/facturama'
import { requireAuth } from '@/lib/api-auth'
import { NextRequest } from 'next/server'

function sbHeaders() {
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
  }
}

async function patchRequest(id: string, patch: Record<string, unknown>) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  return fetch(`${sbUrl}/rest/v1/pos_cfdi_requests?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  })
}

export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  try {
    if (!isFacturamaConfigured()) {
      return Response.json(
        { ok: false, error: 'Facturama no configurado — faltan FACTURAMA_USER/PASSWORD/EXPEDITION_PLACE' },
        { status: 503 }
      )
    }

    const body = await req.json()
    const id = String(body.id || '')
    if (!id) return Response.json({ ok: false, error: 'Falta id' }, { status: 400 })
    const paymentForm = ['01', '03', '04', '28'].includes(String(body.payment_form))
      ? String(body.payment_form)
      : undefined

    // Cargar la solicitud
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const res = await fetch(
      `${sbUrl}/rest/v1/pos_cfdi_requests?id=eq.${encodeURIComponent(id)}&limit=1`,
      { headers: sbHeaders(), cache: 'no-store' }
    )
    if (!res.ok) return Response.json({ ok: false, error: 'No se pudo cargar la solicitud' }, { status: 500 })
    const rows = await res.json()
    const row: (CfdiRequestRow & { status: string }) | undefined = rows[0]
    if (!row) return Response.json({ ok: false, error: 'Solicitud no encontrada' }, { status: 404 })
    if (!['pendiente', 'error'].includes(row.status)) {
      return Response.json({ ok: false, error: `La solicitud está "${row.status}" — solo se timbran pendientes` }, { status: 409 })
    }

    await patchRequest(id, { status: 'procesando', error_msg: null })

    const result = await stampCfdi(row, paymentForm)
    if (!result.ok || !result.facturamaId) {
      await patchRequest(id, { status: 'error', error_msg: result.error ?? 'Error desconocido' })
      return Response.json({ ok: false, error: result.error ?? 'Error al timbrar' }, { status: 502 })
    }

    // URLs de descarga vía nuestro proxy (el Id de Facturama viaja en la URL —
    // la tabla no tiene columna para guardarlo aparte)
    const pdfUrl = `/api/factura/descarga?fid=${encodeURIComponent(result.facturamaId)}&tipo=pdf`
    const xmlUrl = `/api/factura/descarga?fid=${encodeURIComponent(result.facturamaId)}&tipo=xml`

    await patchRequest(id, {
      status: 'emitida',
      folio_fiscal: result.uuid || null,
      pdf_url: pdfUrl,
      xml_url: xmlUrl,
    })

    const emailed = row.email ? await emailCfdi(result.facturamaId, row.email) : false

    return Response.json({
      ok: true,
      folio_fiscal: result.uuid,
      pdf_url: pdfUrl,
      xml_url: xmlUrl,
      emailed,
    })
  } catch (e) {
    console.error('[factura/timbrar] error:', e)
    return Response.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
