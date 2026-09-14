'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Banda de acción — tercer componente del port.
//
// Es la franja donde se decide el dinero: enviar a cocina, imprimir la cuenta,
// dividir y cobrar. Hoy son seis botones de 52 px con cinco colores saturados
// distintos (cian, esmeralda, ámbar, morado, azul) escritos a mano, sin pasar
// por los tokens. A un metro de distancia compiten todos por la misma atención,
// y el que más se toca —Enviar— no se distingue del que menos.
//
// Mismo contrato de siempre: con `v2` apagada, el marcado anterior intacto.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react'
import { ArrowLeft, ClipboardCheck, Send, Receipt, CreditCard } from 'lucide-react'

export type PosActionBandProps = {
  vacia: boolean
  escribeEnCaja: boolean
  saving: boolean
  sentToKitchen: boolean
  /** Deshabilitado porque no hay renglones activos. */
  sinItems: boolean
  /** Deshabilitado por estado de la caja o de la mesa. */
  bloqueadoEnviar: boolean
  bloqueadoCobrar: boolean
  bloqueadoGuardar: boolean
  puedeCobrar: boolean
  onSalir: () => void
  onGuardar: () => void
  onVerificar: () => void
  onEnviar: () => void
  onCuenta: () => void
  onSplit: () => void
  onCobrar: () => void
  v2: boolean
}

