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
  'kpi-accent-blue': { bg: 'bg-blue-100', icon: 'text-blue-600' },
  'kpi-accent-green': { bg: 'bg-emerald-100', icon: 'text-emerald-600' },
  'kpi-accent-amber': { bg: 'bg-amber-100', icon: 'text-amber-600' },
  'kpi-accent-purple': { bg: 'bg-purple-100', icon: 'text-purple-600' },
  'kpi-accent-pink': { bg: 'bg-pink-100', icon: 'text-pink-600' },
  'kpi-accent-cyan': { bg: 'bg-cyan-100', icon: 'text-cyan-600' },
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
  const style = accentClass ? iconStyles[accentClass] || { bg: 'bg-slate-100', icon: 'text-slate-500' } : { bg: 'bg-slate-100', icon: 'text-slate-500' }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ scale: 1.02, y: -2 }}
      className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-4">
        {Icon && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3, delay: index * 0.06 + 0.1 }}
            className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${style.bg}`}
          >
            <Icon size={22} strokeWidth={1.8} className={style.icon} />
          </motion.div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-500 font-medium mb-0.5">{label}</p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: index * 0.06 + 0.15 }}
            className="text-2xl font-bold tracking-tight text-slate-900"
            style={{ fontVariantNumeric: 'tabular-nums' }}
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
            deltaType === 'up' ? 'text-emerald-600' : deltaType === 'down' ? 'text-red-500' : 'text-slate-400'
          }`}>
            {deltaType === 'up' && <TrendingUp size={13} />}
            {deltaType === 'down' && <TrendingDown size={13} />}
            {deltaType === 'neutral' && <Minus size={13} />}
            {delta}
          </span>
          {subtitle && <span className="text-slate-400 text-xs">{subtitle}</span>}
        </motion.div>
      )}
    </motion.div>
  )
}
