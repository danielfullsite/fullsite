/**
 * F1 de `docs/security/PLAN-PIN-HASH.md` — la forma de la migración de `pin_hash`.
 *
 * Sigue la convención de `pos-terminals-migration.test.ts`: no corre SQL, lee el archivo y
 * afirma las propiedades que no deben regresar. Autocontenido.
 *
 * La migración SÍ se ejecutó de verdad antes de subirla — contra un Postgres 16.14 local con
 * el DDL de producción replicado. Ahí se encontró el defecto del CHECK que estas pruebas
 * ahora fijan (ver "el `is not null` no es adorno" más abajo). Leer la expresión no bastaba.
 *
 * El último bloque es el que más valor tiene: ata el formato que exige la BASE al formato que
 * produce la LIBRERÍA. Son dos archivos que nadie edita junto, y si se separan el backfill de
 * F3 escribe filas que la base rechaza — o peor, que acepta y F4 no encuentra.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { hashPinParaBD, VERSION_DE_PIMIENTA } from '@/lib/pos-pin-hash'

const dir = path.dirname(fileURLToPath(import.meta.url))
const RUTA = path.resolve(dir, '../../../supabase/migrations/PENDIENTE_20260914120000_pos_staff_pin_hash.sql')

/** El archivo entero, comentarios incluidos. Sólo para afirmar sobre lo que DOCUMENTA. */
const sql = readFileSync(RUTA, 'utf8').toLowerCase()

/**
 * Sólo lo que Postgres va a ejecutar.
 *
 * Esta separación no es cosmética: la primera versión de estas pruebas afirmaba sobre el
 * archivo completo y la de "no borra nada" falló contra la frase `drop constraint` que aparece
 * en un COMENTARIO sobre F5. Falló del lado correcto, pero revela el problema de fondo: una
 * guarda que lee prosa también habría dado por bueno un `add column if not exists` que sólo
 * existiera dentro de un comentario. Lo estructural se afirma contra esto.
 */
const sqlEjecutable = sql.replace(/--[^\n]*/g, '')

describe('migración pin_hash — aditiva, nunca destructiva', () => {
  it('agrega las dos columnas con `if not exists` (idempotente)', () => {
    expect(sqlEjecutable).toContain('add column if not exists pin_hash')
    expect(sqlEjecutable).toContain('add column if not exists pin_hash_v')
  })

  it('NO toca la columna `pin` — es la autoritativa hasta F4 y el rollback depende de ella', () => {
    expect(sqlEjecutable).not.toMatch(/drop\s+column/)
    expect(sqlEjecutable).not.toMatch(/alter\s+column\s+pin\s/)
    expect(sqlEjecutable).not.toMatch(/update\s+public\.pos_staff\s+set/)
  })

  it('no borra nada', () => {
    expect(sqlEjecutable).not.toMatch(/drop\s+table/)
    expect(sqlEjecutable).not.toMatch(/drop\s+constraint/)
    expect(sqlEjecutable).not.toMatch(/truncate/)
    expect(sqlEjecutable).not.toMatch(/delete\s+from/)
  })

  it('las columnas nacen NULLABLE — 84 filas existentes no pueden tener hash todavía', () => {
    expect(sqlEjecutable).not.toMatch(/pin_hash\s+text\s+not\s+null/)
    expect(sqlEjecutable).not.toMatch(/set\s+not\s+null/)
  })

  it('el constraint se agrega condicionalmente (idempotencia)', () => {
    expect(sqlEjecutable).toContain('from pg_constraint where conname')
  })
})

describe('migración pin_hash — el índice único, que es lo que hace que el login no sea ambiguo', () => {
  it('existe, es único y parcial', () => {
    expect(sqlEjecutable).toContain('create unique index if not exists pos_staff_pin_hash_unico')
    expect(sqlEjecutable).toContain('where pin_hash is not null')
  })

  it('es (client_id, pin_hash) en ese orden — sirve a las tres consultas de F4', () => {
    expect(sqlEjecutable).toContain('(client_id, pin_hash)')
  })

  it('NO filtra por `active`, igual que unique_pin_per_client', () => {
    // Si filtrara, el PIN de un empleado desactivado se vería "libre" en la validación y el
    // INSERT chocaría contra el índice con un 502 opaco (api/owner/staff/route.ts:50-54).
    const i = sqlEjecutable.indexOf('pos_staff_pin_hash_unico')
    expect(sqlEjecutable.slice(i, i + 300)).not.toContain('active')
  })
})

