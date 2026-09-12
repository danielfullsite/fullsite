import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(path.resolve(
  __dirname,
  '../../../supabase/migrations/PENDIENTE_20260912020000_kds_item_delta_atomico.sql',
), 'utf8').toLowerCase()

describe('migración KDS item delta', () => {
  it('fusiona un solo índice dentro de un UPDATE tenant/sucursal', () => {
    expect(sql).toContain('create or replace function public.pos_apply_kds_item_delta')
    expect(sql).toMatch(/update\s+public\.pos_orders[\s\S]*jsonb_set/)
    expect(sql).toMatch(/client_id\s*=\s*p_client_id/)
    expect(sql).toMatch(/location_id\s*=\s*p_location_id/)
    expect(sql).toMatch(/status\s+in\s*\('enviada',\s*'preparando',\s*'lista'\)/)
  })

  it('no expone la función atómica al navegador', () => {
    expect(sql).toMatch(/revoke\s+all[\s\S]*from\s+public,\s*anon,\s*authenticated/)
    expect(sql).toMatch(/grant\s+execute[\s\S]*to\s+service_role/)
  })
})
