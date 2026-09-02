'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Target, Zap } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { getActiveClientSlug } from '@/lib/data'
import { getActiveTimezone } from '@/lib/date-mx'

interface PredictionWidgetProps {
  currentVentas: number
  currentTickets: number
  yesterdayVentas: number
  lastWeekVentas: number
  dowAvgVentas: number
  dataFecha?: string
}

function predict(
  currentVentas: number,
  distribution: Record<number, number>,
  dataFecha?: string,
): { projected: number; pctDone: number; remaining: number } {
  const now = new Date()
  const mxHour = (now.getUTCHours() - 6 + 24) % 24
  const mxMinute = now.getUTCMinutes()

  if (dataFecha) {
    const mxNow = new Date(now.toLocaleString('en-US', { timeZone: getActiveTimezone() }))
    const todayStr = mxNow.toISOString().slice(0, 10)
    if (dataFecha !== todayStr) return { projected: 0, pctDone: 0, remaining: 0 }
  }

  if (currentVentas <= 0 || mxHour < 8) return { projected: 0, pctDone: 0, remaining: 0 }

  let pctCaptured = 0
  for (const [hour, pct] of Object.entries(distribution)) {
    const h = parseInt(hour)
    if (h < mxHour) {
      pctCaptured += pct
    } else if (h === mxHour) {
      pctCaptured += pct * (mxMinute / 60)
    }
  }

  if (pctCaptured <= 0) return { projected: 0, pctDone: 0, remaining: 0 }

  const projected = currentVentas / pctCaptured
  return { projected, pctDone: pctCaptured * 100, remaining: projected - currentVentas }
}

export default function PredictionWidget({
  currentVentas,
  currentTickets,
  yesterdayVentas,
  lastWeekVentas,
  dowAvgVentas,
  dataFecha,
}: PredictionWidgetProps) {
  const [distribution, setDistribution] = useState<Record<number, number> | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const clientId = getActiveClientSlug()
    if (!clientId) { setLoaded(true); return }

    fetch(`/api/dashboard/hourly-distribution?client_id=${encodeURIComponent(clientId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setDistribution(data?.distribution ?? null) })
      .catch(() => setDistribution(null))
      .finally(() => setLoaded(true))
  }, [])

  // Not ready or no sufficient history (N/A)
  if (!loaded || !distribution) return null

  const { projected, pctDone, remaining } = predict(currentVentas, distribution, dataFecha)
  if (projected <= 0) return null

  const vsYesterday = yesterdayVentas > 0 ? ((projected - yesterdayVentas) / yesterdayVentas) * 100 : 0
  const vsLastWeek = lastWeekVentas > 0 ? ((projected - lastWeekVentas) / lastWeekVentas) * 100 : 0
  const vsDowAvg = dowAvgVentas > 0 ? ((projected - dowAvgVentas) / dowAvgVentas) * 100 : 0

  const isAboveAvg = vsDowAvg >= 0
  const mainComparison = dowAvgVentas > 0 ? vsDowAvg : vsYesterday
  const mainCompLabel = dowAvgVentas > 0 ? 'vs promedio del día' : 'vs ayer'
  const isUp = mainComparison >= 0

  // suppress unused-var warning — kept in props for backward compatibility
  void currentTickets

  return (
    <div className="relative overflow-hidden rounded-[18px] border border-[var(--line)] mb-6" style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}>
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{
          background: isAboveAvg
            ? 'linear-gradient(90deg, var(--accent), var(--accent-bright))'
            : 'linear-gradient(90deg, var(--warn), var(--warn-ink))',
        }}
      />

      <div className="px-4 sm:px-5 py-4 sm:py-[18px]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-[9px]">
            <div className={`w-7 h-7 rounded-[9px] grid place-items-center ${isAboveAvg ? 'bg-[var(--accent-soft)] text-[var(--accent-bright)]' : 'bg-[var(--warn-soft)] text-[var(--warn-ink)]'}`}>
              <Target className="w-[15px] h-[15px]" />
            </div>
            <p className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-[0.13em] font-mono">Predicción de cierre</p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
            <Zap className="w-3 h-3" fill="currentColor" />
            <span className="hidden sm:inline">Tiempo real</span>
            <span className="sm:hidden">{pctDone.toFixed(0)}%</span>
          </div>
        </div>

        <div className="flex items-end gap-3 sm:gap-3.5 mb-3 sm:mb-3.5">
          <p className="text-[32px] sm:text-[36px] font-black text-[var(--text-1)] tracking-[-0.03em] tnum leading-none">
            {formatCurrency(projected)}
          </p>
          <div className={`flex items-center gap-1 text-xs sm:text-sm font-semibold mb-1 ${isUp ? 'text-[var(--accent-ink)]' : 'text-[var(--warn-ink)]'}`}>
            {isUp ? <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <TrendingDown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            <span>{isUp ? '+' : ''}{mainComparison.toFixed(1)}%</span>
            <span className="text-[var(--text-3)] font-normal hidden sm:inline">{mainCompLabel}</span>
          </div>
        </div>

        <div className="mb-3 sm:mb-4">
          <div className="flex justify-between text-xs text-[var(--text-3)] mb-1.5">
            <span>Progreso del día</span>
            <span>{pctDone.toFixed(0)}% completado</span>
          </div>
          <div className="w-full bg-[var(--line-soft)] rounded-full h-2.5 sm:h-3 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${Math.min(pctDone, 100)}%`,
                background: isAboveAvg
                  ? 'linear-gradient(90deg, var(--accent), var(--accent-bright))'
                  : 'linear-gradient(90deg, var(--warn), var(--warn-ink))',
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-3 border-t border-[var(--line-soft)]">
          <div>
            <p className="text-[10px] sm:text-[10.5px] text-[var(--text-3)] mb-0.5">Falta</p>
            <p className="text-[13.5px] font-bold text-[var(--text-1)] tnum">{formatCurrency(remaining)}</p>
          </div>
          <div>
            <p className="text-[10px] sm:text-[10.5px] text-[var(--text-3)] mb-0.5">vs ayer</p>
            <p className={`text-[13.5px] font-bold tnum ${vsYesterday >= 0 ? 'text-[var(--accent-ink)]' : 'text-[var(--crit-ink)]'}`}>
              {vsYesterday >= 0 ? '+' : ''}{vsYesterday.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] sm:text-[10.5px] text-[var(--text-3)] mb-0.5">vs 7d</p>
            <p className={`text-[13.5px] font-bold tnum ${vsLastWeek >= 0 ? 'text-[var(--accent-ink)]' : 'text-[var(--crit-ink)]'}`}>
              {vsLastWeek >= 0 ? '+' : ''}{vsLastWeek.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
