import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(
  resolve(process.cwd(), '../supabase/migrations', name),
  'utf8',
).toLowerCase()
const cleanup = readFileSync(
  resolve(process.cwd(), '../docs/operations/AMALAY-CUTOVER-TEST-ORDERS-CLEANUP-2026-08-31.sql'),
  'utf8',
).toLowerCase()

describe('AMALAY cutover database protections', () => {
  it('closes the cross-tenant agent backup to browser roles without deleting recovery data', () => {
    const sql = migration('20260831010000_secure_agent_results_backup.sql')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('force row level security')
    expect(sql).toContain('revoke all on table public.agent_results_respaldo_jsonb from anon')
    expect(sql).toContain('revoke all on table public.agent_results_respaldo_jsonb from authenticated')
    expect(sql).not.toContain('drop table')
    expect(sql).not.toContain('delete from')
  })

  it('numbers orders inside one turno and serializes concurrent allocation', () => {
    const sql = migration('20260831011000_pos_turno_replay_and_numbering.sql')
    expect(sql).toContain('add column if not exists captured_at timestamptz')
    expect(sql).toContain('pg_advisory_xact_lock')
    expect(sql).toContain('and turno_id = new.turno_id')
    expect(sql).not.toContain('drop column')
  })

  it('keeps the AMALAY test-order cleanup auditable and rollback-only by default', () => {
    expect(cleanup).toContain('v_count <> 16')
    expect(cleanup).toContain('v_total <> 6172.36')
    expect(cleanup).toContain("action, actor")
    expect(cleanup).toContain("'cutover_test_order_cancelled'")
    expect(cleanup).not.toContain('delete from')
    expect(cleanup.trimEnd().endsWith('rollback;')).toBe(true)
  })
})
