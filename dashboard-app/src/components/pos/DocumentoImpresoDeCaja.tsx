'use client'
import { useEffect, useRef, useState } from 'react'
import { imprimirPrecuentaCaja, imprimirReciboPagoCaja, leerDocumentosCaja, type DocumentoDeCaja } from '@/lib/pedro-impresion'
import type { FinanzasDeCaja } from '@/lib/pedro-finanzas'

type Props = { order: { id: string; order_revision: number; financial_order?: FinanzasDeCaja | null }; paymentId?: string }
/** Printing receives saved identity/revisions. Draft products and browser totals
 * never enter the command. An explicit copy preserves the original document. */
export default function DocumentoImpresoDeCaja({ order, paymentId }: Props) {
  const [original, setOriginal] = useState<DocumentoDeCaja | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const working = useRef(false)
  const scope = `${order.id}:${order.order_revision}:${order.financial_order?.revision ?? 0}:${paymentId ?? ''}`
  const currentScope = useRef(scope)
  useEffect(() => { currentScope.current = scope }, [scope])
  const refresh = async () => {
    const documents = await leerDocumentosCaja(order.id)
    if (currentScope.current !== scope) return
    const found = documents.find(document => !document.original_document_id && (paymentId
      ? document.payment_id === paymentId
      : !document.payment_id && document.order_revision === order.order_revision &&
        (document.financial_revision ?? 0) === (order.financial_order?.revision ?? 0)))
    setOriginal(found || null); setReady(true)
  }
  useEffect(() => {
    let active = true
    setReady(false); setOriginal(null); setReason(''); setMessage('')
    void leerDocumentosCaja(order.id).then(documents => {
      if (!active) return
      const found = documents.find(document => !document.original_document_id && (paymentId
        ? document.payment_id === paymentId
        : !document.payment_id && document.order_revision === order.order_revision &&
          (document.financial_revision ?? 0) === (order.financial_order?.revision ?? 0)))
      setOriginal(found || null); setReady(true)
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Documentos sin confirmar') })
    return () => { active = false }
  }, [order.id, order.order_revision, order.financial_order?.revision, paymentId])
  const print = async () => {
    if (working.current) return
    working.current = true; setBusy(true); setMessage('')
    try {
      const copy = original ? { originalDocumentId: original.document_id, reason } : undefined
      const receipt = paymentId
        ? await imprimirReciboPagoCaja(order.financial_order!, paymentId, copy)
        : await imprimirPrecuentaCaja(order, copy)
      if (currentScope.current !== scope) return
      setMessage(`${receipt.recovered ? 'Solicitud original recuperada' : 'Solicitud confirmada'}. El trabajo quedó guardado en Caja; verifica el papel en la impresora.`)
      if (!receipt.recovered) setReason('')
      await refresh()
    } catch (error) {
      if (currentScope.current !== scope) return
      setMessage(error instanceof Error ? error.message : 'Caja no confirmó la impresión.')
      await refresh().catch(() => { setReady(false) })
    } finally { working.current = false; setBusy(false) }
  }
  const title = paymentId ? 'recibo del abono' : 'precuenta'
  return <section aria-label={`Impresión de ${title}`} className="space-y-2 text-sm">
    {original && <label className="block">Motivo de la copia<input disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="ml-2 rounded border bg-transparent p-2" /></label>}
    <button disabled={!ready || busy || !!original && !reason.trim() || !!paymentId && !order.financial_order}
      onClick={() => void print()} className="rounded border px-3 py-2 disabled:opacity-50">{busy ? 'Confirmando impresión…' : `Imprimir ${original ? 'copia de ' : ''}${title}`}</button>
    {!ready && <button disabled={busy} onClick={() => void refresh().catch(error => setMessage(error.message))} className="ml-2 underline">Verificar documentos en Caja</button>}
    {!paymentId && <p>La precuenta muestra consumo confirmado; no acredita pago.</p>}
    {message && <p role="status">{message}</p>}
  </section>
}
