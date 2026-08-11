'use client'

import { createContext, useCallback, useContext, useState, ReactNode } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react'

// Control Plane · UI feedback DS v2 (ambos temas):
//   - Toasts de éxito/error para las escrituras cross-tenant.
//   - Modal de confirmación para acciones GLOBALES o destructivas
//     ("Esto afecta a N tenants — confirmar").
// Se usa vía useToast() y <ConfirmModal/>. Sin dependencias ad-hoc: solo tokens del DS.

// ── Toasts ───────────────────────────────────────────────────────────────────
interface Toast { id: number; kind: 'success' | 'error'; msg: string }
const ToastCtx = createContext<(kind: 'success' | 'error', msg: string) => void>(() => {})

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: 'success' | 'error', msg: string) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, kind, msg }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500)
  }, [])

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 shadow-lg text-sm ${
              t.kind === 'success'
                ? 'border-emerald-500/30 bg-[var(--surface)] text-[var(--text-1)]'
                : 'border-red-500/30 bg-[var(--surface)] text-[var(--text-1)]'
            }`}
          >
            {t.kind === 'success'
              ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
              : <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />}
            <span className="flex-1">{t.msg}</span>
            <button
              onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}
              className="text-[var(--text-4)] hover:text-[var(--text-2)]"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ── Confirm modal (global / destructive) ──────────────────────────────────────
export function ConfirmModal({
  open,
  title,
  message,
  affected,
  confirmLabel = 'Confirmar',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  affected?: number
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--bg)] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--line)] flex items-center gap-3">
          <AlertTriangle size={18} className="text-amber-500" />
          <div className="font-bold text-[var(--text-1)]">{title}</div>
        </div>
        <div className="p-5 space-y-3">
          {typeof affected === 'number' && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-[var(--text-1)]">
              Esto afecta a <b className="tabular-nums">{affected}</b> {affected === 1 ? 'tenant' : 'tenants'} — confirmar.
            </div>
          )}
          {message && <p className="text-sm text-[var(--text-2)] leading-relaxed">{message}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] text-sm font-semibold hover:text-[var(--text-1)] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[#04120c] text-sm font-bold hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
            >
              {busy && <span className="w-3.5 h-3.5 border-2 border-[#04120c] border-t-transparent rounded-full animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
