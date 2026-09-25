import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { derivarLlaveDeTerminal } from '@/lib/recibo-offline'
import { terminalIdValido } from '@/lib/terminal-id'

/**
 * Entrega a la CAJA la llave con la que firmará recibos de aprobación offline (bloque POS,
 * 2026-09-24). Ver recibo-offline.ts.
 *
 * Quién la recibe: una sesión de GERENTE o más (el shiftToken que la Caja acaba de obtener al
 * validar con red el PIN de un gerente). Un mesero no la obtiene: si pudiera, firmaría sus
 * propias aprobaciones. La Caja la guarda sellada por el SO y nunca la expone a la página.
 *
 * La llave es por (restaurante, terminal) y se DERIVA, no se guarda: rotar la raíz
 * (OFFLINE_RECEIPT_ROOT, con otro `kid`) invalida todas a la vez.
 *
 * Si el restaurante exige terminales enroladas, la terminal debe estarlo. Sin raíz: 503.
 */
export const dynamic = 'force-dynamic'

const ROLE_LVL: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5, 'dueño': 5 }
const KID = 'v1'

export async function POST(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  if ((ROLE_LVL[auth.role] || 0) < ROLE_LVL.gerente) return Response.json({ error: 'Requiere gerente' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const deviceId = body?.device_id
  if (!terminalIdValido(deviceId)) return Response.json({ error: 'device_id inválido' }, { status: 400 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return Response.json({ error: 'SERVER_CONFIG_ERROR' }, { status: 503 })
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  try {
    const cfg = await fetch(`${url}/rest/v1/clients?id=eq.${encodeURIComponent(auth.clientId)}&select=pos_settings&limit=1`,
      { headers: H, cache: 'no-store', signal: AbortSignal.timeout(4000) })
    if (!cfg.ok) return Response.json({ error: 'authority_unavailable' }, { status: 503 })
    const filas = await cfg.json().catch(() => null)
    if (!Array.isArray(filas) || filas.length !== 1) return Response.json({ error: 'authority_unavailable' }, { status: 503 })
    if (filas[0]?.pos_settings?.['pos.require_enrolled_terminal'] === true) {
      const t = await fetch(`${url}/rest/v1/pos_terminals?client_id=eq.${encodeURIComponent(auth.clientId)}&device_id=eq.${encodeURIComponent(deviceId)}&active=eq.true&select=device_id&limit=1`,
        { headers: H, cache: 'no-store', signal: AbortSignal.timeout(4000) })
      if (!t.ok) return Response.json({ error: 'authority_unavailable' }, { status: 503 })
      const tf = await t.json().catch(() => null)
      if (!Array.isArray(tf)) return Response.json({ error: 'authority_unavailable' }, { status: 503 })
      if (tf.length === 0) return Response.json({ error: 'Terminal no autorizada', code: 'terminal_not_enrolled' }, { status: 403 })
    }
  } catch {
    return Response.json({ error: 'authority_unavailable' }, { status: 503 })
  }

  const llave = derivarLlaveDeTerminal(auth.clientId, deviceId, KID)
  if (!llave) return Response.json({ error: 'Recibos offline no configurados', code: 'authority_unavailable' }, { status: 503 })

  // Bitácora: quién habilitó los recibos de qué terminal. Nunca la llave.
  try {
    await fetch(`${url}/rest/v1/pos_audit_log`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ client_id: auth.clientId, action: 'llave_recibos_entregada', actor: auth.staffName || auth.staffId,
        approved_by: auth.staffId, details: { terminal_id: deviceId, kid: KID } }),
      signal: AbortSignal.timeout(2000),
    })
  } catch { /* bitácora best-effort */ }

  return Response.json({ kid: KID, key: llave, device_id: deviceId }, { headers: { 'Cache-Control': 'no-store' } })
}
