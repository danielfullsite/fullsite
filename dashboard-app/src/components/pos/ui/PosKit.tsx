'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Fullsite POS — UI Kit (sistema base del rediseño)
// "El POS que no se explica": touch-first (≥48px), color = navegación,
// estado se ve no se lee. Todo hereda de estas piezas. Usa los tokens reales
// de globals.css (--accent, --info, --warn, --crit, --surface-*, --text-*).
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react'
import { Plus, Minus } from 'lucide-react'

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
}: {
  variant?: BtnVariant; size?: 'md' | 'lg'; icon?: React.ReactNode; children: React.ReactNode
  onClick?: () => void; disabled?: boolean; full?: boolean; className?: string
}) {
  const sz = size === 'lg' ? 'min-h-[60px] text-[15px] px-6 rounded-2xl' : 'min-h-[48px] text-sm px-4 rounded-xl'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
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
