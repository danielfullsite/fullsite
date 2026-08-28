// Forma de seguridad de la migración pos_location_stations. Lee el archivo, no corre SQL.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  path.resolve(dir, '../../../supabase/migrations/20260827140000_pos_location_stations.sql'),
  'utf8',
).toLowerCase()

describe('migración pos_location_stations', () => {
  it('aditiva: create if not exists, sin drop table destructivo', () => {
    expect(sql).toContain('create table if not exists public.pos_location_stations')
    expect(sql).not.toMatch(/drop\s+table\s+public/)
  })

  it('estación acotada a cocina/barra/caja', () => {
    expect(sql).toContain('station in (\'cocina\', \'barra\', \'caja\')')
  })

  it('FK compuesto: la sucursal pertenece al mismo tenant', () => {
    expect(sql).toContain('foreign key (client_id, location_id)')
    expect(sql).toContain('references public.client_locations (client_id, id)')
  })

  it('overrides validados: sólo estaciones válidas, con tope de tamaño', () => {
    expect(sql).toContain('pos_location_stations_overrides_ck')
    expect(sql).toContain('8192')
  })

  it('RLS fail-closed: habilitada, lectura por tenant, sin anon, sin escritura authenticated', () => {
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('private.user_has_client_access(client_id)')
    expect(sql).toContain('for select')
    expect(sql).not.toContain('to anon')
    expect(sql).not.toMatch(/for\s+(insert|update|delete)[\s\S]{0,80}to authenticated/)
  })

  it('constraints idempotentes (guardadas por pg_constraint)', () => {
    expect(sql).toContain('from pg_constraint where conname')
  })
})
