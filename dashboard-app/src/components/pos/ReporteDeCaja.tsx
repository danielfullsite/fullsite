'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { leerReporteCaja } from '@/lib/pedro-reportes'
import { pesosDeCentavos } from '@/lib/pedro-finanzas'
import { autorizarOperacionConHuellaEnCaja, autorizarOperacionConPinEnCaja, type SesionDeCaja } from '@/lib/pedro-actor'
import AutorizacionPinOHuella from './AutorizacionPinOHuella'
import { useEstadoHuellaCaja } from './useEstadoHuellaCaja'

export default function ReporteDeCaja() {
  const [result, setResult] = useState<Awaited<ReturnType<typeof leerReporteCaja>> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [pin, setPin] = useState('')
  const [token, setToken] = useState<string>()
  const huella = useEstadoHuellaCaja()
  const load = async (approval?: string) => {
    setBusy(true); setError(''); setResult(null)
    try { setResult(await leerReporteCaja(undefined, approval)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Reporte no disponible') }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])
  const authorize = async (session: SesionDeCaja) => {
    setBusy(true); setError('')
    try {
      setToken(session.actor_token); setPin(''); await load(session.actor_token)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se confirmó el permiso'); setBusy(false) }
  }
  const report = result?.report
  return <main className="mx-auto max-w-4xl space-y-3 p-4 text-[var(--text-1)]">
    <Link className="inline-flex min-h-[56px] items-center rounded-xl border border-[var(--line)] px-4" href="/pos/mesas">← Volver a mesas</Link>
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Corte de Caja</h1>
      <button disabled={busy} onClick={() => void load(token)} className="min-h-[56px] rounded-xl border px-4">Actualizar</button></div>
    <p className="text-sm text-[var(--text-2)]">Importes confirmados por Caja. Consultar el corte X no cierra el turno.</p>
    {busy && <p role="status">Consultando Caja…</p>}
    {error && <div role="alert" className="rounded-xl border border-amber-500 p-3"><p>{error}</p>
      <div className="mt-2"><AutorizacionPinOHuella label="Autorizar consulta de Corte X" pin={pin} onPinChange={setPin}
        onPin={autorizarOperacionConPinEnCaja} onHuella={autorizarOperacionConHuellaEnCaja} onAuthorized={authorize}
        huellaDisponible={huella.disponible} motivoHuellaNoDisponible={huella.motivo} disabled={busy} /></div></div>}
    {report && <>
      <p>Turno {report.turno_id} · {result.closed ? 'Cerrado · Z' : 'Abierto · X'}</p>
      <dl className="grid grid-cols-2 gap-3">
        {[
          ['Cobrado confirmado', report.total_paid_cents], ['Cobrado en efectivo', report.cash_sales_cents],
          ['Depósitos', report.deposits_cents], ['Retiros', report.withdrawals_cents],
          ['Fondo inicial', report.opening_cash_cents], ['Efectivo esperado', report.expected_cash_cents],
          ['Saldo por cobrar', report.balance_cents], ['Cobros pendientes de resolver', report.reserved_cents],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[var(--line)] p-3"><dt className="text-sm text-[var(--text-2)]">{label}</dt><dd className="text-2xl font-semibold">{pesosDeCentavos(Number(value))}</dd></div>)}
      </dl>
      <p>{report.settled_orders} cuentas pagadas · {report.open_orders} cuentas con saldo. Los cobros parciales están incluidos; el avance de cocina no cambia el dinero.</p>
      {result.close && <p>Contado: {pesosDeCentavos(result.close.counted_cash_cents)} · Diferencia: {pesosDeCentavos(result.close.difference_cents)}</p>}
      <Link className="inline-flex min-h-[56px] items-center rounded-xl border px-4" href="/pos/turno">Ir a apertura y cierre Z</Link>
    </>}
  </main>
}
