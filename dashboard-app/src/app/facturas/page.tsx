'use client'

import { useState, useCallback, useEffect } from 'react'
import { Upload, FileText, CheckCircle, AlertTriangle, DollarSign, Inbox, Loader2, Mail, Check, RotateCcw } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import { formatCurrency } from '@/lib/format'

interface CfdiRequest {
  id: string
  order_id: string | null
  total: number | null
  rfc: string
  razon_social: string
  regimen_fiscal: string
  uso_cfdi: string
  codigo_postal: string
  email: string
  status: string
  folio_fiscal: string | null
  requested_by: string | null
  created_at: string
}

function CfdiRequestsSection() {
  const [requests, setRequests] = useState<CfdiRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [folioDraft, setFolioDraft] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/factura')
      const data = await res.json()
      if (data.ok) setRequests(data.requests)
    } catch { /* noop */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const updateStatus = async (id: string, status: string, folio?: string) => {
    setSavingId(id)
    try {
      const res = await fetch('/api/factura', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, ...(folio !== undefined ? { folio_fiscal: folio } : {}) }),
      })
      const data = await res.json()
      if (data.ok) {
        setRequests(prev => prev.map(r => r.id === id ? { ...r, status, folio_fiscal: folio !== undefined ? folio : r.folio_fiscal } : r))
      }
    } catch { /* noop */ }
    setSavingId('')
  }

  const pendientes = requests.filter(r => r.status === 'pendiente')
  const visible = showAll ? requests : pendientes

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-amber-500" />
          <h2 className="text-sm font-bold text-[var(--text-1)]">Solicitudes de clientes (QR del ticket)</h2>
          {pendientes.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 text-[11px] font-bold">{pendientes.length} pendiente{pendientes.length === 1 ? '' : 's'}</span>
          )}
        </div>
        {requests.length > pendientes.length && (
          <button onClick={() => setShowAll(s => !s)} className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors">
            {showAll ? 'Solo pendientes' : `Ver todas (${requests.length})`}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-3)] px-1 py-4">
          <Loader2 size={14} className="animate-spin" /> Cargando solicitudes...
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] px-4 py-4 text-sm text-[var(--text-3)]">
          {requests.length === 0 ? 'Sin solicitudes de factura todavía. Llegan cuando un cliente escanea el QR de su ticket.' : 'Sin solicitudes pendientes.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(r => (
            <div key={r.id} className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-[var(--text-1)] truncate">{r.razon_social}</p>
                    {r.status === 'facturada' ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 text-[10px] font-bold uppercase">Facturada</span>
                    ) : r.status === 'error' ? (
                      <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[10px] font-bold uppercase">Error</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 text-[10px] font-bold uppercase">Pendiente</span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-3)] mt-0.5">
                    RFC: <span className="font-medium text-[var(--text-2)]">{r.rfc}</span> · Régimen {r.regimen_fiscal} · Uso {r.uso_cfdi} · CP {r.codigo_postal}
                  </p>
                  <p className="text-xs text-[var(--text-3)] mt-0.5 flex items-center gap-1">
                    <Mail size={11} /> {r.email}
                    {r.order_id && <span> · Orden {r.order_id}</span>}
                    <span> · {new Date(r.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  {r.folio_fiscal && <p className="text-[10px] text-[var(--text-3)] mt-0.5">Folio fiscal: {r.folio_fiscal}</p>}
                </div>
                <div className="flex items-center gap-3">
                  {r.total != null && <p className="text-lg font-bold text-[var(--text-1)] tabular-nums">{formatCurrency(r.total)}</p>}
                  {r.status === 'pendiente' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={folioDraft[r.id] || ''}
                        onChange={e => setFolioDraft(prev => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder="Folio fiscal (opcional)"
                        className="w-44 bg-[var(--bg)] border border-[var(--line)] rounded-lg px-3 py-2 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        onClick={() => updateStatus(r.id, 'facturada', folioDraft[r.id]?.trim() || '')}
                        disabled={savingId === r.id}
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors"
                      >
                        {savingId === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Facturada
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => updateStatus(r.id, 'pendiente')}
                      disabled={savingId === r.id}
                      className="flex items-center gap-1.5 px-3 py-2 bg-[var(--bg)] border border-[var(--line)] hover:border-[var(--text-3)] text-[var(--text-2)] rounded-lg text-xs font-medium transition-colors"
                      title="Regresar a pendiente"
                    >
                      {savingId === r.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                      Reabrir
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface CFDIData {
  uuid: string
  emisor: { rfc: string; nombre: string }
  receptor: { rfc: string; nombre: string }
  fecha: string
  subtotal: number
  iva: number
  total: number
  conceptos: { descripcion: string; cantidad: number; unitario: number; importe: number }[]
  raw?: string
}

function parseCFDI(xml: string): CFDIData | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')

    // Handle CFDI 4.0 namespace
    const comp = doc.querySelector('Comprobante') || doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Comprobante')[0]
    if (!comp) return null

    const emisorEl = comp.querySelector('Emisor') || doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Emisor')[0]
    const receptorEl = comp.querySelector('Receptor') || doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Receptor')[0]
    const tfdEl = doc.querySelector('TimbreFiscalDigital') || doc.getElementsByTagNameNS('http://www.sat.gob.mx/TimbreFiscalDigital', 'TimbreFiscalDigital')[0]

    const conceptosEls = comp.querySelectorAll('Concepto').length > 0
      ? comp.querySelectorAll('Concepto')
      : doc.getElementsByTagNameNS('http://www.sat.gob.mx/cfd/4', 'Concepto')

    const conceptos = Array.from(conceptosEls).map(c => ({
      descripcion: c.getAttribute('Descripcion') || c.getAttribute('descripcion') || '',
      cantidad: Number(c.getAttribute('Cantidad') || c.getAttribute('cantidad') || 0),
      unitario: Number(c.getAttribute('ValorUnitario') || c.getAttribute('valorUnitario') || 0),
      importe: Number(c.getAttribute('Importe') || c.getAttribute('importe') || 0),
    }))

    return {
      uuid: tfdEl?.getAttribute('UUID') || tfdEl?.getAttribute('uuid') || 'N/A',
      emisor: {
        rfc: emisorEl?.getAttribute('Rfc') || emisorEl?.getAttribute('rfc') || '',
        nombre: emisorEl?.getAttribute('Nombre') || emisorEl?.getAttribute('nombre') || '',
      },
      receptor: {
        rfc: receptorEl?.getAttribute('Rfc') || receptorEl?.getAttribute('rfc') || '',
        nombre: receptorEl?.getAttribute('Nombre') || receptorEl?.getAttribute('nombre') || '',
      },
      fecha: comp.getAttribute('Fecha') || comp.getAttribute('fecha') || '',
      subtotal: Number(comp.getAttribute('SubTotal') || comp.getAttribute('subTotal') || 0),
      iva: Number(comp.getAttribute('Total') || 0) - Number(comp.getAttribute('SubTotal') || 0),
      total: Number(comp.getAttribute('Total') || comp.getAttribute('total') || 0),
      conceptos,
    }
  } catch (e) {
    console.error('Error parsing CFDI:', e)
    return null
  }
}

export default function FacturasPage() {
  const [files, setFiles] = useState<CFDIData[]>([])
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const handleFiles = useCallback((fileList: FileList) => {
    setError('')
    Array.from(fileList).forEach(file => {
      if (!file.name.endsWith('.xml')) {
        setError('Solo archivos XML de CFDI')
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        const xml = e.target?.result as string
        const parsed = parseCFDI(xml)
        if (parsed) {
          parsed.raw = xml
          setFiles(prev => {
            if (prev.find(f => f.uuid === parsed.uuid)) return prev
            return [...prev, parsed]
          })
        } else {
          setError('No se pudo leer el XML. Verifica que sea un CFDI válido.')
        }
      }
      reader.readAsText(file)
    })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const totalFacturas = files.reduce((s, f) => s + f.total, 0)

  return (
    <>
      <PageHeader title="Facturas" subtitle="Solicitudes de clientes y XMLs de CFDI de proveedores" />

      {/* Solicitudes de factura de clientes (pos_cfdi_requests) */}
      <CfdiRequestsSection />

      <h2 className="text-sm font-bold text-[var(--text-1)] mb-3">Facturas de proveedores</h2>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`mb-6 border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-colors ${
          dragging ? 'border-emerald-500 bg-emerald-500/5' : 'border-[var(--line)] hover:border-[var(--text-3)]'
        }`}
      >
        <Upload size={32} className="mx-auto mb-3 text-[var(--text-3)]" />
        <p className="text-sm font-medium text-[var(--text-1)] mb-1">
          Arrastra tus XMLs de CFDI aquí
        </p>
        <p className="text-xs text-[var(--text-3)] mb-4">o haz click para seleccionar</p>
        <input
          type="file"
          accept=".xml"
          multiple
          className="hidden"
          id="xml-upload"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <label htmlFor="xml-upload" className="inline-block px-6 py-2.5 bg-emerald-500 text-white rounded-lg text-sm font-bold cursor-pointer hover:bg-emerald-600 transition-colors">
          Seleccionar XMLs
        </label>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertTriangle size={16} className="text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {/* Summary */}
      {files.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4 text-center">
            <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">Facturas</p>
            <p className="text-2xl font-bold text-[var(--text-1)]">{files.length}</p>
          </div>
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4 text-center">
            <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">Total</p>
            <p className="text-2xl font-bold text-emerald-500">{formatCurrency(totalFacturas)}</p>
          </div>
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] p-4 text-center">
            <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-1">Proveedores</p>
            <p className="text-2xl font-bold text-[var(--text-1)]">{new Set(files.map(f => f.emisor.rfc)).size}</p>
          </div>
        </div>
      )}

      {/* Facturas list */}
      {files.map((f, i) => (
        <div key={f.uuid || i} className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm mb-4 overflow-hidden">
          <div className="px-4 sm:px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle size={20} className="text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-[var(--text-1)]">{f.emisor.nombre || f.emisor.rfc}</p>
                <p className="text-xs text-[var(--text-3)]">RFC: {f.emisor.rfc} · {f.fecha.slice(0, 10)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-[var(--text-1)]">{formatCurrency(f.total)}</p>
              <p className="text-[10px] text-[var(--text-3)]">UUID: {f.uuid.slice(0, 8)}...</p>
            </div>
          </div>
          {f.conceptos.length > 0 && (
            <div className="border-t border-[var(--line-soft)] px-4 sm:px-5 py-3">
              <p className="text-[10px] text-[var(--text-3)] uppercase tracking-wider mb-2">Conceptos ({f.conceptos.length})</p>
              <div className="space-y-1.5">
                {f.conceptos.slice(0, 10).map((c, j) => (
                  <div key={j} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-2)] truncate max-w-[60%]">{c.descripcion}</span>
                    <span className="text-[var(--text-1)] font-medium tabular-nums">{c.cantidad} × {formatCurrency(c.unitario)} = {formatCurrency(c.importe)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {files.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Sin facturas"
          description="Sube un XML de CFDI para ver los datos de la factura: emisor, conceptos, totales e impuestos."
          iconColor="text-purple-500"
          iconBg="bg-purple-500/10"
        />
      )}
    </>
  )
}
