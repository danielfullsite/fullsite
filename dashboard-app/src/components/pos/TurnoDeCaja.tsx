'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { leerTurnosCaja, cerrarTurnoCaja, type TurnoDeCaja as Turno, type CierreDeCaja } from '@/lib/pedro-turnos'
import { centavosDeTexto, pesosDeCentavos } from '@/lib/pedro-finanzas'
import { openTurno } from '@/lib/pos-data'

export default function TurnoDeCaja() {
  const [turno, setTurno] = useState<Turno | null>(null)
  const [cierres, setCierres] = useState<CierreDeCaja[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  useEffect(() => {
    let alive = true, pending = false
    const read = async () => {
      if (pending || working.current) return
      pending = true
      try {
        const state = await leerTurnosCaja()
        if (alive) { setTurno(state.turno); setCierres(state.cierres); setConnected(true) }
      } catch { if (alive) setConnected(false) }
      finally { pending = false }
    }
    void read(); const timer = setInterval(read, 1000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  const act = async () => {
    if (working.current || !connected) return
    working.current = true; setBusy(true); setError('')
    try {
      const cents = centavosDeTexto(amount)
      if (turno) {
        const close = await cerrarTurnoCaja(turno.id, cents, notes)
        setCierres(previous => [...previous.filter(c => c.id !== close.id), close]); setTurno(null)
      } else {
        await openTurno(cents / 100, '')
        setTurno((await leerTurnosCaja()).turno)
      }
      setAmount(''); setNotes('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Caja no confirmó la operación.') }
    finally { working.current = false; setBusy(false) }
  }
  const latest = cierres.at(-1)
  return <main className="min-h-screen bg-[var(--surface)] text-[var(--text-1)] p-5 md:p-8">
    <div className="mx-auto max-w-2xl">
      <Link href="/pos/mesas" className="inline-block rounded-lg border border-[var(--line)] px-4 py-3">Volver al salón</Link>
      <h1 className="mt-6 text-3xl font-bold">Turno de Caja</h1>
      <p className="mt-2">{connected ? turno ? 'Turno abierto y compartido con las terminales.' : 'No hay turno abierto.' : 'Sin conexión confirmada con Caja. La apertura y el cierre están bloqueados.'}</p>
      {error && <p role="alert" className="my-4 rounded-xl bg-red-500/10 p-3 text-red-600">{error}</p>}
      {turno && <p className="my-5">Fondo inicial: <strong>{pesosDeCentavos(turno.opening_cash_cents)}</strong></p>}
      <div className="my-6 rounded-2xl border border-[var(--line)] p-5 space-y-4">
        <label className="block">{turno ? 'Efectivo contado al cierre' : 'Fondo inicial en efectivo'}
          <input aria-label={turno ? 'Efectivo contado al cierre' : 'Fondo inicial en efectivo'} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-xl" /></label>
        {turno && <label className="block">Notas del cierre<textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3" /></label>}
        <button disabled={busy || !connected || !amount} onClick={act} className="min-h-[48px] w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-40">
          {busy ? 'Confirmando con Caja…' : turno ? 'Confirmar cierre de turno' : 'Abrir turno'}
        </button>
      </div>
      {latest && <section aria-label="Último cierre confirmado" className="rounded-2xl border border-emerald-600 p-5">
        <h2 className="text-xl font-bold">Último cierre confirmado</h2>
        <p className="my-2 text-sm">{new Date(latest.closed_at).toLocaleString('es-MX')}</p>
        <dl className="space-y-2">{[
          ['Fondo inicial', latest.opening_cash_cents], ['Ventas en efectivo', latest.cash_sales_cents],
          ['Total cobrado', latest.total_paid_cents], ['Efectivo esperado', latest.expected_cash_cents],
          ['Efectivo contado', latest.counted_cash_cents], ['Diferencia', latest.difference_cents],
        ].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="font-semibold">{pesosDeCentavos(Number(value))}</dd></div>)}</dl>
      </section>}
    </div>
  </main>
}
