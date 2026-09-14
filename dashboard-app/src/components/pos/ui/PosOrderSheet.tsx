'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Las acciones de un renglón, en una hoja.
//
// En el diseño el renglón de la cuenta tiene TRES columnas —cantidad, nombre,
// precio— y ningún botón. Se toca el renglón y las acciones aparecen aquí.
//
// Por qué importa y no es capricho: los seis controles en línea se comían el
// ancho de la columna, así que el nombre del platillo quedaba en dos letras por
// renglón y los modificadores no cabían. Y un botón de cancelar a 8 px del de
// sumar, en una pantalla que se toca con prisa, es un error esperando.
//
// Las acciones son las MISMAS y llaman a las mismas funciones. Sólo cambia
// dónde viven.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect } from 'react'
import { Minus, Plus, Pencil, Ban, ArrowRightLeft, Armchair, X, Lock } from 'lucide-react'

export type PosOrderSheetProps = {
  nombre: string
  cantidad: number
  subtotalFmt: string
  silla: number
  modificadores: string[]
  notas?: string
  isSent: boolean
  puedeCancelar: boolean
  onDec: () => void
  onInc: () => void
  onCycleSilla: () => void
  onEdit: () => void
  onTransfer: () => void
  onCancel: () => void
  onCerrar: () => void
}

/** Un botón de acción de la hoja. Vive FUERA del componente: definirlo dentro
 *  crea un tipo nuevo en cada render, así que React desmonta y vuelve a montar
 *  los botones — y en una pantalla táctil eso se siente como un parpadeo. */
function Accion({ icono, texto, onClick, onCerrar, tono = 'normal', bloqueado }: {
  icono: React.ReactNode
  texto: string
  onClick: () => void
  onCerrar: () => void
  tono?: 'normal' | 'peligro' | 'aviso'
  bloqueado?: boolean
}) {
  const tinte = tono === 'peligro'
    ? { background: 'var(--crit-soft)', borderColor: 'var(--crit-line)', color: 'var(--crit-ink)' }
    : tono === 'aviso'
    ? { background: 'var(--warn-soft)', borderColor: 'var(--warn-line)', color: 'var(--warn)' }
    : { background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }
  return (
    <button
      onClick={() => { if (!bloqueado) { onClick(); onCerrar() } }}
      disabled={bloqueado}
      className="min-h-[64px] rounded-[var(--r2,12px)] border flex flex-col items-center justify-center gap-1 font-bold text-[13px] transition-transform active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
      style={tinte}
    >
      {icono}{texto}
    </button>
  )
}

export function PosOrderSheet(p: PosOrderSheetProps) {
  const { nombre, cantidad, subtotalFmt, silla, modificadores, notas, isSent,
          puedeCancelar, onDec, onInc, onCycleSilla, onEdit, onTransfer, onCancel, onCerrar } = p

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCerrar])

  return (
    <div
      className="fixed inset-0 z-[400] grid place-items-center p-5"
      style={{ background: 'rgba(4,7,8,.72)', backdropFilter: 'blur(10px)' }}
      onClick={onCerrar}
    >
      <div
        className="w-full max-w-[520px] rounded-[var(--r4,22px)] border overflow-hidden"
        style={{ background: 'var(--panel)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-3)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <span
            className="min-w-[34px] h-[34px] px-2 rounded-lg grid place-items-center font-mono font-black text-[15px] flex-shrink-0"
            style={{ background: 'var(--info-soft)', color: 'var(--info)' }}
          >
            {cantidad}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-[16px] leading-tight" style={{ color: 'var(--text-1)' }}>{nombre}</p>
            {modificadores.length > 0 && (
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-3)' }}>{modificadores.join(' · ')}</p>
            )}
            {notas && <p className="text-[12px] italic mt-0.5" style={{ color: 'var(--text-2)' }}>{notas}</p>}
            {isSent && (
              <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--text-4)' }}>
                <Lock size={11} /> Ya está en cocina
              </span>
            )}
          </div>
          <span className="font-mono font-black text-[17px] flex-shrink-0" style={{ color: 'var(--text-1)' }}>{subtotalFmt}</span>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="w-10 h-10 rounded-lg grid place-items-center flex-shrink-0"
            style={{ color: 'var(--text-3)' }}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 grid grid-cols-3 gap-2">
          <Accion onCerrar={onCerrar} icono={<Minus size={20} />} texto="Menos" onClick={onDec} bloqueado={isSent} />
          <Accion onCerrar={onCerrar} icono={<Plus size={20} />} texto="Más" onClick={onInc} bloqueado={isSent} />
          <Accion onCerrar={onCerrar} icono={<Armchair size={20} />} texto={`Silla ${silla}`} onClick={onCycleSilla} bloqueado={isSent} />
          {!isSent && <Accion onCerrar={onCerrar} icono={<Pencil size={19} />} texto="Editar" onClick={onEdit} />}
          {isSent && <Accion onCerrar={onCerrar} icono={<ArrowRightLeft size={19} />} texto="Transferir" onClick={onTransfer} tono="aviso" />}
          {puedeCancelar && <Accion onCerrar={onCerrar} icono={<Ban size={19} />} texto="Cancelar" onClick={onCancel} tono="peligro" />}
        </div>
      </div>
    </div>
  )
}
