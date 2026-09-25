/**
 * Qué columnas se escriben en `pos_staff` cuando se asigna un PIN.
 *
 * F2 de `docs/security/PLAN-PIN-HASH.md` — doble escritura. Los tres escritores (E1
 * `/api/owner/staff`, E2 `/api/platform/staff`, E3 `provisionTenant`) importan ESTO en vez de
 * armar `{ pin }` a mano, para que la regla viva en un solo lugar.
 *
 * ── El interruptor ────────────────────────────────────────────────────────────────────
 *
 * `POS_PIN_DUAL_WRITE=on` activa la escritura de `pin_hash` + `pin_hash_v`. Cualquier otro
 * valor (o ninguno) escribe sólo `pin`, como hoy. El interruptor existe por una razón de
 * ORDEN, no de gusto: las columnas `pin_hash`/`pin_hash_v` las crea la migración F1
 * (`PENDIENTE_20260914120000`). Si el código escribiera el hash antes de que la columna
 * exista, PostgREST respondería 400 (PGRST204) y NADIE podría dar de alta personal.
 *
 *   1. Aplicar F1.  2. Publicar `POS_PIN_PEPPER`.  3. Poner `POS_PIN_DUAL_WRITE=on`.
 *
 * ── Falla CERRADO ─────────────────────────────────────────────────────────────────────
 *
 * Con el interruptor encendido y sin pimienta, `hashPinParaBD` lanza `PimientaNoConfigurada`.
 * NO se cae a escribir sólo `pin`: después del backfill (F3) eso dejaría un `pin_hash` viejo
 * junto a un `pin` nuevo, y el corte de lectura (F4) dejaría fuera a esa persona sin que nadie
 * lo note. La ruta traduce la excepción a `503 authority_unavailable`.
 *
 * Una vez corrido F3, el interruptor NO se apaga: apagarlo reabre el mismo desfase.
 */
import { hashPinParaBD, VERSION_DE_PIMIENTA } from './pos-pin-hash'

export function dobleEscrituraDePinActiva(): boolean {
  return (process.env.POS_PIN_DUAL_WRITE ?? '').trim() === 'on'
}

export type ColumnasDePin =
  | { pin: string }
  | { pin: string; pin_hash: string; pin_hash_v: number }

/**
 * Las columnas a escribir para asignar `pin` a una persona de `clientId`.
 *
 * @throws {PimientaNoConfigurada} doble escritura encendida sin pimienta — traducir a 503.
 * @throws {Error} PIN o client_id con formato inválido (quien llama valida antes y da 400).
 */
export async function columnasDePin(clientId: string, pin: string): Promise<ColumnasDePin> {
  if (!dobleEscrituraDePinActiva()) return { pin }
  const pin_hash = await hashPinParaBD(clientId, pin)
  return { pin, pin_hash, pin_hash_v: VERSION_DE_PIMIENTA }
}
