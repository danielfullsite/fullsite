import { verifyApprovalCredential } from '@/lib/shift-token'
import { esRecibo, verificarRecibo } from '@/lib/recibo-offline'

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

// ── EL TOKEN DE APROBACIÓN, VERIFICADO EN UN SOLO LUGAR (2026-09-24) ─────────
//
// Antes, cancel-item y transfer-item repetían a mano `verifyShiftToken(token)` + rol +
// tenant, y ninguno miraba DESDE DÓNDE ni CUÁNTAS VECES se usaba la aprobación. Un
// shiftToken de gerente (8 h) capturado en una terminal servía para aprobar cualquier cosa,
// en cualquier terminal del restaurante, toda la noche.
//
// Reglas nuevas, en este orden:
//   1. Firma, vigencia, tenant y rol mínimo (como antes).
//   2. TERMINAL: si el token dice de qué terminal salió (`tid`) y la sesión que lo presenta
//      también, tienen que coincidir. La aprobación se da frente a una pantalla; no viaja.
//   3. UN SOLO USO POR OPERACIÓN: el token de aprobación trae `jti`, y su primer uso queda
//      registrado junto con la operación que autorizó. Reintentar la MISMA operación (la
//      respuesta se perdió) vale; usarlo para OTRA es un replay y se rechaza.
//   4. Con POS_APROBACION_V2_ESTRICTA=true además se exige: token de aprobación (no el
//      shiftToken viejo), `tid` en ambos lados, y que el registro de uso haya funcionado.
//      Sin la bandera, lo viejo se acepta y queda marcado en el modo para la bitácora.

type UsoDeAprobacion = 'nuevo' | 'mismo' | 'reusado' | 'sin-registro'

/**
 * Registra el primer uso de un `jti`. Idempotente por operación.
 * `sin-registro` = la tabla no respondió (migración PENDIENTE_20260925030000 sin aplicar,
 * o la base caída): quien llama decide según el modo estricto.
 */
export async function registrarUsoDeAprobacion(jti: string, clientId: string, operacion: string): Promise<UsoDeAprobacion> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return 'sin-registro'
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  try {
    const ins = await fetch(`${url}/rest/v1/pos_aprobaciones_usadas`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ jti, client_id: clientId, operacion }),
      signal: AbortSignal.timeout(3000),
    })
    if (ins.ok) return 'nuevo'
    if (ins.status !== 409) return 'sin-registro'
    const prev = await fetch(`${url}/rest/v1/pos_aprobaciones_usadas?jti=eq.${encodeURIComponent(jti)}&select=client_id,operacion&limit=1`,
      { headers: H, cache: 'no-store', signal: AbortSignal.timeout(3000) })
    if (!prev.ok) return 'sin-registro'
    const rows = await prev.json().catch(() => null)
    if (!Array.isArray(rows) || rows.length !== 1) return 'sin-registro'
    return rows[0].client_id === clientId && rows[0].operacion === operacion ? 'mismo' : 'reusado'
  } catch {
    return 'sin-registro'
  }
}

export type VeredictoDeToken =
  | { ok: true; mode: string; actor: string; rol: string }
  | { ok: false; error: 'SIN_TOKEN' | 'TOKEN_INVALIDO' | 'TERMINAL_DISTINTA' | 'APROBACION_REUSADA' | 'APROBACION_NO_REGISTRADA' | 'APROBACION_V1_NO_ADMITIDA' }

export function aprobacionV2Estricta(): boolean {
  return process.env.POS_APROBACION_V2_ESTRICTA === 'true'
}

