// Guard compartido para los endpoints administrativos de integraciones.
//
// Autoriza con:  Authorization: Bearer <INTEGRATION_ADMIN_SECRET>
//
// INTEGRATION_ADMIN_SECRET es un secreto dedicado a endpoints internos. NO debe
// ser SUPABASE_SERVICE_KEY — esa llave es sólo para operaciones de base de datos.
//
// Falla cerrado: si la variable no está configurada, NADIE pasa. Un endpoint que
// habla con Uber en nombre de un restaurante no puede quedar abierto por una
// variable faltante.
//
// La comparación es de tiempo constante para no filtrar el secreto carácter a
// carácter. La comparación de longitud previa no filtra nada útil: la longitud
// del secreto no es material sensible, y timingSafeEqual exige buffers iguales.
//
// Este módulo existe porque el guard estaba copiado en tres rutas y ausente en
// otras cuatro. Ver docs/security/INTEGRATION-ROUTES-AUTH.md.

import { timingSafeEqual } from 'crypto'

export interface AdminAuthResult {
  ok: boolean
  /** Motivo para logging interno. Nunca se devuelve al cliente. */
  reason?: 'no_secret_configured' | 'no_header' | 'length_mismatch' | 'mismatch'
}

/** Valida la cabecera Authorization contra INTEGRATION_ADMIN_SECRET. */
export function checkAdminAuth(request: { headers: { get(name: string): string | null } }): AdminAuthResult {
  const expected = (process.env.INTEGRATION_ADMIN_SECRET ?? '').trim()
  if (!expected) return { ok: false, reason: 'no_secret_configured' }

  const raw = request.headers.get('authorization') ?? ''
  const provided = raw.replace(/^Bearer\s+/i, '').trim()
  if (!provided) return { ok: false, reason: 'no_header' }

  if (provided.length !== expected.length) return { ok: false, reason: 'length_mismatch' }

  try {
    const equal = timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
    return equal ? { ok: true } : { ok: false, reason: 'mismatch' }
  } catch {
    return { ok: false, reason: 'mismatch' }
  }
}

/**
 * Respuesta 401 uniforme. No revela por qué falló — un atacante no debe poder
 * distinguir "secreto sin configurar" de "secreto incorrecto".
 */
export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
