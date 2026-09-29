import { describe, it, expect } from 'vitest'
import { terminosBusqueda, intencion, contextoProducto, contextoReceta, contextoInsumo, contextoFrescura } from '@/lib/chat-nativo'

// RPC falso: registra llamadas y devuelve lo que cada prueba necesita.
function rpcFalso(resp: Record<string, (args: Record<string, unknown>) => Record<string, unknown>[] | null>) {
  const llamadas: { fn: string; args: Record<string, unknown> }[] = []
  const rpc = async (fn: string, args: Record<string, unknown>) => { llamadas.push({ fn, args }); return resp[fn]?.(args) ?? [] }
  return { rpc, llamadas }
}

describe('terminosBusqueda / intencion', () => {
  it('saca el producto de preguntas reales del chat', () => {
    expect(terminosBusqueda('¿Cuántas Smarty chips se han vendido en lo que va de junio?')).toEqual(['smarty', 'chips'])
    expect(terminosBusqueda('Cuantos gramos de ribeye lleva la orden de taquitos')).toEqual(['ribeye', 'taquitos'])
  })
  it('detecta intención', () => {
    expect(intencion('quien es el proveedor de la miel de maple kirkland').insumo).toBe(true)
    expect(intencion('cuantos gramos de ribeye lleva la orden de taquitos').receta).toBe(true)
    expect(intencion('cuantas smarty chips se han vendido').producto).toBe(true)
    expect(intencion('quien es el mejor mesero')).toEqual({ producto: false, receta: false, insumo: false })
  })
})

describe('contextoProducto', () => {
  it('reporta ventas, cambio de precio e historial por mes', async () => {
    const { rpc } = rpcFalso({ fs_ventas_producto: () => [{
      producto: 'CHILAQUILES', piezas: 120, venta: 23900, precio_promedio: 199, precio_min: 185, precio_max: 205,
      primera_venta: '2026-07-01', ultima_venta: '2026-09-27', precio_por_mes: { '2026-07': 185, '2026-09': 205 },
    }] })
    const t = await contextoProducto(rpc, 'x', 'cuantos chilaquiles vendimos', '2026-07-01', '2026-09-27', 'America/Monterrey')
    expect(t).toContain('CHILAQUILES: 120 pzas, $23,900')
    expect(t).toContain('el precio fue de $185 a $205')
    expect(t).toContain('2026-07: $185, 2026-09: $205')
  })
  it('si la frase completa no pega, reintenta con la palabra más larga', async () => {
    const { rpc, llamadas } = rpcFalso({ fs_ventas_producto: a => (a.p_busqueda === 'jicama' ? [{ producto: 'SMARTY JICAMA', piezas: 3, venta: 180, precio_promedio: 60, precio_min: 60, precio_max: 60, primera_venta: 'a', ultima_venta: 'b', precio_por_mes: null }] : []) })
    const t = await contextoProducto(rpc, 'x', 'smarty chips jicama vendidas', 'a', 'b', 'tz')
    expect(llamadas.map(l => l.args.p_busqueda)).toEqual(['smarty chips jicama', 'smarty', 'jicama'])
    expect(t).toContain('SMARTY JICAMA: 3 pzas')
  })
  it('0 ventas → dice que no se vendió (no "no tengo datos")', async () => {
    const { rpc } = rpcFalso({ fs_ventas_producto: () => [] })
    expect(await contextoProducto(rpc, 'x', 'cuantas obleas vendimos', 'a', 'b', 'tz')).toContain('NO digas que no tienes datos')
  })
})

describe('contextoReceta', () => {
  it('convierte kg a gramos y suma el costo total y food cost', async () => {
    const { rpc } = rpcFalso({ fs_receta: () => [
      { platillo: 'CHICKEN PANINI', precio_venta: 296, insumo: 'PECHUGA DE POLLO', cantidad: 0.14, unidad: 'kg', costo_linea: 16.6, proveedor: 'MAGNO' },
      { platillo: 'CHICKEN PANINI', precio_venta: 296, insumo: 'QUESO GOUDA', cantidad: 0.08, unidad: 'kg', costo_linea: 10.16, proveedor: 'LABEN' },
    ] })
    const t = await contextoReceta(rpc, 'amalay', 'cuantos gramos de pollo lleva el chicken panini')
    expect(t).toContain('PECHUGA DE POLLO: 140 g, $16.60 (proveedor MAGNO)')
    expect(t).toContain('costo $27 (9.0% food cost)')
  })
})

describe('contextoInsumo', () => {
  it('muestra costos chicos con decimales y el proveedor con contacto', async () => {
    const { rpc } = rpcFalso({ fs_insumo: () => [{ insumo: 'Paprika', unidad: 'GRS', costo_unitario: 0.115, proveedor: 'BRENDAS', proveedor_telefono: '8112345678', proveedor_contacto: null, dias_entrega: null, usado_en: ['Spicy Deluxe'] }] })
    const t = await contextoInsumo(rpc, 'x', 'quien es el proveedor de paprika')
    expect(t).toContain('Paprika: $0.115 por GRS, proveedor BRENDAS (8112345678) | se usa en: Spicy Deluxe')
  })
})

describe('contextoFrescura', () => {
  it('dice cuándo fue la última venta y cuánto va hoy', async () => {
    const { rpc } = rpcFalso({ fs_frescura: () => [{ ultima_orden_pos: '2026-09-27T20:18:38Z', ordenes_pos_hoy: 12, venta_pos_hoy: 5400 }] })
    const t = await contextoFrescura(rpc, 'x', 'America/Monterrey')
    expect(t).toContain('Hoy van 12 órdenes por $5,400')
  })
})
