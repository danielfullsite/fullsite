import { describe, it, expect } from 'vitest'
import { terminosBusqueda, intencion, contextoProducto, contextoReceta, contextoInsumo, contextoFrescura, textoFrescura, leerFrescura } from '@/lib/chat-nativo'

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
  it('0 ventas de ESE producto con el POS vivo → "no hay ventas registradas de ese producto"', async () => {
    const { rpc } = rpcFalso({ fs_ventas_producto: () => [] })
    const t = await contextoProducto(rpc, 'x', 'cuantas obleas vendimos', '2026-09-01', '2026-09-27', 'tz', '2026-09-27')
    expect(t).toContain('no hay ventas registradas de ese producto')
    // Ya no se le ordena al modelo negar que le faltan datos.
    expect(t).not.toContain('NO digas que no tienes datos')
  })
  it('0 ventas y NO se pudo leer la frescura (undefined) → neutral, no "el POS sí vendió otras cosas"', async () => {
    const { rpc } = rpcFalso({ fs_ventas_producto: () => [] })
    const t = await contextoProducto(rpc, 'x', 'cuantas obleas vendimos', '2026-09-01', '2026-09-27', 'tz', undefined)
    expect(t).toContain('no pude verificar la cobertura del POS')
    expect(t).not.toContain('el POS sí registró otras ventas')
    expect(t).not.toContain('SIN COBERTURA')
  })
  it('0 ventas porque el POS NO tiene cobertura en el periodo → SIN COBERTURA, no "no se vendió"', async () => {
    const { rpc } = rpcFalso({ fs_ventas_producto: () => [] })
    const t = await contextoProducto(rpc, 'x', 'cuantas obleas vendimos', '2026-09-10', '2026-09-27', 'tz', '2026-09-07')
    expect(t).toContain('SIN COBERTURA DEL POS')
    expect(t).toContain('2026-09-07')
    const nunca = await contextoProducto(rpc, 'x', 'cuantas obleas vendimos', '2026-09-10', '2026-09-27', 'tz', null)
    expect(nunca).toContain('SIN COBERTURA DEL POS')
    expect(nunca).toContain('nunca')
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
    const t = await contextoFrescura(rpc, 'x', 'America/Monterrey', '2026-09-27')
    expect(t).toContain('Hoy van 12 órdenes por $5,400')
    // Ya no afirma "se actualiza en tiempo real" (no es cierto si el POS no está en uso).
    expect(t).not.toContain('tiempo real')
  })
})

describe('textoFrescura — cobertura del POS (sin cobertura ≠ $0)', () => {
  const tz = 'America/Monterrey'
  it('la última venta es de hace días → SIN COBERTURA con el periodo y la fecha, nunca "$0"', () => {
    const t = textoFrescura({ ultima: '2026-09-08T20:00:00Z', ultimaFecha: '2026-09-08', ordenesHoy: 0, ventaHoy: 0 }, tz, '2026-09-28')
    expect(t).toContain('SIN COBERTURA DEL POS del 2026-09-09 al 2026-09-28')
    expect(t).toContain('última venta registrada 2026-09-08')
    expect(t).not.toMatch(/Hoy van 0|por \$0/)
  })
  it('el POS nunca registró una venta → SIN COBERTURA', () => {
    const t = textoFrescura({ ultima: null, ultimaFecha: null, ordenesHoy: 0, ventaHoy: 0 }, tz, '2026-09-28')
    expect(t).toContain('SIN COBERTURA')
    expect(t).not.toContain('Hoy van')
  })
  it('ayer sí hubo ventas y hoy aún no → "aún no hay ventas registradas hoy", no "$0"', () => {
    const t = textoFrescura({ ultima: '2026-09-28T03:00:00Z', ultimaFecha: '2026-09-27', ordenesHoy: 0, ventaHoy: 0 }, tz, '2026-09-28')
    expect(t).toContain('aún no hay ventas registradas')
    expect(t).not.toContain('SIN COBERTURA')
  })
  it('fallo al leer (null) → acotado: no afirma la última venta pero deja usar los bloques calculados', () => {
    const t = textoFrescura(null, tz, '2026-09-28')
    expect(t).toContain('no pude verificarla')
    expect(t).toContain('usa SÓLO los bloques calculados')
    expect(t).not.toContain('ni cuánto va hoy')
  })
  it('leerFrescura: el RPC falla → null (fallo ≠ POS vacío)', async () => {
    const rpc = async () => null
    expect(await leerFrescura(rpc, 'x', tz)).toBeNull()
  })
  it('leerFrescura: calcula el DÍA de la última venta en la zona del tenant', async () => {
    const { rpc } = rpcFalso({ fs_frescura: () => [{ ultima_orden_pos: '2026-09-08T03:30:00Z', ordenes_pos_hoy: 0, venta_pos_hoy: 0 }] })
    // 03:30 UTC del 8 = 21:30 del 7 en Monterrey
    expect((await leerFrescura(rpc, 'x', tz))!.ultimaFecha).toBe('2026-09-07')
  })
  it('leerFrescura: una venta a las 00:30 pertenece al DÍA DE VENTA anterior', async () => {
    const { rpc } = rpcFalso({ fs_frescura: () => [{ ultima_orden_pos: '2026-09-08T06:30:00Z', ordenes_pos_hoy: 0, venta_pos_hoy: 0 }] })
    // 06:30 UTC del 8 = 00:30 del 8 en Monterrey → día de venta del 7 (inicio 05:00)
    expect((await leerFrescura(rpc, 'x', tz, '05:00'))!.ultimaFecha).toBe('2026-09-07')
  })
})
