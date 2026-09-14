'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Teclado numérico del punto de venta.
//
// Existe porque en una caja NO hay teclado físico, y hoy las pantallas de
// dinero —fondo de caja, cobro, descuento— usan un `<input type="number">`
// con su flechita de 12 px. Contar el efectivo de un turno tocando una flecha
// de doce píxeles es como pedir que se equivoquen.
//
// Reglas que trae:
//   · tecla de 64 px, por encima del mínimo de 56 del sistema
//   · el monto se lee en monoespaciada grande, no en un campo de formulario
//   · montos rápidos, porque el fondo de caja casi siempre es redondo
//   · el teclado FÍSICO también funciona: si la terminal tiene uno, se usa
//
// No sabe de dinero ni de turnos: recibe un valor y avisa cuando cambia.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useCallback } from 'react'
import { Delete } from 'lucide-react'

export function PosNumPad({
  valor, onValor, onConfirmar, rapidos, decimales = true, className = '',
}: {
  valor: string
  onValor: (v: string) => void
  onConfirmar?: () => void
  /** Montos de un toque. En blanco, no se pinta la franja. */
  rapidos?: number[]
  decimales?: boolean
  className?: string
}) {
  const teclear = useCallback((d: string) => {
    if (d === '.') {
      if (!decimales || valor.includes('.')) return
      onValor((valor || '0') + '.')
      return
    }
    // Dos decimales y ya: un fondo de caja no lleva milésimas.
    const [, dec] = valor.split('.')
    if (dec !== undefined && dec.length >= 2) return
    if (valor === '0') { onValor(d); return }
    onValor(valor + d)
  }, [valor, onValor, decimales])

  const borrar = useCallback(() => onValor(valor.slice(0, -1)), [valor, onValor])

  // El teclado físico, si la terminal lo tiene. Muchas cajas traen uno y hoy
  // no servía de nada en estas pantallas.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); teclear(e.key) }
      else if (e.key === '.' || e.key === ',') { e.preventDefault(); teclear('.') }
      else if (e.key === 'Backspace') { e.preventDefault(); borrar() }
      else if (e.key === 'Enter' && onConfirmar) { e.preventDefault(); onConfirmar() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [teclear, borrar, onConfirmar])

  const tecla = (contenido: React.ReactNode, alTocar: () => void, extra = '') => (
    <button
      onClick={alTocar}
      className={`min-h-[64px] rounded-2xl font-bold text-2xl flex items-center justify-center transition-transform active:scale-[0.94] ${extra}`}
      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
    >
      {contenido}
    </button>
  )

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {rapidos && rapidos.length > 0 && (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${rapidos.length}, minmax(0,1fr))` }}>
          {rapidos.map(n => (
            <button
              key={n}
              onClick={() => onValor(String(n))}
              className="min-h-[56px] rounded-xl font-bold text-[15px] font-mono tabular-nums transition-transform active:scale-95"
              style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', color: 'var(--accent-ink)' }}
            >
              ${n.toLocaleString('es-MX')}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {['1','2','3','4','5','6','7','8','9'].map(d => tecla(d, () => teclear(d)))}
        {decimales
          ? tecla('.', () => teclear('.'))
          : tecla('00', () => { teclear('0'); teclear('0') })}
        {tecla('0', () => teclear('0'))}
        {tecla(<Delete size={24} />, borrar)}
      </div>
    </div>
  )
}

/** El monto, grande y en monoespaciada. Un número que se lee de reojo. */
export function PosMonto({ valor, etiqueta }: { valor: string; etiqueta?: string }) {
  const n = parseFloat(valor || '0') || 0
  return (
    <div className="text-center">
      {etiqueta && (
        <p className="text-[11px] font-black uppercase tracking-[0.09em] mb-1.5" style={{ color: 'var(--text-4)' }}>
          {etiqueta}
        </p>
      )}
      <p
        className="font-mono tabular-nums font-black leading-none"
        style={{ fontSize: 'clamp(34px, 7vw, 54px)', color: valor ? 'var(--text-1)' : 'var(--text-4)' }}
      >
        ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  )
}
