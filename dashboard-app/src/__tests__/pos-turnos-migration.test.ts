// Forma de seguridad de la migración de turnos por sucursal. Lee el archivo, no corre SQL.
// Fija lo que NO debe pasar: borrar historial ni reiniciar folios fiscales.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  path.resolve(dir, '../../../supabase/migrations/20260827150000_pos_turnos_por_sucursal.sql'),
  'utf8',
).toLowerCase()

describe('migración pos_turnos — aditiva', () => {
  it('agrega location_id y status como columnas (add column if not exists)', () => {
    expect(sql).toContain('add column if not exists location_id')
    expect(sql).toContain('add column if not exists status')
  })
  it('no borra historial: sin delete, sin drop table, sin truncate', () => {
    expect(sql).not.toMatch(/\bdelete\s+from\b/)
    expect(sql).not.toMatch(/\bdrop\s+table\b/)
    expect(sql).not.toMatch(/\btruncate\b/)
  })
  it('status se DERIVA de closed_at, y sólo toca filas sin status (idempotente)', () => {
    expect(sql).toMatch(/set status = case when closed_at is null/)
    expect(sql).toContain('where status is null')
  })
})

describe('migración pos_turnos — NO reinicia folios fiscales', () => {
  it('no ejecuta ninguna operación sobre tablas de facturación/CFDI', () => {
    // Se comprueban OPERACIONES (no la mera palabra, que puede aparecer en un comentario).
    expect(sql).not.toMatch(/(alter|update|insert\s+into|delete\s+from|drop)\s+[^;]*cfdi/)
    expect(sql).not.toMatch(/(alter|update|insert\s+into|delete\s+from|drop)\s+[^;]*folio/)
  })
  it('no reinicia ninguna secuencia', () => {
    expect(sql).not.toContain('setval')
    expect(sql).not.toContain('restart')
    expect(sql).not.toContain('alter sequence')
  })
})

describe('migración pos_turnos — una caja/turno activo por sucursal', () => {
  it('índice único parcial de turno abierto por (client_id, location_id)', () => {
    expect(sql).toContain('unique index if not exists uq_pos_turnos_activo_por_sucursal')
    expect(sql).toMatch(/where status = 'abierto' and location_id is not null/)
  })
  it('FK compuesto: la sucursal del turno es del mismo tenant', () => {
    expect(sql).toContain('foreign key (client_id, location_id)')
    expect(sql).toContain('references public.client_locations (client_id, id)')
  })
  it('status acotado a abierto/cerrado/forzado', () => {
    expect(sql).toContain("status in ('abierto', 'cerrado', 'forzado')")
  })
  it('location_id nullable (turnos legacy en transición)', () => {
    expect(sql).not.toMatch(/location_id\s+text\s+not null/)
  })
})

describe('migración pos_turnos — no duplica la RLS existente', () => {
  it('no recrea políticas de pos_turnos (ya existen en el baseline)', () => {
    expect(sql).not.toContain('create policy')
    expect(sql).not.toContain('enable row level security')
  })
})
