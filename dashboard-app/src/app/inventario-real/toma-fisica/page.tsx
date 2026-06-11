'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Search, Save, CheckCircle, AlertTriangle, Package, ClipboardList, ChevronDown } from 'lucide-react'
import { getWansoftDataLatest, getActiveClientSlug } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import PageHeader from '@/components/PageHeader'

// ── Types ───────────────────────────────────────────────────────────

interface InventoryItem {
  almacen: string
  codigo: string
  producto: string
  departamento: string
  critico: boolean
  inv_final_qty: number
  inv_final_val: number
  costo_promedio: number
}

interface CountEntry {
  codigo: string
  almacen: string
  producto: string
  departamento: string
  stock_sistema: number
  conteo_real: number | null
  diferencia: number | null
  valor_diferencia: number | null
  costo_promedio: number
}

// ── Constants ───────────────────────────────────────────────────────

const WAREHOUSES = [
  { key: 'cocina', label: 'Cocina' },
  { key: 'barra', label: 'Barra' },
  { key: 'panaderia', label: 'Panaderia' },
  { key: 'market', label: 'Market' },
  { key: 'venta_terceros', label: 'Venta Terceros' },
]

function matchWarehouse(almacen: string, tab: string): boolean {
  const normalized = almacen.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (tab === 'cocina') return normalized.includes('cocina')
  if (tab === 'barra') return normalized.includes('barra')
  if (tab === 'panaderia') return normalized.includes('panaderia') || normalized.includes('panadería')
  if (tab === 'market') return normalized.includes('market')
  if (tab === 'venta_terceros') return normalized.includes('venta') && normalized.includes('tercero')
  return false
}

function todayISO(): string {
  const d = new Date()
  return d.toISOString().split('T')[0]
}

// ── Component ───────────────────────────────────────────────────────

