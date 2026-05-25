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
}

const iconStyles: Record<string, { bg: string; icon: string }> = {
  'kpi-accent-blue': { bg: 'bg-blue-500/10', icon: 'text-blue-400' },
  'kpi-accent-green': { bg: 'bg-emerald-500/10', icon: 'text-emerald-400' },
  'kpi-accent-amber': { bg: 'bg-amber-500/10', icon: 'text-amber-400' },
  'kpi-accent-purple': { bg: 'bg-purple-500/10', icon: 'text-purple-400' },
  'kpi-accent-pink': { bg: 'bg-pink-500/10', icon: 'text-pink-400' },
  'kpi-accent-cyan': { bg: 'bg-cyan-500/10', icon: 'text-cyan-400' },
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
}: KPICardProps) {
  const style = accentClass ? iconStyles[accentClass] || { bg: 'bg-[var(--surface-2)]', icon: 'text-[var(--text-3)]' } : { bg: 'bg-[var(--surface-2)]', icon: 'text-[var(--text-3)]' }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.02, y: -2 }}
      className="relative overflow-hidden rounded-2xl border border-[var(--accent-line)] p-5 transition-shadow"
      style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}
    >
      {/* Bisel emerald superior */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{ background: 'var(--bento-bevel)' }} />

      <div className="flex items-center gap-4">
        {Icon && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, delay: index * 0.06 + 0.1 }}
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${style.bg}`}
          >
            <Icon size={22} strokeWidth={1.8} className={style.icon} />
          </motion.div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.15em] font-mono text-[var(--text-3)] mb-1">{label}</p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: index * 0.06 + 0.15 }}
            className="text-2xl font-bold tracking-tight text-[var(--text-1)] tnum"
          >
            {value}
          </motion.p>
        </div>
      </div>
      {delta && (
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: index * 0.06 + 0.2 }}
          className="mt-3 flex items-center gap-1.5"
        >
          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
            deltaType === 'up' ? 'text-emerald-400' : deltaType === 'down' ? 'text-red-400' : 'text-[var(--text-3)]'
          }`}>
            {deltaType === 'up' && <TrendingUp size={13} />}
            {deltaType === 'down' && <TrendingDown size={13} />}
            {deltaType === 'neutral' && <Minus size={13} />}
            {delta}
          </span>
          {subtitle && <span className="text-[var(--text-4)] text-xs">{subtitle}</span>}
        </motion.div>
      )}
    </motion.div>
  )
}
