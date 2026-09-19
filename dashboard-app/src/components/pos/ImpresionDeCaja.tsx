'use client'
import { useEffect, useRef, useState } from 'react'
import { leerCuentasImprimibles, solicitarDocumentoCaja, solicitarCopiaCaja, solicitarCajonCaja, type DocumentoDeCaja } from '@/lib/pedro-impresion'
import { pesosDeCentavos } from '@/lib/pedro-finanzas'

export default function ImpresionDeCaja({ mode, orderId, onClose }: { mode: 'precheck' | 'receipt' | 'drawer'; orderId?: string; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof leerCuentasImprimibles>> | null>(null)
  const [selected, setSelected] = useState(orderId ?? '')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  const [original, setOriginal] = useState<DocumentoDeCaja | null>(null), [result, setResult] = useState<DocumentoDeCaja | null>(null)
  const [reason, setReason] = useState(''), [pin, setPin] = useState(''), [verified, setVerified] = useState(false)
  const working = useRef(false)
  useEffect(() => {
    let alive = true
    setData(null); setError('')
    void leerCuentasImprimibles().then(next => { if (alive) setData(next) }).catch(e => { if (alive) setError(e instanceof Error ? e.message : 'No se pudo consultar Caja.') })
    return () => { alive = false }
  }, [refresh])
  const choices = data ? mode === 'receipt' ? data.recibos : data.precuentas.filter(order => !orderId || order.id === orderId) : []
  const account = choices.find(order => order.id === selected) ?? (mode === 'precheck' ? choices[0] : undefined)
  const run = async (action: () => Promise<DocumentoDeCaja>, copy = false) => {
    if (working.current) return
    working.current = true; setBusy(true); setError('')
    try {
      const document = await action(); setResult(document)
      if (!copy && document.kind !== 'drawer') setOriginal(document)
    } catch (e) { setError(e instanceof Error ? e.message : 'Caja no confirmó el trabajo.') }
    finally { working.current = false; setBusy(false); setPin('') }
  }
  const button = 'min-h-[48px] rounded-xl border border-[var(--line)] px-4 py-3 font-semibold disabled:opacity-40'
  const input = 'mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3'
  return <div role="dialog" aria-modal="true" aria-labelledby="print-caja-title" className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4"
    onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() } }}>
    <section className="max-h-[92vh] w-full max-w-xl space-y-4 overflow-auto rounded-2xl bg-[var(--surface)] p-6 text-[var(--text)] shadow-xl">
      <div className="flex items-center justify-between gap-3"><h2 id="print-caja-title" className="text-2xl font-bold">{mode === 'drawer' ? 'Cajón de Caja' : mode === 'precheck' ? 'Precuenta de Caja' : 'Recibos de Caja'}</h2>
        <button autoFocus className={button} disabled={busy} onClick={onClose}>Cerrar</button></div>
      {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-red-600">{error}</p>}
      <button className={button} disabled={busy} onClick={() => { setResult(null); setOriginal(null); setRefresh(value => value + 1) }}>Consultar Caja de nuevo</button>
      {!data && !error && <p>Consultando los documentos confirmados…</p>}
      {data && mode !== 'drawer' && <>
        {choices.length ? <>
          <label className="block">Cuenta<select aria-label="Cuenta del documento" className={input} disabled={busy} value={account?.id ?? ''}
            onChange={event => { setSelected(event.target.value); setOriginal(null); setResult(null) }}><option value="" disabled>Selecciona la cuenta con pagos confirmados</option>{choices.map(order => <option key={order.id} value={order.id}>{order.label}</option>)}</select></label>
          {account && <p>Consumo: {pesosDeCentavos(account.total)} · Pagado: {pesosDeCentavos(account.paid)} · Propina recibida: {pesosDeCentavos(account.tip)}</p>}
          <button className={`${button} bg-blue-600 text-white`} disabled={busy || !account}
            onClick={() => run(() => solicitarDocumentoCaja(mode, account!))}>{mode === 'precheck' ? 'Solicitar precuenta' : 'Solicitar recibo de pagos'}</button>
        </> : <p>{mode === 'receipt' ? 'No hay pagos aceptados para emitir un recibo.' : 'No hay consumo guardado de esta cuenta para imprimir.'}</p>}
      </>}
      {data && mode === 'drawer' && <>
        {!data.turnoId && <p>No hay turno abierto. Abre el turno en Caja antes de solicitar el cajón.</p>}
        <label className="block">Motivo de apertura<input aria-label="Motivo de apertura" className={input} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className={`${button} bg-blue-600 text-white`} disabled={busy || !data.turnoId || !reason.trim() || result?.kind === 'drawer'}
          onClick={() => run(() => solicitarCajonCaja(data.turnoId!, reason))}>Solicitar apertura de cajón</button>
      </>}
      {result && <div role="status" className="space-y-2 rounded-xl bg-emerald-500/10 p-3">
        <p>{result.kind === 'drawer' ? 'Solicitud de cajón guardada en Caja. Verifica físicamente la apertura.' : 'Trabajo guardado en Caja. Verifica la salida del papel; este aviso no confirma que se imprimió.'}</p>
        <p className="break-all text-sm">{result.copy ? 'COPIA · ' : ''}Trabajo: {result.job_ids.join(', ')}</p>
      </div>}
      {original && <div className="space-y-3 border-t border-[var(--line)] pt-4">
        <h3 className="font-bold">Copia autorizada</h3>
        <p className="text-sm">El original conserva su trabajo aunque vuelvas a solicitarlo. Revisa la impresora antes de pedir otra hoja; un envío incierto no se repite automáticamente.</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} />Revisé el papel y solicito una copia adicional.</label>
        <label className="block">Motivo de la copia<input aria-label="Motivo de la copia" className={input} maxLength={200} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <label className="block">PIN de gerente<input aria-label="PIN de gerente para copia" className={input} type="password" value={pin} autoComplete="off" onChange={event => setPin(event.target.value)} /></label>
        <button className={button} disabled={busy || !verified || !reason.trim() || !pin}
          onClick={() => run(() => solicitarCopiaCaja(original, reason, pin), true)}>Solicitar COPIA con autorización</button>
      </div>}
    </section>
  </div>
}