export default function TomaFisicaPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fecha, setFecha] = useState('')
  const [activeWarehouse, setActiveWarehouse] = useState('cocina')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Load inventory data
  useEffect(() => {
    async function load() {
      try {
        const result = await getWansoftDataLatest('inventory_parsed')
        if (result?.data) {
          const raw = Array.isArray(result.data) ? result.data : (result.data as any)?.items || []
          setItems(raw.map((r: any) => ({
            almacen: r.almacen || '',
            codigo: r.codigo || '',
            producto: r.producto || '',
            departamento: r.departamento || '',
            critico: Boolean(r.critico),
            inv_final_qty: Number(r.inv_final_qty) || 0,
            inv_final_val: Number(r.inv_final_val) || 0,
            costo_promedio: Number(r.costo_promedio) || 0,
          })))
          setFecha(result.fecha)
        }
      } catch (e) {
        console.error('[toma-fisica] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  // Filter items for the selected warehouse
  const warehouseItems = useMemo(() => {
    let list = items.filter(i => matchWarehouse(i.almacen, activeWarehouse))
    if (!showAll) {
      list = list.filter(i => i.inv_final_qty > 0)
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.producto.toLowerCase().includes(q) ||
        i.codigo.toLowerCase().includes(q) ||
        i.departamento.toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => a.producto.localeCompare(b.producto, 'es'))
  }, [items, activeWarehouse, showAll, search])

  // Build count entries with difference calculations
  const countEntries: CountEntry[] = useMemo(() => {
    return warehouseItems.map(item => {
      const key = `${item.almacen}::${item.codigo}`
      const conteo = counts[key] ?? null
      const diferencia = conteo !== null ? conteo - item.inv_final_qty : null
      const valorDif = diferencia !== null ? diferencia * item.costo_promedio : null
      return {
        codigo: item.codigo,
        almacen: item.almacen,
        producto: item.producto,
        departamento: item.departamento,
        stock_sistema: item.inv_final_qty,
        conteo_real: conteo,
        diferencia,
        valor_diferencia: valorDif,
        costo_promedio: item.costo_promedio,
      }
    })
  }, [warehouseItems, counts])

  // Summary stats
  const summary = useMemo(() => {
    const total = countEntries.length
    const counted = countEntries.filter(e => e.conteo_real !== null).length
    const pending = total - counted
    const totalDiffValue = countEntries.reduce((s, e) => s + (e.valor_diferencia ?? 0), 0)
    const discrepancies = countEntries.filter(e => e.diferencia !== null && e.diferencia !== 0).length
    return { total, counted, pending, totalDiffValue, discrepancies }
  }, [countEntries])

  // Handle count input
  const handleCount = useCallback((almacen: string, codigo: string, value: string) => {
    const key = `${almacen}::${codigo}`
    if (value === '' || value === '-') {
      setCounts(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    } else {
      const num = parseFloat(value)
      if (!isNaN(num)) {
        setCounts(prev => ({ ...prev, [key]: num }))
      }
    }
  }, [])

  // Save to Supabase
  const handleSave = async () => {
    if (summary.counted === 0) return

    setSaving(true)
    setSaveMessage(null)

    const countData = countEntries
      .filter(e => e.conteo_real !== null)
      .map(e => ({
        codigo: e.codigo,
        almacen: e.almacen,
        producto: e.producto,
        departamento: e.departamento,
        stock_sistema: e.stock_sistema,
        conteo_real: e.conteo_real,
        diferencia: e.diferencia,
        valor_diferencia: e.valor_diferencia,
        costo_promedio: e.costo_promedio,
      }))

    const payload = {
      client_id: getActiveClientSlug(),
      data_key: `physical_count_${todayISO()}`,
      fecha: todayISO(),
      data: {
        warehouse: activeWarehouse,
        warehouse_label: WAREHOUSES.find(w => w.key === activeWarehouse)?.label,
        counted_at: new Date().toISOString(),
        sistema_fecha: fecha,
        total_items: summary.total,
        items_counted: summary.counted,
        total_diff_value: summary.totalDiffValue,
        items: countData,
      },
    }

    try {
      const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
      const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      const res = await fetch(`${SUPABASE_URL}/rest/v1/wansoft_data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY!,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setSaveMessage({ type: 'success', text: `Conteo guardado: ${summary.counted} productos en ${WAREHOUSES.find(w => w.key === activeWarehouse)?.label}` })
      } else {
        const errText = await res.text().catch(() => '')
        console.error('[toma-fisica] Save error:', res.status, errText)
        setSaveMessage({ type: 'error', text: `Error al guardar (${res.status}). Intenta de nuevo.` })
      }
    } catch (err) {
      console.error('[toma-fisica] Save error:', err)
      setSaveMessage({ type: 'error', text: 'Error de red. Verifica tu conexion.' })
    }

    setSaving(false)
  }

  // Difference color
  function diffColor(diff: number | null): string {
    if (diff === null) return ''
    if (diff === 0) return 'text-emerald-400'
    if (diff < 0) return 'text-red-400'
    return 'text-amber-400'
  }

  function diffBg(diff: number | null): string {
    if (diff === null) return ''
    if (diff === 0) return 'bg-emerald-500/8'
    if (diff < 0) return 'bg-red-500/8'
    return 'bg-amber-500/8'
  }

  // ── Render ──────────────────────────────────────────────────────

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
        title="Toma Fisica de Inventario"
        subtitle={`Conteo real vs sistema${fecha ? ` — datos al ${fecha}` : ''}`}
        action={
          <button
            onClick={handleSave}
            disabled={saving || summary.counted === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save size={16} />
            )}
            Guardar conteo
          </button>
        }
      />

      {/* Save message */}
      {saveMessage && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium ${
          saveMessage.type === 'success'
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
            : 'bg-red-500/15 text-red-400 border border-red-500/30'
        }`}>
          {saveMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {saveMessage.text}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-xl border border-[var(--accent-line)] p-4" style={{ background: 'var(--bento-card)' }}>
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-3)] mb-1">Total productos</p>
          <p className="text-2xl font-bold text-[var(--text-1)] tabular-nums">{formatNumber(summary.total)}</p>
        </div>
        <div className="rounded-xl border border-[var(--accent-line)] p-4" style={{ background: 'var(--bento-card)' }}>
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-3)] mb-1">Contados</p>
          <p className="text-2xl font-bold text-emerald-400 tabular-nums">{formatNumber(summary.counted)}</p>
          <div className="mt-2 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${summary.total > 0 ? (summary.counted / summary.total) * 100 : 0}%` }}
            />
          </div>
        </div>
        <div className="rounded-xl border border-[var(--accent-line)] p-4" style={{ background: 'var(--bento-card)' }}>
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-3)] mb-1">Pendientes</p>
          <p className={`text-2xl font-bold tabular-nums ${summary.pending > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {formatNumber(summary.pending)}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--accent-line)] p-4" style={{ background: 'var(--bento-card)' }}>
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-3)] mb-1">Diferencia total $</p>
          <p className={`text-2xl font-bold tabular-nums ${
            summary.totalDiffValue === 0 ? 'text-emerald-400' :
            summary.totalDiffValue < 0 ? 'text-red-400' : 'text-amber-400'
          }`}>
            {summary.counted > 0 ? formatCurrency(summary.totalDiffValue) : '--'}
          </p>
        </div>
      </div>

      {/* Warehouse selector + controls */}
      <div className="flex flex-col gap-3">
        {/* Warehouse tabs - large touch targets */}
        <div className="flex gap-2 flex-wrap">
          {WAREHOUSES.map(wh => (
            <button
              key={wh.key}
              onClick={() => {
                setActiveWarehouse(wh.key)
                setSearch('')
              }}
              className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all ${
                activeWarehouse === wh.key
                  ? 'bg-blue-500/20 text-blue-400 border-2 border-blue-500/40'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)] border-2 border-transparent'
              }`}
            >
              {wh.label}
            </button>
          ))}
        </div>

        {/* Search + toggle */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
            <input
              type="text"
              placeholder="Buscar producto, codigo o departamento..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none px-1">
            <input
              type="checkbox"
              checked={showAll}
              onChange={e => setShowAll(e.target.checked)}
              className="w-5 h-5 rounded border-[var(--accent-line)] bg-[var(--surface)] text-blue-500 focus:ring-blue-500/50 accent-blue-500"
            />
            <span className="text-sm text-[var(--text-2)]">Mostrar items sin stock</span>
          </label>
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-3)]">
          {formatNumber(warehouseItems.length)} productos en {WAREHOUSES.find(w => w.key === activeWarehouse)?.label}
          {search ? ` (filtro: "${search}")` : ''}
        </p>
        {summary.discrepancies > 0 && (
          <p className="text-xs text-amber-400 font-medium">
            {summary.discrepancies} discrepancia{summary.discrepancies !== 1 ? 's' : ''} detectada{summary.discrepancies !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--accent-line)]" style={{ background: 'var(--bento-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--accent-line)]">
              <th className="px-3 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] whitespace-nowrap">
                Codigo
              </th>
              <th className="px-3 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] whitespace-nowrap">
                Producto
              </th>
              <th className="px-3 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] whitespace-nowrap hidden sm:table-cell">
                Depto
              </th>
              <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] whitespace-nowrap">
                Stock Sistema
              </th>
              <th className="px-3 py-3 text-center text-[10px] uppercase tracking-wider font-semibold text-blue-400 whitespace-nowrap">
                Conteo Real
              </th>
              <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] whitespace-nowrap">
                Diferencia
              </th>
              <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] whitespace-nowrap hidden md:table-cell">
                Valor Dif.
              </th>
            </tr>
          </thead>
          <tbody>
            {countEntries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-[var(--text-4)] text-sm">
                  <Package size={32} className="mx-auto mb-3 opacity-40" />
                  No se encontraron productos para este almacen
                </td>
              </tr>
            ) : (
              countEntries.map((entry, idx) => (
                <tr
                  key={`${entry.almacen}::${entry.codigo}::${idx}`}
                  className={`border-b border-[var(--accent-line)]/50 transition-colors ${diffBg(entry.diferencia)} hover:bg-[var(--surface-2)]`}
                >
                  {/* Codigo */}
                  <td className="px-3 py-3 font-mono text-xs text-[var(--text-3)] whitespace-nowrap">
                    {entry.codigo}
                  </td>

                  {/* Producto */}
                  <td className="px-3 py-3 font-medium text-[var(--text-1)] max-w-[240px]">
                    <span className="block truncate">{entry.producto}</span>
                  </td>

                  {/* Departamento */}
                  <td className="px-3 py-3 text-[var(--text-3)] text-xs whitespace-nowrap hidden sm:table-cell">
                    {entry.departamento}
                  </td>

                  {/* Stock Sistema */}
                  <td className="px-3 py-3 text-right font-mono text-sm tabular-nums text-[var(--text-2)]">
                    {entry.stock_sistema.toFixed(2)}
                  </td>

                  {/* Conteo Real - large touch-friendly input */}
                  <td className="px-2 py-2 text-center">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="--"
                      value={entry.conteo_real !== null ? entry.conteo_real : ''}
                      onChange={e => handleCount(entry.almacen, entry.codigo, e.target.value)}
                      className="w-24 sm:w-28 px-3 py-3 rounded-lg text-center text-base font-semibold tabular-nums bg-[var(--surface)] border-2 border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </td>

                  {/* Diferencia */}
                  <td className={`px-3 py-3 text-right font-mono text-sm font-semibold tabular-nums ${diffColor(entry.diferencia)}`}>
                    {entry.diferencia !== null ? (
                      <>
                        {entry.diferencia > 0 ? '+' : ''}{entry.diferencia.toFixed(2)}
                      </>
                    ) : (
                      <span className="text-[var(--text-4)]">--</span>
                    )}
                  </td>

                  {/* Valor diferencia */}
                  <td className={`px-3 py-3 text-right font-mono text-xs tabular-nums hidden md:table-cell ${diffColor(entry.valor_diferencia)}`}>
                    {entry.valor_diferencia !== null ? (
                      formatCurrency(entry.valor_diferencia)
                    ) : (
                      <span className="text-[var(--text-4)]">--</span>
                    )}
                  </td>
                </tr>
              ))
            )}

            {/* Totals row */}
            {countEntries.length > 0 && summary.counted > 0 && (
              <tr className="border-t-2 border-[var(--accent-line)] bg-[var(--surface-2)]">
                <td className="px-3 py-3" />
                <td className="px-3 py-3 font-bold text-[var(--text-1)] text-xs uppercase tracking-wider">
                  Total ({formatNumber(summary.counted)} contados)
                </td>
                <td className="px-3 py-3 hidden sm:table-cell" />
                <td className="px-3 py-3 text-right font-mono text-sm font-bold tabular-nums text-[var(--text-1)]">
                  {countEntries.filter(e => e.conteo_real !== null).reduce((s, e) => s + e.stock_sistema, 0).toFixed(2)}
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm font-bold tabular-nums text-blue-400">
                  {countEntries.filter(e => e.conteo_real !== null).reduce((s, e) => s + (e.conteo_real ?? 0), 0).toFixed(2)}
                </td>
                <td className={`px-3 py-3 text-right font-mono text-sm font-bold tabular-nums ${diffColor(summary.totalDiffValue)}`}>
                  {summary.totalDiffValue > 0 ? '+' : ''}{countEntries.filter(e => e.diferencia !== null).reduce((s, e) => s + (e.diferencia ?? 0), 0).toFixed(2)}
                </td>
                <td className={`px-3 py-3 text-right font-mono text-xs font-bold tabular-nums hidden md:table-cell ${diffColor(summary.totalDiffValue)}`}>
                  {formatCurrency(summary.totalDiffValue)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom save bar - sticky on mobile */}
      {summary.counted > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-4 px-5 py-4 rounded-xl border border-[var(--accent-line)] shadow-2xl" style={{ background: 'var(--bento-card)' }}>
          <div className="text-sm text-[var(--text-2)]">
            <span className="font-semibold text-[var(--text-1)]">{summary.counted}</span> de {summary.total} productos contados
            {summary.discrepancies > 0 && (
              <span className="ml-3 text-amber-400 font-medium">
                {summary.discrepancies} discrepancia{summary.discrepancies !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save size={16} />
            )}
            Guardar conteo
          </button>
        </div>
      )}
    </div>
  )
}
