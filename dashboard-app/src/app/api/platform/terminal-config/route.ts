import { NextRequest } from 'next/server'
import { requirePlatformAdmin2FA } from '@/lib/platform-auth'
import { auditLog } from '@/lib/platform-writes'
import { locationBelongsToClient } from '@/lib/terminal-enrollment'
import {
  generateTerminalConfig, buildProvisionDeepLink, isRoleRemote,
  TERMINAL_ROLES, type TerminalRole,
} from '@/lib/terminal-config'

// Esqueleton clonable (Feature 1) · POST /api/platform/terminal-config
// Genera un TerminalConfig por cliente/rol/sucursal para provisionar una terminal
// (POS/KDS/caja) sin teclear: se descarga como config.json (el wizard del Electron lo
// importa) o se arma un deep-link/QR. Admin-gated (2FA) + service_role + audit.
// Body: { clientId, locationId, role, name?, bridgeHost? }.
//
// locationId es obligatorio y se valida contra client_locations del mismo tenant: no se
// emite una configuración de terminal sin sucursal.

export const dynamic = 'force-dynamic'
const CLIENT_RE = /^[a-z0-9_-]{1,40}$/i
const LOCATION_RE = /^[a-z0-9_-]{1,64}$/i
const HOST_RE = /^[a-z0-9.\-:]{1,60}$/i

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin2FA(req)
  if ('error' in gate) return gate.error

  let body: { clientId?: string; locationId?: string; role?: string; name?: string; bridgeHost?: string } = {}
  try { body = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }

  const clientId = body.clientId
  const locationId = typeof body.locationId === 'string' ? body.locationId.trim() : ''
  const role = body.role as TerminalRole
  const bridgeHost = typeof body.bridgeHost === 'string' ? body.bridgeHost.trim() : ''

  if (!clientId || !CLIENT_RE.test(clientId)) return Response.json({ error: 'clientId inválido' }, { status: 400 })
  if (!locationId || !LOCATION_RE.test(locationId)) return Response.json({ error: 'locationId requerido' }, { status: 400 })
  if (!TERMINAL_ROLES.includes(role)) return Response.json({ error: 'role inválido' }, { status: 400 })
  if (isRoleRemote(role)) {
    if (!bridgeHost || !HOST_RE.test(bridgeHost)) {
      return Response.json({ error: 'Para POS/KDS se requiere la IP de la caja (bridgeHost)' }, { status: 400 })
    }
  }
  // La sucursal pertenece al tenant (server-side). Sin esto, un admin podría emitir un
  // config apuntando a la sucursal de otro restaurante.
  if (!(await locationBelongsToClient(clientId, locationId))) {
    return Response.json({ error: 'locationId no es una sucursal activa de este tenant' }, { status: 400 })
  }

  const config = generateTerminalConfig({ clientId, locationId, role, name: body.name, bridgeHost })
  const deepLink = buildProvisionDeepLink(config)

  await auditLog(gate.ctx, {
    action: 'terminal.config.generate',
    scope: 'tenant',
    target_tenant: clientId,
    detail: { role, location_id: locationId, terminal_id: config.terminal_id, terminal_name: config.terminal_name },
  })

  return Response.json({ config, deepLink })
}
