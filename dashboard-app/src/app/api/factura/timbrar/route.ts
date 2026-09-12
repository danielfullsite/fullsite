// Timbra una solicitud CFDI pendiente vía Facturama (sandbox/producción).
// POST { id, payment_form? } → timbra, guarda folio fiscal + URLs de descarga
// y manda el PDF/XML por email al cliente (best-effort).

import { stampCfdi, emailCfdi, isFacturamaConfigured, type CfdiRequestRow } from '@/lib/facturama'
import { checkPosRole, POS_ROLE_LVL, withPOSAuth, unauthorized } from '@/lib/api-auth'
import { NextRequest } from 'next/server'

function sbHeaders() {
  const sbKey = process.env.SUPABASE_SERVICE_KEY!
  return {
    apikey: sbKey,
    Authorization: `Bearer ${sbKey}`,
    'Content-Type': 'application/json',
  }
}

async function patchRequest(clientId: string, id: string, patch: Record<string, unknown>) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  return fetch(`${sbUrl}/rest/v1/pos_cfdi_requests?id=eq.${encodeURIComponent(id)}&client_id=eq.${encodeURIComponent(clientId)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  })
}

async function claimRequest(clientId: string, id: string) {
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const res = await fetch(
    `${sbUrl}/rest/v1/pos_cfdi_requests?id=eq.${encodeURIComponent(id)}` +
    `&client_id=eq.${encodeURIComponent(clientId)}&status=in.(pendiente,error)`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'procesando',
        error_msg: 'Timbrado en curso. No reintentar hasta conocer el resultado del PAC.',
        updated_at: new Date().toISOString(),
      }),
    },
  )
  if (!res.ok) throw new Error(`CFDI_CLAIM_FAILED_${res.status}`)
  const rows = await res.json().catch(() => [])
  return (Array.isArray(rows) ? rows[0] : null) as (CfdiRequestRow & { status: string }) | null
}

export async function POST(req: NextRequest) {
  // FUGA F-1 CERRADA (2026-08-30): resolvía client_id con client_users limit=1
  // SIN order — para un usuario multi-membresía Postgres devolvía una fila
  // arbitraria y se TIMBRABA CFDI (escritura fiscal irreversible ante el SAT)
  // contra el restaurante equivocado. Ahora el tenant sale de withPOSAuth, que
  // ya es fail-closed multi-membresía y honra el header x-fullsite-tenant validado.
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()
  if (!checkPosRole(auth, POS_ROLE_LVL.cajero, 'POS_STRICT_ROLES').ok) {
    return Response.json({ ok: false, error: 'El rol no autoriza emitir CFDI' }, { status: 403 })
  }
  const clientId = auth.clientId
  let claimedId: string | null = null

  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      return Response.json({ ok: false, error: 'Base de datos fiscal no configurada' }, { status: 503 })
    }
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

    // Compare-and-swap en Postgres: dos taps concurrentes no pueden reclamar la
    // misma solicitud. Leer y después hacer PATCH permitía dos timbrados SAT.
    const row = await claimRequest(clientId, id)
    if (!row) {
      return Response.json({ ok: false, error: 'La solicitud ya está siendo procesada o fue emitida' }, { status: 409 })
    }
    claimedId = id

    const result = await stampCfdi(row, paymentForm)
    if (!result.ok || !result.facturamaId) {
      await patchRequest(clientId, id, { status: 'error', error_msg: result.error ?? 'Error desconocido' })
      return Response.json({ ok: false, error: result.error ?? 'Error al timbrar' }, { status: 502 })
    }

    // URLs de descarga vía nuestro proxy (el Id de Facturama viaja en la URL —
    // la tabla no tiene columna para guardarlo aparte)
    const pdfUrl = `/api/factura/descarga?fid=${encodeURIComponent(result.facturamaId)}&tipo=pdf`
    const xmlUrl = `/api/factura/descarga?fid=${encodeURIComponent(result.facturamaId)}&tipo=xml`

    const persisted = await patchRequest(clientId, id, {
      status: 'emitida',
      folio_fiscal: result.uuid || null,
      pdf_url: pdfUrl,
      xml_url: xmlUrl,
    })
    if (!persisted.ok) {
      console.error('[factura/timbrar] PAC confirmó pero no se pudo persistir el folio', { id, status: persisted.status })
      await patchRequest(clientId, id, {
        status: 'incierto',
        error_msg: 'El PAC confirmó el timbrado, pero no se guardó el folio. Concilia en Facturama; no reintentes.',
      }).catch(() => null)
      return Response.json({
        ok: false,
        uncertain: true,
        error: 'Facturama confirmó el timbrado, pero no se pudo guardar el folio. No reintentes; concilia en Facturama.',
      }, { status: 502 })
    }
    claimedId = null

    let emailed = false
    if (row.email) {
      try { emailed = await emailCfdi(result.facturamaId, row.email) }
      catch (error) { console.error('[factura/timbrar] timbrada, pero el correo falló', { id, error: String(error) }) }
    }

    return Response.json({
      ok: true,
      folio_fiscal: result.uuid,
      pdf_url: pdfUrl,
      xml_url: xmlUrl,
      emailed,
    })
  } catch (e) {
    console.error('[factura/timbrar] error:', e)
    if (claimedId) {
      await patchRequest(clientId, claimedId, {
        status: 'incierto',
        error_msg: 'Se perdió la respuesta del PAC. Verifica Facturama antes de cualquier reintento.',
      }).catch(() => null)
      return Response.json({
        ok: false,
        uncertain: true,
        error: 'Resultado incierto: verifica Facturama antes de reintentar para evitar un CFDI duplicado.',
      }, { status: 502 })
    }
    return Response.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
