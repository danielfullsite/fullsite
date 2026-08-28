// Fija la forma de seguridad de la migración de pos_terminals. No corre SQL: lee el archivo
// y afirma las propiedades que no deben regresar — RLS fail-closed, aislamiento por tenant,
// FK compuesto tenant+sucursal, y el CHECK de metadata. Autocontenido.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  path.resolve(dir, '../../../supabase/migrations/20260827120000_pos_terminals_por_sucursal.sql'),
  'utf8',
).toLowerCase()

describe('migración pos_terminals — aditiva e idempotente', () => {
  it('captura la tabla sin destruir (create if not exists, nunca drop table)', () => {
    expect(sql).toContain('create table if not exists public.pos_terminals')
    expect(sql).not.toMatch(/drop\s+table\s+(?!if\s+exists\s+—)/) // sin DROP TABLE destructivo
  })

  it('agrega location_id como columna aditiva (add column if not exists)', () => {
    expect(sql).toContain('add column if not exists location_id')
  })

  it('las constraints se agregan condicionalmente (idempotencia)', () => {
    expect(sql).toContain('from pg_constraint where conname')
  })
})

describe('migración pos_terminals — aislamiento tenant + sucursal', () => {
  it('FK compuesto: (client_id, location_id) → client_locations(client_id, id)', () => {
    expect(sql).toContain('foreign key (client_id, location_id)')
    expect(sql).toContain('references public.client_locations (client_id, id)')
  })

  it('UNIQUE(client_id, id) en client_locations para habilitar el FK compuesto', () => {
    expect(sql).toContain('unique (client_id, id)')
  })

  it('server_device_id referencia otra terminal del MISMO tenant', () => {
    expect(sql).toContain('foreign key (client_id, server_device_id)')
    expect(sql).toContain('references public.pos_terminals (client_id, device_id)')
  })
})

describe('migración pos_terminals — RLS fail-closed', () => {
  it('habilita RLS', () => {
    expect(sql).toContain('enable row level security')
  })

  it('la lectura de authenticated está acotada por tenant (user_has_client_access)', () => {
    expect(sql).toContain('for select')
    expect(sql).toContain('to authenticated')
    expect(sql).toContain('private.user_has_client_access(client_id)')
  })

  it('NO hay política para anon (fail-closed: anon denegado por ausencia de política)', () => {
    expect(sql).not.toContain('to anon')
  })

  it('NO hay política de escritura para authenticated (escribe sólo service_role)', () => {
    expect(sql).not.toMatch(/for\s+(insert|update|delete)[\s\S]{0,80}to authenticated/)
  })
})

describe('migración pos_terminals — metadata sin secretos', () => {
  it('CHECK de metadata con whitelist y tope de tamaño', () => {
    expect(sql).toContain('pos_terminals_metadata_ck')
    expect(sql).toContain('pos_terminals_metadata_ok')
    expect(sql).toContain('4096')
  })

  it('location_id queda NULLABLE (transición legacy — no NOT NULL en esta migración)', () => {
    expect(sql).not.toMatch(/location_id[\s\S]{0,40}not null/)
  })
})
