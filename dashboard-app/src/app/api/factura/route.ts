// Solicitud de factura (CFDI) desde la página pública /factura (QR del ticket).
// pos_cfdi_requests tiene RLS sin policy de INSERT anon — este route inserta
// con la service key, con validación server-side de los campos.

const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const rfc = String(body.rfc || '').trim().toUpperCase()
    const razonSocial = String(body.razon_social || '').trim()
    const regimenFiscal = String(body.regimen_fiscal || '').trim()
    const usoCfdi = String(body.uso_cfdi || '').trim()
    const codigoPostal = String(body.codigo_postal || '').trim()
    const email = String(body.email || '').trim().toLowerCase()

    if (!RFC_RE.test(rfc)) return Response.json({ ok: false, error: 'RFC inválido' }, { status: 400 })
    if (!razonSocial) return Response.json({ ok: false, error: 'Falta razón social' }, { status: 400 })
    if (!/^\d{5}$/.test(codigoPostal)) return Response.json({ ok: false, error: 'Código postal inválido' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ ok: false, error: 'Email inválido' }, { status: 400 })

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const res = await fetch(`${sbUrl}/rest/v1/pos_cfdi_requests`, {
      method: 'POST',
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        id: crypto.randomUUID(), // la tabla no tiene DEFAULT en id
        client_id: 'amalay',
        order_id: body.order_id ? String(body.order_id).slice(0, 64) : null,
        total: body.total ? Number(body.total) : null,
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

    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: false, error: 'Error inesperado' }, { status: 500 })
  }
}
