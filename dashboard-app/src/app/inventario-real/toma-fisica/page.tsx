'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Search, Save, CheckCircle, AlertTriangle, Package } from 'lucide-react'
import { getActiveClientSlug } from '@/lib/data'
import { formatCurrency, formatNumber } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import { sbPost } from '@/lib/supabase-helpers'
import { recordMovement, loadInventoryWithStock, makeIdempotencyKey } from '@/lib/inventory'
import type { MovementResult } from '@/lib/inventory'

// ── Types ───────────────────────────────────────────────────────────

interface InventoryItem {
  ingredient_id: string
  name: string
  unit: string
  category: string | null
  stock: number
  cost_per_unit: number
}

interface CountEntry {
  ingredient_id: string
  name: string
  unit: string
  category: string | null
  stock_sistema: number
  conteo_real: number | null
  diferencia: number | null
  valor_diferencia: number | null
  costo_promedio: number
}

// ── Constants ───────────────────────────────────────────────────────

const COUNT_REASONS = [
  'Cierre mensual',
  'Auditoría',
  'Conteo parcial',
  'Verificación de discrepancia',
  'Otro',
]

function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

function nowKey(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

// ── Component ───────────────────────────────────────────────────────

export default function TomaFisicaPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [countReason, setCountReason] = useState(COUNT_REASONS[0])
  const [counts, setCounts] = useState<Record<string, number | null>>({})
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error' | 'duplicate'; text: string } | null>(null)

  // ── Load inventory from canonical source ──────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const clientId = getActiveClientSlug()
        const data = await loadInventoryWithStock(clientId)
        setItems(data.map(r => ({
          ingredient_id: r.ingredient_id,
          name: r.name,
          unit: r.unit,
          category: r.category,
          stock: r.stock,
          cost_per_unit: r.cost_per_unit,
        })))
      } catch (e) {
        console.error('[toma-fisica] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  // ── Categories ────────────────────────────────────────────────────

  const categories = useMemo(() => {
    return [...new Set(items.map(i => i.category || 'SIN CATEGORIA'))].sort()
  }, [items])

  // ── Filter items ──────────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    let list = items
    if (!showAll) {
      list = list.filter(i => i.stock > 0)
    }
    if (categoryFilter) {
      list = list.filter(i => (i.category || 'SIN CATEGORIA') === categoryFilter)
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.ingredient_id.toLowerCase().includes(q) ||
        (i.category || '').toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [items, showAll, categoryFilter, search])

  // ── Build count entries with difference calculations ──────────────

  const countEntries: CountEntry[] = useMemo(() => {
    return filteredItems.map(item => {
      const conteo = counts[item.ingredient_id] ?? null
      const diferencia = conteo !== null ? conteo - item.stock : null
      const valorDif = diferencia !== null ? diferencia * item.cost_per_unit : null
      return {
        ingredient_id: item.ingredient_id,
        name: item.name,
        unit: item.unit,
        category: item.category,
        stock_sistema: item.stock,
        conteo_real: conteo,
        diferencia,
        valor_diferencia: valorDif,
        costo_promedio: item.cost_per_unit,
      }
    })
  }, [filteredItems, counts])

  // ── Summary stats ─────────────────────────────────────────────────

  const summary = useMemo(() => {
    const total = countEntries.length
    const counted = countEntries.filter(e => e.conteo_real !== null).length
    const pending = total - counted
    const totalDiffValue = countEntries.reduce((s, e) => s + (e.valor_diferencia ?? 0), 0)
    const discrepancies = countEntries.filter(e => e.diferencia !== null && e.diferencia !== 0).length
    return { total, counted, pending, totalDiffValue, discrepancies }
  }, [countEntries])

  // ── Handle count input ────────────────────────────────────────────

  const handleCount = useCallback((ingredientId: string, value: string) => {
    if (value === '' || value === '-') {
      setCounts(prev => {
        const next = { ...prev }
        delete next[ingredientId]
        return next
      })
    } else {
      const num = parseFloat(value)
      if (!isNaN(num)) {
        setCounts(prev => ({ ...prev, [ingredientId]: num }))
      }
    }
  }, [])

  // ── Save ──────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (summary.counted === 0) return
    setSaving(true)
    setSaveMessage(null)

    const clientId = getActiveClientSlug()
    const timestamp = nowKey()
    const idempotencyKey = makeIdempotencyKey('adjustment', 'dashboard', timestamp, 'toma_fisica')

    // Only items that were counted AND have a difference
    const adjustments = countEntries
      .filter(e => e.conteo_real !== null && e.diferencia !== null && e.diferencia !== 0)

    try {
      if (adjustments.length > 0) {
        // ── 1. Record adjustment movements ──────────────────────
        const movResult: MovementResult = await recordMovement({
          client_id: clientId,
          movement_type: 'adjustment',
          actor: 'dashboard',
          idempotency_key: idempotencyKey,
          metadata: {
            reason: countReason,
            total_counted: summary.counted,
            total_discrepancies: adjustments.length,
          },
          lines: adjustments.map(e => ({
            ingredient_id: e.ingredient_id,
            quantity: e.diferencia!,  // positive = found more, negative = found less
            notes: `Toma física: sistema=${e.stock_sistema} conteo=${e.conteo_real} dif=${e.diferencia} motivo=${countReason}`,
          })),
        })

        if (movResult.was_duplicate) {
          setSaveMessage({ type: 'duplicate', text: 'Este conteo ya fue registrado anteriormente.' })
          setCounts({})
          setSaving(false)
          return
        }

        if (!movResult.success) {
          setSaveMessage({ type: 'error', text: `Error: ${movResult.errors.join(', ')}` })
          setSaving(false)
          return
        }
      }

      // ── 2. Save historical blob (all counted items, including 0 diff) ──
      const allCounted = countEntries.filter(e => e.conteo_real !== null)
      const payload = {
        reason: countReason,
        counted_at: new Date().toISOString(),
        total_items: summary.total,
        items_counted: summary.counted,
        discrepancies: adjustments.length,
        total_diff_value: summary.totalDiffValue,
        items: allCounted.map(e => ({
          ingredient_id: e.ingredient_id,
          name: e.name,
          unit: e.unit,
          stock_sistema: e.stock_sistema,
          conteo_real: e.conteo_real,
          diferencia: e.diferencia,
          valor_diferencia: e.valor_diferencia,
          costo_promedio: e.costo_promedio,
        })),
        idempotency_key: idempotencyKey,
      }

      await sbPost('wansoft_data', clientId, {
        data_key: `physical_count_${timestamp}`,
        fecha: todayISO(),
        data: payload,
      })

      const adjMsg = adjustments.length > 0
        ? ` ${adjustments.length} ajustes aplicados al stock.`
        : ' Sin discrepancias.'

      setSaveMessage({
        type: 'success',
        text: `Conteo guardado: ${summary.counted} productos.${adjMsg}`,
      })
      setCounts({})
    } catch {
      setSaveMessage({ type: 'error', text: 'Error de red. Verifica tu conexion.' })
    }
    setSaving(false)
  }

  // ── Difference colors ─────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────

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
        subtitle={`Conteo real vs sistema — ${items.length} productos`}
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
            : saveMessage.type === 'duplicate'
            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
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

      {/* Controls: reason + search + filter */}
      <div className="flex flex-col gap-3">
        {/* Reason selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-[var(--text-3)] shrink-0">Motivo del conteo:</label>
          <select
            value={countReason}
            onChange={e => setCountReason(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            {COUNT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* Search + category filter + toggle */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-4)]" />
            <input
              type="text"
              placeholder="Buscar producto, codigo o categoria..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl text-sm bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          </div>

          <div className="flex items-center gap-3">
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="px-3 py-2.5 rounded-lg text-xs bg-[var(--surface)] border border-[var(--accent-line)] text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              <option value="">Todas las categorias</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <label className="flex items-center gap-2 cursor-pointer select-none px-1">
              <input
                type="checkbox"
                checked={showAll}
                onChange={e => setShowAll(e.target.checked)}
                className="w-5 h-5 rounded border-[var(--accent-line)] bg-[var(--surface)] text-blue-500 focus:ring-blue-500/50 accent-blue-500"
              />
              <span className="text-sm text-[var(--text-2)]">Con stock 0</span>
            </label>
          </div>
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-3)]">
          {formatNumber(filteredItems.length)} productos
          {categoryFilter ? ` en ${categoryFilter}` : ''}
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
              <th className="px-3 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Producto</th>
              <th className="px-3 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] hidden sm:table-cell">Categoria</th>
              <th className="px-3 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Unidad</th>
              <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Stock Sistema</th>
              <th className="px-3 py-3 text-center text-[10px] uppercase tracking-wider font-semibold text-blue-400">Conteo Real</th>
              <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Diferencia</th>
              <th className="px-3 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)] hidden md:table-cell">Valor Dif.</th>
            </tr>
          </thead>
          <tbody>
            {countEntries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-[var(--text-4)] text-sm">
                  <Package size={32} className="mx-auto mb-3 opacity-40" />
                  No se encontraron productos
                </td>
              </tr>
            ) : (
              countEntries.map((entry) => (
                <tr
                  key={entry.ingredient_id}
                  className={`border-b border-[var(--accent-line)]/50 transition-colors ${diffBg(entry.diferencia)} hover:bg-[var(--surface-2)]`}
                >
                  <td className="px-3 py-3 font-medium text-[var(--text-1)] max-w-[240px]">
                    <span className="block truncate">{entry.name}</span>
                  </td>
                  <td className="px-3 py-3 text-[var(--text-3)] text-xs whitespace-nowrap hidden sm:table-cell">
                    {entry.category || 'Sin categoría'}
                  </td>
                  <td className="px-3 py-3 text-[var(--text-3)] text-xs">{entry.unit}</td>
                  <td className="px-3 py-3 text-right font-mono text-sm tabular-nums text-[var(--text-2)]">
                    {entry.stock_sistema.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder="--"
                      value={entry.conteo_real !== null ? entry.conteo_real : ''}
                      onChange={e => handleCount(entry.ingredient_id, e.target.value)}
                      className="w-24 sm:w-28 px-3 py-3 rounded-lg text-center text-base font-semibold tabular-nums bg-[var(--surface)] border-2 border-[var(--accent-line)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </td>
                  <td className={`px-3 py-3 text-right font-mono text-sm font-semibold tabular-nums ${diffColor(entry.diferencia)}`}>
                    {entry.diferencia !== null ? (
                      <>{entry.diferencia > 0 ? '+' : ''}{entry.diferencia.toFixed(2)}</>
                    ) : (
                      <span className="text-[var(--text-4)]">--</span>
                    )}
                  </td>
                  <td className={`px-3 py-3 text-right font-mono text-xs tabular-nums hidden md:table-cell ${diffColor(entry.valor_diferencia)}`}>
                    {entry.valor_diferencia !== null ? formatCurrency(entry.valor_diferencia) : <span className="text-[var(--text-4)]">--</span>}
                  </td>
                </tr>
              ))
            )}

            {/* Totals row */}
            {countEntries.length > 0 && summary.counted > 0 && (
              <tr className="border-t-2 border-[var(--accent-line)] bg-[var(--surface-2)]">
                <td className="px-3 py-3 font-bold text-[var(--text-1)] text-xs uppercase tracking-wider">
                  Total ({formatNumber(summary.counted)} contados)
                </td>
                <td className="px-3 py-3 hidden sm:table-cell" />
                <td className="px-3 py-3" />
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

      {/* Bottom save bar */}
      {summary.counted > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-4 px-5 py-4 rounded-xl border border-[var(--accent-line)] shadow-2xl" style={{ background: 'var(--bento-card)' }}>
          <div className="text-sm text-[var(--text-2)]">
            <span className="font-semibold text-[var(--text-1)]">{summary.counted}</span> de {summary.total} contados
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
