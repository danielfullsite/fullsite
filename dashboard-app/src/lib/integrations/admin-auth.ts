// ─── Guard de administración para las rutas de integraciones ─────────────────
//
// CONTRATO
// --------
// Toda ruta de `/api/integrations/**` que provoque un efecto hacia una
// plataforma externa (publicar menú, pausar/activar tienda, aceptar o rechazar
// órdenes, disparar reconciliación) DEBE llamar a `checkAdminAuth(request)`
// como primera línea de su handler y cortar si no pasa.
//
// Excepción única: los webhooks entrantes, que se autentican por firma HMAC del
// proveedor (ver `uber-eats/webhook/route.ts`), no por este secreto.
//
// Credencial: `INTEGRATION_ADMIN_SECRET`, enviada como `Authorization: Bearer <secreto>`.
// La comparación es en tiempo constante para no filtrar el secreto por timing.
//
// Respuestas:
//   { ok: true }                                    → continuar
//   { ok: false, status: 401, error: 'unauthorized' }   → falta, mal formado, o no coincide
//   { ok: false, status: 503, error: 'not_configured' } → el servidor no tiene el secreto
//
// POR QUÉ EXISTE
// --------------
// Antes del 2026-08-29 este patrón estaba copiado a mano en `stores/route.ts` y
// `sandbox/route.ts`, y **faltaba por completo** en `menu`, `order`, `reconcile`
// y `store`. Eso dejaba en producción, sin autenticación, la capacidad de cerrar
// la tienda de Uber Eats de un cliente, reemplazarle el menú y rechazar órdenes
// reales. Copiar el guard a mano fue justo lo que permitió olvidarlo: por eso
// ahora vive en un solo lugar.

import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: 'unauthorized' | 'not_configured' }

/** Valida `Authorization: Bearer <INTEGRATION_ADMIN_SECRET>` en tiempo constante. */
export function checkAdminAuth(request: NextRequest): AdminAuthResult {
  const expected = (process.env.INTEGRATION_ADMIN_SECRET ?? '').trim()
  if (!expected) return { ok: false, status: 503, error: 'not_configured' }

  // El esquema `Bearer` es OBLIGATORIO. El patrón original (copiado en
  // `stores/route.ts` y `sandbox/route.ts`) hacía `replace(/^Bearer\s+/i, '')`,
  // que quita el prefijo si está pero también acepta el token pelón sin esquema.
  // No es una vulnerabilidad —igual hay que conocer el secreto— pero es laxo y
  // hace que el header no signifique lo que dice. Aquí se exige explícito.
  const raw = request.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim())
  if (!m) return { ok: false, status: 401, error: 'unauthorized' }
  const provided = m[1].trim()
  if (!provided) return { ok: false, status: 401, error: 'unauthorized' }

  // timingSafeEqual exige longitudes iguales; comparar antes evita la excepción
  // y no filtra nada que no revele ya la longitud del header.
  if (provided.length !== expected.length) return { ok: false, status: 401, error: 'unauthorized' }

  try {
    const equal = timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'))
    return equal ? { ok: true } : { ok: false, status: 401, error: 'unauthorized' }
  } catch {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
}
