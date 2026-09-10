'use client'
import { resolverCajonCaja } from '@/lib/pedro-cajon'
import { useRef, useState } from 'react'
import { autorizarOperacionConPinEnCaja } from '@/lib/pedro-actor'
import { leerImpresionesInciertasCaja, resolverImpresionCaja, type ImpresionInciertaCaja } from '@/lib/pedro-impresion'

export default function ImpresionesInciertasDeCaja({ kind = 'paper' }: { kind?: 'paper' | 'drawer' }) {
  const drawer = kind === 'drawer'
  const filterJobs = (jobs: ImpresionInciertaCaja[]) => jobs.filter(job => (job.document_type === 'drawer_pulse') === drawer)
  const [jobs, setJobs] = useState<ImpresionInciertaCaja[] | null>(null)
  const [selected, setSelected] = useState<ImpresionInciertaCaja | null>(null)
  const [resolution, setResolution] = useState<'printed' | 'reprint' | 'opened' | 'retry_pulse'>(drawer ? 'opened' : 'printed')
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const refresh = async () => {
    if (working.current) return
    working.current = true; setBusy(true); setMessage('')
    try { setJobs(filterJobs(await leerImpresionesInciertasCaja())) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Cola sin confirmar') }
    finally { working.current = false; setBusy(false) }
  }
  const resolve = async () => {
    if (!selected || working.current) return
    working.current = true; setBusy(true); setMessage('')
    try {
      const actor = await autorizarOperacionConPinEnCaja(pin)
      setPin('')
      const confirmed = drawer
        ? { resolution: (await resolverCajonCaja(selected, resolution as 'opened' | 'retry_pulse', reason, actor)).result.drawer_resolution as Record<string, unknown> }
        : await resolverImpresionCaja(selected, resolution as 'printed' | 'reprint', reason, actor)
      setSelected(null); setReason('')
      setMessage(drawer ? (confirmed.resolution.resolution === 'opened' ? 'Caja registró tu verificación del cajón.' : 'Apertura solicitada. Verifica el cajón; no se confirma su posición física.') : confirmed.resolution.resolution === 'printed'
        ? 'Caja registró tu verificación de que el documento salió completo.'
        : 'Caja guardó la solicitud de copia. Verifica su salida en la impresora.')
      setJobs(filterJobs(await leerImpresionesInciertasCaja(actor)))
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Verificación sin confirmar') }
    finally { working.current = false; setBusy(false) }
  }
  return <section aria-label={drawer ? "Revisar cajón incierto" : "Revisar papel incierto"} className="space-y-3 rounded-xl border border-[var(--line)] p-4 text-sm">
    <button disabled={busy} onClick={() => void refresh()} className="rounded border px-3 py-2 disabled:opacity-50">{drawer ? "Consultar aperturas por verificar" : "Consultar impresiones por verificar"}</button>
    {jobs?.length === 0 && <p>{drawer ? "Caja no reporta aperturas inciertas en esta consulta." : "Caja no reporta impresiones inciertas en esta consulta."}</p>}
    {jobs?.map(job => <button key={`${job.job_id}:${job.uncertain_episode_id}`} disabled={busy}
      onClick={() => { setSelected(job); setResolution(drawer ? 'opened' : 'printed'); setReason(''); setPin(''); setMessage('') }}
      className="block rounded border px-3 py-2">{job.printer_name} · {job.document_type} · {job.job_id.slice(0, 12)}</button>)}
    {selected && <div className="space-y-2" role="group" aria-label={drawer ? "Verificar resultado del cajón" : "Verificar resultado de impresión"}>
      <p>{drawer ? "Revisa el cajón antes de decidir. Otro pulso puede volver a abrirlo." : "Revisa la impresora y el documento antes de decidir. Una conexión confirmada no prueba que haya salido papel."}</p>
      <label className="block">Resultado verificado<select disabled={busy} value={resolution} onChange={event => setResolution(event.target.value as typeof resolution)} className="ml-2 rounded border bg-[var(--surface)] p-2">
        <option value={drawer ? "opened" : "printed"}>{drawer ? "Verifiqué la apertura" : "El documento salió completo"}</option><option value={drawer ? "retry_pulse" : "reprint"}>{drawer ? "Solicitar otro pulso" : "Necesito una copia"}</option>
      </select></label>
      <label className="block">Detalle de la verificación<input disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="ml-2 rounded border bg-transparent p-2" /></label>
      <label className="block">PIN del encargado<input disabled={busy} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={event => setPin(event.target.value)} className="ml-2 rounded border bg-transparent p-2" /></label>
      <button disabled={busy || !reason.trim() || !pin} onClick={() => void resolve()} className="rounded border px-3 py-2 disabled:opacity-50">Confirmar verificación en Caja</button>
      <button disabled={busy} onClick={() => { setSelected(null); setPin('') }} className="ml-2 underline">Cerrar</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>
}
