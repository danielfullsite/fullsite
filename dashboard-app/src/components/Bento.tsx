import { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Bento Panel — tarjeta con bisel emerald, inspirada en HAILO OS
 * Usa tokens CSS de globals.css (--bento-*, --shadow-*)
 */
export function Panel({
  title, actions, className, children,
}: {
  title?: string; actions?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-[var(--accent-line)] p-4 md:p-5',
        className
      )}
      style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}
    >
      {/* bisel luminoso superior — la firma visual */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{ background: 'var(--bento-bevel)' }} />
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 mb-4">
          {title && <h2 className="serif text-[15px] md:text-[17px] font-semibold">{title}</h2>}
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className="relative">{children}</div>
    </section>
  )
}

/**
 * Chip — pastilla de estado
 */
export function Chip({
  children, tone = 'neutral', className,
}: {
  children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'accent' | 'warn'; className?: string;
}) {
  const toneClasses = {
    neutral: 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)]',
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    bad: 'border-red-500/30 bg-red-500/10 text-red-400',
    accent: 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-bright)]',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  }[tone]
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] uppercase tracking-[0.15em] font-mono font-semibold',
      toneClasses, className
    )}>
      {children}
    </span>
  )
}

/**
 * StatCard — KPI card estilo bento
 */
export function StatCard({
  label, value, sub, tone = 'neutral',
}: {
  label: string; value: string; sub?: string; tone?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div
      className="rounded-2xl border border-[var(--accent-line)] p-4"
      style={{ background: 'var(--bento-card)', boxShadow: 'var(--shadow-mid)' }}
    >
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-[var(--text-3)] mb-1">{label}</div>
      <div className="text-[24px] font-bold tabular-nums tracking-tight">{value}</div>
      {sub && (
        <div className={cn('text-xs mt-1', {
          'text-emerald-400': tone === 'up',
          'text-red-400': tone === 'down',
          'text-[var(--text-3)]': tone === 'neutral',
        })}>
          {sub}
        </div>
      )}
    </div>
  )
}
