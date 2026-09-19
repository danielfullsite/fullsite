'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Fullsite POS — UI Kit (sistema base del rediseño)
// "El POS que no se explica": touch-first (≥48px), color = navegación,
// estado se ve no se lee. Todo hereda de estas piezas. Usa los tokens reales
// de globals.css (--accent, --info, --warn, --crit, --surface-*, --text-*).
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react'
import { Plus, Minus } from 'lucide-react'
import { Dialog, type DialogProps } from '@/components/ui/Dialog'

// ── Sistema de color por categoría (color = navegación) ──────────────────────
export const CAT_COLORS = {
  cafe:   { grad: 'linear-gradient(135deg,#a8703a,#c78a4a)', ink: '#d3a06a', line: 'rgba(168,112,58,.5)', soft: 'rgba(168,112,58,.16)' },
  cocina: { grad: 'linear-gradient(135deg,#2e9e5b,#3fb56d)', ink: '#5cd08a', line: 'rgba(46,158,91,.5)',  soft: 'rgba(46,158,91,.14)' },
  postre: { grad: 'linear-gradient(135deg,#e07b39,#f0954f)', ink: '#f0a878', line: 'rgba(224,123,57,.5)', soft: 'rgba(224,123,57,.14)' },
  te:     { grad: 'linear-gradient(135deg,#8b5cf6,#a17bf8)', ink: '#b39bf7', line: 'rgba(139,92,246,.5)', soft: 'rgba(139,92,246,.14)' },
  agua:   { grad: 'linear-gradient(135deg,#3b82f6,#5b9bf8)', ink: '#89b4f7', line: 'rgba(59,130,246,.5)', soft: 'rgba(59,130,246,.14)' },
  bar:    { grad: 'linear-gradient(135deg,#ec4899,#f472b6)', ink: '#f8a8ce', line: 'rgba(236,72,153,.5)', soft: 'rgba(236,72,153,.14)' },
} as const
export type CatKey = keyof typeof CAT_COLORS

// ── Botón de acción ──────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'info' | 'ghost' | 'danger'
const BTN_STYLE: Record<BtnVariant, React.CSSProperties> = {
  primary: { background: 'linear-gradient(180deg,var(--accent-bright),var(--accent))', color: '#052018', borderColor: 'transparent', boxShadow: '0 6px 16px rgba(16,185,129,.28)' },
  info:    { background: 'linear-gradient(180deg,#5cc9fb,var(--info))', color: '#062430', borderColor: 'transparent' },
  ghost:   { background: 'var(--surface-2)', color: 'var(--text-1)', borderColor: 'var(--line)' },
  danger:  { background: 'var(--crit-soft)', color: 'var(--crit-ink,#fda4af)', borderColor: 'rgba(245,69,92,.3)' },
}
export function PosButton({
  variant = 'primary', size = 'md', icon, children, onClick, disabled, full, className = '',
  ariaLabel, title, type = 'button',
}: {
  variant?: BtnVariant; size?: 'md' | 'lg'; icon?: React.ReactNode; children?: React.ReactNode
  onClick?: () => void; disabled?: boolean; full?: boolean; className?: string
  /** Obligatorio cuando el botón es sólo icono: sin esto es un botón anónimo. */
  ariaLabel?: string; title?: string; type?: 'button' | 'submit'
}) {
  const sz = size === 'lg' ? 'min-h-[60px] text-[15px] px-6 rounded-2xl' : 'min-h-[48px] text-sm px-4 rounded-xl'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`inline-flex items-center justify-center gap-2 font-bold border transition-transform active:scale-[.97] disabled:opacity-40 disabled:pointer-events-none ${sz} ${full ? 'w-full' : ''} ${className}`}
      style={BTN_STYLE[variant]}
    >
      {icon}{children}
    </button>
  )
}

// ── Chip de categoría (rail) ─────────────────────────────────────────────────
export function CategoryChip({
  catKey, icon, label, active = false, onClick,
}: { catKey: CatKey; icon?: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  const c = CAT_COLORS[catKey]
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 font-bold text-sm rounded-xl px-3 min-h-[52px] transition-transform active:scale-95"
      style={{
        borderLeft: `3px solid ${active ? c.ink : c.line}`,
        background: active ? c.soft : 'var(--surface-2)',
        color: c.ink,
        opacity: active ? 1 : 0.85,
      }}
    >
      {icon}<span className="truncate">{label}</span>
    </button>
  )
}

