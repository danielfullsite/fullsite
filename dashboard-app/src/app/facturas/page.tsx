'use client'

import { useState, useCallback } from 'react'
import { Upload, FileText, CheckCircle, AlertTriangle, DollarSign } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'

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
      <PageHeader title="Facturas de Proveedores" subtitle="Sube XMLs de CFDI para registrar compras y actualizar costos" />

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
        <div className="text-center py-12 text-[var(--text-3)]">
          <FileText size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sube un XML de CFDI para ver los datos de la factura</p>
        </div>
      )}
    </>
  )
}
