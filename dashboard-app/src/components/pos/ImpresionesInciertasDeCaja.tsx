'use client'
import { resolverCajonCaja } from '@/lib/pedro-cajon'
import { useRef, useState } from 'react'
import { autorizarOperacionConHuellaEnCaja, autorizarOperacionConPinEnCaja, type SesionDeCaja } from '@/lib/pedro-actor'
import { leerImpresionesInciertasCaja, resolverImpresionCaja, type ImpresionInciertaCaja } from '@/lib/pedro-impresion'
import AutorizacionPinOHuella from './AutorizacionPinOHuella'
import { useEstadoHuellaCaja } from './useEstadoHuellaCaja'

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
  const huella = useEstadoHuellaCaja()
  const refresh = async () => {
    if (working.current) return
    working.current = true; setBusy(true); setMessage('')
    try { setJobs(filterJobs(await leerImpresionesInciertasCaja())) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Cola sin confirmar') }
    finally { working.current = false; setBusy(false) }
  }
  const resolve = async (actor: SesionDeCaja) => {
    if (!selected || working.current) return
    working.current = true; setBusy(true); setMessage('')
    try {
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
  const field = 'mt-2 min-h-[56px] w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-3'
  const button = 'min-h-[56px] rounded-xl border border-[var(--line)] px-3 py-2 font-semibold disabled:opacity-50'
  return <section aria-label={drawer ? "Revisar cajón incierto" : "Revisar papel incierto"} className="min-h-0 overflow-y-auto rounded-xl border border-[var(--line)] p-4 text-sm">
    <h2 className="text-lg font-bold">{drawer ? 'Cajón por verificar' : 'Papel por verificar'}</h2>
    <button disabled={busy} onClick={() => void refresh()} className={`${button} mt-3`}>{drawer ? "Consultar aperturas por verificar" : "Consultar impresiones por verificar"}</button>
    {jobs?.length === 0 && <p>{drawer ? "Caja no reporta aperturas inciertas en esta consulta." : "Caja no reporta impresiones inciertas en esta consulta."}</p>}
    {jobs?.map(job => <button key={`${job.job_id}:${job.uncertain_episode_id}`} disabled={busy}
      onClick={() => { setSelected(job); setResolution(drawer ? 'opened' : 'printed'); setReason(''); setPin(''); setMessage('') }}
      className={`${button} mt-2 block w-full text-left`}>{job.printer_name} · {job.document_type} · {job.job_id.slice(0, 12)}</button>)}
    {selected && <div className="mt-3 space-y-3" role="group" aria-label={drawer ? "Verificar resultado del cajón" : "Verificar resultado de impresión"}>
      <p>{drawer ? "Revisa el cajón antes de decidir. Otro pulso puede volver a abrirlo." : "Revisa la impresora y el documento antes de decidir. Una conexión confirmada no prueba que haya salido papel."}</p>
      <label className="block font-medium">Resultado verificado<select disabled={busy} value={resolution} onChange={event => setResolution(event.target.value as typeof resolution)} className={field}>
        <option value={drawer ? "opened" : "printed"}>{drawer ? "Verifiqué la apertura" : "El documento salió completo"}</option><option value={drawer ? "retry_pulse" : "reprint"}>{drawer ? "Solicitar otro pulso" : "Necesito una copia"}</option>
      </select></label>
      <label className="block font-medium">Detalle de la verificación<input disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className={field} /></label>
      <AutorizacionPinOHuella label="Autorizar verificación en Caja" pin={pin} onPinChange={setPin}
        onPin={autorizarOperacionConPinEnCaja} onHuella={autorizarOperacionConHuellaEnCaja} onAuthorized={resolve}
        huellaDisponible={huella.disponible} motivoHuellaNoDisponible={huella.motivo} disabled={busy || !reason.trim()} />
      <button disabled={busy} onClick={() => { setSelected(null); setPin('') }} className={`${button} w-full`}>Cerrar</button>
    </div>}
    {message && <p role="status" className="mt-3">{message}</p>}
  </section>
}
