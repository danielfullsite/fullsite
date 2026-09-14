/**
 * `/api/pos/staff-cache` no vuelve.
 *
 * ── Qué era ───────────────────────────────────────────────────────────────────
 *
 * Una ruta que leía `pos_staff` con la service key, hasheaba cada PIN con
 * `SHA-256(pin + '_fullsite_salt')` y devolvía la plantilla activa completa a
 * cualquiera con shift token — o sea, a cualquier mesero.
 *
 * Ese hash no protegía nada: sal estática, cero iteraciones, y un espacio de 10^4
 * para un PIN de 4 dígitos. Se recorre entero en menos de un segundo. Era texto plano
 * con pasos extra, y no de una persona: de toda la plantilla, incluidos los perfiles
 * que autorizan cancelaciones, descuentos y cortes de caja.
 *
 * ── Por qué seguía viva ───────────────────────────────────────────────────────
 *
 * `9d1776ea` la creó junto con su consumidor en `pos/layout.tsx`. `dbd84c1a`
 * ("POS: P0 production hardening") quitó el consumidor —el caché de PIN en el
 * navegador, el mismo "P0-E fix" que menciona `api/pos/pin/route.ts:8`— y **dejó la
 * ruta sirviendo**. Quedó huérfana ahí, exponiendo, sin que nadie la llamara.
 *
 * Es la forma inversa del hallazgo de T-24: allá un módulo perfecto y desconectado
 * se veía igual que uno que no existe. Aquí una ruta desconectada se veía igual que
 * una borrada — y no lo estaba.
 *
 * ── Qué prueba esto, exactamente ──────────────────────────────────────────────
 *
 * Que el archivo no está. Nada más, y conviene decirlo: no impide que alguien
 * exponga los PIN por otra ruta con otro nombre. Su alcance es literalmente el
 * directorio que inspecciona. Vale porque el modo de falla real de este endpoint no
 * fue que alguien lo inventara de cero: fue que sobrevivió a la desaparición de su
 * consumidor.
 *
 * Levantado el 2026-09-14 (hallazgo C1 de docs/security/PLAN-PIN-HASH.md).
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const RUTA = path.resolve(dir, '../app/api/pos/staff-cache')

describe('/api/pos/staff-cache está borrada y no vuelve', () => {
  it('el directorio de la ruta no existe', () => {
    expect(
      existsSync(RUTA),
      'Si esta prueba falla, alguien reintrodujo un endpoint que entrega un derivado ' +
      'del PIN de TODA la plantilla a cualquiera con shift token. El hasheo del PIN va ' +
      'por pos-pin-hash.ts contra la base, no repartiendo hashes a los clientes.',
    ).toBe(false)
  })

  it('tampoco existe su route.ts', () => {
    expect(existsSync(path.join(RUTA, 'route.ts'))).toBe(false)
  })
})
