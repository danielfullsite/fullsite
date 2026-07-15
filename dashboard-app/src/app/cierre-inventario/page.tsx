'use client'

import { useEffect, useState, useMemo } from 'react'
import { Package, AlertTriangle, CheckCircle2, Download, Camera, History, Search, ChevronDown, ChevronUp, X } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface Ingredient {
  id: string
  name: string
  unit: string
  cost_per_unit: number
  category: string
  active: boolean
}

interface InventoryRow {
  ingredient_id: string
  stock: number
  reorder_point: number
}

interface MergedItem {
  ingredient_id: string
  name: string
  unit: string
  category: string
  stock: number
  cost_per_unit: number
  reorder_point: number
  total_value: number
  status: 'ok' | 'low' | 'zero'
}

interface Snapshot {
  id?: string
  snapshot_date: string
  total_value: number
  total_items: number
  items_zero: number
  data?: any
}

type SortKey = 'name' | 'category' | 'stock' | 'cost_per_unit' | 'total_value' | 'status'

async function sbFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      ...options,
    })
    if (!res.ok) return null
    const text = await res.text()
    if (!text) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export default function CierreInventarioPage() {
  const [items, setItems] = useState<MergedItem[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('total_value')
  const [sortAsc, setSortAsc] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    async function load() {
      const [ingredients, inventory, snaps] = await Promise.all([
        sbFetch<Ingredient[]>('pos_ingredients?client_id=eq.amalay&active=eq.true&select=id,name,unit,cost_per_unit,category'),
        sbFetch<InventoryRow[]>('pos_inventory?client_id=eq.amalay&select=ingredient_id,stock,reorder_point'),
        sbFetch<Snapshot[]>('pos_inventory_snapshots?client_id=eq.amalay&select=id,snapshot_date,total_value,total_items,items_zero&order=snapshot_date.desc&limit=20'),
      ])

      if (ingredients && inventory) {
        const invMap = new Map<string, InventoryRow>()
        for (const row of inventory) {
          invMap.set(row.ingredient_id, row)
        }

        const merged: MergedItem[] = ingredients.map(ing => {
          const inv = invMap.get(ing.id)
          const stock = inv?.stock ?? 0
          const reorder = inv?.reorder_point ?? 0
          const costPerUnit = ing.cost_per_unit ?? 0
          const totalValue = stock * costPerUnit
          let status: 'ok' | 'low' | 'zero' = 'ok'
          if (stock <= 0) status = 'zero'
          else if (stock <= reorder) status = 'low'
          return {
            ingredient_id: ing.id,
            name: ing.name,
            unit: ing.unit,
            category: ing.category || 'Sin categoria',
            stock,
            cost_per_unit: costPerUnit,
            reorder_point: reorder,
            total_value: totalValue,
            status,
          }
        })
        setItems(merged)
      }

      if (snaps) setSnapshots(snaps)
      setLoading(false)
    }
    load()
  }, [])

  // Filtering
  const filtered = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
  }, [items, search])

  // Sorting
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: any = a[sortKey]
      let vb: any = b[sortKey]
      if (sortKey === 'status') {
        const order = { zero: 0, low: 1, ok: 2 }
        va = order[va as 'ok' | 'low' | 'zero']
        vb = order[vb as 'ok' | 'low' | 'zero']
      }
      if (typeof va === 'string') {
        const cmp = va.localeCompare(vb as string, 'es')
        return sortAsc ? cmp : -cmp
      }
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })
  }, [filtered, sortKey, sortAsc])

  // Grouped by category
  const grouped = useMemo(() => {
    const map = new Map<string, MergedItem[]>()
    for (const item of sorted) {
      const list = map.get(item.category) || []
      list.push(item)
      map.set(item.category, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], 'es'))
  }, [sorted])

  // KPIs
  const totalValue = items.reduce((s, i) => s + i.total_value, 0)
  const totalActive = items.length
  const itemsZero = items.filter(i => i.status === 'zero').length
  const itemsCritical = items.filter(i => i.status === 'low').length

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronDown size={12} className="opacity-30 ml-0.5 inline" />
    return sortAsc
      ? <ChevronUp size={12} className="text-blue-400 ml-0.5 inline" />
      : <ChevronDown size={12} className="text-blue-400 ml-0.5 inline" />
  }

  // CSV export
  function exportCSV() {
    const header = 'Categoria,Ingrediente,Unidad,Stock,Costo Unitario,Valor Total,Estado\n'
    const rows = sorted.map(i =>
      `"${i.category}","${i.name}","${i.unit}",${i.stock.toFixed(2)},${i.cost_per_unit.toFixed(2)},${i.total_value.toFixed(2)},${i.status}`
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cierre-inventario-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Save snapshot
  async function saveSnapshot() {
    setSaving(true)
    setSaveMsg('')
    const payload = {
      client_id: (typeof window !== 'undefined' && localStorage.getItem('fullsite_client_id')) || 'amalay',
      snapshot_date: new Date().toISOString().slice(0, 10),
      total_value: totalValue,
      total_items: totalActive,
      items_zero: itemsZero,
      data: items.map(i => ({
        ingredient_id: i.ingredient_id,
        name: i.name,
        unit: i.unit,
        category: i.category,
        stock: i.stock,
        cost_per_unit: i.cost_per_unit,
        total_value: i.total_value,
        status: i.status,
      })),
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_snapshots`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        setSaveMsg('Cierre guardado correctamente')
        // Refresh snapshots
        const snaps = await sbFetch<Snapshot[]>('pos_inventory_snapshots?client_id=eq.amalay&select=id,snapshot_date,total_value,total_items,items_zero&order=snapshot_date.desc&limit=20')
        if (snaps) setSnapshots(snaps)
      } else {
        setSaveMsg(`Error al guardar (${res.status})`)
      }
    } catch {
      setSaveMsg('Error de conexion al guardar')
    }
    setSaving(false)
    setShowConfirm(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cierre de Inventario"
        subtitle="Snapshot del inventario actual para cierre mensual"
        action={
          <div className="flex gap-2">
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-[var(--text-2)] bg-[var(--surface-2)] border border-[var(--line)] hover:bg-[var(--surface)] hover:text-[var(--text-1)] transition-colors"
            >
              <Download size={14} />
              Exportar CSV
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors"
            >
              <Camera size={14} />
              Cerrar inventario
            </button>
          </div>
        }
      />

      {saveMsg && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
          saveMsg.includes('Error') ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
        }`}>
          {saveMsg}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          label="Total valor inventario"
          value={formatCurrency(totalValue)}
          icon={Package}
          accentClass="kpi-accent-blue"
          index={0}
        />
        <KPICard
          label="Items activos"
          value={formatNumber(totalActive)}
          icon={CheckCircle2}
          accentClass="kpi-accent-green"
          index={1}
        />
        <KPICard
          label="Items en cero"
          value={formatNumber(itemsZero)}
          icon={AlertTriangle}
          accentClass={itemsZero > 0 ? 'kpi-accent-amber' : 'kpi-accent-green'}
          index={2}
        />
        <KPICard
          label="Items criticos"
          value={formatNumber(itemsCritical)}
          subtitle="Bajo punto de reorden"
          icon={AlertTriangle}
          accentClass={itemsCritical > 0 ? 'kpi-accent-purple' : 'kpi-accent-green'}
          index={3}
        />
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--text-3)]">
          {formatNumber(filtered.length)} ingredientes
          {search ? ` (filtro: "${search}")` : ''}
        </p>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
          <input
            type="text"
            placeholder="Buscar ingrediente o categoria..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-72 pl-9 pr-3 py-2 rounded-lg text-sm bg-[var(--surface)] border border-[var(--line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
      </div>

      {/* Inventory Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--line)]" style={{ background: 'var(--bento-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line)]">
              {([
                { key: 'category' as SortKey, label: 'Categoria', align: 'left' },
                { key: 'name' as SortKey, label: 'Ingrediente', align: 'left' },
                { key: 'stock' as SortKey, label: 'Stock', align: 'right' },
                { key: 'cost_per_unit' as SortKey, label: 'Costo Unit.', align: 'right' },
                { key: 'total_value' as SortKey, label: 'Valor Total', align: 'right' },
                { key: 'status' as SortKey, label: 'Estado', align: 'center' },
              ]).map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`px-3 py-3 text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] cursor-pointer select-none hover:text-[var(--text-1)] transition-colors whitespace-nowrap ${
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  }`}
                >
                  {col.label}
                  <SortIcon col={col.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-[var(--text-4)] text-sm">
                  No se encontraron ingredientes
                </td>
              </tr>
            ) : (
              grouped.map(([category, catItems]) => (
                catItems.map((item, idx) => (
                  <tr
                    key={item.ingredient_id}
                    className={`border-b border-[var(--line-soft)] transition-colors ${
                      item.status === 'zero'
                        ? 'bg-red-500/8 hover:bg-red-500/15'
                        : item.status === 'low'
                        ? 'bg-amber-500/5 hover:bg-amber-500/10'
                        : 'hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <td className="px-3 py-2.5 text-xs text-[var(--text-3)] whitespace-nowrap">
                      {idx === 0 ? (
                        <span className="font-semibold text-[var(--text-2)]">{category}</span>
                      ) : null}
                    </td>
                    <td className={`px-3 py-2.5 font-medium whitespace-nowrap ${
                      item.status === 'zero' ? 'text-red-400' : 'text-[var(--text-1)]'
                    }`}>
                      {item.name}
                      <span className="ml-1.5 text-[var(--text-4)] text-xs">({item.unit})</span>
                    </td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold tnum ${
                      item.status === 'zero' ? 'text-red-400' : item.status === 'low' ? 'text-amber-400' : 'text-[var(--text-1)]'
                    }`}>
                      {item.stock.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tnum text-[var(--text-2)]">
                      {formatCurrency(item.cost_per_unit)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold tnum text-[var(--text-1)]">
                      {formatCurrency(item.total_value)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.status === 'zero' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400">
                          <AlertTriangle size={10} />
                          CERO
                        </span>
                      )}
                      {item.status === 'low' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">
                          <AlertTriangle size={10} />
                          BAJO
                        </span>
                      )}
                      {item.status === 'ok' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                          <CheckCircle2 size={10} />
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ))
            )}

            {/* Totals row */}
            {sorted.length > 0 && (
              <tr className="border-t-2 border-[var(--line)] bg-[var(--surface-2)]">
                <td className="px-3 py-3 font-bold text-[var(--text-1)] text-xs uppercase tracking-wider">
                  Total
                </td>
                <td className="px-3 py-3 text-xs text-[var(--text-3)]">
                  {formatNumber(filtered.length)} ingredientes
                </td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3" />
                <td className="px-3 py-3 text-right font-mono text-xs font-bold tnum text-[var(--text-1)]">
                  {formatCurrency(filtered.reduce((s, i) => s + i.total_value, 0))}
                </td>
                <td className="px-3 py-3" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Snapshot History */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <History size={16} className="text-[var(--text-3)]" />
          <h3 className="text-sm font-bold text-[var(--text-1)]">Historial de cierres</h3>
        </div>

        {snapshots.length === 0 ? (
          <p className="text-xs text-[var(--text-4)] py-4">No hay cierres anteriores registrados</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--line)]" style={{ background: 'var(--bento-card)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="px-3 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Fecha</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Valor Total</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Items</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">En cero</th>
                  <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">vs Anterior</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snap, idx) => {
                  const prev = snapshots[idx + 1]
                  const diff = prev ? snap.total_value - prev.total_value : null
                  const pct = prev && prev.total_value > 0 ? ((diff! / prev.total_value) * 100) : null
                  return (
                    <tr key={snap.id || snap.snapshot_date} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-3 py-2.5 text-[var(--text-1)] font-medium text-xs">{snap.snapshot_date}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold tnum text-[var(--text-1)]">
                        {formatCurrency(snap.total_value)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tnum text-[var(--text-2)]">
                        {formatNumber(snap.total_items)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tnum text-[var(--text-2)]">
                        {formatNumber(snap.items_zero)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tnum">
                        {pct !== null ? (
                          <span className={pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[var(--text-4)]">--</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowConfirm(false)}>
          <div
            className="w-full max-w-md mx-4 rounded-2xl border border-[var(--line)] p-6 space-y-4"
            style={{ background: 'var(--surface)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[var(--text-1)]">Confirmar cierre de inventario</h3>
              <button onClick={() => setShowConfirm(false)} className="text-[var(--text-3)] hover:text-[var(--text-1)]">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2 text-sm text-[var(--text-2)]">
              <p>Se guardara un snapshot con los siguientes datos:</p>
              <ul className="space-y-1 ml-4">
                <li>Fecha: <span className="font-semibold text-[var(--text-1)]">{new Date().toISOString().slice(0, 10)}</span></li>
                <li>Valor total: <span className="font-semibold text-[var(--text-1)]">{formatCurrency(totalValue)}</span></li>
                <li>Items: <span className="font-semibold text-[var(--text-1)]">{formatNumber(totalActive)}</span></li>
                <li>En cero: <span className="font-semibold text-[var(--text-1)]">{formatNumber(itemsZero)}</span></li>
              </ul>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-[var(--text-2)] bg-[var(--surface-2)] border border-[var(--line)] hover:bg-[var(--surface)] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveSnapshot}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Guardando...' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