export async function verificarTokenDeAprobacion(token: unknown, opts: {
  clientId: string
  minLevel: number
  /** `tid` del shift token de la sesión que presenta la aprobación (POSAuthContext.terminalId). */
  terminalSolicitante?: string
  /** Operación que se autoriza (operation_id, o una clave estable). Sin ella: un solo uso, punto. */
  operacion?: string
}): Promise<VeredictoDeToken> {
  if (typeof token !== 'string' || !token) return { ok: false, error: 'SIN_TOKEN' }
  // Recibo de aprobación OFFLINE firmado por la Caja (recibo-offline.ts). Es una PRUEBA
  // verificable, así que cuenta como aprobación del servidor aun en POS_APPROVAL_STRICT.
  // Un recibo que no verifica (firma, tenant, rol, vigencia, raíz ausente) vale lo mismo que
  // un token inválido: el consumidor decide con sus banderas de rollout.
  if (esRecibo(token)) {
    const r = verificarRecibo(token, { clientId: opts.clientId, minLevel: opts.minLevel, terminalSolicitante: opts.terminalSolicitante })
    if (!r.ok) return { ok: false, error: r.error === 'TERMINAL_DISTINTA' ? 'TERMINAL_DISTINTA' : 'TOKEN_INVALIDO' }
    const marcasR: string[] = []
    const uso = await registrarUsoDeAprobacion(`recibo:${r.claims.non}`, opts.clientId, opts.operacion || `recibo:${r.claims.non}`)
    if (uso === 'reusado') return { ok: false, error: 'APROBACION_REUSADA' }
    if (uso === 'sin-registro') {
      if (aprobacionV2Estricta()) return { ok: false, error: 'APROBACION_NO_REGISTRADA' }
      marcasR.push('sin_registro')
    }
    if (uso === 'mismo') marcasR.push('reintento')
    return { ok: true, mode: ['offline_recibo:' + r.claims.rol, ...marcasR].join(':'), actor: r.claims.nam || r.claims.sub, rol: r.claims.rol }
  }
  const p = await verifyApprovalCredential(token)
  if (!p || p.cid !== opts.clientId || (ROLE_LVL[p.rol] || 0) < opts.minLevel) return { ok: false, error: 'TOKEN_INVALIDO' }
  const estricta = aprobacionV2Estricta()
  if (p.tid && opts.terminalSolicitante && p.tid !== opts.terminalSolicitante) return { ok: false, error: 'TERMINAL_DISTINTA' }
  const marcas: string[] = []
  if (p.pur !== 'aprobacion') {
    if (estricta) return { ok: false, error: 'APROBACION_V1_NO_ADMITIDA' }
    marcas.push('v1')
  }
  if (!p.tid || !opts.terminalSolicitante) {
    if (estricta) return { ok: false, error: 'TERMINAL_DISTINTA' }
    marcas.push('sin_terminal')
  }
  if (p.pur === 'aprobacion' && p.jti) {
    const uso = await registrarUsoDeAprobacion(p.jti, opts.clientId, opts.operacion || `jti:${p.jti}`)
    if (uso === 'reusado') return { ok: false, error: 'APROBACION_REUSADA' }
    if (uso === 'sin-registro') {
      if (estricta) return { ok: false, error: 'APROBACION_NO_REGISTRADA' }
      marcas.push('sin_registro')
    }
    if (uso === 'mismo') marcas.push('reintento')
  }
  return { ok: true, mode: ['online:' + p.rol, ...marcas].join(':'), actor: p.nam || p.sub, rol: p.rol }
}

export async function verifyManagerApproval(opts: {
  approvalToken?: unknown
  offlineApproved?: unknown
  clientId: string
  minLevel?: number
  /** Rol de la sesión que pide, del shift token FIRMADO. No lo dicta el cliente. */
  solicitanteRol?: string
  terminalSolicitante?: string
  operacion?: string
}): Promise<{ ok: boolean; mode: string; solicitanteNivel: number; error?: string }> {
  const minLevel = opts.minLevel ?? 4 // gerente+
  const solicitanteNivel = ROLE_LVL[String(opts.solicitanteRol)] || 0
  let mode = ''
  if (typeof opts.approvalToken === 'string' && opts.approvalToken) {
    const v = await verificarTokenDeAprobacion(opts.approvalToken, {
      clientId: opts.clientId, minLevel, terminalSolicitante: opts.terminalSolicitante, operacion: opts.operacion,
    })
    // Un token PRESENTE que no vale por terminal o por replay NO cae al camino offline:
    // eso convertiría un replay rechazado en un `legacy_no_approval` aceptado.
    if (!v.ok && v.error !== 'TOKEN_INVALIDO') return { ok: false, mode: 'blocked', solicitanteNivel, error: v.error }
    if (v.ok) mode = v.mode
  }
  if (!mode) {
    // MODO ESTRICTO = SÓLO PRUEBA DEL SERVIDOR (revisión adversarial de PR1, N-4).
    // Con POS_APPROVAL_STRICT=true, cualquier aprobación que no sea un token firmado
    // de gerente+ del mismo restaurante se rechaza — incluida `offline_approved`, que
    // es una afirmación del cliente. EFECTO EN CAMPO, explícito: las cancelaciones y
    // reaperturas aprobadas SIN internet no se aceptan en modo estricto; al drenar la
    // cola reciben 403 y pos-offline-db las marca TERMINAL_NON_RETRYABLE (ver el bloque
    // de arriba). Por eso la bandera se prende sólo cuando exista la prueba firmada por
    // dispositivo, o en un restaurante que acepte operar esas acciones sólo con red.
    // Sin la bandera todo sigue como hoy: se acepta y se audita con el rol real.
    if (process.env.POS_APPROVAL_STRICT === 'true') return { ok: false, mode: 'blocked', solicitanteNivel }
    if (opts.offlineApproved === true) {
      // El rol va PEGADO al modo, no en un campo aparte, para que ningún consumidor
      // pueda leer el modo y olvidarse de mirar quién fue.
      mode = `offline_device_trust:${opts.solicitanteRol || 'desconocido'}`
    }
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
