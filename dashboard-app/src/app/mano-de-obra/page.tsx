'use client'

// Tacómetro de mano de obra — el semáforo operativo (verde/amarillo/rojo) del
// % de labor sobre venta. Pedido por Billy Newell (2026-09-01) como el número
// que un operador de fast food revisa al llegar a la sucursal. El costo de labor
// viene de /api/labor (server, service key); la venta de getDashboardFromPosOrders.
// Cálculo puro y umbrales en src/lib/labor.ts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Gauge, Clock, Users, DollarSign, AlertTriangle, ChevronDown, Calendar } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import { formatCurrency } from '@/lib/format'
import { buildTacometro, DEFAULT_THRESHOLDS, type LaborPayload, type TacometroSummary, type LaborZone } from '@/lib/labor'
import { getPOSAuthHeaders } from '@/lib/pos-data'

type PeriodDays = 7 | 14 | 30
const PERIODS: PeriodDays[] = [7, 14, 30]

const ZONE_UI: Record<LaborZone, { label: string; text: string; bg: string; ring: string; dot: string }> = {
  verde: { label: 'Saludable', text: 'text-emerald-500', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', dot: 'bg-emerald-500' },
  amarillo: { label: 'Atención', text: 'text-amber-500', bg: 'bg-amber-500/10', ring: 'ring-amber-500/30', dot: 'bg-amber-500' },
  rojo: { label: 'Fuera de rango', text: 'text-red-500', bg: 'bg-red-500/10', ring: 'ring-red-500/30', dot: 'bg-red-500' },
  'sin-dato': { label: 'Sin dato', text: 'text-[var(--text-3)]', bg: 'bg-[var(--surface-2)]', ring: 'ring-[var(--line)]', dot: 'bg-[var(--text-4)]' },
}

function pctStr(pct: number | null): string {
  if (pct == null || !isFinite(pct)) return '--'
  return `${(pct * 100).toFixed(1)}%`
}

function fechaCorta(f: string): string {
  const d = new Date(f + 'T12:00:00')
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

export default function ManoDeObraPage() {
  const [days, setDays] = useState<PeriodDays>(30)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<TacometroSummary | null>(null)
  const [showPeriod, setShowPeriod] = useState(false)

  const load = useCallback(async (n: PeriodDays) => {
    setLoading(true)
    try {
      const laborRes = await fetch(`/api/labor?days=${n}`, { cache: 'no-store', headers: getPOSAuthHeaders() })
      const labor: LaborPayload = laborRes.ok
        ? await laborRes.json()
        : { days: n, laborByDay: [], employees: [], totalCost: 0, totalHours: 0, totalSales: 0, hasWageData: false }
      // La venta viene del mismo route (mismo criterio de fecha que el labor) para
      // que el cruce por día alinee — NO de getDashboardFromPosOrders (business_day).
      const salesByDay = labor.laborByDay.map(d => ({ fecha: d.fecha, ventas_dia: d.sales }))
      setSummary(buildTacometro(labor, salesByDay, DEFAULT_THRESHOLDS))
    } catch (err) {
      console.error('[mano-de-obra] error:', err)
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(days) }, [days, load])

  const maxPct = useMemo(() => {
    if (!summary) return 0.4
    return Math.max(0.4, ...summary.days.map(d => d.pct || 0))
  }, [summary])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const zone = summary?.zone || 'sin-dato'
  const ui = ZONE_UI[zone]
  const hasDays = !!summary && summary.days.length > 0
  const costPerHour = summary && summary.totalHours > 0 ? Math.round(summary.totalCost / summary.totalHours) : 0

  return (
    <>
      <PageHeader
        eyebrow="Operación"
        title="Mano de obra"
        subtitle="% de nómina operativa sobre venta — el semáforo que revisas al llegar"
        action={
          <div className="relative">
            <button
              onClick={() => setShowPeriod(!showPeriod)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--line)] text-sm font-medium text-[var(--text-1)] hover:bg-[var(--surface-2)] transition-colors"
            >
              <Calendar size={14} className="text-[var(--text-3)]" />
              Últimos {days} días
              <ChevronDown size={14} className="text-[var(--text-3)]" />
            </button>
            {showPeriod && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowPeriod(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--surface)] border border-[var(--line)] rounded-lg shadow-lg overflow-hidden min-w-[150px]">
                  {PERIODS.map(p => (
                    <button
                      key={p}
                      onClick={() => { setDays(p); setShowPeriod(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--surface-2)] transition-colors ${
                        days === p ? 'text-emerald-500 font-semibold bg-emerald-500/5' : 'text-[var(--text-2)]'
                      }`}
                    >
                      Últimos {p} días
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        }
      />

      {!hasDays ? (
        <EmptyState
          icon={Gauge}
          title="Sin turnos en el periodo"
          description="El tacómetro se alimenta de los turnos del punto de venta (entradas/salidas del personal) y sus sueldos. Registra turnos y captura las tarifas por hora para activarlo."
          iconColor="text-emerald-500"
          iconBg="bg-emerald-500/10"
        />
      ) : (
        <>
          {!summary?.hasWageData && (
            <div className="mb-4 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-500/90">
                No hay sueldos capturados (tarifa por hora en 0), así que el costo de labor sale en cero.
                Captura el sueldo de cada empleado para activar el porcentaje.
              </p>
            </div>
          )}

          {/* ── Semáforo grande ─────────────────────────────────────── */}
          <div className={`mb-6 rounded-2xl border border-[var(--line)] ${ui.bg} ring-1 ${ui.ring} p-6 sm:p-8`}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="flex items-center gap-4">
                <div className={`w-3 h-3 rounded-full ${ui.dot} ${zone === 'rojo' ? 'animate-pulse' : ''}`} />
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-3)] mb-1">Mano de obra / venta</p>
                  <div className="flex items-baseline gap-3">
                    <span className={`text-6xl font-bold tracking-tight tabular-nums ${ui.text}`}>{pctStr(summary!.pct)}</span>
                    <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${ui.bg} ${ui.text}`}>{ui.label}</span>
                  </div>
                </div>
              </div>
              <div className="sm:ml-auto grid grid-cols-3 gap-4 sm:gap-6">
                <div>
                  <p className="text-xs text-[var(--text-3)] flex items-center gap-1"><DollarSign size={11} /> Costo labor</p>
                  <p className="text-lg font-bold text-[var(--text-1)] tabular-nums">{formatCurrency(summary!.totalCost)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-3)] flex items-center gap-1"><DollarSign size={11} /> Venta</p>
                  <p className="text-lg font-bold text-[var(--text-1)] tabular-nums">{formatCurrency(summary!.totalSales)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-3)] flex items-center gap-1"><Clock size={11} /> Horas · $/h</p>
                  <p className="text-lg font-bold text-[var(--text-1)] tabular-nums">{Math.round(summary!.totalHours)}h · {formatCurrency(costPerHour)}</p>
                </div>
              </div>
            </div>
            {/* leyenda de rangos */}
            <div className="mt-5 pt-4 border-t border-[var(--line-soft)] flex flex-wrap gap-4 text-xs text-[var(--text-3)]">
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Verde ≤ {(DEFAULT_THRESHOLDS.green * 100).toFixed(0)}%</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> Amarillo ≤ {(DEFAULT_THRESHOLDS.yellow * 100).toFixed(0)}%</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> Rojo &gt; {(DEFAULT_THRESHOLDS.yellow * 100).toFixed(0)}%</span>
            </div>
          </div>

          {/* ── Tendencia diaria ────────────────────────────────────── */}
          <div className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
            <p className="text-sm font-semibold text-[var(--text-1)] mb-4 flex items-center gap-2"><Gauge size={15} className="text-[var(--text-3)]" /> Labor % por día</p>
            <div className="flex items-end gap-1.5 h-40 overflow-x-auto pb-1">
              {summary!.days.map(d => {
                const z = ZONE_UI[d.zone]
                const h = d.pct != null ? Math.max(4, Math.round((d.pct / maxPct) * 150)) : 4
                return (
                  <div key={d.fecha} className="flex flex-col items-center gap-1 min-w-[26px] flex-1 group">
                    <span className={`text-[9px] tabular-nums ${z.text} opacity-0 group-hover:opacity-100 transition-opacity`}>{pctStr(d.pct)}</span>
                    <div className="w-full flex items-end justify-center" style={{ height: 150 }}>
                      <div className={`w-full rounded-t ${z.dot} transition-all`} style={{ height: `${h}px` }} title={`${fechaCorta(d.fecha)} · ${pctStr(d.pct)} · labor ${formatCurrency(d.cost)} / venta ${formatCurrency(d.sales)}`} />
                    </div>
                    <span className="text-[9px] text-[var(--text-4)] whitespace-nowrap">{fechaCorta(d.fecha)}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Desglose por empleado ───────────────────────────────── */}
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line-soft)] bg-[var(--surface-2)] flex items-center gap-2">
              <Users size={15} className="text-[var(--text-3)]" />
              <span className="text-sm font-semibold text-[var(--text-1)]">Personal operativo ({summary!.employees.length})</span>
            </div>
            {summary!.employees.length === 0 ? (
              <div className="px-4 py-6 text-sm text-[var(--text-3)]">Sin turnos de personal operativo en el periodo.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line-soft)] text-[var(--text-3)]">
                      <th className="text-left px-4 py-3 font-medium">#</th>
                      <th className="text-left px-4 py-3 font-medium">Empleado</th>
                      <th className="text-left px-4 py-3 font-medium">Rol</th>
                      <th className="text-right px-4 py-3 font-medium">Horas</th>
                      <th className="text-right px-4 py-3 font-medium">Costo</th>
                      <th className="text-right px-4 py-3 font-medium">% del costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary!.employees.map((e, i) => {
                      const share = summary!.totalCost > 0 ? e.cost / summary!.totalCost : 0
                      return (
                        <tr key={e.staff_id} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                          <td className="px-4 py-3 text-[var(--text-4)]">{i + 1}</td>
                          <td className="px-4 py-3 font-medium text-[var(--text-1)]">{e.name}</td>
                          <td className="px-4 py-3 text-[var(--text-3)] capitalize">{e.role || '--'}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{e.hours}h</td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--text-1)]">{formatCurrency(e.cost)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[var(--text-3)]">{(share * 100).toFixed(0)}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
