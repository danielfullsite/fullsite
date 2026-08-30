// Proxy de descarga de PDF/XML de CFDIs emitidos en Facturama.
// GET ?fid={facturamaId}&tipo=pdf|xml — las credenciales del PAC viven
// en el servidor; el cliente solo recibe el archivo.

import { fetchCfdiFile } from '@/lib/facturama'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  // FUGA F-5 CERRADA (2026-08-30): antes solo pedía "hay sesión" y servía
  // CUALQUIER CFDI por su fid → un usuario descargaba PDF/XML fiscal de otro
  // restaurante. Ahora el fid se valida contra pos_cfdi_requests filtrado por
  // el tenant del que llama (withPOSAuth, fail-closed multi-membresía).
  const auth = await withPOSAuth(req)
  if (!auth) return unauthorized()

  const url = new URL(req.url)
  const fid = url.searchParams.get('fid') || ''
  const tipo = url.searchParams.get('tipo') === 'xml' ? 'xml' : 'pdf'
  if (!fid) return Response.json({ ok: false, error: 'Falta fid' }, { status: 400 })

  // El fid vive dentro de pdf_url/xml_url. Confirmar que existe una fila de ESTE
  // tenant que lo referencia antes de tocar el PAC.
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const ownRes = await fetch(
    `${sbUrl}/rest/v1/pos_cfdi_requests?client_id=eq.${encodeURIComponent(auth.clientId)}&or=(pdf_url.ilike.*${encodeURIComponent(fid)}*,xml_url.ilike.*${encodeURIComponent(fid)}*)&select=id&limit=1`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
  ).catch(() => null)
  const ownRows = ownRes && ownRes.ok ? await ownRes.json().catch(() => []) : []
  if (!Array.isArray(ownRows) || ownRows.length === 0) {
    return Response.json({ ok: false, error: 'CFDI no encontrado para este restaurante' }, { status: 404 })
  }

  const bytes = await fetchCfdiFile(fid, tipo)
  if (!bytes) {
    return Response.json({ ok: false, error: 'No se pudo descargar el archivo' }, { status: 502 })
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': tipo === 'pdf' ? 'application/pdf' : 'application/xml',
      'Content-Disposition': `attachment; filename="factura-${fid}.${tipo}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
