'use client'

import { useEffect, useState, useCallback } from 'react'
import { TrendingDown, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react'

// Rentabilidad — exhibe el loop factura -> costo -> margen con CAUSA.
// "Tu sopa bajó de 68% a 61% de margen porque el CAMARÓN subió 15%."
// Consume /api/rentabilidad (cost-engine + historial de costos).

type Driver = { name: string; oldCost: number | null; newCost: number; pct: number | null }
type Dish = {
  menu_item_id: string; name: string; price: number | null
  costBefore: number; costNow: number; costDeltaPct: number | null
  marginNow: number | null; marginBefore: number | null; drivers: Driver[]
}
type Change = { name: string; oldCost: number | null; newCost: number; pct: number | null }
type Resp = { days: number; changes: Change[]; dishes: Dish[]; hasHistory: boolean }

const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pctTxt = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
// Umbral de rentabilidad: food cost 35% => margen 65%.
const RENTABLE_MIN = 65

function marginColor(m: number | null) {
  if (m == null) return 'var(--text-3)'
  if (m < 55) return 'var(--crit-ink)'
  if (m < RENTABLE_MIN) return 'var(--warn-ink, #fbbf24)'
  return 'var(--accent-ink)'
}

export default function RentabilidadPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  const load = useCallback((d: number) => {
    setLoading(true)
    fetch(`/api/rentabilidad?days=${d}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => setData(j))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(days) }, [load, days])

  const dishes = data?.dishes ?? []
  const changes = data?.changes ?? []
  const lostRentable = dishes.filter(d => d.marginBefore != null && d.marginNow != null && d.marginBefore >= RENTABLE_MIN && d.marginNow < RENTABLE_MIN)

  return (
    <div className="h-dvh overflow-y-auto" style={{ color: 'var(--text-1)', background: 'var(--bg)' }}>
      <div className="max-w-4xl mx-auto w-full p-6">
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <div className="flex items-center gap-3">
            <TrendingDown size={24} style={{ color: 'var(--accent-ink)' }} />
            <h1 className="text-2xl font-bold">Rentabilidad</h1>
          </div>
          <div className="flex items-center gap-2">
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              className="rounded-lg px-3 py-2 text-sm min-h-[40px]"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text-1)' }}>
              <option value={7}>Últimos 7 días</option>
              <option value={30}>Últimos 30 días</option>
              <option value={90}>Últimos 90 días</option>
            </select>
            <button onClick={() => load(days)} className="rounded-lg p-2 min-h-[40px] min-w-[40px] grid place-items-center"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)' }} aria-label="Refrescar">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <p className="text-sm mb-5" style={{ color: 'var(--text-3)' }}>
          Cuando entra una factura y sube un insumo, aquí ves qué platillos se encarecieron y cuáles dejaron de ser rentables — y por qué.
        </p>

        {loading && <p className="text-sm" style={{ color: 'var(--text-3)' }}>Calculando…</p>}

        {!loading && data && !data.hasHistory && (
          <div className="rounded-2xl border p-6 text-sm" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', color: 'var(--text-3)' }}>
            Aún no hay cambios de costo registrados. En cuanto entre una factura de proveedor que mueva el costo de un insumo, aparecerá aquí automáticamente.
          </div>
        )}

        {!loading && data && data.hasHistory && (
          <>
            {/* Insumos que se movieron */}
            {changes.length > 0 && (
              <div className="mb-5">
                <h2 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Insumos que se movieron</h2>
                <div className="flex flex-wrap gap-2">
                  {changes.slice(0, 12).map((c, i) => {
                    const up = (c.pct ?? 0) > 0
                    return (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm"
                        style={{ background: up ? 'var(--crit-soft)' : 'var(--accent-soft)', color: up ? 'var(--crit-ink)' : 'var(--accent-ink)', border: `1px solid ${up ? 'var(--crit-soft)' : 'var(--accent-line)'}` }}>
                        {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                        <b>{c.name}</b> {pctTxt(c.pct)}
                        <span style={{ opacity: .7 }}>({money(c.oldCost)}→{money(c.newCost)})</span>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Alerta: dejaron de ser rentables */}
            {lostRentable.length > 0 && (
              <div className="rounded-2xl border p-4 mb-5 flex items-start gap-3"
                style={{ background: 'var(--crit-soft)', borderColor: 'var(--crit-ink)' }}>
                <AlertTriangle size={20} style={{ color: 'var(--crit-ink)', flexShrink: 0, marginTop: 2 }} />
                <div className="text-sm">
                  <b style={{ color: 'var(--crit-ink)' }}>{lostRentable.length} platillo{lostRentable.length > 1 ? 's' : ''} dejó de ser rentable</b>
                  <span style={{ color: 'var(--text-2, var(--text-1))' }}> — cruzaron por debajo de {RENTABLE_MIN}% de margen tras el último movimiento de costos.</span>
                </div>
              </div>
            )}

            {/* Platillos afectados */}
            {dishes.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>Ningún platillo se vio afectado por los cambios de costo en este periodo.</p>
            ) : (
              <div className="grid gap-2.5">
                {dishes.map(d => (
                  <div key={d.menu_item_id} className="rounded-2xl border p-4"
                    style={{ background: 'var(--bento-card)', borderColor: 'var(--line)' }}>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-semibold text-[15px] truncate">{d.name}</div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                          Costo {money(d.costBefore)} → <b style={{ color: 'var(--text-1)' }}>{money(d.costNow)}</b>
                          {d.costDeltaPct != null && <span style={{ color: d.costDeltaPct > 0 ? 'var(--crit-ink)' : 'var(--accent-ink)' }}> ({pctTxt(d.costDeltaPct)})</span>}
                          {d.price != null && <span> · precio {money(d.price)}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        {d.marginNow != null ? (
                          <>
                            <div className="text-2xl font-bold tabular-nums" style={{ color: marginColor(d.marginNow) }}>{d.marginNow.toFixed(0)}%</div>
                            <div className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                              margen{d.marginBefore != null && <> · antes {d.marginBefore.toFixed(0)}%</>}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs" style={{ color: 'var(--text-3)' }}>sin precio<br />configurado</div>
                        )}
                      </div>
                    </div>
                    {d.drivers.length > 0 && (
                      <div className="mt-2.5 pt-2.5 flex flex-wrap gap-1.5" style={{ borderTop: '1px solid var(--line)' }}>
                        <span className="text-xs" style={{ color: 'var(--text-3)' }}>Por:</span>
                        {d.drivers.map((dr, i) => (
                          <span key={i} className="text-xs font-medium" style={{ color: (dr.pct ?? 0) > 0 ? 'var(--crit-ink)' : 'var(--accent-ink)' }}>
                            {dr.name} {pctTxt(dr.pct)}{i < d.drivers.length - 1 ? ',' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