// ── Tile de producto ─────────────────────────────────────────────────────────
export function ProductTile({
  catKey, icon, name, price, onClick,
}: { catKey: CatKey; icon?: React.ReactNode; name: string; price?: number; onClick?: () => void }) {
  const c = CAT_COLORS[catKey]
  return (
    <button
      onClick={onClick}
      className="rounded-xl px-2 py-3 min-h-[72px] flex flex-col items-center justify-center gap-1 text-center font-bold text-white text-xs leading-tight transition-transform active:scale-95"
      style={{ background: c.grad, boxShadow: '0 2px 8px rgba(0,0,0,.3)' }}
    >
      {icon && <span className="opacity-90">{icon}</span>}
      <span className="text-balance">{name}</span>
      {price != null && <span className="opacity-80 text-[11px] font-mono tabular-nums">${price}</span>}
    </button>
  )
}

// ── Stepper de cantidad ──────────────────────────────────────────────────────
export function Stepper({ value, onDec, onInc }: { value: number; onDec: () => void; onInc: () => void }) {
  return (
    <div className="inline-flex items-center rounded-xl overflow-hidden border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
      <button onClick={onDec} aria-label="Menos" className="w-11 h-12 flex items-center justify-center active:scale-90 transition-transform" style={{ color: 'var(--text-1)' }}><Minus size={16} /></button>
      <span className="w-10 text-center font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{value}</span>
      <button onClick={onInc} aria-label="Más" className="w-11 h-12 flex items-center justify-center active:scale-90 transition-transform" style={{ color: 'var(--text-1)' }}><Plus size={16} /></button>
    </div>
  )
}

