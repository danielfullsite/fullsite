'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ingresarConPinEnCaja, type SesionDeCaja } from '@/lib/pedro-actor'
import { leerCorteCaja } from '@/lib/pedro-reportes'
import { pesosDeCentavos } from '@/lib/pedro-finanzas'
import { type CorteCaja } from '@/lib/caja-reportes'

export default function CorteDeCaja() {
  const [session, setSession] = useState<SesionDeCaja | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<CorteCaja | null>(null)
  const [turnoId, setTurnoId] = useState('')
  const reading = useRef(false)
  const scope = useRef({ session, turnoId })
  scope.current = { session, turnoId }
  const refresh = useCallback(async () => {
    if (!session || reading.current) return
    reading.current = true
    try {
      const next = await leerCorteCaja(session, turnoId || undefined)
      if (scope.current.session !== session || scope.current.turnoId !== turnoId) return
      setReport(next); setError('')
    } catch (e) {
      if (scope.current.session !== session || scope.current.turnoId !== turnoId) return
      setReport(null); setError(e instanceof Error ? e.message : 'El corte no está disponible.')
      if (session.expires_at <= Date.now()) setSession(null)
    } finally { reading.current = false }
  }, [session, turnoId])
  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [refresh])
  const signIn = async () => {
    if (busy || !pin) return
    setBusy(true); setError('')
    try {
      // min_role is checked by Caja. It never replaces the POS operator's session.
      const authorized = await ingresarConPinEnCaja(pin, 'gerente')
      const next = await leerCorteCaja(authorized)
      setSession(authorized); setReport(next)
    } catch (e) { setReport(null); setError(e instanceof Error ? e.message : 'Caja no autorizó el acceso.') }
    finally { setPin(''); setBusy(false) }
  }
  const button = 'min-h-[48px] rounded-xl border border-[var(--line)] px-4 py-3 font-semibold disabled:opacity-40'
  return <main className="min-h-screen bg-[var(--surface)] p-5 text-[var(--text-1)] md:p-8">
    <div className="mx-auto max-w-4xl">
      <Link href="/pos/mesas" className={`inline-block ${button}`}>Volver al salón</Link>
      <h1 className="mt-6 text-3xl font-bold">Corte de Caja</h1>
      {error && <p role="alert" className="my-4 rounded-xl bg-red-500/10 p-4 text-red-600">{error}</p>}
      {!session ? <form className="my-6 max-w-sm space-y-4" onSubmit={e => { e.preventDefault(); void signIn() }}>
        <p>Ingresa el PIN de gerente para consultar los cobros confirmados por Caja.</p>
        <label className="block">PIN de gerente<input aria-label="PIN de gerente" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3" /></label>
        <button type="submit" disabled={busy || !pin} className={`${button} bg-blue-600 text-white`}>{busy ? 'Validando…' : 'Consultar corte'}</button>
      </form> : <>
        <div className="my-5 flex flex-wrap items-center gap-3">
          <button className={button} onClick={() => void refresh()}>Actualizar corte</button>
          <button className={button} onClick={() => { setSession(null); setReport(null); setError('') }}>Bloquear reporte</button>
          <Link href="/pos/turno" className={button}>Ir al cierre de turno (Z)</Link>
        </div>
        {report ? <>
          <p className="mb-4">{report.turno?.closedAt ? 'Turno cerrado: consulta de sus cobros confirmados.' : 'Corte X: consulta parcial. El turno permanece abierto.'} Las propinas se muestran separadas de las ventas.</p>
          {report.turnos.length > 0 && <label className="block max-w-xl">Turno consultado<select aria-label="Turno consultado" value={turnoId || report.turno?.id || ''} onChange={e => { setReport(null); setTurnoId(e.target.value) }} className="my-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
            {report.turnos.map(t => <option key={t.id} value={t.id}>{new Date(t.openedAt).toLocaleString('es-MX')} · {t.closedAt ? 'Cerrado' : 'Abierto'}</option>)}
          </select></label>}
          {!report.turno ? <p className="my-6">Caja no tiene turnos registrados para consultar.</p> : <>
            <dl className="my-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ['Venta cobrada', report.sales], ['Propina recibida', report.tips], ['Saldo por cobrar', report.balance],
                ['Efectivo recibido (incluye propina)', report.cash], ['Tarjeta registrada (incluye propina)', report.card], ['Transferencia registrada (incluye propina)', report.transfer],
                ['Proveedor externo (incluye propina)', report.external], ['Venta reservada sin confirmar', report.reserved], ['Propina reservada sin confirmar', report.reservedTips],
                ['Fondo inicial', report.turno.opening], ['Depósitos de efectivo', report.cashDeposits], ['Retiros de efectivo', report.cashWithdrawals], ['Efectivo esperado', report.expectedCash],
                ...(report.turno.closedAt ? [['Efectivo contado', report.turno.counted], ['Diferencia del cierre', report.turno.difference]] : []),
              ] as [string, number | null][]).map(([label, amount]) => <div key={label} className="rounded-xl border border-[var(--line)] p-4"><dt className="text-sm text-[var(--text-3)]">{label}</dt><dd className="mt-2 text-xl font-bold">{amount === null ? 'No disponible' : pesosDeCentavos(amount)}</dd></div>)}
            </dl>
            <p className="my-3">{report.ordersWithPayments} cuentas con pagos · {report.settledOrders} liquidadas · {report.kitchenPending} comandas pendientes en cocina.</p>
            <div className="overflow-x-auto"><table className="w-full text-left"><caption className="py-3 text-left font-bold">Cuentas de cobro del turno</caption><thead><tr>{['Cuenta', 'Venta cobrada', 'Pendiente', 'Propina', 'Estado de cobro'].map(h => <th key={h} className="border-b border-[var(--line)] p-3">{h}</th>)}</tr></thead><tbody>
              {report.orders.map(o => <tr key={o.orderId}><td className="max-w-[180px] break-all p-3">{o.orderId}</td><td className="p-3">{pesosDeCentavos(o.paid)}</td><td className="p-3">{pesosDeCentavos(o.balance)}</td><td className="p-3">{pesosDeCentavos(o.tips)}</td><td className="p-3">{o.settled ? 'Liquidada' : o.reserved ? 'Cobro por confirmar' : 'Pendiente'}</td></tr>)}
            </tbody></table></div>
          </>}
        </> : <p className="my-6">Reporte no disponible. Vuelve a consultar Caja para confirmar los importes.</p>}
      </>}
    </div>
  </main>
}