describe('migración pin_hash — el `is not null` del CHECK no es adorno', () => {
  /**
   * Un CHECK de Postgres rechaza la fila sólo cuando la expresión da FALSE; si da NULL, PASA.
   * La primera versión de este constraint decía `... and pin_hash_v >= 1` sin el guard, y una
   * fila de (hash válido, versión NULL) entraba: `true and (null >= 1)` = null, y
   * `false or null` = null → pasa. Justo la fila a medio escribir que el constraint existe
   * para impedir. Se descubrió EJECUTÁNDOLA, no leyéndola.
   */
  it('el constraint existe', () => {
    expect(sqlEjecutable).toContain('pos_staff_pin_hash_chk')
  })

  it('los `is not null` van ANTES de las comparaciones', () => {
    const i = sqlEjecutable.indexOf('add constraint pos_staff_pin_hash_chk')
    const cuerpo = sqlEjecutable.slice(i, i + 500)
    const guard = cuerpo.indexOf('pin_hash_v is not null')
    const comparacion = cuerpo.indexOf('pin_hash_v >= 1')
    expect(guard, 'sin el guard, una fila a medio escribir pasa').toBeGreaterThan(-1)
    expect(comparacion).toBeGreaterThan(-1)
    expect(guard, 'el guard tiene que evaluarse primero para dar FALSE y no NULL')
      .toBeLessThan(comparacion)
  })

  it('ata las dos columnas: o las dos están, o ninguna', () => {
    expect(sqlEjecutable).toContain('pin_hash is null and pin_hash_v is null')
  })

  it('la trampa queda explicada en el archivo, no sólo evitada', () => {
    expect(sql, 'quien venga después tiene que entender por qué está el guard')
      .toMatch(/rechaza la fila solo cuando la expresion da false|false or null/i)
  })
})

describe('el formato de la BASE y el de la LIBRERÍA no pueden separarse', () => {
  /** El regex tal como lo exige el CHECK, extraído del propio archivo de migración. */
  const regexDeLaMigracion = (() => {
    const m = sqlEjecutable.match(/pin_hash\s*~\s*'(\^\[0-9a-f\]\{64\}\$)'/)
    return m ? new RegExp(m[1]) : null
  })()

  it('la migración exige 64 hex en minúsculas', () => {
    expect(regexDeLaMigracion, 'no se encontró el regex en la migración').not.toBeNull()
    expect(regexDeLaMigracion!.source).toBe('^[0-9a-f]{64}$')
  })

  it('lo que produce hashPinParaBD() cabe en ese regex', async () => {
    process.env.POS_PIN_PEPPER = 'f'.repeat(64)
    for (const [cid, pin] of [['amalay', '1234'], ['boruca', '1234'], ['amalay', '1234567890']]) {
      expect(await hashPinParaBD(cid, pin), `${cid}/${pin}`).toMatch(regexDeLaMigracion!)
    }
  })

  it('la versión que escribe la librería satisface `pin_hash_v >= 1`', () => {
    expect(VERSION_DE_PIMIENTA).toBeGreaterThanOrEqual(1)
  })
})

describe('la migración documenta lo que NO hace', () => {
  it('dice por qué no revoca el SELECT de anon', () => {
    // Un `revoke select (pin) ... from anon` se ve como que cierra algo y no cierra nada:
    // un privilegio a nivel tabla no se recorta revocando columnas sueltas.
    expect(sql).toContain('anon')
    expect(sql).toMatch(/nivel tabla no se recorta|revocar el\s*--?\s*select completo/i)
  })

  it('advierte que staging no tiene pos_staff_pin_len_chk y F5 lo va a topar', () => {
    expect(sql).toContain('pos_staff_pin_len_chk')
    expect(sql).toMatch(/staging/)
    expect(sql, 'F5 planea dropearlo y en staging reventaría').toContain('drop constraint if exists')
  })

  it('declara que NO se aplicó por el MCP', () => {
    expect(sql).toMatch(/read-only/)
  })
})
