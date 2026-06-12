// Proxy de descarga de PDF/XML de CFDIs emitidos en Facturama.
// GET ?fid={facturamaId}&tipo=pdf|xml — las credenciales del PAC viven
// en el servidor; el cliente solo recibe el archivo.

import { fetchCfdiFile } from '@/lib/facturama'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const fid = url.searchParams.get('fid') || ''
  const tipo = url.searchParams.get('tipo') === 'xml' ? 'xml' : 'pdf'
  if (!fid) return Response.json({ ok: false, error: 'Falta fid' }, { status: 400 })

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
