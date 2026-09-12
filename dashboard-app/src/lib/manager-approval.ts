import { verifyShiftToken } from '@/lib/shift-token'

// ─── Aprobación de gerente server-side (anti-fraude) ─────────────────────────
// Para operaciones sensibles (cancelar, reabrir cuenta, descuento). Antes se confiaba
// en un string `manager` que el cliente afirmaba → un mesero podía forjarlo por POST
// directo. Ahora el servidor VERIFICA:
//   • Online: el token FIRMADO del gerente que emite /api/pos/pin (rol >= minLevel,
//     mismo tenant). Infalsificable desde el cliente.
//   • Offline: la sesión solicitante ya debe ser gerente+. Un booleano enviado por
//     el navegador nunca demuestra que otra persona capturó su PIN.

const ROLE_LVL: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 }

// `offline_approved: true` era una afirmación controlada por el navegador y permitía
// que un mesero reabriera una cuenta pagada. Ya no concede nada. Sin token separado,
// sólo una sesión firmada que ya sea gerente+ puede continuar. El modo sin WAN de
// AMALAY usa el actor_token que firma Caja; la ruta cloud falla cerrada.

export async function verifyManagerApproval(opts: {
  approvalToken?: unknown
  offlineApproved?: unknown
  clientId: string
  minLevel?: number
  /** Rol de la sesión que pide, del shift token FIRMADO. No lo dicta el cliente. */
  solicitanteRol?: string
}): Promise<{ ok: boolean; mode: string; solicitanteNivel: number }> {
  const minLevel = opts.minLevel ?? 4 // gerente+
  const solicitanteNivel = ROLE_LVL[String(opts.solicitanteRol)] || 0
  let mode = ''
  if (typeof opts.approvalToken === 'string' && opts.approvalToken) {
    const p = await verifyShiftToken(opts.approvalToken)
    if (p && p.cid === opts.clientId && (ROLE_LVL[p.rol] || 0) >= minLevel) mode = 'online:' + p.rol
  }
  if (!mode && solicitanteNivel >= minLevel) mode = `session_role:${opts.solicitanteRol}`
  if (!mode) return { ok: false, mode: 'blocked', solicitanteNivel }
  return { ok: true, mode, solicitanteNivel }
}

/**
 * ¿Esta aprobación merece que alguien la mire?
 *
 * Compatibilidad con los campos de auditoría existentes. Una aprobación concedida
 * nunca debe resultar sospechosa: los niveles insuficientes ya se bloquean arriba.
 */
export function apruebaSospechosa(r: { mode: string; solicitanteNivel: number }, minLevel = 4): boolean {
  return !r.mode.startsWith('online:') && r.solicitanteNivel < minLevel
}
