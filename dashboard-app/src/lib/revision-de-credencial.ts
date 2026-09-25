/**
 * Revisión de la credencial de una persona (revisión adversarial E5, bloque POS 2026-09-24).
 *
 * La Caja prepara una credencial offline por persona y la compara, después de cada entrada con
 * red, contra el roster de la nube. El roster sólo traía `id` y `role`, así que un `reset_pin`
 * NO llegaba: el PIN viejo seguía entrando sin red hasta 7 días (y, si ese PIN se le asignaba
 * a otra persona, entraba como la primera).
 *
 * `cred_rev` cambia cuando cambia el PIN, y la Caja borra la credencial cuya revisión ya no
 * coincide. Es un HMAC con una subllave del servidor: la Caja lo compara pero no puede sacar
 * de él el PIN (no tiene la llave). Nunca se calcula ni se devuelve sin secreto.
 *
 * Mientras exista `pin` en claro se usa ése (el backfill de `pin_hash` no cambia la revisión y
 * no obliga a re-preparar a todos); sin `pin` (F5), el hash.
 */
import { createHmac } from 'crypto'

function subllave(): Buffer | null {
  const s = process.env.SHIFT_TOKEN_SECRET
  if (!s || s.length < 32) return null
  return createHmac('sha256', s).update('fullsite:cred-rev:v1').digest()
}

export function revisionDeCredencial(staffId: string, pin: string | null | undefined, pinHash: string | null | undefined): string | null {
  const k = subllave()
  if (!k || !staffId) return null
  const material = typeof pin === 'string' && pin ? `p:${pin}` : typeof pinHash === 'string' && pinHash ? `h:${pinHash}` : null
  if (!material) return null
  return createHmac('sha256', k).update(`${staffId}|${material}`).digest('hex').slice(0, 32)
}
