'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { abrirFinanzasCaja, leerEstadoCobroCaja, dividirParejoCaja, reservarEfectivoCaja,
  confirmarEfectivoCaja, liberarEfectivoNoRecibido, avisoAntesDeCobrarCaja, centavosDeTexto, pesosDeCentavos,
  reservarCobroExterno, confirmarCobroExterno, rechazarCobroExterno, marcarCobroExternoIncierto,
  type FinanzasDeCaja, type PagoDeCaja, type OrdenParaCobroCaja } from '@/lib/pedro-finanzas'

/** Nombre por omisión de la terminal bancaria. En AMALAY la tarjeta se pasa en el aparato
 *  del banco y se registra aquí: son dos actos manuales, no una integración. */
const TERMINAL_POR_OMISION = 'Terminal bancaria'

interface Props {
  order: { id: string; turno_id: string; order_revision: number; total_cents: number; items?: unknown }
  onClose: () => void
  onChanged: () => void
}

/** Shared payment UI reads the durable accounts, including reservations made at
 * another terminal. Receiving cash is an explicit action after reserving money.
 * An uncertain response keeps the attempt recoverable; it never clears a table. */
export default function CobroDeCaja({ order, onClose, onChanged }: Props) {
  const [savedOrder, setSavedOrder] = useState<OrdenParaCobroCaja>(order)
  const [finance, setFinance] = useState<FinanzasDeCaja | null>(null)
  const [error, setError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [received, setReceived] = useState<Record<string, string>>({})
  const [referencias, setReferencias] = useState<Record<string, string>>({})
  const [terminal, setTerminal] = useState(TERMINAL_POR_OMISION)
  const [split, setSplit] = useState('2')
  const [notice, setNotice] = useState('')
  const apply = useCallback((next: FinanzasDeCaja) => {
    setFinance(current => current && current.revision > next.revision ? current : next)
    setConnected(true)
  }, [])
  useEffect(() => {
    let alive = true
    let pending = false
    const refresh = async () => {
      if (pending || working.current) return
      pending = true
      try {
        const snapshot = await leerEstadoCobroCaja(order.id)
        const next = snapshot.financial
        if (alive) { setSavedOrder(current => snapshot.order && snapshot.order.order_revision >= current.order_revision ? snapshot.order : current); if (next) apply(next); else setConnected(true); setConnectionError('') }
      } catch (e) {
        if (alive) { setConnected(false); setConnectionError(e instanceof Error ? e.message : 'No se pudo consultar Caja.') }
      } finally { pending = false }
    }
    void refresh()
    const timer = setInterval(refresh, 1000)
    return () => { alive = false; clearInterval(timer) }
  }, [order.id, apply])

  const run = async (action: () => Promise<FinanzasDeCaja>, success: string) => {
    if (working.current) return
    working.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const next = await action()
      apply(next); setNotice(success); onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : 'Caja no confirmó la operación.') }
    finally { working.current = false; setBusy(false) }
  }
  const account = finance?.accounts.find(a => a.account_id === accountId && a.balance_cents > a.reserved_cents) ?? finance?.accounts.find(a => a.balance_cents > a.reserved_cents)
  const pendingPayments = finance?.payments.filter(p => p.status === 'pending' || p.status === 'unknown') ?? []
  const confirm = (payment: PagoDeCaja) => run(async () => {
    const next = await confirmarEfectivoCaja(finance!, payment, centavosDeTexto(received[payment.payment_id] || ''))
    const paid = next.payments.find(p => p.payment_id === payment.payment_id)
    if (paid?.status !== 'accepted') throw new Error('El intento se recuperó con otro resultado. Revisa los pagos confirmados antes de continuar.')
    return next
  }, 'Efectivo registrado en Caja y compartido con las terminales.')
  // Resolver un cobro de terminal. El resultado que se guarda es el que el cajero VIO en
  // el aparato, no el que conviene: por eso son tres botones y no dos.
  const resolverTerminal = (payment: PagoDeCaja, como: 'aprobado' | 'rechazado' | 'incierto') => {
    const ref = referencias[payment.payment_id] ?? ''
    const acciones = {
      aprobado:  { fn: () => confirmarCobroExterno(finance!, payment, ref),        ok: 'Cobro con terminal registrado y compartido con las terminales.' },
      rechazado: { fn: () => rechazarCobroExterno(finance!, payment, ref),         ok: 'Rechazo registrado. La cuenta vuelve a quedar cobrable.' },
      incierto:  { fn: () => marcarCobroExternoIncierto(finance!, payment, ref),   ok: 'Quedó como pendiente de aclarar. El importe sigue apartado y nadie lo puede cobrar dos veces.' },
    }[como]
    return run(acciones.fn, acciones.ok)
  }

  const sendWarning = avisoAntesDeCobrarCaja(savedOrder)
  const disabled = busy || !connected
  const button = 'min-h-[48px] rounded-xl px-4 py-3 font-semibold disabled:opacity-40 disabled:cursor-not-allowed'
  const field = 'w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 text-[var(--text)]'

  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="cobro-caja-title"
    onKeyDown={e => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose() }
      if (e.key !== 'Tab') return
      const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]'))
      const first = controls[0], last = controls.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }}>
    <div className="w-full max-w-2xl max-h-[92vh] overflow-auto rounded-2xl bg-[var(--surface)] text-[var(--text)] p-6 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="cobro-caja-title" className="text-2xl font-bold">Cobro de la cuenta</h2>
          <p className="mt-1 text-sm text-[var(--text-2)]">{connected ? 'Conectado con Caja' : 'Sin confirmar conexión con Caja'}</p></div>
        <button autoFocus className={`${button} border border-[var(--line)]`} onClick={onClose} disabled={busy}>Cerrar</button>
      </div>
      {(connectionError || error) && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-red-600">{connectionError || error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-emerald-700">{notice}</p>}
      {!finance ? <div className="mt-6">
        <p className="text-3xl font-bold">{pesosDeCentavos(savedOrder.total_cents)}</p>
        <p className="my-4">{sendWarning || 'Confirma el total para preparar las cuentas de cobro. Los productos pendientes seguirán en cocina.'}</p>
        <button className={`${button} bg-blue-600 text-white`} disabled={disabled || !!sendWarning}
          onClick={() => run(() => abrirFinanzasCaja(savedOrder), 'Cuenta preparada para cobrar.')}>Preparar cuenta para cobrar</button>
      </div> : <>
        <dl className="my-6 grid grid-cols-2 gap-3">
          {[['Total', finance.total_cents], ['Pagado', finance.paid_cents], ['Reservado', finance.reserved_cents], ['Pendiente', finance.balance_cents]].map(([label, value]) =>
            <div key={label}><dt className="text-sm text-[var(--text-2)]">{label}</dt><dd className="text-xl font-bold">{pesosDeCentavos(Number(value))}</dd></div>)}
        </dl>
        <div className="space-y-2" aria-label="Cuentas compartidas">
          {finance.accounts.map((a, i) => <button key={a.account_id} disabled={disabled || a.balance_cents <= a.reserved_cents}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left ${account?.account_id === a.account_id ? 'border-blue-500 bg-blue-500/10' : 'border-[var(--line)]'}`}
            onClick={() => { setAccountId(a.account_id); setAmount(((a.balance_cents - a.reserved_cents) / 100).toFixed(2)) }}>
            <span>{a.label || `Cuenta ${i + 1}`}<small className="block text-[var(--text-2)]">Pagado {pesosDeCentavos(a.paid_cents)}{a.reserved_cents > 0 ? ` · En proceso ${pesosDeCentavos(a.reserved_cents)}` : ''}</small></span>
            <strong>{pesosDeCentavos(a.balance_cents)}</strong>
          </button>)}
        </div>
        {finance.payments.length === 0 && <div className="my-5 flex items-end gap-3">
          <label className="flex-1">Dividir en partes iguales<input aria-label="Número de cuentas" className={field} type="number" min="2" max="50" value={split} onChange={e => setSplit(e.target.value)} /></label>
          <button className={`${button} border border-[var(--line)]`} disabled={disabled}
            onClick={() => run(() => dividirParejoCaja(finance, Number(split)), 'División guardada y visible en todas las terminales.')}>Dividir cuenta</button>
        </div>}
        {finance.status === 'settled' ? <p className="my-5 text-lg font-bold text-emerald-700">Cuenta liquidada. Cocina conserva la preparación pendiente.</p> : <>
          {sendWarning && <p role="status" className="my-3 text-amber-700">{sendWarning} Los cobros en proceso todavía pueden confirmarse o aclararse.</p>}
          {account && <div className="my-5 space-y-3 border-t border-[var(--line)] pt-4">
            <label className="block">Importe a cobrar en efectivo<input aria-label="Importe a cobrar" className={field} inputMode="decimal" value={amount} placeholder={((account.balance_cents - account.reserved_cents) / 100).toFixed(2)} onChange={e => setAmount(e.target.value)} /></label>
            <button className={`${button} w-full bg-blue-600 text-white`} disabled={disabled || !!sendWarning}
              onClick={() => run(() => reservarEfectivoCaja(finance, account.account_id,
                centavosDeTexto(amount || ((account.balance_cents - account.reserved_cents) / 100).toFixed(2))), 'Cobro preparado. Confirma cuando hayas recibido el efectivo.')}>Preparar cobro en efectivo</button>

            {/* COBRO CON TERMINAL BANCARIA.
                Se aparta el importe ANTES de pasar la tarjeta para que otra terminal no lo
                cobre otra vez mientras el cajero está en el aparato. El resultado se
                registra después, con la referencia del voucher. */}
            <div className="rounded-xl border border-[var(--line)] p-3">
              <label className="block text-sm">Terminal donde se pasa la tarjeta
                <input aria-label="Terminal bancaria" className={field} value={terminal}
                  onChange={e => setTerminal(e.target.value)} /></label>
              <button className={`${button} mt-3 w-full border border-blue-600 text-blue-600`} disabled={disabled || !!sendWarning || !terminal.trim()}
                onClick={() => run(() => reservarCobroExterno(finance, account.account_id,
                  centavosDeTexto(amount || ((account.balance_cents - account.reserved_cents) / 100).toFixed(2)), terminal),
                  'Importe apartado. Pasa la tarjeta en la terminal y registra aquí el resultado.')}>
                Cobrar con terminal bancaria</button>
              <p className="mt-2 text-xs text-[var(--text-2)]">El importe queda apartado mientras pasas la tarjeta. Ninguna otra terminal lo puede cobrar.</p>
            </div>
          </div>}
          {pendingPayments.map(payment => <section key={payment.payment_id} className="my-4 rounded-xl border border-amber-500 p-4">
            <h3 className="font-bold">Cobro por confirmar · {pesosDeCentavos(payment.amount_cents)}</h3>
            <p className="my-2 text-sm">Este importe ya está reservado. Verifica si se recibió el dinero antes de confirmar o liberarlo.</p>
            {payment.method === 'cash' && <>
              <label>Efectivo recibido<input aria-label={`Efectivo recibido ${payment.payment_id}`} className={field} inputMode="decimal" value={received[payment.payment_id] ?? ''}
                onChange={e => setReceived(prev => ({ ...prev, [payment.payment_id]: e.target.value }))} /></label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={`${button} bg-emerald-700 text-white`} disabled={disabled} onClick={() => confirm(payment)}>Confirmar efectivo recibido</button>
                <button className={`${button} border border-[var(--line)]`} disabled={disabled}
                  onClick={() => run(() => liberarEfectivoNoRecibido(finance, payment), 'Resultado recuperado. Revisa el saldo antes de iniciar otro cobro.')}>No se recibió efectivo</button>
              </div>
            </>}
            {payment.method === 'external' && <>
              <p className="text-sm">Terminal: <strong>{payment.provider}</strong>{payment.status === 'unknown' ? ' · quedó pendiente de aclarar' : ''}</p>
              <label className="mt-2 block">Referencia o número de autorización del voucher
                <input aria-label={`Referencia del voucher ${payment.payment_id}`} className={field}
                  value={referencias[payment.payment_id] ?? ''}
                  onChange={e => setReferencias(prev => ({ ...prev, [payment.payment_id]: e.target.value }))} /></label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={`${button} bg-emerald-700 text-white`} disabled={disabled}
                  onClick={() => resolverTerminal(payment, 'aprobado')}>La terminal aprobó</button>
                <button className={`${button} border border-[var(--line)]`} disabled={disabled}
                  onClick={() => resolverTerminal(payment, 'rechazado')}>La terminal rechazó</button>
                {/* El tercero es el que evita cobrar dos veces. Si nadie vio el voucher, el
                    importe sigue apartado y se resuelve cuando aparezca. */}
                <button className={`${button} border border-amber-600 text-amber-700`} disabled={disabled}
                  onClick={() => resolverTerminal(payment, 'incierto')}>No sé qué pasó</button>
              </div>
              <p className="mt-2 text-xs text-[var(--text-2)]">Si no sabes si pasó, no adivines: déjalo pendiente. El importe sigue apartado y se resuelve después con el voucher.</p>
            </>}
          </section>)}
        </>}
        {finance.payments.some(p => p.status === 'accepted') && <div className="mt-5 border-t border-[var(--line)] pt-4">
          <h3 className="font-bold">Pagos confirmados</h3>
          {finance.payments.filter(p => p.status === 'accepted').map(p => <p key={p.payment_id} className="mt-2 text-sm">
            {pesosDeCentavos(p.amount_cents)} · {p.method === 'cash' ? 'Efectivo' : (p.provider || 'Terminal')}{p.change_cents ? ` · Cambio ${pesosDeCentavos(p.change_cents)}` : ''}
          </p>)}
        </div>}
      </>}
    </div>
  </div>
}
