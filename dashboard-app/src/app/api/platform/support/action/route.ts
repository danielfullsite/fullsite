import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin2FA, platformServiceFetch } from '@/lib/platform-auth'
import { auditLog, rateLimit } from '@/lib/platform-writes'
import { SUPPORT_ACTIONS, findSupportAction, isConsentValid } from '@/lib/support-actions'

// Acciones de soporte remoto. RBAC (2FA) + consentimiento + auditoría. Sin shell arbitrario.
//   GET                       → { actions }  (la allowlist; el UI sólo ofrece esto)
//   POST { clientId, actionId } → ejecuta SÓLO una acción de la allowlist, audita, exige
//                                 consentimiento vigente si la acción lo requiere.
//
// Gate: factory.support_console. El consentimiento vive en pos_settings['support.consent']
// = { grantedBy, expiresAt } — temporal; fuera de esa ventana, se rechaza.

export const dynamic = 'force-dynamic'
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i

export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  // Sólo la allowlist. El cliente no puede pedir nada fuera de esto.
  return NextResponse.json({ actions: SUPPORT_ACTIONS })
}

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error
  const limited = rateLimit(gate.ctx)
  if (limited) return limited

  let body: { clientId?: string; actionId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const clientId = body.clientId || ''
  if (!CLIENT_RE.test(clientId)) return NextResponse.json({ error: 'clientId inválido' }, { status: 400 })

  // La allowlist ES el límite: cualquier id fuera de ella se rechaza. No hay ruta a un shell.
  const action = findSupportAction(body.actionId)
  if (!action) return NextResponse.json({ error: 'acción no permitida' }, { status: 400 })

  // Consentimiento temporal del cliente para las acciones que lo exigen.
  if (action.requiresConsent) {
    let consent: unknown = null
    try {
      const res = await platformServiceFetch(
        `clients?id=eq.${encodeURIComponent(clientId)}&select=pos_settings&limit=1`,
        { headers: { Accept: 'application/json' } },
      )
      const rows = res.ok ? await res.json() : []
      consent = (Array.isArray(rows) && rows[0]?.pos_settings?.['support.consent']) || null
    } catch { consent = null }
    if (!isConsentValid(consent, Date.now())) {
      return NextResponse.json({ error: 'sin consentimiento vigente del cliente' }, { status: 403 })
    }
  }

  // Auditoría SIEMPRE (actor verificado server-side). Sin PII: sólo el id de la acción.
  await auditLog(gate.ctx, {
    action: `support.${action.id}`,
    scope: 'tenant',
    target_tenant: clientId,
    detail: { readOnly: action.readOnly, requiresConsent: action.requiresConsent },
  })

  // Las acciones no-lectura se ENCOLAN/auditan; la ejecución en la caja (Pedro) es un PR de
  // local-server con instalador. Nada destructivo ni shell se corre aquí.
  const status = action.readOnly ? 'ok' : 'queued'
  return NextResponse.json({ ok: true, action: action.id, status })
}
