import { NextRequest } from 'next/server'

/**
 * sameOriginOnly — defensa contra CSRF / integraciones no autorizadas.
 *
 * Los endpoints de negocio (owner/*, pos/*) son SOLO para el propio dashboard/POS
 * de Fullsite (same-origin). Un tercero que quiera "armar una integración fácil"
 * —o un script que reuse una cookie/token robado desde OTRO origen— manda un
 * Origin distinto: aquí se rechaza. No hay CORS permisivo ni API pública; las
 * integraciones reales van por un flujo deliberado controlado por Fullsite
 * (API-key/OAuth, como el de Uber), nunca por esta API de sesión.
 *
 * Para requests que mutan (POST/PATCH/PUT/DELETE) el header Origin DEBE existir y
 * su host DEBE coincidir con el host del propio request. Los navegadores SIEMPRE
 * mandan Origin en requests con método no-simple + JSON, así que su ausencia en
 * una mutación es señal de un cliente no-navegador (curl/script) → se rechaza.
 */
export function sameOriginOnly(request: NextRequest): Response | null {
  const method = request.method.toUpperCase()
  const isMutation = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE'
  if (!isMutation) return null // GETs de lectura no mutan; el gate de auth ya aplica

  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) {
    return Response.json({ error: 'Origen no permitido' }, { status: 403 })
  }
  let originHost: string
  try { originHost = new URL(origin).host } catch { return Response.json({ error: 'Origen inválido' }, { status: 403 }) }
  if (originHost !== host) {
    return Response.json({ error: 'Origen no permitido' }, { status: 403 })
  }
  return null
}