// ── Pastilla de estado (estado se ve, no se lee) ─────────────────────────────
export type Tone = 'occ' | 'free' | 'bill' | 'off' | 'neutral'
const TONE_STYLE: Record<Tone, React.CSSProperties> = {
  occ:     { background: 'var(--info-soft)',   color: 'var(--info)',          borderColor: 'rgba(56,189,248,.35)' },
  free:    { background: 'var(--accent-soft)', color: 'var(--accent-bright)', borderColor: 'var(--accent-line)' },
  bill:    { background: 'var(--warn-soft)',   color: 'var(--warn)',          borderColor: 'rgba(245,165,36,.35)' },
  off:     { background: 'var(--crit-soft)',   color: 'var(--crit)',          borderColor: 'rgba(245,69,92,.35)' },
  neutral: { background: 'var(--surface-2)',   color: 'var(--text-2)',        borderColor: 'var(--line)' },
}
export function StatusPill({ tone = 'neutral', icon, children, pulse = false }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode; pulse?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold rounded-full px-2.5 py-1 border ${pulse ? 'animate-pulse' : ''}`} style={TONE_STYLE[tone]}>
      {icon}{children}
    </span>
  )
}

// ── Botón de monto rápido (cobro) ────────────────────────────────────────────
export function QuickAmount({ label, accent = false, onClick }: { label: string; accent?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="min-h-[56px] min-w-[80px] rounded-xl border font-bold text-[15px] flex items-center justify-center transition-transform active:scale-95"
      style={{ background: 'var(--surface-2)', color: accent ? 'var(--accent-bright)' : 'var(--text-1)', borderColor: accent ? 'var(--accent-line)' : 'var(--line)' }}
    >
      {label}
    </button>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// FASE 1 DEL REDISEÑO V2 — primitivas de dato y de hoja.
//
// Salen del artifact aprobado (`.sheet/.card`, `.row/.list`, `.card-stat`,
// `.tag`, `.pill`, `#actions/.act`, `.keypad/.key`) y sólo usan tokens de
// globals.css. Ninguna toca estado de negocio: reciben props y pintan.
// ═════════════════════════════════════════════════════════════════════════════

/** Tonos de DATO — distintos de `Tone`, que describe el estado de una mesa. */
export type DataTone = 'ok' | 'info' | 'warn' | 'bad' | 'neutral'

const DATA_TONE: Record<DataTone, { ink: string; soft: string; line: string }> = {
  ok:      { ink: 'var(--accent-bright)', soft: 'var(--accent-soft)', line: 'var(--accent-line)' },
  info:    { ink: 'var(--info)',          soft: 'var(--info-soft)',   line: 'rgba(56,189,248,.30)' },
  warn:    { ink: 'var(--warn)',          soft: 'var(--warn-soft)',   line: 'rgba(245,165,36,.30)' },
  bad:     { ink: 'var(--crit-ink)',      soft: 'var(--crit-soft)',   line: 'rgba(245,69,92,.32)' },
  neutral: { ink: 'var(--text-3)',        soft: 'var(--surface-2)',   line: 'var(--line)' },
}

// ── Tag ──────────────────────────────────────────────────────────────────────
/** Etiqueta corta de clasificación. Es un `<span>`: si algo se toca, es un botón. */
export function Tag({
  tone = 'neutral', icon, children, className = '', title,
}: { tone?: DataTone; icon?: React.ReactNode; children: React.ReactNode; className?: string; title?: string }) {
  const t = DATA_TONE[tone]
  return (
    <span
      title={title}
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full border whitespace-nowrap text-[10.5px] font-extrabold uppercase tracking-[.04em] ${className}`}
      style={{ background: t.soft, color: t.ink, borderColor: t.line }}
    >
      {icon}{children}
    </span>
  )
}

// ── Pill ─────────────────────────────────────────────────────────────────────
export type PillState = 'on' | 'off' | 'warn' | 'neutral'
const PILL_TONE: Record<PillState, DataTone> = { on: 'ok', off: 'bad', warn: 'warn', neutral: 'neutral' }

/**
 * Indicador de estado de la barra superior (red, cocina, turno). Mono y en
 * mayúsculas porque se lee de reojo, no se lee de verdad.
 */
export function Pill({
  state = 'neutral', dot = true, icon, children, pulse = false, onClick, title,
}: {
  state?: PillState; dot?: boolean; icon?: React.ReactNode; children: React.ReactNode
  pulse?: boolean; onClick?: () => void; title?: string
}) {
  const t = DATA_TONE[PILL_TONE[state]]
  const body = (
    <>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: 'currentColor' }} />}
      {icon}{children}
    </>
  )
  const cls = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border font-mono text-[11px] font-semibold uppercase tracking-[.04em] whitespace-nowrap'
  const style = { background: t.soft, color: t.ink, borderColor: t.line }
  if (!onClick) return <span data-state={state} title={title} className={cls} style={style}>{body}</span>
  return (
    <button type="button" onClick={onClick} data-state={state} title={title}
      className={`${cls} transition-transform active:scale-95`} style={style}>
      {body}
    </button>
  )
}

// ── CardStat ─────────────────────────────────────────────────────────────────
/** Tarjeta de un solo número. Etiqueta arriba, número grande, nota abajo. */
export function CardStat({
  label, value, note, tone = 'neutral', valueSize = 26, className = '',
}: {
  label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode
  tone?: DataTone; valueSize?: number; className?: string
}) {
  const ink = tone === 'neutral' ? 'var(--text-1)' : DATA_TONE[tone].ink
  return (
    <div className={`rounded-2xl border px-4 py-3.5 ${className}`} style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="text-[10px] font-extrabold uppercase tracking-[.12em]" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="font-black tabular-nums mt-1 leading-none" style={{ color: ink, fontSize: valueSize, letterSpacing: '-.035em' }}>{value}</div>
      {note != null && <div className="text-[11.5px] font-semibold mt-1" style={{ color: 'var(--text-3)' }}>{note}</div>}
    </div>
  )
}

// ── List / Row ───────────────────────────────────────────────────────────────
/** Contenedor de lista densa. Scrollea él, no la página. */
export function List({
  children, className = '', style, 'data-testid': testId,
}: { children: React.ReactNode; className?: string; style?: React.CSSProperties; 'data-testid'?: string }) {
  return (
    <div
      data-testid={testId}
      className={`overflow-y-auto min-h-0 rounded-2xl border ${className}`}
      style={{ borderColor: 'var(--line)', background: 'var(--panel)', overscrollBehavior: 'contain', ...style }}
    >
      {children}
    </div>
  )
}

/**
 * Renglón de lista. Con `onClick` se renderiza como `<button>` — no como un div
 * con handler — para que llegue por teclado y lo anuncie un lector de pantalla.
 */
export function Row({
  columns = '1fr auto', tone, onClick, children, className = '', style, title, 'data-testid': testId,
}: {
  columns?: string; tone?: DataTone; onClick?: () => void; children: React.ReactNode
  className?: string; style?: React.CSSProperties; title?: string; 'data-testid'?: string
}) {
  const accent = tone ? DATA_TONE[tone] : null
  const base: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: columns, alignItems: 'center', gap: 12,
    borderBottom: '1px solid var(--line-soft)',
    ...(accent ? { borderLeft: `2px solid ${accent.ink}`, background: accent.soft } : null),
    ...style,
  }
  const cls = `w-full text-left px-3.5 py-2.5 last:border-b-0 ${onClick ? 'transition-colors hover:bg-[var(--surface-2)]' : ''} ${className}`
  if (!onClick) return <div data-testid={testId} title={title} className={cls} style={base}>{children}</div>
  return (
    <button type="button" onClick={onClick} data-testid={testId} title={title} className={cls} style={base}>
      {children}
    </button>
  )
}

/** Celda de dos renglones (título + apoyo). Es el 90 % de las celdas del POS. */
export function RowText({ title, sub, className = '' }: { title: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="font-bold text-sm truncate" style={{ color: 'var(--text-1)' }}>{title}</div>
      {sub != null && <div className="text-[11.5px] font-semibold mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  )
}

// ── ActionBar ────────────────────────────────────────────────────────────────
/**
 * Banda de acción inferior. Altura fija y columnas declaradas: los verbos
 * conservan su posición entre pantallas — lo destructivo a la izquierda, lo
 * principal a la derecha — para que el dedo aprenda dónde están.
 */
export function ActionBar({
  columns = '1fr', children, className = '',
}: { columns?: string; children: React.ReactNode; className?: string }) {
  return (
    <footer
      className={`flex-shrink-0 grid items-center gap-2.5 px-3.5 border-t ${className}`}
      style={{ gridTemplateColumns: columns, height: 78, borderColor: 'var(--line)', background: 'var(--surface-2)' }}
    >
      {children}
    </footer>
  )
}

// ── Keypad ───────────────────────────────────────────────────────────────────
/**
 * Teclado numérico de 3 columnas. No guarda estado: emite dígitos y deja las
 * dos teclas de función a quien lo usa (Exacto/Limpiar, ←/Confirmar…).
 */
export function Keypad({
  onDigit, left, right, className = '',
}: {
  onDigit: (digit: string) => void
  left?: { label: React.ReactNode; onPress: () => void }
  right?: { label: React.ReactNode; onPress: () => void }
  className?: string
}) {
  const key = 'rounded-xl border font-mono text-[21px] font-bold grid place-items-center transition-transform active:scale-95'
  const style = { height: 58, background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-1)' }
  const fnStyle = { ...style, color: 'var(--text-3)' }
  return (
    <div className={`grid grid-cols-3 gap-2 content-start ${className}`} role="group" aria-label="Teclado numérico">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
        <button key={d} type="button" onClick={() => onDigit(d)} className={key} style={style}>{d}</button>
      ))}
      {left
        ? <button type="button" onClick={left.onPress} className={`${key} !text-[13px] font-sans font-extrabold`} style={fnStyle}>{left.label}</button>
        : <span />}
      <button type="button" onClick={() => onDigit('0')} className={key} style={style}>0</button>
      {right
        ? <button type="button" onClick={right.onPress} className={`${key} !text-[13px] font-sans font-extrabold`} style={fnStyle}>{right.label}</button>
        : <span />}
    </div>
  )
}

// ── Sheet ────────────────────────────────────────────────────────────────────
const SHEET_SIZE = { md: 'max-w-[820px]', wide: 'max-w-[1060px]', full: 'max-w-[1280px]' } as const
export type SheetSize = keyof typeof SHEET_SIZE

/**
 * Hoja modal del POS.
 *
 * Envuelve `<Dialog>` — NO reimplementa el modal. Todo lo que Dialog ya
 * resuelve (trampa de foco, ESC por pila, bloqueo de scroll, `aria-modal`,
 * quedarse dentro de `.pos-kiosk`) sigue vivo; esto sólo le pone la piel del
 * artifact: tamaños del rediseño, cabecera con subtítulo, cuerpo scrolleable y
 * pie fijo.
 */
export function Sheet({
  open, onClose, title, subtitle, size = 'md', footer, children,
  dismissible, scrollBody = true, layer, 'data-testid': testId,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  size?: SheetSize
  footer?: React.ReactNode
  children: React.ReactNode
  dismissible?: DialogProps['dismissible']
  /** `false` para hojas que manejan su propio scroll interno (editor de plano). */
  scrollBody?: boolean
  layer?: DialogProps['layer']
  'data-testid'?: string
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      dismissible={dismissible}
      size={SHEET_SIZE[size]}
      height={size === 'full' ? 'full' : 'auto'}
      layout="flex-column"
      fatScroll
      backdrop="dim-blur"
      closeButtonSize="touch"
      layer={layer}
      panelClassName="rounded-[22px]"
      bodyClassName={scrollBody ? '' : 'overflow-hidden'}
      footer={footer}
      data-testid={testId}
    >
      {children}
    </Dialog>
  )
}