export function PosActionBand(p: PosActionBandProps) {
  const { vacia, escribeEnCaja, saving, sentToKitchen, sinItems,
          bloqueadoEnviar, bloqueadoCobrar, bloqueadoGuardar, puedeCobrar,
          onSalir, onGuardar, onVerificar, onEnviar, onCuenta, onSplit, onCobrar, v2 } = p

  // ── Antes del rediseño ─────────────────────────────────────────────────────
  if (!v2) {
    return (
      <div className={`px-3 py-1 border-t border-[var(--line)] gap-2 flex-shrink-0 ${escribeEnCaja ? 'grid grid-cols-3' : 'flex'}`}>
        {vacia ? (
          <button
            onClick={onSalir}
            className="flex-1 flex items-center justify-center gap-2 bg-[var(--surface-2)] hover:bg-[var(--text-4)] active:bg-[var(--raised)] active:scale-[0.97] text-[var(--text-1)] font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
          >
            <ArrowLeft size={18} />
            Salir
          </button>
        ) : (<>
        {escribeEnCaja && <button onClick={onGuardar}
          disabled={bloqueadoGuardar}
          className="flex-1 min-h-[52px] rounded-xl bg-slate-700 px-3 py-2.5 font-bold text-white disabled:opacity-40">Guardar</button>}
        <button
          onClick={onVerificar}
          disabled={sinItems}
          className="flex-[0.5] flex items-center justify-center gap-1 bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-sm transition-all min-h-[52px]"
        >
          <ClipboardCheck size={16} />
          Verificar
        </button>
        <button
          onClick={onEnviar}
          disabled={bloqueadoEnviar}
          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
        >
          {saving ? <div className="w-[18px] h-[18px] border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send size={18} />}
          {saving ? 'Enviando' : sentToKitchen ? 'Enviado' : 'Enviar'}
        </button>
        <button
          onClick={onCuenta}
          disabled={bloqueadoEnviar}
          className="flex-[0.6] flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
        >
          <Receipt size={16} />
          Cuenta
        </button>
        <button
          onClick={onSplit}
          disabled={bloqueadoCobrar}
          className="flex-[0.4] flex items-center justify-center bg-purple-600 hover:bg-purple-500 active:bg-purple-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
          title={!puedeCobrar ? 'Sin permiso para cobrar' : ''}
        >
          Split
        </button>
        <button
          onClick={onCobrar}
          disabled={bloqueadoCobrar}
          className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 active:scale-[0.97] disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-2.5 rounded-xl text-base transition-all min-h-[52px]"
          title={!puedeCobrar ? 'Sin permiso para cobrar' : ''}
        >
          <CreditCard size={18} />
          {!puedeCobrar ? 'Sin permiso' : 'Cobrar'}
        </button>
        </>)}
      </div>
    )
  }

  // ── Rediseño ───────────────────────────────────────────────────────────────
  // Tres decisiones:
  //
  // 1. Jerarquía por peso, no por color. Enviar y Cobrar son las dos acciones
  //    que terminan algo, y son las únicas rellenas. Verificar, Cuenta y Split
  //    quedan delineadas: se ven disponibles sin gritar.
  // 2. Altura 60 px — el estándar del catálogo para lo que se toca con prisa.
  //    Los 52 de hoy quedan por debajo del mínimo que el propio sistema fija.
  // 3. Los colores salen de los tokens. Un ámbar escrito a mano no cambia con
  //    el tema del cliente y se ve mal en claro; --warn sí.
  const base = 'flex items-center justify-center gap-1.5 rounded-2xl font-bold min-h-[60px] px-3 ' +
    'transition-transform active:scale-[0.97] disabled:opacity-35 disabled:pointer-events-none'
  const relleno = (bg: string, ink: string) => ({ background: bg, color: ink, border: '1px solid transparent' })
  const linea = (col: string) => ({
    background: 'transparent',
    color: `var(--${col}-ink, var(--${col}))`,
    border: `1px solid color-mix(in srgb, var(--${col}) 38%, transparent)`,
  })

  return (
    <div className={`px-3 py-2 border-t border-[var(--line)] gap-2 flex-shrink-0 ${escribeEnCaja ? 'grid grid-cols-3' : 'flex'}`}>
      {vacia ? (
        <button
          onClick={onSalir}
          className={`${base} flex-1 text-base`}
          style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--line)' }}
        >
          <ArrowLeft size={18} />
          Salir
        </button>
      ) : (<>
        {escribeEnCaja && (
          <button
            onClick={onGuardar}
            disabled={bloqueadoGuardar}
            className={`${base} flex-1 text-[15px]`}
            style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--line)' }}
          >
            Guardar
          </button>
        )}
        <button
          onClick={onVerificar}
          disabled={sinItems}
          className={`${base} flex-[0.5] text-sm`}
          style={linea('info')}
        >
          <ClipboardCheck size={16} />
          Verificar
        </button>
        <button
          onClick={onEnviar}
          disabled={bloqueadoEnviar}
          className={`${base} flex-[1.3] text-base`}
          style={relleno('linear-gradient(180deg,var(--accent-bright,var(--accent)),var(--accent))', '#04231a')}
        >
          {saving
            ? <div className="w-[18px] h-[18px] border-2 border-current border-t-transparent rounded-full animate-spin" />
            : <Send size={18} />}
          {saving ? 'Enviando' : sentToKitchen ? 'Enviado' : 'Enviar'}
        </button>
        <button
          onClick={onCuenta}
          disabled={bloqueadoEnviar}
          className={`${base} flex-[0.6] text-[15px]`}
          style={linea('warn')}
        >
          <Receipt size={16} />
          Cuenta
        </button>
        <button
          onClick={onSplit}
          disabled={bloqueadoCobrar}
          className={`${base} flex-[0.4] text-[15px]`}
          style={linea('info')}
          title={!puedeCobrar ? 'Sin permiso para cobrar' : ''}
        >
          Split
        </button>
        <button
          onClick={onCobrar}
          disabled={bloqueadoCobrar}
          className={`${base} flex-[1.2] text-base`}
          style={relleno('var(--info)', '#04202b')}
          title={!puedeCobrar ? 'Sin permiso para cobrar' : ''}
        >
          <CreditCard size={18} />
          {!puedeCobrar ? 'Sin permiso' : 'Cobrar'}
        </button>
      </>)}
    </div>
  )
}
