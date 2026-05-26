'use client'

import { useTheme } from '@/contexts/ThemeContext'

// Wrapper component for all demo pages — provides theme-aware base styles
// Use: <DemoPage title="Meseros"> ... </DemoPage>

interface DemoPageProps {
  title?: string
  subtitle?: string
  children: React.ReactNode
  headerRight?: React.ReactNode
}

export default function DemoPage({ title, subtitle, children, headerRight }: DemoPageProps) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <div className={`min-h-screen transition-colors ${isDark ? 'bg-[#0a0a0c] text-white' : 'bg-gray-50 text-gray-900'}`}>
      {(title || headerRight) && (
        <header className={`border-b px-6 py-4 flex items-center justify-between ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
          <div>
            {title && <h1 className="text-lg font-bold">{title}</h1>}
            {subtitle && <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{subtitle}</p>}
          </div>
          {headerRight}
        </header>
      )}
      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {children}
      </div>
    </div>
  )
}

// Theme-aware card component
export function DemoCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <div className={`rounded-2xl border p-5 ${isDark ? 'bg-white/[0.02] border-white/5' : 'bg-white border-gray-200 shadow-sm'} ${className}`}>
      {children}
    </div>
  )
}

// Theme-aware stat card
export function DemoStat({ label, value, change, icon }: { label: string; value: string; change?: number; icon?: React.ReactNode }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <div className={`rounded-2xl border p-5 ${isDark ? 'bg-white/[0.02] border-white/5' : 'bg-white border-gray-200 shadow-sm'}`}>
      <div className="flex items-center justify-between mb-3">
        {icon && <span className={isDark ? 'text-emerald-400' : 'text-emerald-600'}>{icon}</span>}
        {change !== undefined && change !== 0 && (
          <span className={`text-xs font-medium ${change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-gray-500'}`}>{label}</p>
    </div>
  )
}

// Theme-aware table
export function DemoTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={isDark ? 'border-b border-white/5' : 'border-b border-gray-200'}>
            {headers.map(h => (
              <th key={h} className={`text-left py-3 px-3 text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// Theme-aware table row
export function DemoTR({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <tr className={`${isDark ? 'border-b border-white/5 hover:bg-white/[0.02]' : 'border-b border-gray-100 hover:bg-gray-50'}`}>
      {children}
    </tr>
  )
}

// Theme-aware badge
export function DemoBadge({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'success' | 'warning' | 'danger' | 'default' }) {
  const colors = {
    success: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    danger: 'bg-red-500/10 text-red-500 border-red-500/20',
    default: 'bg-white/5 text-zinc-400 border-white/10',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors[variant]}`}>
      {children}
    </span>
  )
}

// Theme hook re-export for convenience
export { useTheme }
