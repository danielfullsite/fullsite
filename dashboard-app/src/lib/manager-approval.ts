import { verifyShiftToken } from '@/lib/shift-token'

// ─── Aprobación de gerente server-side (anti-fraude) ─────────────────────────
// Para operaciones sensibles (cancelar, reabrir cuenta, descuento). Antes se confiaba
// en un string `manager` que el cliente afirmaba → un mesero podía forjarlo por POST
// directo. Ahora el servidor VERIFICA:
//   • Online: el token FIRMADO del gerente que emite /api/pos/pin (rol >= minLevel,
//     mismo tenant). Infalsificable desde el cliente.
//   • Offline: offline_approved — el PIN del gerente se verificó EN EL DISPOSITIVO
//     (PBKDF2, 8h). Decisión "como Wansoft": se acepta y se audita como device-trust,
//     para no romper la operación offline (país 40% efectivo).
// Rollout en 2 fases: sin ninguna aprobación → GRACE (permite + audita 'legacy_no_approval')
// salvo POS_APPROVAL_STRICT=true → 403. Se flipea a strict cuando el log deje de mostrar
// legacy (= todos los clientes con SW cacheado ya actualizaron).

const ROLE_LVL: Record<string, number> = { mesero: 1, cajero: 2, capitan: 3, gerente: 4, admin: 5 }

export async function verifyManagerApproval(opts: {
  approvalToken?: unknown
  offlineApproved?: unknown
  clientId: string
  minLevel?: number
}): Promise<{ ok: boolean; mode: string }> {
  const minLevel = opts.minLevel ?? 4 // gerente+
  let mode = ''
  if (typeof opts.approvalToken === 'string' && opts.approvalToken) {
    const p = await verifyShiftToken(opts.approvalToken)
    if (p && p.cid === opts.clientId && (ROLE_LVL[p.rol] || 0) >= minLevel) mode = 'online:' + p.rol
  }
  if (!mode) {
    if (opts.offlineApproved === true) mode = 'offline_device_trust'
    else if (process.env.POS_APPROVAL_STRICT === 'true') return { ok: false, mode: 'blocked' }
    else mode = 'legacy_no_approval'
  }
  return { ok: true, mode }
}
