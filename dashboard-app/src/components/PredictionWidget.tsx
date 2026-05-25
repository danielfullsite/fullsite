'use client'

import { TrendingUp, TrendingDown, Target, Zap } from 'lucide-react'
import { formatCurrency } from '@/lib/format'

// Hourly distribution for a brunch/café (AMALAY pattern)
const HOURLY_DISTRIBUTION: Record<number, number> = {
  8:  0.02,
  9:  0.06,
  10: 0.12,
  11: 0.15,
  12: 0.16,
  13: 0.14,
  14: 0.10,
  15: 0.07,
  16: 0.06,
  17: 0.05,
  18: 0.04,
  19: 0.02,
  20: 0.01,
}

interface PredictionWidgetProps {
  currentVentas: number
  currentTickets: number
  yesterdayVentas: number
  lastWeekVentas: number
  dowAvgVentas: number
}

function predict(currentVentas: number): { projected: number; pctDone: number; remaining: number } {
  const now = new Date()
  // Mexico timezone offset (UTC-6)
  const mxHour = (now.getUTCHours() - 6 + 24) % 24
  const mxMinute = now.getUTCMinutes()

  if (currentVentas <= 0 || mxHour < 8) {
    return { projected: 0, pctDone: 0, remaining: 0 }
  }

  // Calculate percentage of day captured so far
  let pctCaptured = 0
  for (const [hour, pct] of Object.entries(HOURLY_DISTRIBUTION)) {
    const h = parseInt(hour)
    if (h < mxHour) {
      pctCaptured += pct
    } else if (h === mxHour) {
      pctCaptured += pct * (mxMinute / 60)
    }
  }

  if (pctCaptured <= 0) return { projected: 0, pctDone: 0, remaining: 0 }

  const projected = currentVentas / pctCaptured
  const remaining = projected - currentVentas
  const pctDone = pctCaptured * 100

  return { projected, pctDone, remaining }
}

export default function PredictionWidget({
  currentVentas,
  currentTickets,
  yesterdayVentas,
  lastWeekVentas,
  dowAvgVentas,
}: PredictionWidgetProps) {
  const { projected, pctDone, remaining } = predict(currentVentas)

  if (projected <= 0) return null

  const vsYesterday = yesterdayVentas > 0 ? ((projected - yesterdayVentas) / yesterdayVentas) * 100 : 0
  const vsLastWeek = lastWeekVentas > 0 ? ((projected - lastWeekVentas) / lastWeekVentas) * 100 : 0
  const vsDowAvg = dowAvgVentas > 0 ? ((projected - dowAvgVentas) / dowAvgVentas) * 100 : 0

  const isAboveAvg = vsDowAvg >= 0
  const mainComparison = dowAvgVentas > 0 ? vsDowAvg : vsYesterday
  const mainCompLabel = dowAvgVentas > 0 ? 'vs promedio del dia' : 'vs ayer'
  const isUp = mainComparison >= 0

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm mb-6">
      {/* Gradient accent bar */}
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{
          background: isAboveAvg
            ? 'linear-gradient(90deg, #10b981, #34d399)'
            : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
        }}
      />

      <div className="px-6 py-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isAboveAvg ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
              <Target className={`w-4 h-4 ${isAboveAvg ? 'text-emerald-500' : 'text-amber-500'}`} />
            </div>
            <div>
              <p className="text-xs font-medium text-[var(--text-3)] uppercase tracking-wider">Prediccion de cierre</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-[var(--text-3)]">
            <Zap className="w-3 h-3" />
            <span>Tiempo real</span>
          </div>
        </div>

        {/* Main prediction number */}
        <div className="flex items-end gap-4 mb-4">
          <p className="text-4xl font-bold text-[var(--text-1)] tracking-tight">
            {formatCurrency(projected)}
          </p>
          <div className={`flex items-center gap-1 text-sm font-semibold mb-1 ${isUp ? 'text-emerald-500' : 'text-amber-500'}`}>
            {isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span>{isUp ? '+' : ''}{mainComparison.toFixed(1)}%</span>
            <span className="text-[var(--text-3)] font-normal">{mainCompLabel}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-[var(--text-3)] mb-1.5">
            <span>Progreso del dia</span>
            <span>{pctDone.toFixed(0)}% completado</span>
          </div>
          <div className="w-full bg-[var(--line-soft)] rounded-full h-3 overflow-hidden">
            <div
              className="h-3 rounded-full transition-all duration-1000"
              style={{
                width: `${Math.min(pctDone, 100)}%`,
                background: isAboveAvg
                  ? 'linear-gradient(90deg, #10b981, #34d399)'
                  : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
              }}
            />
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 pt-3 border-t border-[var(--line-soft)]">
          <div>
            <p className="text-xs text-[var(--text-3)] mb-0.5">Falta por vender</p>
            <p className="text-sm font-semibold text-[var(--text-1)]">{formatCurrency(remaining)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-3)] mb-0.5">vs ayer</p>
            <p className={`text-sm font-semibold ${vsYesterday >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {vsYesterday >= 0 ? '+' : ''}{vsYesterday.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-3)] mb-0.5">vs semana pasada</p>
            <p className={`text-sm font-semibold ${vsLastWeek >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {vsLastWeek >= 0 ? '+' : ''}{vsLastWeek.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
