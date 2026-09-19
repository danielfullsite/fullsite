import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * OCM · autoridad de fuente por inquilino y fecha.
 *
 * QUÉ PROTEGE, Y POR QUÉ ESTÁ ESCRITO COMO PROHIBICIÓN Y NO COMO PRESENCIA
 *
 * La vista `ocm_daily` unía dos fuentes y desempataba con esta cláusula:
 *
 *     FROM hist h
 *     WHERE NOT EXISTS (SELECT 1 FROM live l
 *                       WHERE l.client_id = h.client_id AND l.fecha = h.fecha)
 *
 * O sea: `live` (pos_orders) siempre ganaba y `hist` (ops_daily) sólo rellenaba huecos.
 * Para AMALAY —que opera en Wansoft y tiene órdenes de prueba en el POS— eso publicó
 * $682 donde la fuente autoritativa decía $125,724, tres días seguidos, y $151 un cuarto
 * día en que ninguna fuente tenía dato.
 *
 * Una prueba que sólo comprobara "existe la tabla de autoridad" pasaría en verde con la
 * cláusula vieja todavía adentro. Por eso la mitad de lo que sigue son PROHIBICIONES.
 */

const migracion = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260918210000_tenant_source_authority.sql'),
  'utf8',
).toLowerCase()

/** El cuerpo sin comentarios: un `--` que cita el bug no puede contar como el bug. */
const sql = migracion
  .split('\n')
  .map((linea) => linea.split('--')[0])
  .join('\n')

describe('OCM — autoridad de fuente', () => {
  it('no reintroduce el respaldo automático entre fuentes', () => {
    // La forma exacta del defecto: `hist` condicionada a que `live` no exista.
    expect(sql).not.toMatch(/not\s+exists\s*\(\s*select\s+1\s+from\s+live/)
    // Ni su recíproca, que sería el mismo error al revés.
    expect(sql).not.toMatch(/not\s+exists\s*\(\s*select\s+1\s+from\s+hist/)
    // Y ningún `coalesce` entre las dos fuentes, que es el respaldo disfrazado.
    expect(sql).not.toMatch(/coalesce\s*\(\s*live\./)
    expect(sql).not.toMatch(/coalesce\s*\(\s*hist\./)
  })

  it('elige el candidato SÓLO por la fuente autoritativa', () => {
    // El filtro que hace que la vista nunca cruce de sistema.
    expect(sql).toContain('x.source_system = a.authoritative_source')
    // Y la autoridad se resuelve por la FECHA del dato, no por el estado de hoy.
    expect(sql).toContain('t.effective_from <=')
    expect(sql).toContain('t.effective_to is null')
  })

  it('publica el hueco en vez de inventar un número', () => {
    expect(sql).toContain('sin_dato_en_fuente_autoritativa')
    expect(sql).toContain('sin_autoridad')
    expect(sql).toContain('as data_status')
  })

  it('conserva el candado que ya se perdió dos veces', () => {
    // `create or replace view` REEMPLAZA los reloptions: lo que no se declara se pierde.
    // Así se perdió el 2026-09-09 y la vista corrió como `postgres` seis días.
    const creates = sql.match(/create\s+or\s+replace\s+view\s+public\.\w+[\s\S]{0,120}/g) ?? []
    expect(creates.length).toBeGreaterThanOrEqual(3)
    for (const bloque of creates) {
      expect(bloque).toMatch(/security_invoker\s*=\s*on/)
    }
    expect(sql).toContain('revoke select on public.ocm_daily from anon')
    // El plan de ejecución que fijó la migración de 2026-09-09 tampoco se pierde.
    expect(sql).toContain('not materialized')
  })

  it('impide dos autoridades vigentes para el mismo día', () => {
    // Sin esto, la autoridad de una fecha es ambigua y la vista elegiría una en
    // silencio: el mismo modo de falla que produjo el incidente.
    expect(sql).toContain('exclude using gist')
    expect(sql).toContain('tstzrange(effective_from')
    expect(sql).toContain('create extension if not exists btree_gist')
  })

  it('no deja que el modo y la fuente se separen', () => {
    // Un `shadow` con autoridad `fullsite` sería el defecto escrito a mano.
    expect(sql).toContain('tsa_modo_coherente_con_fuente')
    expect(sql).toMatch(/mode\s+in\s*\('legacy','shadow','parallel','rollback'\)\s*and\s+authoritative_source\s*=\s*'wansoft'/)
  })

  it('siembra AMALAY como shadow con Wansoft autoritativo', () => {
    expect(sql).toMatch(/'amalay',\s*'wansoft',\s*'shadow'/)
    // Retroactivo al inicio de la serie: sin esto, los días viejos quedarían sin autoridad.
    expect(sql).toContain("timestamptz '2024-01-01")
    // Y el resto de los inquilinos se siembra también, o la regla de "sin autoridad →
    // hueco" los apagaría a todos.
    expect(sql).toMatch(/from\s+public\.clients\s+c/)
  })

  it('no expone la tabla de autoridad por la llave pública', () => {
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('revoke all on public.tenant_source_authority from public, anon, authenticated')
    expect(sql).toContain('private.user_has_client_access(client_id)')
  })

  it('es aditiva: no borra ni toca datos de negocio', () => {
    expect(sql).not.toContain('drop table')
    expect(sql).not.toContain('delete from')
    expect(sql).not.toContain('truncate')
    expect(sql).not.toMatch(/update\s+public\.pos_orders/)
    expect(sql).not.toMatch(/update\s+public\.ops_daily/)
  })

  it('deja los dos guardianes del cutover', () => {
    expect(sql).toContain('create or replace view public.ocm_source_mismatch')
    expect(sql).toContain('create or replace view public.ocm_source_divergence')
    // G2 gradúa la severidad: es el instrumento que justifica el cutover con datos.
    expect(sql).toContain("then 'alta'")
    expect(sql).toContain("then 'media'")
  })
})
