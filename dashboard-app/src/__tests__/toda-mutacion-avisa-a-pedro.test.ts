// Bajo Electron, toda mutación de la cuenta tiene que llegar a Pedro.
//
// BARRIDO DEL 2026-09-10, antes del instalador. El mapa y el editor leen del MISMO
// Pedro (H3), pero en modo legacy —como se instala AMALAY— cinco mutaciones iban
// SOLO a la nube: anular la orden, cancelar un platillo, transferir un platillo,
// transferir la mesa y fusionar dos mesas. Pedro protege toda orden local del poll
// de nube, así que nunca se corregía: la mesa anulada seguía ocupada en las tres
// pantallas, el platillo cancelado seguía sumando en el mapa, la mesa transferida
// se veía en la vieja. Es la familia entera de «por fuera no dice lo mismo que por
// dentro» de los videos de Eduardo, por otra puerta.
//
// Sólo «Enviar» y «Cobrar» hablaban con Pedro. `avisarCuentaActualizada` es la boca
// que faltaba, y estas pruebas anclan (a) qué manda y (b) que cada sitio la llama.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7717' }))
vi.mock('@/lib/pedro-cliente', () => ({ requiereCaja: () => true }))

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { for (const k of Object.keys(store)) delete store[k] },
})

const enviados: Record<string, unknown>[] = []
let responder: { ok: boolean; status?: number } | Error = { ok: true }
vi.mock('@/lib/local-network-fetch', () => ({
  localNetworkFetch: async (_url: string, init: RequestInit) => {
    enviados.push(JSON.parse(String(init.body)))
    if (responder instanceof Error) throw responder
    return { ok: responder.ok, status: responder.status ?? 200 } as Response
  },
}))

beforeEach(() => { enviados.length = 0; localStorage.clear(); responder = { ok: true }; vi.resetModules() })
afterEach(async () => { (await import('@/lib/aviso-lan')).detenerReintentos(); vi.useRealTimers() })

const cargar = () => import('@/lib/aviso-lan')

