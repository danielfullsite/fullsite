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
  /** Abre la hoja de acciones. Sustituye a los seis botones en línea. */
  onAbrirAcciones: () => void
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
          puedeCancelar, onDec, onInc, onCycleSilla, onEdit, onTransfer, onCancel,
          onAbrirAcciones, v2 } = p
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

  // ── El renglón del diseño ──────────────────────────────────────────────────
  // Tres columnas y ningún botón: cantidad, nombre (con sus modificadores
  // debajo) y precio. Se toca el renglón y las acciones salen en una hoja.
  //
  // La versión anterior metía seis controles en línea. Se comían el ancho de la
  // columna, así que el nombre del platillo caía en dos letras por renglón y
  // los modificadores no cabían. Y tener «cancelar» a 8 px de «sumar», en una
  // pantalla que se toca con prisa, es un error esperando a ocurrir.
  const apagado = isVoided || isCancelled

  return (
    <button
      onClick={onAbrirAcciones}
      className={`w-full grid items-center gap-2.5 px-2 py-[7px] rounded-[var(--r2,12px)] text-left transition-colors ${isSent && !apagado ? 'opacity-[0.55]' : ''} ${isFlashing ? 'ring-2 ring-[var(--accent)]' : ''}`}
      style={{
        gridTemplateColumns: 'auto 1fr auto',
        background: isFlashing ? 'var(--accent-soft)' : 'transparent',
      }}
    >
      <span
        className="min-w-[30px] h-[30px] px-[7px] rounded-[7px] grid place-items-center font-mono font-extrabold text-[13px]"
        style={apagado
          ? { background: 'var(--surface-2)', color: 'var(--text-4)' }
          : isSent
          ? { background: 'var(--surface-2)', color: 'var(--text-4)' }
          : { background: 'var(--info-soft)', color: 'var(--info)' }}
      >
        {cantidad}
      </span>

      <span className="min-w-0">
        <span
          className={`block font-semibold text-[14px] leading-[1.25] line-clamp-2 ${apagado ? 'line-through' : ''}`}
          style={{ color: apagado ? 'var(--text-4)' : 'var(--text-1)' }}
          title={nombre}
        >
          {nombre}
        </span>
        {mods.length > 0 && (
          <span className="block text-[11px] leading-[1.2] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
            <Modificadores mods={mods} />
          </span>
        )}
        {notas && (
          <span className="block text-[11px] italic leading-[1.2] truncate" style={{ color: 'var(--text-2)' }}>
            {notas}
          </span>
        )}
        {(kdsDone || sinComanda || isVoided || (isCancelled && !isVoided)) && (
          <span className="flex flex-wrap gap-1 mt-1">
            {!apagado && kdsDone && (
              <span className="inline-flex items-center text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none tracking-wide"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent-bright)' }}>LISTO</span>
            )}
            {!apagado && sinComanda && (
              <span className="inline-flex items-center text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none tracking-wide"
                style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }} title="Producto de Market — no genera comanda">SIN COMANDA</span>
            )}
            {isVoided && (
              <span className="inline-flex items-center text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none tracking-wide"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>ANULADO</span>
            )}
            {isCancelled && !isVoided && (
              <span className="inline-flex items-center text-[10px] font-black px-1.5 py-0.5 rounded-full leading-none tracking-wide"
                style={{ background: 'var(--crit-soft)', color: 'var(--crit-ink)' }}>CANCELADO</span>
            )}
          </span>
        )}
      </span>

      <span
        className={`font-mono font-bold text-[14px] tabular-nums ${apagado ? 'line-through' : ''}`}
        style={{ color: apagado ? 'var(--text-4)' : 'var(--text-1)' }}
      >
        {subtotalFmt}
      </span>
    </button>
  )
}