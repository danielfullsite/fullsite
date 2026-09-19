'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { abrirFinanzasCaja, leerFinanzasCaja, dividirParejoCaja, reservarPagoCaja, confirmarPagoManualCaja, resolverPagoManualCaja,
  confirmarEfectivoCaja, liberarEfectivoNoRecibido, avisoAntesDeCobrarCaja, centavosDeTexto, pesosDeCentavos,
  type FinanzasDeCaja, type PagoDeCaja } from '@/lib/pedro-finanzas'

interface Props {
  order: { id: string; turno_id: string; order_revision: number; total_cents: number; items?: unknown }
  onClose: () => void
  onChanged: () => void
}

/** Shared payment UI reads the durable accounts, including reservations made at
 * another terminal. Receiving cash is an explicit action after reserving money.
 * An uncertain response keeps the attempt recoverable; it never clears a table. */
export default function CobroDeCaja({ order, onClose, onChanged }: Props) {
  const [finance, setFinance] = useState<FinanzasDeCaja | null>(null)
  const [error, setError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [tip, setTip] = useState('')
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash')
  const [manual, setManual] = useState<Record<string, { source?: string; reference?: string; reason?: string }>>({})
  const [received, setReceived] = useState<Record<string, string>>({})
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
        const next = await leerFinanzasCaja(order.id)
        if (alive) { if (next) apply(next); else setConnected(true); setConnectionError('') }
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
  const manualField = (paymentId: string, field: 'source' | 'reference' | 'reason', value: string) =>
    setManual(previous => ({ ...previous, [paymentId]: { ...previous[paymentId], [field]: value } }))
  const confirm = (payment: PagoDeCaja) => run(async () => {
    const next = await confirmarEfectivoCaja(finance!, payment, centavosDeTexto(received[payment.payment_id] || ''))
    const paid = next.payments.find(p => p.payment_id === payment.payment_id)
    if (paid?.status !== 'accepted') throw new Error('El intento se recuperó con otro resultado. Revisa los pagos confirmados antes de continuar.')
    return next
  }, 'Efectivo registrado en Caja y compartido con las terminales.')
  const sendWarning = avisoAntesDeCobrarCaja(order)
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
        <p className="text-3xl font-bold">{pesosDeCentavos(order.total_cents)}</p>
        <p className="my-4">{sendWarning || 'Confirma el total para preparar las cuentas de cobro. Los productos pendientes seguirán en cocina.'}</p>
        <button className={`${button} bg-blue-600 text-white`} disabled={disabled || !!sendWarning}
          onClick={() => run(() => abrirFinanzasCaja(order), 'Cuenta preparada para cobrar.')}>Preparar cuenta para cobrar</button>
      </div> : <>
        <dl className="my-6 grid grid-cols-3 gap-3">
          {[['Total', finance.total_cents], ['Pagado', finance.paid_cents], ['Pendiente', finance.balance_cents]].map(([label, value]) =>
            <div key={label}><dt className="text-sm text-[var(--text-2)]">{label}</dt><dd className="text-xl font-bold">{pesosDeCentavos(Number(value))}</dd></div>)}
        </dl>
        {(finance.tip_cents ?? 0) > 0 && <p className="mb-4">Propinas registradas: <strong>{pesosDeCentavos(finance.tip_cents ?? 0)}</strong> · separadas del consumo.</p>}
        {finance.status !== 'settled' && pendingPayments.length === 0 && <p className="mb-4 text-sm text-[var(--text-2)]">Puedes cerrar esta ventana para agregar consumo. Los pagos registrados se conservan; después guarda y envía la nueva ronda.</p>}
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
          {account && <div className="my-5 space-y-3 border-t border-[var(--line)] pt-4">
            <label className="block">Forma de pago<select aria-label="Forma de pago" className={field} value={method} disabled={disabled}
              onChange={e => setMethod(e.target.value as 'cash' | 'card' | 'transfer')}>
              <option value="cash">Efectivo</option><option value="card">Tarjeta en terminal independiente</option><option value="transfer">Transferencia verificada</option>
            </select></label>
            {method !== 'cash' && <p className="text-sm">Fullsite registra el pago que verificaste fuera del sistema. Este botón no realiza un cargo bancario.</p>}
            <label className="block">Importe del consumo<input aria-label="Importe a cobrar" className={field} inputMode="decimal" value={amount} placeholder={((account.balance_cents - account.reserved_cents) / 100).toFixed(2)} onChange={e => setAmount(e.target.value)} /></label>
            <label className="block">Propina de este pago<input aria-label="Propina de este pago" className={field} inputMode="decimal" value={tip} placeholder="0.00" onChange={e => setTip(e.target.value)} /></label>
            <button className={`${button} w-full bg-blue-600 text-white`} disabled={disabled}
              onClick={() => run(() => reservarPagoCaja(finance, account.account_id,
                centavosDeTexto(amount || ((account.balance_cents - account.reserved_cents) / 100).toFixed(2)),
                { method: method === 'cash' ? 'cash' : 'manual', ...(method !== 'cash' ? { tender: method } : {}), tip_cents: centavosDeTexto(tip || '0') }),
              'Importe reservado. Revisa el intento y confirma sólo cuando hayas verificado el pago.')}>
              {method === 'cash' ? 'Preparar cobro en efectivo' : 'Preparar registro de pago externo'}</button>
          </div>}
          {pendingPayments.map(payment => <section key={payment.payment_id} className="my-4 rounded-xl border border-amber-500 p-4">
            <h3 className="font-bold">Cobro por confirmar · {pesosDeCentavos(payment.amount_cents + (payment.tip_cents ?? 0))}</h3>
            <p className="text-sm">Consumo {pesosDeCentavos(payment.amount_cents)} · Propina {pesosDeCentavos(payment.tip_cents ?? 0)}</p>
            <p className="my-2 text-sm">Este importe ya está reservado. Verifica si se recibió el dinero antes de confirmar o liberarlo.</p>
            {payment.status === 'unknown' && <p className="my-2 font-semibold">Resultado sin confirmar. Un encargado debe conciliar este intento antes de cobrarlo de nuevo.</p>}
            {payment.method === 'cash' && <>
              <label>Efectivo recibido<input aria-label={`Efectivo recibido ${payment.payment_id}`} className={field} inputMode="decimal" value={received[payment.payment_id] ?? ''}
                onChange={e => setReceived(prev => ({ ...prev, [payment.payment_id]: e.target.value }))} /></label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={`${button} bg-emerald-700 text-white`} disabled={disabled} onClick={() => confirm(payment)}>Confirmar efectivo recibido</button>
                <button className={`${button} border border-[var(--line)]`} disabled={disabled}
                  onClick={() => run(() => liberarEfectivoNoRecibido(finance, payment), 'Resultado recuperado. Revisa el saldo antes de iniciar otro cobro.')}>No se recibió efectivo</button>
              </div>
            </>}
            {payment.method === 'manual' && <div className="space-y-3">
              <p className="font-semibold">{payment.tender === 'card' ? 'Tarjeta en terminal independiente' : 'Transferencia'}</p>
              <label className="block">Terminal o banco<input aria-label={`Terminal o banco ${payment.payment_id}`} className={field} maxLength={200}
                value={manual[payment.payment_id]?.source ?? ''} onChange={e => manualField(payment.payment_id, 'source', e.target.value)} /></label>
              <label className="block">Folio o referencia<input aria-label={`Referencia ${payment.payment_id}`} className={field} maxLength={200}
                value={manual[payment.payment_id]?.reference ?? ''} onChange={e => manualField(payment.payment_id, 'reference', e.target.value)} /></label>
              <button className={`${button} w-full bg-emerald-700 text-white`} disabled={disabled}
                onClick={() => run(async () => {
                  const next = await confirmarPagoManualCaja(finance, payment, manual[payment.payment_id]?.source ?? '', manual[payment.payment_id]?.reference ?? '')
                  if (next.payments.find(p => p.payment_id === payment.payment_id)?.status !== 'accepted') throw new Error('Se recuperó otro resultado del intento. Revisa el saldo y vuelve a confirmar la acción correcta.')
                  return next
                }, 'Pago externo registrado con la referencia verificada por el operador.')}>Confirmar pago externo verificado</button>
              <label className="block">Motivo si no puedes confirmar el pago<input aria-label={`Motivo del pago ${payment.payment_id}`} className={field} maxLength={200}
                value={manual[payment.payment_id]?.reason ?? ''} onChange={e => manualField(payment.payment_id, 'reason', e.target.value)} /></label>
              <div className="flex flex-wrap gap-2">
                <button className={`${button} border border-[var(--line)]`} disabled={disabled}
                  onClick={() => run(() => resolverPagoManualCaja(finance, payment, 'unknown', manual[payment.payment_id]?.reason ?? ''), 'Resultado guardado. El saldo queda reservado hasta la conciliación.')}>No puedo confirmar el resultado</button>
                <button className={`${button} border border-[var(--line)]`} disabled={disabled}
                  onClick={() => run(() => resolverPagoManualCaja(finance, payment, 'rejected', manual[payment.payment_id]?.reason ?? ''), 'Revisa el resultado y saldo confirmado antes de iniciar otro cobro.')}>Verifiqué que no se realizó</button>
              </div>
            </div>}
          </section>)}
        </>}
        {finance.payments.some(p => p.status === 'accepted') && <div className="mt-5 border-t border-[var(--line)] pt-4">
          <h3 className="font-bold">Pagos confirmados</h3>
          {finance.payments.filter(p => p.status === 'accepted').map(p => <p key={p.payment_id} className="mt-2 text-sm">
            {pesosDeCentavos(p.amount_cents)} · {p.method === 'cash' ? 'Efectivo' : p.method === 'manual' ? p.tender === 'card' ? 'Tarjeta independiente' : 'Transferencia' : 'Proveedor'}
            {(p.tip_cents ?? 0) > 0 ? ` · Propina ${pesosDeCentavos(p.tip_cents ?? 0)}` : ''}{p.change_cents ? ` · Cambio ${pesosDeCentavos(p.change_cents)}` : ''}
            {p.evidence?.reference ? ` · Referencia ${p.evidence.reference}` : ''}
          </p>)}
        </div>}
      </>}
    </div>
  </div>
}