describe('avisarCuentaActualizada: lo que manda', () => {
  it('REGRESION: es un ORDER_UPSERTED con la cuenta completa, y el id lleva el prefijo cuenta:', async () => {
    const { avisarCuentaActualizada } = await cargar()
    const items = [{ id: 'r1', nombre: 'Café', cantidad: 1, precio: 50, subtotal: 50 }, { id: 'r2', nombre: 'Té', cancelled: true }]
    expect(await avisarCuentaActualizada({
      opId: 'op-1', orderId: 'ord-1', clientId: 'amalay', mesa: 3, turnoId: 't1', status: 'enviada',
      items, subtotal: 50, iva: 8, total: 58, descuento: 0, personas: 2, mesero: 'Ana', orderRevision: 4,
    })).toBe(true)
    expect(enviados).toHaveLength(1)
    expect(enviados[0]).toMatchObject({
      command_id: 'cuenta:op-1', command_type: 'ORDER_UPSERTED', order_id: 'ord-1', client_id: 'amalay',
      mesa: 3, turno_id: 't1', status: 'enviada', items, subtotal: 50, iva: 8, total: 58, descuento: 0,
      personas: 2, mesero: 'Ana', order_revision: 4,
    })
  })

  it('lo que no viene no viaja: Pedro conserva lo que ya tenía (mover de mesa no pisa los platillos)', async () => {
    const { avisarCuentaActualizada } = await cargar()
    await avisarCuentaActualizada({ opId: 'op-2', orderId: 'ord-2', clientId: 'amalay', mesa: 9, status: 'enviada' })
    const aviso = enviados[0]
    expect(aviso.mesa).toBe(9)
    for (const campo of ['items', 'subtotal', 'iva', 'total', 'descuento', 'personas', 'mesero', 'order_revision', 'notas', 'turno_id']) {
      expect(campo in aviso, `${campo} no debe viajar si no se pasó`).toBe(false)
    }
  })

  it('es durable como el cierre: si Pedro no contesta, queda pendiente y se reintenta con el mismo id', async () => {
    responder = new Error('Failed to fetch')
    const { avisarCuentaActualizada, reintentarAvisosPendientes } = await cargar()
    expect(await avisarCuentaActualizada({ opId: 'op-3', orderId: 'ord-3', clientId: 'amalay', mesa: 1, status: 'enviada' })).toBe(false)
    responder = { ok: true }
    expect(await reintentarAvisosPendientes()).toEqual({ pendientes: 0, entregados: 1 })
    expect(enviados.map(e => e.command_id)).toEqual(['cuenta:op-3', 'cuenta:op-3'])
  })

  it('una actualización nueva espera la anterior pendiente para no restaurar platillos al reintentar', async () => {
    responder = new Error('LAN caída')
    const { avisarCuentaActualizada, reintentarAvisosPendientes } = await cargar()
    const cuenta = { orderId: 'ord-3', clientId: 'amalay', mesa: 1 }
    await avisarCuentaActualizada({ ...cuenta, opId: 'primera', total: 116 })
    responder = { ok: true }
    expect(await avisarCuentaActualizada({ ...cuenta, opId: 'segunda', total: 58 })).toBe(false)
    expect(enviados.map(e => e.command_id)).toEqual(['cuenta:primera'])
    expect(await reintentarAvisosPendientes()).toEqual({ pendientes: 0, entregados: 2 })
    expect(enviados.map(e => e.total)).toEqual([116, 116, 58])
  })

  it('si sigue fallando el primer aviso no se adelanta el segundo', async () => {
    responder = new Error('LAN caída')
    const { avisarCuentaActualizada, reintentarAvisosPendientes } = await cargar()
    const cuenta = { orderId: 'ord-3', clientId: 'amalay', mesa: 1 }
    await avisarCuentaActualizada({ ...cuenta, opId: 'primera', total: 116 })
    await avisarCuentaActualizada({ ...cuenta, opId: 'segunda', total: 58 })
    expect(await reintentarAvisosPendientes()).toEqual({ pendientes: 2, entregados: 0 })
    expect(enviados.every(e => e.command_id === 'cuenta:primera')).toBe(true)
  })

  it('sin order_id no manda nada (Pedro no podría aplicarlo y ensuciaría el historial)', async () => {
    const { avisarCuentaActualizada } = await cargar()
    expect(await avisarCuentaActualizada({ opId: 'op-4', orderId: '', clientId: 'amalay' })).toBe(false)
    expect(enviados).toHaveLength(0)
  })
})

// ── Los sitios que mutan la cuenta, uno por uno ─────────────────────────────
//
// El POS es un componente de 6.700 líneas sin harness de DOM; lo que se puede
// anclar sin navegador es que cada mutación, tras escribir en la nube, avise. Se
// cuentan LLAMADAS reales con comentarios e imports fuera (la primera versión de
// una prueba así pasaba con el cableado comentado — aviso-cierre-a-la-lan.test.ts).
const leer = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*import[\s\S]*?from\s+'[^']*'\s*$/gm, '')
const bloque = (src: string, desde: string, hasta: string) => {
  const i = src.indexOf(desde)
  expect(i, `no se encontró «${desde}»`).toBeGreaterThan(-1)
  const resto = src.slice(i)
  const j = resto.indexOf(hasta)
  return j === -1 ? resto : resto.slice(0, j)
}

