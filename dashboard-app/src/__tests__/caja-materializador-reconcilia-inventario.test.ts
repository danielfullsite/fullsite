import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('materializador Caja e inventario R1', () => {
  const sql = readFileSync(join(process.cwd(), '..', 'supabase', 'migrations',
    'PENDIENTE_20260905010000_caja_business_materializer.sql'), 'utf8')
  const orderBranch = sql.slice(sql.indexOf("elsif event_type in ('ORDER_SAVE'"), sql.indexOf("if event_type like 'FINANCIAL_%'"))

  it('concilia dentro de la misma transacción después de materializar la orden', () => {
    const upsert = orderBranch.indexOf('insert into public.pos_orders')
    const reconcile = orderBranch.indexOf('public.r1_reconcile_order')
    expect(upsert).toBeGreaterThan(-1)
    expect(reconcile).toBeGreaterThan(upsert)
    expect(orderBranch).toContain("if event_type <> 'KITCHEN_SET'")
  })

  it('declara la migración de cancelaciones como requisito de rollout', () => {
    expect(sql.slice(0, 400)).toContain('20260910060000_inventory_cancelled_reconcile')
  })
})
