'use client'

import { TrendingUp, TrendingDown, Minus, LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'

interface KPICardProps {
  label: string
  value: string
  delta?: string
  deltaType?: 'up' | 'down' | 'neutral'
  subtitle?: string
  icon?: LucideIcon
  accentClass?: string
  index?: number
  sparklineData?: number[]
  weekChange?: number | null
}

const iconStyles: Record<string, { bg: string; icon: string; borderColor: string; spark: string }> = {
  'kpi-accent-blue': { bg: 'bg-blue-500/15', icon: 'text-blue-500', borderColor: 'border-blue-500/30', spark: '#3b82f6' },
  'kpi-accent-green': { bg: 'bg-emerald-500/15', icon: 'text-emerald-500', borderColor: 'border-emerald-500/30', spark: '#10b981' },
  'kpi-accent-amber': { bg: 'bg-amber-500/15', icon: 'text-amber-500', borderColor: 'border-amber-500/30', spark: '#f59e0b' },
  'kpi-accent-purple': { bg: 'bg-purple-500/15', icon: 'text-purple-500', borderColor: 'border-purple-500/30', spark: '#a855f7' },
  'kpi-accent-pink': { bg: 'bg-pink-500/15', icon: 'text-pink-500', borderColor: 'border-pink-500/30', spark: '#ec4899' },
  'kpi-accent-cyan': { bg: 'bg-cyan-500/15', icon: 'text-cyan-500', borderColor: 'border-cyan-500/30', spark: '#06b6d4' },
}

function Sparkline({ data, color }: { data: number[]; color?: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 72, h = 26
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ')
  const trending = data[data.length - 1] > data[0]
  const c = color || (data[data.length - 1] === data[0] ? 'var(--text-3)' : trending ? 'var(--accent)' : 'var(--crit)')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block" aria-hidden="true">
      <polyline points={points} fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function KPICard({
  label,
  value,
  delta,
  deltaType = 'neutral',
  subtitle,
  icon: Icon,
  accentClass,
  index = 0,
  sparklineData,
  weekChange,
}: KPICardProps) {
  const defaults = { bg: 'bg-[var(--surface-2)]', icon: 'text-[var(--text-3)]', borderColor: 'border-[var(--accent-line)]', spark: undefined as string | undefined }
  const style = accentClass ? iconStyles[accentClass] || defaults : defaults

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.02, y: -2 }}
      className={`relative overflow-hidden rounded-[14px] border ${style.borderColor} sm:border-[var(--line)] p-3 sm:p-4 transition-shadow`}
      style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-soft)' }}
    >
      {/* Bisel superior coloreado en mobile */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[2px] sm:h-px pointer-events-none sm:hidden"
        style={{ background: 'var(--bento-bevel)' }} />

      {/* ── MOBILE LAYOUT ── */}
      <div className="sm:hidden">
        <div className="flex items-start gap-2.5">
          {Icon && (
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${style.bg}`}>
              <Icon size={20} strokeWidth={1.8} className={style.icon} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[9px] uppercase tracking-[0.12em] font-mono text-[var(--text-3)] mb-0.5">{label}</p>
            <p className="text-[22px] font-black tracking-tight text-[var(--text-1)] leading-tight tnum">{value}</p>
          </div>
        </div>
        {/* Single compact delta */}
        {weekChange !== undefined && weekChange !== null && (
          <div className={`mt-2 flex items-center gap-1 text-[11px] font-bold ${
            weekChange > 0 ? 'text-[var(--ok-ink)]' : weekChange < 0 ? 'text-[var(--crit-ink)]' : 'text-[var(--text-4)]'
          }`}>
            {weekChange >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            <span>{weekChange > 0 ? '+' : ''}{weekChange.toFixed(1)}% 7d</span>
          </div>
        )}
      </div>

      {/* ── DESKTOP LAYOUT ── (matches DS v2 .kpi: label+icon top-left, sparkline top-right, mono value, delta, weekChange) */}
      <div className="hidden sm:block">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-[7px] min-w-0">
            {Icon && (
              <motion.span
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, delay: index * 0.06 + 0.1 }}
                className={`w-[34px] h-[34px] rounded-[10px] grid place-items-center shrink-0 ${style.bg}`}
              >
                <Icon size={17} strokeWidth={2} className={style.icon} />
              </motion.span>
            )}
            <span className="text-[10px] uppercase tracking-[0.13em] font-mono text-[var(--text-3)] leading-tight">{label}</span>
          </div>
          {sparklineData && sparklineData.length >= 2 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: index * 0.06 + 0.2 }}
              className="shrink-0"
            >
              <Sparkline data={sparklineData} color={style.spark} />
            </motion.div>
          )}
        </div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: index * 0.06 + 0.15 }}
          className="text-[26px] font-extrabold tracking-[-0.02em] text-[var(--text-1)] tnum mt-[9px] leading-none"
        >
          {value}
        </motion.p>
        {delta && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: index * 0.06 + 0.2 }}
            className="mt-[5px] flex items-center gap-1.5"
          >
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
              deltaType === 'up' ? 'text-[var(--accent-ink)]' : deltaType === 'down' ? 'text-[var(--crit-ink)]' : 'text-[var(--text-3)]'
            }`}>
              {deltaType === 'up' && <TrendingUp size={13} />}
              {deltaType === 'down' && <TrendingDown size={13} />}
              {deltaType === 'neutral' && <Minus size={13} />}
              {delta}
            </span>
            {subtitle && <span className="text-[var(--text-4)] text-xs">{subtitle}</span>}
          </motion.div>
        )}
        {weekChange !== undefined && weekChange !== null && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: index * 0.06 + 0.22 }}
            className={`text-[11px] font-semibold mt-1 ${
              weekChange > 0 ? 'text-[var(--accent-ink)]' : weekChange < 0 ? 'text-[var(--crit-ink)]' : 'text-[var(--text-4)]'
            }`}
          >
            {weekChange > 0 ? '+' : ''}{weekChange.toFixed(1)}% vs semana pasada
          </motion.p>
        )}
      </div>
    </motion.div>
  )
}