describe('cada mutación del POS avisa a Pedro', () => {
  const pos = leer('src/app/pos/page.tsx')

  it('REGRESION: anular la orden emite ORDER_CANCELLED y suelta la identidad', () => {
    const anular = bloque(pos, 'const handleVoidOrder = useCallback', 'const handleCashMovement')
    expect(anular).toMatch(/avisarCierreDeOrden\(\{[^}]*cancelada: true/)
    expect(anular).toMatch(/olvidarCuentaCerrada\('cobrada-aqui'\)/)
  })

  it('REGRESION: cancelar un platillo avisa la cuenta completa con el renglón marcado', () => {
    const cancelar = bloque(pos, 'const handleCancelItem = useCallback', 'const handleTransferItem')
    expect(cancelar).toMatch(/avisarCuentaActualizada\(\{/)
    expect(cancelar).toMatch(/cuentaEnviadaParaLan/)
  })

  it('REGRESION: transferir un platillo avisa origen y destino', () => {
    const transferir = bloque(pos, 'const handleTransferItem = useCallback', 'const handleVoidOrder')
    expect(transferir.split('avisarCuentaActualizada(').length - 1).toBe(2)
    expect(transferir).toMatch(/result\.target_order_id/)
  })

  it('REGRESION: transferir la mesa avisa la mesa nueva', () => {
    const mover = bloque(pos, "await updateOrderStatus(orderId, 'enviada', { mesa: newMesa })", 'logAudit')
    expect(mover).toMatch(/avisarCuentaActualizada\(\{[\s\S]*mesa: newMesa/)
  })

  it('REGRESION: bajo Electron el número de mesa no cambia en el lugar con platillos en pantalla', () => {
    // Diagnosticado en CIERRE-DEFECTOS-2026-09-06 y sin arreglar: los renglones sin
    // enviar de la mesa origen se anexaban a la cuenta de la mesa destino.
    const input = bloque(pos, 'const newMesa = Number(e.target.value) || 1', 'setMesa(newMesa)')
    expect(input).toMatch(/requiereCaja\(\) && orderItems\.length > 0 && newMesa !== mesa/)
    expect(input).toMatch(/Transferir mesa/)
  })

  it('REGRESION: fusionar mesas avisa la cancelación de la origen y la cuenta nueva de la destino', () => {
    const mapa = leer('src/app/pos/mesas/page.tsx')
    const fusion = bloque(mapa, 'const handleMerge = async', 'setMerging(false)\n  }')
    expect(fusion).toMatch(/avisarCierreDeOrden\(\{[^}]*cancelada: true/)
    expect(fusion).toMatch(/avisarCuentaActualizada\(\{[\s\S]*items: mergedItems/)
  })

  it('REGRESION: la ruta de transferencia devuelve a qué orden fue a dar el renglón', () => {
    const ruta = leer('src/app/api/pos/transfer-item/route.ts')
    expect(ruta).toMatch(/target_order_id: targetOrderId/)
    // La orden NUEVA en la mesa destino se crea pidiendo la representación: sin
    // eso PostgREST no devuelve el id y el POS no tiene a quién avisar.
    const crear = bloque(ruta, 'const createRes = await fetch', 'targetSuccess = createRes.ok')
    expect(crear).toMatch(/return=representation/)
    expect(crear).not.toMatch(/return=minimal/)
    expect(crear).toMatch(/turno_id/)
  })
})


describe('la cancelación compartida no envía borradores a cocina', () => {
  it('conserva los enviados, marca cancelados y excluye el consumo pendiente', async () => {
    const { cuentaEnviadaParaLan } = await cargar()
    const { setIvaRate } = await import('@/lib/pos-constants')
    setIvaRate(0.16)
    const items = [{ id: 'sent', subtotal: 50 }, { id: 'cancelled', subtotal: 25 }, { id: 'draft', subtotal: 100 }]
    const snapshot = cuentaEnviadaParaLan(items, new Set(['sent', 'cancelled']), new Set(['cancelled']), 10)
    expect(snapshot.items).toEqual([{ id: 'sent', subtotal: 50 }, { id: 'cancelled', subtotal: 25, cancelled: true }])
    expect(snapshot.subtotal).toBe(50)
    expect(snapshot.total).toBeCloseTo(46.4)
    expect(items[1]).not.toHaveProperty('cancelled')
    setIvaRate(0)
    expect(cuentaEnviadaParaLan(items, new Set(['sent']), new Set(), 10).total).toBe(40)
  })
})
