'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Target, Zap } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { getActiveClientSlug } from '@/lib/data'

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
    const mxNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Monterrey' }))
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
    <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm mb-6">
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{
          background: isAboveAvg
            ? 'linear-gradient(90deg, #10b981, #34d399)'
            : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
        }}
      />

      <div className="px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isAboveAvg ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
              <Target className={`w-4 h-4 ${isAboveAvg ? 'text-emerald-500' : 'text-amber-500'}`} />
            </div>
            <p className="text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Predicción de cierre</p>
          </div>
          <div className="flex items-center gap-1 text-xs text-[var(--text-3)]">
            <Zap className="w-3 h-3" />
            <span className="hidden sm:inline">Tiempo real</span>
            <span className="sm:hidden">{pctDone.toFixed(0)}%</span>
          </div>
        </div>

        <div className="flex items-end gap-3 sm:gap-4 mb-3 sm:mb-4">
          <p className="text-3xl sm:text-4xl font-black text-[var(--text-1)] tracking-tight">
            {formatCurrency(projected)}
          </p>
          <div className={`flex items-center gap-1 text-xs sm:text-sm font-semibold mb-1 ${isUp ? 'text-emerald-500' : 'text-amber-500'}`}>
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
                  ? 'linear-gradient(90deg, #10b981, #34d399)'
                  : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-3 border-t border-[var(--line-soft)]">
          <div>
            <p className="text-[10px] sm:text-xs text-[var(--text-3)] mb-0.5">Falta</p>
            <p className="text-xs sm:text-sm font-semibold text-[var(--text-1)]">{formatCurrency(remaining)}</p>
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-[var(--text-3)] mb-0.5">vs ayer</p>
            <p className={`text-xs sm:text-sm font-semibold ${vsYesterday >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {vsYesterday >= 0 ? '+' : ''}{vsYesterday.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] sm:text-xs text-[var(--text-3)] mb-0.5">vs 7d</p>
            <p className={`text-xs sm:text-sm font-semibold ${vsLastWeek >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {vsLastWeek >= 0 ? '+' : ''}{vsLastWeek.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
