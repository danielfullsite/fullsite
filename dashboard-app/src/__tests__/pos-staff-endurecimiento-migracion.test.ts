/**
 * P0 pos_staff (2026-09-24) — la FORMA de las migraciones 20260925010000 (endurecimiento) y
 * 20260925020000 (TRUNCATE), y los contratos que las atan al código.
 *
 * No corre SQL. Las migraciones se ejecutaron de verdad contra un Postgres 16 desechable con
 * el esquema de producción replicado: `supabase/tests/pos_staff_endurecimiento/run.sh`
 * (matriz vulnerable → PR3 → endurecido → rollback exacto → reaplicar → fallas inyectadas →
 * act-as con caducidad → TRUNCATE). Esto sólo impide que alguien las afloje sin correr eso.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const MIG = path.resolve(dir, '../../../supabase/migrations')
const leer = (f: string) => readFileSync(path.join(MIG, f), 'utf8').toLowerCase()
const ejecutable = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')

const END = 'PENDIENTE_20260925010000_pos_staff_endurecimiento.sql'
const END_RB = 'PENDIENTE_20260925010000_pos_staff_endurecimiento_ROLLBACK.sql'
const TRU = 'PENDIENTE_20260925020000_revocar_truncate_anon_authenticated.sql'
const TRU_RB = 'PENDIENTE_20260925020000_revocar_truncate_anon_authenticated_ROLLBACK.sql'

const end = ejecutable(leer(END))
const tru = ejecutable(leer(TRU))
const truRb = ejecutable(leer(TRU_RB))

describe('endurecimiento de pos_staff', () => {
  it('existe su rollback y su harness de Postgres', () => {
    expect(existsSync(path.join(MIG, END_RB))).toBe(true)
    expect(existsSync(path.resolve(dir, '../../../supabase/tests/pos_staff_endurecimiento/run.sh'))).toBe(true)
  })

  it('es UNA transacción con lock_timeout (nada queda a medias, no bloquea el POS)', () => {
    expect(end.trim().startsWith('begin;')).toBe(true)
    expect(end.trim().endsWith('commit;')).toBe(true)
    expect(end).toMatch(/set local lock_timeout = '\d+s'/)
  })

  it('revoca TODO de anon y authenticated a nivel tabla (TRUNCATE incluido)', () => {
    expect(end).toContain('revoke all on table public.pos_staff from anon, authenticated;')
  })

  it('authenticated sólo recibe SELECT de columnas no sensibles — nunca pin, hash ni sueldos', () => {
    const grants = [...end.matchAll(/grant ([^;]+) on table public\.pos_staff to ([^;]+);/g)]
    expect(grants).toHaveLength(1)
    const [, que, quien] = grants[0]
    expect(quien.trim()).toBe('authenticated')
    expect(que).toMatch(/^select \(/)
    for (const col of ['pin', 'pin_hash', 'pin_hash_v', 'hourly_rate', 'weekly_salary']) {
      expect(que).not.toMatch(new RegExp(`\\b${col}\\b`))
    }
    expect(end).not.toMatch(/grant (insert|update|delete|truncate|all)[^;]*public\.pos_staff /)
  })

  it('borra las políticas de escritura de authenticated (falla cerrado en dos capas)', () => {
    for (const p of ['pos_staff_ins', 'pos_staff_upd', 'pos_staff_del']) {
      expect(end).toContain(`drop policy if exists ${p} on public.pos_staff;`)
    }
    expect(end).not.toMatch(/create policy/)
  })

  it('client_id inmutable y auditoría por trigger en la misma transacción', () => {
    expect(end).toMatch(/create trigger pos_staff_client_id_inmutable before update on public\.pos_staff/)
    expect(end).toMatch(/create trigger pos_staff_audit_trg after insert or update or delete on public\.pos_staff/)
  })

  it('el trigger de auditoría guarda NOMBRES de campo, jamás valores de pin', () => {
    // Lo que entra a pos_staff_audit: to_jsonb(campos) (text[] de nombres) y el actor.
    expect(end).toMatch(/to_jsonb\(campos\)/)
    expect(end).not.toMatch(/nuevo ->> 'pin'|viejo ->> 'pin'|new\.pin|old\.pin/)
  })

  it('las funciones SECURITY DEFINER fijan search_path y no son ejecutables por el navegador', () => {
    expect(end).toMatch(/security definer set search_path = pg_catalog, public/)
    expect(end).toContain('revoke all on function private.pos_staff_audit_trg() from public, anon, authenticated;')
    expect(end).toContain('revoke all on function private.pos_staff_client_id_inmutable() from public, anon, authenticated;')
  })

  it('pos_staff_audit: el navegador sólo lee; nadie falsifica la bitácora', () => {
    expect(end).toContain('revoke all on table public.pos_staff_audit from anon, authenticated;')
    expect(end).toContain('grant select on table public.pos_staff_audit to authenticated;')
    expect(end).toContain('revoke all on sequence public.pos_staff_audit_id_seq from anon, authenticated;')
  })

  it('no toca user_has_client_access (eso es PR5) ni la columna pin (eso es F1–F6)', () => {
    expect(end).not.toMatch(/user_has_client_access/)
    expect(end).not.toMatch(/alter table public\.pos_staff (drop|alter) column/)
  })
})

describe('revocar TRUNCATE de anon/authenticated', () => {
  it('revoca en todo public y en los privilegios por defecto (tablas futuras)', () => {
    expect(tru).toContain('revoke truncate on all tables in schema public from anon, authenticated;')
    expect(tru).toMatch(/alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;/)
  })

  it('no toca service_role ni otros privilegios', () => {
    expect(tru).not.toMatch(/service_role/)
    expect(tru).not.toMatch(/revoke (select|insert|update|delete|all)/)
  })

  it('su rollback NO re-otorga TRUNCATE en pos_staff ni pos_staff_audit (no deshace el endurecimiento)', () => {
    expect(truRb).toMatch(/not in \('pos_staff', 'pos_staff_audit'\)/)
  })
})

describe('contratos que atan la base al código', () => {
  it('el proxy redacta todas las columnas de credencial que la base puede tener', async () => {
    const { REDACTED_COLUMNS } = await import('@/lib/pos-db-policy')
    expect([...REDACTED_COLUMNS.pos_staff].sort()).toEqual(['pin', 'pin_hash', 'pin_hash_v'])
  })

  it('las columnas que lee el navegador directo están TODAS en el grant de authenticated', () => {
    // Inventario 2026-09-24: pos-data.ts:1493 (name), pos/configuracion y admin/exportar
    // (id,name,role,active). Si alguien agrega una columna aquí sin otorgarla, 42501 en prod.
    const grant = /grant select \(([^)]+)\) on table public\.pos_staff to authenticated;/.exec(end)![1]
    const otorgadas = new Set(grant.split(',').map(s => s.trim()))
    for (const col of ['id', 'name', 'role', 'active', 'client_id']) expect(otorgadas.has(col)).toBe(true)
  })

  it('las lecturas directas del navegador piden sólo columnas otorgadas', () => {
    const src = path.resolve(dir, '..')
    const casos: Array<[string, RegExp]> = [
      ['lib/pos-data.ts', /rest\/v1\/pos_staff\?[^`]*select=([a-z_,]+)/],
      ['app/pos/configuracion/page.tsx', /pos_staff\?[^`'"]*select=([a-z_,]+)/],
      ['app/admin/exportar/page.tsx', /table: 'pos_staff', select: '([a-z_,]+)'/],
    ]
    const grant = /grant select \(([^)]+)\) on table public\.pos_staff to authenticated;/.exec(end)![1]
    const otorgadas = new Set(grant.split(',').map(s => s.trim()))
    for (const [f, re] of casos) {
      const m = re.exec(readFileSync(path.join(src, f), 'utf8'))
      expect(m, `${f} debe seguir leyendo pos_staff con select explícito`).not.toBeNull()
      for (const col of m![1].split(',')) expect(otorgadas.has(col), `${f}: ${col}`).toBe(true)
    }
  })

  it('los tres escritores de PIN (E1, E2, E3) pasan por columnasDePin', () => {
    const src = path.resolve(dir, '..')
    for (const f of ['app/api/owner/staff/route.ts', 'app/api/platform/staff/route.ts', 'lib/provision-tenant.ts']) {
      expect(readFileSync(path.join(src, f), 'utf8'), f).toMatch(/columnasDePin\(/)
    }
  })
})
