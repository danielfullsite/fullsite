'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import ImpresionesInciertasDeCaja from './ImpresionesInciertasDeCaja'
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

type PestanaTurno = 'turno' | 'movimiento' | 'ultimo' | 'verificaciones'

export default function TurnoDeCaja() {
  const [turno, setTurno] = useState<Turno | null>(null)
  const [cierres, setCierres] = useState<CierreDeCaja[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [pestana, setPestana] = useState<PestanaTurno>('turno')
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
        setCierres(previous => [...previous.filter(c => c.id !== close.id), close]); setTurno(null); setPestana('ultimo')
      } else {
        if (!veredictoDelFondo.puedeAbrir) {
          setError(veredictoDelFondo.motivo || 'Revisa el fondo de caja.')
          return
        }
        await openTurno(cents / 100, '', notes.trim())
        const abierto = (await leerTurnosCaja()).turno
        setTurno(abierto)
        // La evidencia autoritativa ya viaja en TURN_OPEN. Esta auditoría es
        // complementaria para las pantallas legacy; no confirma la apertura.
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
  const pestanaVisible = pestana === 'movimiento' && (!turno || !connected) || pestana === 'ultimo' && !latest
    ? 'turno' : pestana
  const pestanas: Array<{ id: PestanaTurno; label: string; disabled?: boolean }> = [
    { id: 'turno', label: 'Turno' },
    { id: 'movimiento', label: 'Retiro / Depósito', disabled: !turno || !connected },
    { id: 'ultimo', label: 'Último cierre', disabled: !latest },
    { id: 'verificaciones', label: 'Verificaciones' },
  ]

  return <main className="flex h-dvh flex-col overflow-hidden bg-[var(--surface)] text-[var(--text-1)]">
    <header className="flex flex-shrink-0 items-center gap-4 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-2">
      <Link href="/pos/mesas" className="flex min-h-[56px] items-center rounded-xl border border-[var(--line)] px-4 font-bold active:scale-95">Volver al salón</Link>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold">Turno de Caja</h1>
        <p className="truncate text-sm text-[var(--text-3)]">{connected ? turno ? 'Turno abierto y compartido con las terminales.' : 'No hay turno abierto.' : 'Sin conexión confirmada con Caja. La apertura y el cierre están bloqueados.'}</p>
      </div>
      {turno && <p className="hidden text-right text-sm sm:block">Fondo inicial<br /><strong className="text-lg">{pesosDeCentavos(turno.opening_cash_cents)}</strong></p>}
    </header>

    <div className="grid flex-shrink-0 grid-cols-4 gap-2 border-b border-[var(--line)] px-3 py-2" role="tablist" aria-label="Operaciones del turno">
      {pestanas.map(opcion => <button key={opcion.id} id={`tab-turno-${opcion.id}`} type="button" role="tab"
        aria-selected={pestanaVisible === opcion.id} aria-controls={`panel-turno-${opcion.id}`} disabled={opcion.disabled}
        onClick={() => setPestana(opcion.id)}
        className={`min-h-[56px] rounded-xl border px-2 text-sm font-bold active:scale-[0.98] disabled:opacity-35 ${pestanaVisible === opcion.id ? 'border-emerald-500 bg-[var(--accent-soft)] text-[var(--accent-ink)]' : 'border-[var(--line)] text-[var(--text-3)]'}`}>
        {opcion.label}
      </button>)}
    </div>

    <div className="min-h-0 flex-1 overflow-hidden p-3">
      <section id="panel-turno-turno" role="tabpanel" aria-labelledby="tab-turno-turno" hidden={pestanaVisible !== 'turno'} className="mx-auto h-full max-w-4xl">
        <div className="flex h-full flex-col rounded-2xl border border-[var(--line)] p-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div><h2 className="text-xl font-bold">{turno ? 'Cerrar turno' : 'Abrir turno'}</h2>
              <p className="text-sm text-[var(--text-3)]">{turno ? 'Cuenta el efectivo y confirma el cierre con Caja.' : 'Registra el efectivo inicial antes de operar.'}</p></div>
            {turno && <p className="text-sm sm:hidden">Fondo: <strong>{pesosDeCentavos(turno.opening_cash_cents)}</strong></p>}
          </div>
          {error && <p role="alert" className="mb-3 rounded-xl bg-red-500/10 p-3 text-[var(--crit-ink)]">{error}</p>}
          {turno?.opening_reconciliation?.reason && <p className="mb-3 rounded-xl bg-[var(--line)]/40 p-3 text-sm">Motivo del fondo: {turno.opening_reconciliation.reason}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block font-medium">{turno ? 'Efectivo contado al cierre' : 'Fondo inicial en efectivo'}
              <input aria-label={turno ? 'Efectivo contado al cierre' : 'Fondo inicial en efectivo'} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
                className="mt-2 min-h-[56px] w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xl" /></label>
            {(turno || veredictoDelFondo.exigeExplicacion) && <label className="block font-medium">
              {turno ? 'Notas del cierre' : '¿A dónde se fue (o de dónde salió) la diferencia?'}
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-2 min-h-[72px] w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3" /></label>}
          </div>
          {!turno && veredictoDelFondo.aviso && <p className={`mt-3 rounded-xl p-3 text-sm ${veredictoDelFondo.exigeExplicacion
            ? 'bg-amber-500/10 text-amber-500' : 'bg-[var(--line)]/40 text-[var(--text-3)]'}`}>{veredictoDelFondo.aviso}</p>}
          {!turno && veredictoDelFondo.motivo && amount.trim() !== '' && <p className="mt-2 text-xs text-amber-500">{veredictoDelFondo.motivo}</p>}
          <button disabled={busy || !connected || !amount || (!turno && !veredictoDelFondo.puedeAbrir)} onClick={act}
            className="mt-auto min-h-[64px] w-full rounded-xl bg-blue-600 px-4 py-3 text-lg font-bold text-white active:scale-[0.99] disabled:opacity-40">
            {busy ? 'Confirmando con Caja…' : turno ? 'Confirmar cierre de turno' : 'Abrir turno'}
          </button>
        </div>
      </section>

      <div id="panel-turno-movimiento" role="tabpanel" aria-labelledby="tab-turno-movimiento" hidden={pestanaVisible !== 'movimiento'} className="mx-auto h-full max-w-4xl">
        {turno && <MovimientoDeCaja turnoId={turno.id} />}
      </div>

      <div id="panel-turno-ultimo" role="tabpanel" aria-labelledby="tab-turno-ultimo" hidden={pestanaVisible !== 'ultimo'} className="mx-auto h-full max-w-4xl">
        {latest && <section aria-label="Último cierre confirmado" className="flex h-full flex-col rounded-2xl border border-emerald-600 p-5">
          <h2 className="text-xl font-bold">Último cierre confirmado</h2>
          <p className="mt-1 text-sm text-[var(--text-3)]">{new Date(latest.closed_at).toLocaleString('es-MX')}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">{[
            ['Fondo inicial', latest.opening_cash_cents], ['Ventas en efectivo', latest.cash_sales_cents],
            ['Total cobrado', latest.total_paid_cents], ['Efectivo esperado', latest.expected_cash_cents],
            ['Efectivo contado', latest.counted_cash_cents], ['Diferencia', latest.difference_cents],
          ].map(([label, value]) => <div key={label} className="rounded-xl bg-[var(--surface-2)] p-4"><dt className="text-sm text-[var(--text-3)]">{label}</dt><dd className="mt-1 text-xl font-bold">{pesosDeCentavos(Number(value))}</dd></div>)}</dl>
        </section>}
      </div>

      <div id="panel-turno-verificaciones" role="tabpanel" aria-labelledby="tab-turno-verificaciones" hidden={pestanaVisible !== 'verificaciones'} className="mx-auto h-full max-w-5xl">
        <div className="grid h-full min-h-0 gap-3 md:grid-cols-2">
          <ImpresionesInciertasDeCaja />
          <ImpresionesInciertasDeCaja kind="drawer" />
        </div>
      </div>
    </div>
  </main>
}
