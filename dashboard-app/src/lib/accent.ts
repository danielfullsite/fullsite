// Gap #1 del DS v1 — aplica el accent_color del tenant a los tokens del Design System.
// Solo VISUAL (setea CSS vars), cero lógica. AMALAY = 'emerald' → no-op (mismos valores).
// Otros tenants heredan su color sobre el mismo Core.

type Accent = { accent: string; bright: string; deep: string }

const ACCENTS: Record<string, Accent> = {
  emerald: { accent: '#10b981', bright: '#34d399', deep: '#059669' },
  blue:    { accent: '#3b82f6', bright: '#60a5fa', deep: '#2563eb' },
  violet:  { accent: '#8b5cf6', bright: '#a78bfa', deep: '#7c3aed' },
  rose:    { accent: '#f43f5e', bright: '#fb7185', deep: '#e11d48' },
  amber:   { accent: '#f59e0b', bright: '#fbbf24', deep: '#d97706' },
  teal:    { accent: '#14b8a6', bright: '#2dd4bf', deep: '#0d9488' },
  sky:     { accent: '#0ea5e9', bright: '#38bdf8', deep: '#0284c7' },
}

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/**
 * Aplica el acento del tenant a los tokens --accent* del DS.
 * Acepta un nombre ('emerald') o un hex ('#10b981'). Default: emerald.
 */
export function applyAccent(color: string | null | undefined): void {
  if (typeof document === 'undefined') return
  let a: Accent
  if (color && color.startsWith('#')) {
    a = { accent: color, bright: color, deep: color }
  } else {
    a = ACCENTS[(color || 'emerald').toLowerCase()] || ACCENTS.emerald
  }
  const s = document.documentElement.style
  s.setProperty('--accent', a.accent)
  s.setProperty('--accent-bright', a.bright)
  s.setProperty('--accent-deep', a.deep)
  s.setProperty('--accent-soft', hexToRgba(a.accent, 0.12))
  s.setProperty('--accent-line', hexToRgba(a.accent, 0.28))
}
