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

// ── QUÉ SE CIERRA AQUÍ, Y QUÉ NO ────────────────────────────────────────────
//
// `offline_approved: true` es una AFIRMACIÓN DEL CLIENTE, no una prueba. Un mesero
// con su propio shift token puede mandar
//
//     POST /api/pos/reopen-order
//     { "order_id": "…", "offline_approved": true, "manager": "Eduardo" }
//
// y reabrir una cuenta ya pagada. Prender POS_APPROVAL_STRICT no lo evita: ese check
// vive en el `else if` de abajo, así que la rama offline lo esquiva por orden de
// evaluación. La bandera sólo bloquea a quien no manda ningún campo.
//
// LO QUE NO SE HIZO, Y POR QUÉ. Lo obvio sería exigir que el rol de la SESIÓN sea
// gerente. Rompe el caso real: el gerente teclea su PIN en la terminal DEL MESERO, y
// la sesión sigue siendo del mesero. Sin red no hay token firmado, así que ese camino
// legítimo empezaría a dar 403 — y un 403 en el replay de la cola se clasifica
// TERMINAL_NON_RETRYABLE (pos-offline-db.ts:821): el item se marca terminal y NO se
// reintenta jamás. Cada cancelación hecha sin internet se perdería en silencio, la
// terminal la mostraría cancelada y el servidor la seguiría cobrando. AMALAY opera sin
// WAN; eso rompe la operación para tapar un hueco.
//
// EL CIERRE REAL es la prueba firmada por dispositivo: llave provisionada con red y
// HMAC(llave, orden+gerente+timestamp), verificable al drenar la cola. Es diseño con
// prueba de campo, no un parche.
//
// LO QUE SÍ SE HACE HOY, que no rompe nada y le quita el anonimato: el modo de
// aprobación registra QUIÉN pidió. `offline_device_trust:mesero` y
// `offline_device_trust:gerente` dejan de verse iguales en la bitácora, que es lo que
// hacía al vector invisible.

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
  if (!mode) {
    if (opts.offlineApproved === true) {
      // El rol va PEGADO al modo, no en un campo aparte, para que ningún consumidor
      // pueda leer el modo y olvidarse de mirar quién fue.
      mode = `offline_device_trust:${opts.solicitanteRol || 'desconocido'}`
    }
    else if (process.env.POS_APPROVAL_STRICT === 'true') return { ok: false, mode: 'blocked', solicitanteNivel }
    else mode = 'legacy_no_approval'
  }
  return { ok: true, mode, solicitanteNivel }
}

/**
 * ¿Esta aprobación merece que alguien la mire?
 *
 * Verdadera cuando el permiso se concedió por confianza en el dispositivo pero quien
 * pedía no tiene el nivel requerido — que es exactamente la forma del vector. No
 * bloquea: marca. Bloquear aquí es lo que rompería la operación sin WAN.
 */
export function apruebaSospechosa(r: { mode: string; solicitanteNivel: number }, minLevel = 4): boolean {
  return r.mode.startsWith('offline_device_trust') && r.solicitanteNivel < minLevel
}
