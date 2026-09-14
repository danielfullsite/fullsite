'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Renglón de la cuenta — segundo componente del port del rediseño.
//
// Mismo contrato que PosProductTile: con `v2` apagada devuelve EXACTAMENTE el
// marcado que había en pos/page.tsx. Apagarla es el rollback.
//
// El componente es tonto a propósito. No sabe de permisos, de caja bloqueada
// ni de PIN de gerente: recibe banderas ya resueltas y funciones que llamar.
// Toda esa lógica se queda en pos/page.tsx, que es donde vive y donde se
// entiende. Un componente de presentación que decide quién puede cancelar es
// un componente que hay que auditar dos veces.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react'
import { Minus, Plus, Pencil, Ban, ArrowRightLeft, Lock } from 'lucide-react'

export type PosOrderRowProps = {
  nombre: string
  cantidad: number
  /** Ya formateado por el padre — este componente no sabe de monedas. */
  subtotalFmt: string
  silla: number
  modificadores: string[]
  notas?: string
  // Estado, ya resuelto
  isCancelled: boolean
  isVoided: boolean
  isSent: boolean
  isFlashing: boolean
  kdsDone: boolean
  sinComanda: boolean
  // Lo que esta persona puede hacer, ya resuelto
  puedeCancelar: boolean
  // Qué hacer
  onDec: () => void
  onInc: () => void
  onCycleSilla: () => void
  onEdit: () => void
  onTransfer: () => void
  onCancel: () => void
  v2: boolean
}

/** Los modificadores traen el precio pegado («sin cebolla +$15»); ese precio
 *  se pinta distinto para que se vea que cuesta. */
function Modificadores({ mods }: { mods: string[] }) {
  return (
    <>
      {mods.map((mod, mi, arr) => {
        const parts = String(mod).split(/(\+\$[\d,.]+)/g)
        return (
          <span key={mi}>
            {parts.map((p, pi) => /^\+\$/.test(p)
              ? <span key={pi} className="text-[var(--accent-ink)] font-semibold font-mono tabular-nums">{p}</span>
              : <span key={pi}>{p}</span>)}
            {mi < arr.length - 1 ? ' · ' : ''}
          </span>
        )
      })}
    </>
  )
}

