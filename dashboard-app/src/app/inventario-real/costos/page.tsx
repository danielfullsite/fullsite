'use client'

import { useEffect, useState, useMemo } from 'react'
import { DollarSign, TrendingUp, TrendingDown, ArrowDownUp, Warehouse, Package, BarChart3 } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import PageHeader from '@/components/PageHeader'
import KPICard from '@/components/KPICard'

// ── Types ───────────────────────────────────────────────────────────

interface InventoryItem {
  almacen: string
  departamento: string
  codigo: string
  producto: string
  critico: boolean
  inv_inicial_qty: number
  inv_inicial_val: number
  entradas_qty: number
  entradas_val: number
  salidas_qty: number
  salidas_val: number
  inv_final_qty: number
  inv_final_val: number
  costo_promedio: number
  saldo_actual: number
}

interface DateSnapshot {
  fecha: string
  items: InventoryItem[]
}

// ── Helpers ─────────────────────────────────────────────────────────

function deepParse(val: unknown): unknown {
  if (typeof val === 'string') {
    try { return deepParse(JSON.parse(val)) } catch { return val }
  }
  return val
}

function parseItem(r: Record<string, unknown>): InventoryItem {
  return {
    almacen: String(r.almacen || ''),
    departamento: String(r.departamento || ''),
    codigo: String(r.codigo || ''),
    producto: String(r.producto || ''),
    critico: Boolean(r.critico),
    inv_inicial_qty: Number(r.inv_inicial_qty) || 0,
    inv_inicial_val: Number(r.inv_inicial_val) || 0,
    entradas_qty: Number(r.entradas_qty) || 0,
    entradas_val: Number(r.entradas_val) || 0,
    salidas_qty: Number(r.salidas_qty) || 0,
    salidas_val: Number(r.salidas_val) || 0,
    inv_final_qty: Number(r.inv_final_qty) || 0,
    inv_final_val: Number(r.inv_final_val) || 0,
    costo_promedio: Number(r.costo_promedio) || 0,
    saldo_actual: Number(r.saldo_actual) || 0,
  }
}

// ── Component ───────────────────────────────────────────────────────

