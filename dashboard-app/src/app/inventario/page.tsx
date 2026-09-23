'use client'

import { useEffect, useState } from 'react'
import { Package, AlertTriangle, TrendingDown, Search, ArrowUpDown, Filter, ChefHat, Percent } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { loadInventoryWithStock, loadConsumoDelDia, type ConsumoDelDia } from '@/lib/inventory'
import { getActiveClientSlug } from '@/lib/data'

interface InventoryItem {
  producto: string
  existencia: number
  unidad: string
  costo_unitario: number
  costo_total: number
  category: string
  reorder_point: number
  below_reorder: boolean
  ingredient_id: string
  // Consumo teórico del día: qué DEBIÓ gastarse de este insumo según lo que se vendió.
  // `null` = este insumo no aparece en ninguna receta de lo vendido hoy, que NO es lo
  // mismo que haber consumido cero.
  consumo_teorico: number | null
}

type SortKey = 'producto' | 'existencia' | 'costo_total' | 'category' | 'consumo_teorico'

export default function InventarioPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('costo_total')
  const [sortAsc, setSortAsc] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [fecha, setFecha] = useState('')
  const [consumo, setConsumo] = useState<ConsumoDelDia | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const clientId = getActiveClientSlug()
        // El consumo teórico no debe tumbar el inventario si la vista no está: es
        // información añadida, no el contenido de la página.
        const [data, cons] = await Promise.all([
          loadInventoryWithStock(clientId),
          loadConsumoDelDia(clientId).catch(() => null),
        ])
        setConsumo(cons)
        if (data.length > 0) {
          const items: InventoryItem[] = data.map(row => ({
            producto: row.name,
            existencia: row.stock,
            unidad: row.unit || '',
            costo_unitario: row.cost_per_unit,
            costo_total: row.stock * row.cost_per_unit,
            category: row.category || 'SIN CATEGORIA',
            reorder_point: row.reorder_point,
            below_reorder: row.reorder_point > 0 && row.stock <= row.reorder_point,
            ingredient_id: row.ingredient_id,
            consumo_teorico: cons?.porIngrediente.get(row.ingredient_id) ?? null,
          }))
          setInventory(items)
          setFecha(new Date().toLocaleDateString('es-MX'))
        }
      } catch (err) {
        console.error('Error loading inventory:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const categories = Array.from(new Set(inventory.map(i => i.category))).sort()

  const filtered = inventory
    .filter(i => !categoryFilter || i.category === categoryFilter)
    .filter(i => !search || i.producto.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      // `?? 0` deja los "—" (sin receta) al final del orden descendente, que es donde
      // estorban menos: lo interesante es qué SÍ se consumió.
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      if (typeof va === 'string') return sortAsc ? (va as string).localeCompare(vb as string) : (vb as string).localeCompare(va as string)
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })

  const totalValue = inventory.reduce((s, i) => s + (i.costo_total || 0), 0)

  // Consumo teórico valorizado: lo que costó, a precio de reposición, lo que se vendió.
  // Se valoriza con el costo del insumo que ya trae la tabla — no se pide aparte.
  const consumoValorizado = consumo
    ? inventory.reduce((s, i) => s + (i.consumo_teorico ?? 0) * (i.costo_unitario || 0), 0)
    : 0
  const ventaDelDia = consumo?.cobertura?.importeVendido ?? 0
  // Food cost teórico. `null` cuando no hay venta contra qué medirlo: un 0% se leería
  // como "no cuesta nada", que es lo contrario de "no se puede calcular".
  const foodCostPct = ventaDelDia > 0 ? (consumoValorizado / ventaDelDia) * 100 : null
  const pctImporte = consumo?.cobertura?.pctImporteConReceta ?? null
  const coberturaParcial = pctImporte != null && pctImporte < 99.5
  const belowReorder = inventory.filter(i => i.below_reorder)
  const outOfStock = inventory.filter(i => i.existencia <= 0)

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Inventario</h2>
        <p className="text-sm text-[var(--text-3)]">{inventory.length} productos con stock real {fecha && `· Actualizado ${fecha}`}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Package size={16} className="text-blue-500" /><span className="text-xs text-[var(--text-2)] font-medium">Productos</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{inventory.length}</p>
          <p className="text-xs text-[var(--text-3)] mt-1">{categories.length} categorias</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><Package size={16} className="text-emerald-500" /><span className="text-xs text-[var(--text-2)] font-medium">Valor total</span></div>
          <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(totalValue)}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} className="text-amber-500" /><span className="text-xs text-[var(--text-2)] font-medium">Bajo reorden</span></div>
          <p className="text-2xl font-bold text-amber-400">{belowReorder.length}</p>
        </div>
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
          <div className="flex items-center gap-2 mb-2"><TrendingDown size={16} className="text-red-500" /><span className="text-xs text-[var(--text-2)] font-medium">Sin stock</span></div>
          <p className="text-2xl font-bold text-red-600">{outOfStock.length}</p>
        </div>
      </div>

      {consumo && (
        <div className="mb-6">
          <div className="flex items-baseline gap-2 mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-1)]">Consumo teorico del dia</h3>
            <span className="text-xs text-[var(--text-3)]">
              dia de venta {consumo.diaVenta} · lo que DEBIO gastarse segun lo vendido
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2"><ChefHat size={16} className="text-violet-500" /><span className="text-xs text-[var(--text-2)] font-medium">Consumo teorico</span></div>
              <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(consumoValorizado)}</p>
              <p className="text-xs text-[var(--text-3)] mt-1">{consumo.porIngrediente.size} insumos</p>
            </div>
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2"><Package size={16} className="text-emerald-500" /><span className="text-xs text-[var(--text-2)] font-medium">Venta del dia</span></div>
              <p className="text-2xl font-bold text-[var(--text-1)]">{formatCurrency(ventaDelDia)}</p>
              <p className="text-xs text-[var(--text-3)] mt-1">{consumo.cobertura?.lineasVendidas ?? 0} renglones</p>
            </div>
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2"><Percent size={16} className="text-blue-500" /><span className="text-xs text-[var(--text-2)] font-medium">Food cost teorico</span></div>
              {/* Sin venta no hay porcentaje. Un 0% se leeria como "no cuesta nada". */}
              <p className="text-2xl font-bold text-[var(--text-1)]">{foodCostPct == null ? 'sin dato' : `${foodCostPct.toFixed(1)}%`}</p>
              <p className="text-xs text-[var(--text-3)] mt-1">consumo / venta</p>
            </div>
            <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} className={coberturaParcial ? 'text-amber-500' : 'text-emerald-500'} />
                <span className="text-xs text-[var(--text-2)] font-medium">Cobertura de recetas</span>
              </div>
              <p className={`text-2xl font-bold ${coberturaParcial ? 'text-amber-400' : 'text-[var(--text-1)]'}`}>
                {pctImporte == null ? 'sin dato' : `${pctImporte.toFixed(1)}%`}
              </p>
              {/* El denominador que separa "catalogo incompleto" de merma. Sin decirlo,
                  un food cost calculado sobre media carta parece un food cost real. */}
              <p className="text-xs text-[var(--text-3)] mt-1">
                {coberturaParcial
                  ? `del importe vendido · faltan ${consumo.cobertura?.platillosSinReceta ?? 0} platillos por costear`
                  : 'del importe vendido tiene receta'}
              </p>
            </div>
          </div>
          {coberturaParcial && (
            <p className="text-xs text-amber-500/90 mt-3">
              El food cost teorico solo cubre el {pctImporte!.toFixed(1)}% de lo vendido. Lo que falta
              no es merma: son platillos sin receta capturada.
            </p>
          )}
          {consumo.lineasNoConvertibles > 0 && (
            <p className="text-xs text-amber-500/90 mt-1">
              {consumo.lineasNoConvertibles} renglon(es) de receta no se pudieron convertir a unidad de
              stock y quedaron FUERA del consumo — no cuentan como cero.
            </p>
          )}
        </div>
      )}

      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm">
        <div className="p-4 border-b border-[var(--line-soft)] flex items-center gap-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..." className="w-full pl-9 pr-4 py-2 text-sm border border-[var(--line)] rounded-lg bg-[var(--surface)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
          </div>
          <div className="relative">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="pl-8 pr-3 py-2 text-sm border border-[var(--line)] rounded-lg bg-[var(--surface)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 appearance-none">
              <option value="">Todas las categorias ({inventory.length})</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Package size={24} className="mx-auto mb-3 text-[var(--text-3)]" />
            <p className="text-sm font-bold text-[var(--text-1)] mb-1">{inventory.length === 0 ? 'Sin datos de inventario' : 'Sin resultados'}</p>
            <p className="text-xs text-[var(--text-3)]">{inventory.length === 0 ? 'No se encontraron ingredientes con inventario.' : 'Intenta con otro termino de busqueda.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('producto')}>Producto <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('category')}>Categoria <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('existencia')}>Stock <ArrowUpDown size={12} className="inline" /></th>
                <th className="text-left px-4 py-3 font-medium">Unidad</th>
                {consumo && <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('consumo_teorico')}>Consumo hoy <ArrowUpDown size={12} className="inline" /></th>}
                <th className="text-right px-4 py-3 font-medium">Costo unit.</th>
                <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => toggleSort('costo_total')}>Valor <ArrowUpDown size={12} className="inline" /></th>
              </tr></thead>
              <tbody>{filtered.slice(0, 300).map((item, i) => (
                <tr key={i} className={`border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] ${item.below_reorder ? 'bg-amber-500/10' : item.existencia <= 0 ? 'bg-red-500/5' : ''}`}>
                  <td className="px-4 py-3 font-medium text-[var(--text-1)]">
                    {item.producto}
                    {item.below_reorder && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">reorden</span>}
                    {item.existencia <= 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-500">sin stock</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-2)]">{item.category}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${item.below_reorder ? 'text-amber-400 font-bold' : item.existencia <= 0 ? 'text-red-500 font-bold' : 'text-[var(--text-1)]'}`}>{item.existencia.toFixed(2)}</td>
                  <td className="px-4 py-3 text-[var(--text-2)]">{item.unidad}</td>
                  {consumo && (
                    /* Un guion, no un cero: el insumo no entra en ninguna receta de lo
                       vendido hoy, que no es lo mismo que no haberse consumido. */
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">
                      {item.consumo_teorico == null ? '—' : item.consumo_teorico.toFixed(3)}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">{formatCurrency(item.costo_unitario)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--text-1)]">{formatCurrency(item.costo_total)}</td>
                </tr>
              ))}</tbody>
            </table>
            {filtered.length > 300 && <p className="p-3 text-center text-xs text-[var(--text-3)]">Mostrando 300 de {filtered.length} productos</p>}
          </div>
        )}
      </div>
    </>
  )
}