export function PosOrderRow(p: PosOrderRowProps) {
  const { nombre, cantidad, subtotalFmt, silla, modificadores, notas,
          isCancelled, isVoided, isSent, isFlashing, kdsDone, sinComanda,
          puedeCancelar, onDec, onInc, onCycleSilla, onEdit, onTransfer, onCancel, v2 } = p
  const mods = modificadores || []

  // ── Antes del rediseño ─────────────────────────────────────────────────────
  if (!v2) {
    return (
      <div
        className={`flex items-center gap-2 py-1.5 px-2.5 rounded-[12px] transition-all ${
          isVoided
            ? 'bg-[var(--surface-2)] border border-[var(--line)] opacity-40'
            : isCancelled
            ? 'bg-[var(--crit-soft)] border border-[color-mix(in_srgb,var(--crit)_40%,transparent)] opacity-60'
            : isFlashing
            ? 'ring-2 ring-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent-line)]'
            : 'bg-[var(--surface-2)] border border-[var(--line)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)]'
        }`}
      >
        <div className="flex items-center gap-0.5">
          <button
            onClick={(e) => { e.stopPropagation(); onDec() }}
            disabled={isCancelled || isVoided || isSent}
            className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
          >
            <Minus size={18} />
          </button>
          <span className={`w-7 text-center font-bold text-lg font-mono tabular-nums ${isSent ? 'text-[var(--text-3)]' : ''}`}>
            {cantidad}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onInc() }}
            disabled={isCancelled || isVoided || isSent}
            className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[var(--text-1)]"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="flex-1 min-w-[90px]">
          <p className={`font-medium text-sm leading-tight break-words line-clamp-2 ${isVoided ? 'line-through text-[var(--text-4)]' : isCancelled ? 'line-through text-[var(--crit-ink)]' : ''}`} title={nombre}>
            {nombre}
          </p>
          {!isCancelled && !isVoided && (kdsDone || sinComanda) && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {kdsDone && (
                <span className="inline-flex items-center bg-[var(--accent-soft)] text-[var(--accent-ink)] border border-[var(--accent-line)] text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">LISTO</span>
              )}
              {sinComanda && (
                <span className="inline-flex items-center bg-[var(--surface-2)] text-[var(--text-3)] border border-[var(--line)] text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none" title="Producto de Market — no genera comanda">SIN COMANDA</span>
              )}
            </div>
          )}
          {isVoided && (
            <span className="inline-flex items-center bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--line)] text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none mt-0.5">ANULADO</span>
          )}
          {isCancelled && !isVoided && (
            <span className="inline-flex items-center bg-[var(--crit-soft)] text-[var(--crit-ink)] border border-[color-mix(in_srgb,var(--crit)_40%,transparent)] text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none mt-0.5">CANCELADO</span>
          )}
          {mods.length > 0 && (
            <p className="text-[var(--text-3)] text-[11px] truncate leading-relaxed">
              <Modificadores mods={mods} />
            </p>
          )}
          {notas && (
            <p className="text-[var(--text-2)] text-[11px] italic truncate">
              {notas}
            </p>
          )}
        </div>

        {!isCancelled && !isVoided && (
          <button
            onClick={(e) => { e.stopPropagation(); if (!isSent) onCycleSilla() }}
            disabled={isSent}
            className={`flex-shrink-0 min-w-[44px] h-11 px-2 rounded-lg text-sm font-bold flex items-center justify-center transition-colors ${isSent ? 'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-4)] cursor-not-allowed' : 'bg-[var(--info-soft)] border border-[color-mix(in_srgb,var(--info)_40%,transparent)] text-[var(--info-ink)] hover:bg-[var(--info-soft)]'}`}
            title={isSent ? 'Enviado — no se puede cambiar silla' : 'Silla — toca para cambiar'}
          >
            {isSent && <Lock size={12} className="mr-1" />}
            S{silla || 1}
          </button>
        )}

        <span className={`font-semibold text-sm w-20 text-right flex-shrink-0 font-mono tabular-nums ${isVoided ? 'line-through text-[var(--text-4)]' : isCancelled ? 'line-through text-[var(--crit-ink)]' : ''}`}>
          {subtotalFmt}
        </span>

        {!isCancelled && !isVoided && (
          <>
            {!isSent && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit() }}
              className="w-11 h-11 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--line)] text-[var(--text-3)] flex items-center justify-center transition-colors"
            >
              <Pencil size={18} />
            </button>
            )}
            {isSent && (
            <button
              onClick={(e) => { e.stopPropagation(); onTransfer() }}
              className="w-11 h-11 rounded-lg bg-[var(--warn-soft)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] hover:bg-[var(--warn-soft)] text-[var(--warn-ink)] flex items-center justify-center transition-colors"
              title="Transferir platillo a otra mesa (requiere supervisor)"
            >
              <ArrowRightLeft size={16} />
            </button>
            )}
            {puedeCancelar && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel() }}
              className="w-11 h-11 rounded-lg bg-[var(--crit-soft)] border border-[color-mix(in_srgb,var(--crit)_40%,transparent)] hover:bg-[var(--crit-soft)] text-[var(--crit-ink)] flex items-center justify-center transition-colors"
              title="Cancelar item (requiere gerente)"
            >
              <Ban size={18} />
            </button>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Rediseño ───────────────────────────────────────────────────────────────
  // Tres cambios, y cada uno responde a algo que se ve en la caja:
  //
  // 1. La cantidad deja de ser un par de botones de 44 px y se vuelve un
  //    control sólido de 56 — es lo que más se toca y lo que más se falla.
  // 2. El estado del renglón se lee por una franja de color a la izquierda,
  //    no por el fondo: el fondo teñido de rojo hacía ilegible el nombre.
  // 3. Los botones destructivos dejan de competir con los normales. Cancelar
  //    no puede verse igual de disponible que editar.
  const franja = isVoided ? 'var(--text-4)'
    : isCancelled ? 'var(--crit)'
    : isSent ? 'var(--info)'
    : 'var(--accent)'
  const apagado = isVoided || isCancelled

  return (
    <div
      className={`relative flex items-center gap-2 py-2 pl-3.5 pr-2.5 rounded-[14px] border transition-all overflow-hidden ${
        isFlashing
          ? 'ring-2 ring-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent-line)]'
          : apagado
          ? 'bg-[var(--surface-2)] border-[var(--line)]'
          : 'bg-[var(--surface-2)] border-[var(--line)] hover:bg-[var(--raised)] hover:border-[var(--accent-line)]'
      }`}
    >
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: franja, opacity: apagado ? 0.5 : 1 }} />

      <div className="flex items-center rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onDec() }}
          disabled={isCancelled || isVoided || isSent}
          aria-label="Uno menos"
          className="w-12 h-14 flex items-center justify-center text-[var(--text-1)] transition-transform active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <Minus size={20} />
        </button>
        <span className={`w-9 text-center font-black text-xl font-mono tabular-nums ${isSent ? 'text-[var(--text-3)]' : 'text-[var(--text-1)]'}`}>
          {cantidad}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onInc() }}
          disabled={isCancelled || isVoided || isSent}
          aria-label="Uno más"
          className="w-12 h-14 flex items-center justify-center text-[var(--text-1)] transition-transform active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed"
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="flex-1 min-w-[90px]">
        <p className={`font-semibold text-[15px] leading-tight break-words line-clamp-2 ${apagado ? 'line-through text-[var(--text-4)]' : 'text-[var(--text-1)]'}`} title={nombre}>
          {nombre}
        </p>
        {(kdsDone || sinComanda || isVoided || (isCancelled && !isVoided)) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {!apagado && kdsDone && (
              <span className="inline-flex items-center bg-[var(--accent-soft)] text-[var(--accent-ink)] border border-[var(--accent-line)] text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none tracking-wide">LISTO</span>
            )}
            {!apagado && sinComanda && (
              <span className="inline-flex items-center bg-[var(--surface-2)] text-[var(--text-3)] border border-[var(--line)] text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none tracking-wide" title="Producto de Market — no genera comanda">SIN COMANDA</span>
            )}
            {isVoided && (
              <span className="inline-flex items-center bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--line)] text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none tracking-wide">ANULADO</span>
            )}
            {isCancelled && !isVoided && (
              <span className="inline-flex items-center bg-[var(--crit-soft)] text-[var(--crit-ink)] border border-[color-mix(in_srgb,var(--crit)_40%,transparent)] text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none tracking-wide">CANCELADO</span>
            )}
          </div>
        )}
        {mods.length > 0 && (
          <p className="text-[var(--text-3)] text-[11.5px] truncate leading-relaxed mt-0.5">
            <Modificadores mods={mods} />
          </p>
        )}
        {notas && (
          <p className="text-[var(--text-2)] text-[11.5px] italic truncate">
            {notas}
          </p>
        )}
      </div>

      {!apagado && (
        <button
          onClick={(e) => { e.stopPropagation(); if (!isSent) onCycleSilla() }}
          disabled={isSent}
          className={`flex-shrink-0 min-w-[48px] h-14 px-2 rounded-xl text-sm font-black flex items-center justify-center transition-transform active:scale-95 ${isSent ? 'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text-4)] cursor-not-allowed' : 'bg-[var(--info-soft)] border border-[color-mix(in_srgb,var(--info)_40%,transparent)] text-[var(--info-ink)]'}`}
          title={isSent ? 'Enviado — no se puede cambiar silla' : 'Silla — toca para cambiar'}
        >
          {isSent && <Lock size={12} className="mr-1" />}
          S{silla || 1}
        </button>
      )}

      <span className={`font-black text-base w-20 text-right flex-shrink-0 font-mono tabular-nums ${apagado ? 'line-through text-[var(--text-4)]' : 'text-[var(--text-1)]'}`}>
        {subtotalFmt}
      </span>

      {!apagado && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isSent && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            aria-label="Editar"
            className="w-12 h-14 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-[var(--text-3)] flex items-center justify-center transition-transform active:scale-90"
          >
            <Pencil size={18} />
          </button>
          )}
          {isSent && (
          <button
            onClick={(e) => { e.stopPropagation(); onTransfer() }}
            className="w-12 h-14 rounded-xl bg-[var(--warn-soft)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] text-[var(--warn-ink)] flex items-center justify-center transition-transform active:scale-90"
            title="Transferir platillo a otra mesa (requiere supervisor)"
          >
            <ArrowRightLeft size={17} />
          </button>
          )}
          {puedeCancelar && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel() }}
            className="w-12 h-14 rounded-xl bg-transparent border border-[color-mix(in_srgb,var(--crit)_30%,transparent)] text-[color-mix(in_srgb,var(--crit-ink)_75%,transparent)] flex items-center justify-center transition-[transform,background,color] active:scale-90 hover:bg-[var(--crit-soft)] hover:text-[var(--crit-ink)]"
            title="Cancelar item (requiere gerente)"
          >
            <Ban size={18} />
          </button>
          )}
        </div>
      )}
    </div>
  )
}
