'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import MovimientoDeCaja from './MovimientoDeCaja'
import { leerTurnosCaja, cerrarTurnoCaja, type TurnoDeCaja as Turno, type CierreDeCaja } from '@/lib/pedro-turnos'
import { centavosDeTexto, pesosDeCentavos } from '@/lib/pedro-finanzas'
import { openTurno, logAudit } from '@/lib/pos-data'
import { evaluarFondoDeApertura, type LecturaDelCierreAnterior } from '@/lib/pos-cierre-guard'

/**
 * MISMA CONFRONTACION QUE EN LA PANTALLA LEGADA, PORQUE ES EL MISMO AGUJERO.
 *
 * En modo Caja esta pantalla reemplaza a `TurnoPageLegacy` por completo: tiene su
 * propio formulario de apertura y llama a `openTurno` por su cuenta. Arreglar solo
 * la otra habria dejado el hueco abierto justo en el modo que va a correr AMALAY.
 *
 * Aqui la lectura del cierre anterior ya venia en la mano: `leerTurnosCaja()`
 * devuelve `turn_summaries`, y el ultimo trae `counted_cash_cents`. No hace falta
 * una consulta nueva.
 *
 * `centavosDeTexto` LANZA con texto invalido; la politica quiere `null` para eso.
 */
function pesosDelCampo(texto: string): number | null {
  try { return centavosDeTexto(texto) / 100 } catch { return null }
}

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
        if (!veredictoDelFondo.puedeAbrir) {
          setError(veredictoDelFondo.motivo || 'Revisa el fondo de caja.')
          return
        }
        await openTurno(cents / 100, '')
        const abierto = (await leerTurnosCaja()).turno
        setTurno(abierto)
        // El comando TURN_OPEN de Caja solo lleva `opening_cash_cents`, asi que la
        // explicacion no cabe ahi sin cambiar el contrato del local-server y
        // reinstalar. `logAudit` encola en IndexedDB si falla la red, asi que el
        // rastro sobrevive igual a una apertura sin internet.
        logAudit({
          action: 'status_changed', actor: 'Caja',
          reason: notes.trim() || undefined,
          details: {
            type: 'turno_opened', fondo: cents / 100, turno_id: abierto?.id ?? null,
            contado_al_cerrar: lecturaDelCierre.determinado ? (lecturaDelCierre.cierre?.contado ?? null) : null,
            diferencia_contra_cierre: veredictoDelFondo.diferencia,
            confrontado: lecturaDelCierre.determinado,
            explicacion: notes.trim() || null,
          },
        })
      }
      setAmount(''); setNotes('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Caja no confirmó la operación.') }
    finally { working.current = false; setBusy(false) }
  }
  const latest = cierres.at(-1)
  // Sin conexion confirmada con Caja no se sabe que dejo el corte anterior, y eso
  // NO es lo mismo que "no dejo nada". La apertura ya esta bloqueada por
  // `!connected`, asi que aqui solo se evita mentir sobre la comparacion.
  const lecturaDelCierre: LecturaDelCierreAnterior = !connected
    ? { determinado: false, motivo: 'sin conexión confirmada con Caja' }
    : {
        determinado: true,
        cierre: latest ? {
          contado: latest.counted_cash_cents / 100,
          fecha: new Date(latest.closed_at).toLocaleDateString('es-MX'),
          closedBy: latest.closed_by, folioZ: null,
        } : null,
      }
  const veredictoDelFondo = evaluarFondoDeApertura(pesosDelCampo(amount), lecturaDelCierre, notes)
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
        {/* Lo que dejo contado el corte anterior, enfrente del numero que se teclea.
            Que NO coincidan es normal: el gerente se lleva la venta al banco. Lo que
            estaba mal era que no coincidieran en silencio. */}
        {!turno && veredictoDelFondo.aviso && (
          <p className={`rounded-xl p-3 text-sm ${veredictoDelFondo.exigeExplicacion
            ? 'bg-amber-500/10 text-amber-500' : 'bg-[var(--line)]/40 text-[var(--text-3)]'}`}>
            {veredictoDelFondo.aviso}
          </p>
        )}
        {(turno || veredictoDelFondo.exigeExplicacion) && <label className="block">
          {turno ? 'Notas del cierre' : '¿A dónde se fue (o de dónde salió) la diferencia?'}
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-2 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3" /></label>}
        {!turno && veredictoDelFondo.motivo && amount.trim() !== '' && (
          <p className="text-xs text-amber-500">{veredictoDelFondo.motivo}</p>
        )}
        <button disabled={busy || !connected || !amount || (!turno && !veredictoDelFondo.puedeAbrir)} onClick={act} className="min-h-[48px] w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-40">
          {busy ? 'Confirmando con Caja…' : turno ? 'Confirmar cierre de turno' : 'Abrir turno'}
        </button>
      </div>
      {turno && connected && <MovimientoDeCaja turnoId={turno.id} />}
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