export default function CostosInventarioPage() {
  const [snapshots, setSnapshots] = useState<DateSnapshot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/wansoft_data?client_id=eq.amalay&data_key=eq.inventory_parsed&order=fecha.desc&limit=5&select=fecha,data`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const rows: { fecha: string; data: unknown }[] = await res.json()

        const parsed: DateSnapshot[] = rows
          .map(row => {
            const d = deepParse(row.data)
            const arr = Array.isArray(d) ? d : (d as Record<string, unknown>)?.items
            if (!Array.isArray(arr)) return null
            return {
              fecha: row.fecha,
              items: arr.map((r: Record<string, unknown>) => parseItem(r)),
            }
          })
          .filter((s): s is DateSnapshot => s !== null)
          .sort((a, b) => a.fecha.localeCompare(b.fecha))

        setSnapshots(parsed)
      } catch (e) {
        console.error('[costos] Error loading:', e)
      }
      setLoading(false)
    }
    load()
  }, [])

  // Use the latest snapshot for primary view
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const items = latest?.items || []

  // ── KPIs ────────────────────────────────────────────────────────
  const totalSaldo = items.reduce((s, i) => s + i.saldo_actual, 0)
  const totalEntradas = items.reduce((s, i) => s + i.entradas_val, 0)
  const totalSalidas = items.reduce((s, i) => s + i.salidas_val, 0)
  const rotacion = totalSaldo > 0 ? totalSalidas / totalSaldo : 0

  // ── Warehouse breakdown ─────────────────────────────────────────
  const warehouseData = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach(i => {
      const key = i.almacen || 'Sin almacen'
      map.set(key, (map.get(key) || 0) + i.saldo_actual)
    })
    const arr = Array.from(map.entries())
      .map(([name, saldo]) => ({ name, saldo }))
      .sort((a, b) => b.saldo - a.saldo)
    const max = arr.length > 0 ? arr[0].saldo : 1
    return { arr, max }
  }, [items])

  // ── Department breakdown ────────────────────────────────────────
  const deptData = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach(i => {
      const key = i.departamento || 'Sin departamento'
      map.set(key, (map.get(key) || 0) + i.saldo_actual)
    })
    const arr = Array.from(map.entries())
      .map(([name, saldo]) => ({ name, saldo }))
      .sort((a, b) => b.saldo - a.saldo)
    const max = arr.length > 0 ? arr[0].saldo : 1
    return { arr, max }
  }, [items])

  // ── Top 20 productos ───────────────────────────────────────────
  const top20 = useMemo(() => {
    return [...items]
      .sort((a, b) => b.saldo_actual - a.saldo_actual)
      .slice(0, 20)
  }, [items])

  // ── Timeline data (if multiple snapshots) ──────────────────────
  const timelineData = useMemo(() => {
    return snapshots.map(snap => ({
      fecha: snap.fecha,
      saldo: snap.items.reduce((s, i) => s + i.saldo_actual, 0),
    }))
  }, [snapshots])

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!latest) {
    return (
      <div className="space-y-6">
        <PageHeader title="Costo de Inventario" subtitle="Comparativo por periodo" />
        <div className="rounded-2xl border border-[var(--accent-line)] p-12 text-center" style={{ background: 'var(--bento-card)' }}>
          <Package size={40} className="mx-auto text-[var(--text-4)] mb-3" />
          <p className="text-[var(--text-3)]">No hay datos de inventario disponibles.</p>
          <p className="text-[var(--text-4)] text-sm mt-1">Los datos se cargaran automaticamente cuando el scraper los recolecte.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Costo de Inventario"
        subtitle={`Comparativo por periodo${latest ? ` — ${latest.fecha}` : ''} ${snapshots.length > 1 ? `(${snapshots.length} periodos)` : '(1 periodo disponible)'}`}
      />

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          label="Saldo total"
          value={formatCurrency(totalSaldo)}
          icon={DollarSign}
          accentClass="kpi-accent-green"
          index={0}
        />
        <KPICard
          label="Entradas del periodo"
          value={formatCurrency(totalEntradas)}
          icon={TrendingUp}
          accentClass="kpi-accent-blue"
          index={1}
        />
        <KPICard
          label="Salidas del periodo"
          value={formatCurrency(totalSalidas)}
          icon={TrendingDown}
          accentClass="kpi-accent-amber"
          index={2}
        />
        <KPICard
          label="Rotacion"
          value={rotacion.toFixed(2) + 'x'}
          subtitle="salidas / saldo"
          icon={ArrowDownUp}
          accentClass="kpi-accent-purple"
          index={3}
        />
      </div>

      {/* ── Timeline (multi-date) ── */}
      {timelineData.length > 1 && (
        <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
          <h3 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-400" />
            Saldo total por periodo
          </h3>
          <div className="space-y-2">
            {(() => {
              const max = Math.max(...timelineData.map(d => d.saldo))
              return timelineData.map((d, i) => (
                <div key={d.fecha} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-[var(--text-3)] w-24 shrink-0">{d.fecha}</span>
                  <div className="flex-1 h-7 rounded-lg bg-[var(--surface-2)] overflow-hidden relative">
                    <div
                      className="h-full rounded-lg transition-all duration-500"
                      style={{
                        width: `${max > 0 ? (d.saldo / max) * 100 : 0}%`,
                        background: i === timelineData.length - 1
                          ? 'linear-gradient(90deg, rgba(59,130,246,0.3), rgba(59,130,246,0.6))'
                          : 'linear-gradient(90deg, rgba(107,114,128,0.2), rgba(107,114,128,0.4))',
                      }}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-mono font-semibold text-[var(--text-1)]">
                      {formatCurrency(d.saldo)}
                    </span>
                  </div>
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* ── Warehouse breakdown ── */}
      <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
        <h3 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
          <Warehouse size={16} className="text-purple-400" />
          Saldo por almacen
        </h3>
        <div className="space-y-2.5">
          {warehouseData.arr.map((w) => {
            const pct = totalSaldo > 0 ? (w.saldo / totalSaldo) * 100 : 0
            return (
              <div key={w.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-[var(--text-2)] truncate max-w-[50%]">{w.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-[var(--text-4)]">{pct.toFixed(1)}%</span>
                    <span className="text-xs font-mono font-semibold text-[var(--text-1)] tnum">{formatCurrency(w.saldo)}</span>
                  </div>
                </div>
                <div className="h-5 rounded-lg bg-[var(--surface-2)] overflow-hidden relative">
                  <div
                    className="h-full rounded-lg"
                    style={{
                      width: `${warehouseData.max > 0 ? (w.saldo / warehouseData.max) * 100 : 0}%`,
                      background: 'linear-gradient(90deg, rgba(168,85,247,0.25), rgba(168,85,247,0.5))',
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Top 20 productos mas caros ── */}
      <div className="rounded-2xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
        <div className="px-5 py-4 border-b border-[var(--accent-line)]">
          <h3 className="text-sm font-bold text-[var(--text-1)] flex items-center gap-2">
            <DollarSign size={16} className="text-emerald-400" />
            Top 20 productos por saldo
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--accent-line)]">
                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">#</th>
                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Producto</th>
                <th className="px-4 py-3 text-left text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Almacen</th>
                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Qty</th>
                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Costo Prom</th>
                <th className="px-4 py-3 text-right text-[10px] uppercase tracking-wider font-semibold text-[var(--text-3)]">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {top20.map((item, idx) => (
                <tr
                  key={`${item.codigo}-${item.almacen}-${idx}`}
                  className="border-b border-[var(--accent-line)]/50 hover:bg-[var(--surface-2)] transition-colors"
                >
                  <td className="px-4 py-2.5 text-xs text-[var(--text-4)] font-mono">{idx + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-[var(--text-1)] whitespace-nowrap max-w-[260px] truncate">{item.producto}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--text-3)] whitespace-nowrap">{item.almacen}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tnum text-[var(--text-2)]">{item.inv_final_qty.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tnum text-[var(--text-2)]">{formatCurrency(item.costo_promedio)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tnum text-[var(--text-1)]">{formatCurrency(item.saldo_actual)}</td>
                </tr>
              ))}
              {top20.length > 0 && (
                <tr className="border-t-2 border-[var(--accent-line)] bg-[var(--surface-2)]">
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 font-bold text-xs uppercase tracking-wider text-[var(--text-1)]">
                    Top 20 subtotal
                  </td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right font-mono text-xs font-bold tnum text-[var(--text-1)]">
                    {formatCurrency(top20.reduce((s, i) => s + i.saldo_actual, 0))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Department breakdown ── */}
      <div className="rounded-2xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
        <h3 className="text-sm font-bold text-[var(--text-1)] mb-4 flex items-center gap-2">
          <Package size={16} className="text-cyan-400" />
          Saldo por departamento
        </h3>
        <div className="space-y-2.5">
          {deptData.arr.map((d) => {
            const pct = totalSaldo > 0 ? (d.saldo / totalSaldo) * 100 : 0
            return (
              <div key={d.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-[var(--text-2)] truncate max-w-[50%]">{d.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-[var(--text-4)]">{pct.toFixed(1)}%</span>
                    <span className="text-xs font-mono font-semibold text-[var(--text-1)] tnum">{formatCurrency(d.saldo)}</span>
                  </div>
                </div>
                <div className="h-5 rounded-lg bg-[var(--surface-2)] overflow-hidden relative">
                  <div
                    className="h-full rounded-lg"
                    style={{
                      width: `${deptData.max > 0 ? (d.saldo / deptData.max) * 100 : 0}%`,
                      background: 'linear-gradient(90deg, rgba(6,182,212,0.25), rgba(6,182,212,0.5))',
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
