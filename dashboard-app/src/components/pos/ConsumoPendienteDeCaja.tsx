'use client'
import { useEffect, useRef, useState } from 'react'
import { operacionesConsumoPendientesCaja } from '@/lib/pedro-comandos'
import { recuperarConsumoPendienteCaja } from '@/lib/pedro-operaciones'

/** The receipt is evidence of the original operation, never a replacement for
 * the current account: another terminal may already have settled it. */
export default function ConsumoPendienteDeCaja({ onRecovered, disabled = false }: { onRecovered: () => void; disabled?: boolean }) {
  const [pending, setPending] = useState<ReturnType<typeof operacionesConsumoPendientesCaja>>([])
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const refresh = () => setPending(operacionesConsumoPendientesCaja())
    refresh()
    window.addEventListener('storage', refresh)
    window.addEventListener('pos:comandos-pendientes', refresh)
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('pos:comandos-pendientes', refresh) }
  }, [])
  if (!pending.length && !message) return null
  return <section aria-label="Consumo pendiente de confirmar" className="px-4 py-3 bg-amber-950 text-amber-100 text-sm">
    {pending.length > 0 && <p>Hay guardados o envíos sin confirmar. Recupera el resultado original aunque la cuenta ya se haya cobrado. Tu borrador se conserva.</p>}
    {pending.map(({ operation, command }) => <button key={operation} disabled={disabled || busy}
      className="mt-2 mr-2 rounded border border-amber-300 px-3 py-2 disabled:opacity-50" onClick={async () => {
        if (working.current) return
        working.current = true; setBusy(true); setMessage('')
        try {
          await recuperarConsumoPendienteCaja(operation)
          setMessage('Resultado original recuperado. Consulta el estado actual de la cuenta; tu borrador se conserva.')
          onRecovered()
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Caja no confirmó el resultado.') }
        finally { working.current = false; setBusy(false); setPending(operacionesConsumoPendientesCaja()) }
      }}>Recuperar {command.command_type === 'ORDER_SAVE' ? 'guardado' : 'envío'} · {command.mesa ? `Mesa ${command.mesa}` : String(command.order_id)}</button>)}
    {message && <p role="status" className="mt-2">{message}</p>}
  </section>
}
