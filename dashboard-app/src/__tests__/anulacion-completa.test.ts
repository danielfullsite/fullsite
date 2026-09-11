// Anular una orden completa exige decidir qué pasa con la mercancía de CADA renglón.
//
// H08, 2026-09-10: `r1_reconcile_order` rechaza una orden `cancelada` cuyos renglones
// no traen `inventory_disposition` (CANCELLATION_DISPOSITION_REQUIRED). Eso evitó
// devolver existencias ficticias, pero dejaba el inventario pendiente para siempre
// porque la anulación completa no capturaba la decisión. Este módulo la captura;
// estas pruebas anclan que nunca se propone devolver stock por suposición.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { disposicionPropuesta, renglonesAnulados, renglonesVivos, resumenDeDisposicion } from '@/lib/anulacion-completa'

const cafe = { id: 'r1', nombre: 'Café', cantidad: 2, subtotal: 100 }
const te = { id: 'r2', nombre: 'Té', cantidad: 1, subtotal: 40 }
const yaCancelado = { id: 'r3', nombre: 'Pan', cantidad: 1, subtotal: 20, cancelled: true, inventory_disposition: 'return_stock' }

describe('La propuesta por defecto es conservadora', () => {
  it('REGRESION: lo enviado a cocina se propone como merma; lo no enviado regresa', () => {
    expect(disposicionPropuesta([cafe, te], new Set(['r1']))).toEqual({ r1: 'retain_consumption', r2: 'return_stock' })
  })
  it('nada enviado: todo regresa', () => {
    expect(disposicionPropuesta([cafe, te], new Set())).toEqual({ r1: 'return_stock', r2: 'return_stock' })
  })
  it('los renglones ya cancelados no entran en la propuesta', () => {
    expect(disposicionPropuesta([cafe, yaCancelado], new Set(['r1', 'r3']))).toEqual({ r1: 'retain_consumption' })
    expect(renglonesVivos([cafe, yaCancelado]).map(r => r.id)).toEqual(['r1'])
  })
})

describe('Los renglones que viajan en la anulación', () => {
  it('REGRESION: cada renglón va cancelado, con su disposición y el motivo', () => {
    const r = renglonesAnulados([cafe, te], { r1: 'retain_consumption', r2: 'return_stock' }, 'cliente se fue')
    expect(r).toEqual([
      { ...cafe, cancelled: true, inventory_disposition: 'retain_consumption', cancellation_reason: 'cliente se fue' },
      { ...te, cancelled: true, inventory_disposition: 'return_stock', cancellation_reason: 'cliente se fue' },
    ])
  })
  it('REGRESION: sin decisión para un renglón NO se manda nada — se lanza con el nombre', () => {
    expect(() => renglonesAnulados([cafe, te], { r1: 'retain_consumption' }, 'x')).toThrow(/CANCELLATION_DISPOSITION_REQUIRED: Té/)
  })
  it('una disposición inventada no cuenta como decisión', () => {
    expect(() => renglonesAnulados([cafe], { r1: 'devolver' as never }, 'x')).toThrow(/CANCELLATION_DISPOSITION_REQUIRED/)
  })
  it('un renglón cancelado antes conserva su disposición previa', () => {
    const r = renglonesAnulados([cafe, yaCancelado], { r1: 'return_stock' }, 'x')
    expect(r[1].inventory_disposition).toBe('return_stock')
    expect(r[1].cancelled).toBe(true)
  })
  it('un renglón cancelado antes SIN disposición la exige ahora', () => {
    const viejo = { id: 'r9', nombre: 'Sopa', cantidad: 1, subtotal: 30, cancelled: true }
    expect(() => renglonesAnulados([viejo], {}, 'x')).toThrow(/Sopa/)
    expect(renglonesAnulados([viejo], { r9: 'retain_consumption' }, 'x')[0].inventory_disposition).toBe('retain_consumption')
  })
})

describe('El resumen para auditoría', () => {
  it('separa merma de lo que regresa', () => {
    expect(resumenDeDisposicion([cafe, te], { r1: 'retain_consumption', r2: 'return_stock' })).toEqual({ merma: 100, regresa: 40 })
  })
})

describe('El POS lo usa al anular', () => {
  const leer = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  it('REGRESION: la anulación completa manda los renglones con disposición en el mismo guardado', () => {
    const pos = leer('src/app/pos/page.tsx')
    const i = pos.indexOf('const handleVoidOrder = useCallback')
    const anular = pos.slice(i, pos.indexOf('const handleCashMovement', i))
    expect(anular).toMatch(/renglonesAnulados\(/)
    expect(anular).toMatch(/items: renglones/)
  })
  it('REGRESION: el modal pide la disposición por renglón y la propone conservadora', () => {
    const pos = leer('src/app/pos/page.tsx')
    const i = pos.indexOf('function VoidOrderModal(')
    const modal = pos.slice(i, pos.indexOf('\n}\n', i))
    expect(modal).toMatch(/disposicionPropuesta\(/)
    expect(modal).toMatch(/retain_consumption/)
    expect(modal).toMatch(/return_stock/)
  })
})
