'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, FileText, Send, Search, Check, X, Clock, AlertCircle,
  Download, RefreshCw,
} from 'lucide-react'
import {
  createCFDIRequest, getCFDIRequests, updateCFDIStatus,
  REGIMENES_FISCALES, USOS_CFDI, formatMXN,
  type CFDIRequest,
} from '@/lib/pos-data'

const IVA_RATE = 0.16

const STATUS_STYLES: Record<string, { color: string; bg: string; label: string; icon: typeof Clock }> = {
  pendiente: { color: 'text-amber-400', bg: 'bg-amber-900/40', label: 'Pendiente', icon: Clock },
  procesando: { color: 'text-blue-400', bg: 'bg-blue-900/40', label: 'Procesando', icon: RefreshCw },
  emitida: { color: 'text-emerald-400', bg: 'bg-emerald-900/40', label: 'Emitida', icon: Check },
  cancelada: { color: 'text-red-400', bg: 'bg-red-900/40', label: 'Cancelada', icon: X },
  error: { color: 'text-red-400', bg: 'bg-red-900/40', label: 'Error', icon: AlertCircle },
}

export default function FacturacionPage() {
  const [tab, setTab] = useState<'nueva' | 'historial'>('nueva')
  const [requests, setRequests] = useState<CFDIRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [searchRFC, setSearchRFC] = useState('')

  // Form state
  const [rfc, setRfc] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [regimenFiscal, setRegimenFiscal] = useState('616')
  const [usoCfdi, setUsoCfdi] = useState('S01')
  const [codigoPostal, setCodigoPostal] = useState('')
  const [email, setEmail] = useState('')
  const [montoTotal, setMontoTotal] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const fetchRequests = async () => {
    setLoading(true)
    const data = await getCFDIRequests()
    setRequests(data)
    setLoading(false)
  }

  useEffect(() => { fetchRequests() }, [])

  const resetForm = () => {
    setRfc(''); setRazonSocial(''); setRegimenFiscal('616'); setUsoCfdi('S01')
    setCodigoPostal(''); setEmail(''); setMontoTotal('')
  }

  const validateRFC = (v: string) => /^[A-Z&]{3,4}\d{6}[A-Z0-9]{3}$/.test(v.toUpperCase())
  const validateCP = (v: string) => /^\d{5}$/.test(v)
  const validateEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

  const handleSubmit = async () => {
    const rfcClean = rfc.toUpperCase().trim()
    if (!validateRFC(rfcClean)) { showToast('RFC invalido'); return }
    if (!razonSocial.trim()) { showToast('Razon social requerida'); return }
    if (!validateCP(codigoPostal)) { showToast('Codigo postal invalido (5 digitos)'); return }
    if (!validateEmail(email)) { showToast('Email invalido'); return }
    const total = parseFloat(montoTotal)
    if (isNaN(total) || total <= 0) { showToast('Monto invalido'); return }

    const subtotal = total / (1 + IVA_RATE)
    const iva = total - subtotal

    setSaving(true)
    const result = await createCFDIRequest({
      rfc: rfcClean,
      razon_social: razonSocial.trim(),
      regimen_fiscal: regimenFiscal,
      uso_cfdi: usoCfdi,
      codigo_postal: codigoPostal,
      email: email.trim(),
      subtotal: Math.round(subtotal * 100) / 100,
      iva: Math.round(iva * 100) / 100,
      total,
    })
    setSaving(false)

    if (result.ok) {
      showToast(`Solicitud ${result.id} creada`)
      resetForm()
      fetchRequests()
      setTab('historial')
    } else {
      showToast('Error al crear solicitud')
    }
  }

  const filteredRequests = searchRFC
    ? requests.filter(r => r.rfc.includes(searchRFC.toUpperCase()) || r.razon_social.toLowerCase().includes(searchRFC.toLowerCase()))
    : requests

  return (
    <div className="h-screen flex flex-col text-white bg-[var(--surface)]">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-4 bg-[var(--surface-2)] border-b border-slate-700 flex-shrink-0">
        <Link href="/pos" className="w-10 h-10 rounded-lg bg-[var(--line)] hover:bg-slate-600 flex items-center justify-center transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <FileText size={24} className="text-emerald-400" />
          <h1 className="text-xl font-bold">Facturacion CFDI</h1>
        </div>
        <div className="flex-1" />
        <div className="flex bg-[var(--line)] rounded-lg p-1 gap-1">
          {(['nueva', 'historial'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                tab === t ? 'bg-emerald-600 text-white' : 'text-[var(--text-3)] hover:text-white'
              }`}
            >
              {t === 'nueva' ? 'Nueva solicitud' : `Historial (${requests.length})`}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'nueva' ? (
          <div className="max-w-2xl mx-auto">
            <p className="text-[var(--text-3)] text-sm mb-6">
              Datos fiscales del cliente para generar CFDI 4.0
            </p>

            <div className="space-y-4">
              {/* RFC */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-4)] mb-1">RFC *</label>
                <input
                  type="text"
                  value={rfc}
                  onChange={e => setRfc(e.target.value.toUpperCase())}
                  placeholder="XAXX010101000"
                  maxLength={13}
                  className="w-full bg-[var(--surface-2)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono text-lg tracking-wider"
                />
                {rfc.length > 0 && !validateRFC(rfc) && (
                  <p className="text-red-400 text-xs mt-1">Formato: 3-4 letras + 6 digitos + 3 caracteres</p>
                )}
              </div>

              {/* Razon social */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-4)] mb-1">Razon social *</label>
                <input
                  type="text"
                  value={razonSocial}
                  onChange={e => setRazonSocial(e.target.value)}
                  placeholder="Empresa S.A. de C.V."
                  className="w-full bg-[var(--surface-2)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {/* Grid: Regimen + Uso CFDI */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-4)] mb-1">Regimen fiscal *</label>
                  <select
                    value={regimenFiscal}
                    onChange={e => setRegimenFiscal(e.target.value)}
                    className="w-full bg-[var(--surface-2)] border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {REGIMENES_FISCALES.map(r => (
                      <option key={r.clave} value={r.clave}>{r.clave} - {r.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-4)] mb-1">Uso CFDI *</label>
                  <select
                    value={usoCfdi}
                    onChange={e => setUsoCfdi(e.target.value)}
                    className="w-full bg-[var(--surface-2)] border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {USOS_CFDI.map(u => (
                      <option key={u.clave} value={u.clave}>{u.clave} - {u.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Grid: CP + Email */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-4)] mb-1">Codigo postal *</label>
                  <input
                    type="text"
                    value={codigoPostal}
                    onChange={e => setCodigoPostal(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="64000"
                    maxLength={5}
                    className="w-full bg-[var(--surface-2)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-4)] mb-1">Email *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="factura@empresa.com"
                    className="w-full bg-[var(--surface-2)] border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Monto */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-4)] mb-1">Monto total (IVA incluido) *</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-3)] font-bold">$</span>
                  <input
                    type="number"
                    value={montoTotal}
                    onChange={e => setMontoTotal(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    className="w-full bg-[var(--surface-2)] border border-slate-600 rounded-lg pl-8 pr-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono text-lg"
                  />
                </div>
                {montoTotal && parseFloat(montoTotal) > 0 && (
                  <div className="flex gap-4 mt-2 text-xs text-[var(--text-3)]">
                    <span>Subtotal: {formatMXN(parseFloat(montoTotal) / (1 + IVA_RATE))}</span>
                    <span>IVA 16%: {formatMXN(parseFloat(montoTotal) - parseFloat(montoTotal) / (1 + IVA_RATE))}</span>
                  </div>
                )}
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full bg-emerald-600 hover:bg-emerald-500/100 disabled:bg-[var(--line)] disabled:text-[var(--text-2)] text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors text-lg mt-4"
              >
                {saving ? (
                  <><RefreshCw size={20} className="animate-spin" /> Guardando...</>
                ) : (
                  <><Send size={20} /> Solicitar factura</>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* ── Historial ── */
          <div className="max-w-4xl mx-auto">
            {/* Search */}
            <div className="relative mb-4">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-2)]" />
              <input
                type="text"
                value={searchRFC}
                onChange={e => setSearchRFC(e.target.value)}
                placeholder="Buscar por RFC o razon social..."
                className="w-full bg-[var(--surface-2)] border border-slate-600 rounded-lg pl-10 pr-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {loading ? (
              <div className="text-center py-12">
                <RefreshCw size={24} className="animate-spin text-emerald-400 mx-auto mb-2" />
                <p className="text-[var(--text-3)]">Cargando...</p>
              </div>
            ) : filteredRequests.length === 0 ? (
              <div className="text-center py-12">
                <FileText size={48} className="text-[var(--text-2)] mx-auto mb-3" />
                <p className="text-[var(--text-3)]">Sin solicitudes de factura</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredRequests.map(req => {
                  const st = STATUS_STYLES[req.status] || STATUS_STYLES.pendiente
                  const StatusIcon = st.icon
                  return (
                    <div key={req.id} className="bg-[var(--surface-2)] border border-slate-700 rounded-xl p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-mono text-sm text-[var(--text-3)]">{req.id}</span>
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>
                              <StatusIcon size={12} />
                              {st.label}
                            </span>
                          </div>
                          <p className="font-semibold text-white truncate">{req.razon_social}</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-[var(--text-3)]">
                            <span className="font-mono">{req.rfc}</span>
                            <span>{req.email}</span>
                            <span>CP {req.codigo_postal}</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-lg font-bold text-white">{formatMXN(req.total)}</p>
                          <p className="text-xs text-[var(--text-2)] mt-1">
                            {new Date(req.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      {req.status === 'emitida' && (req.pdf_url || req.xml_url) && (
                        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-700">
                          {req.pdf_url && (
                            <a href={req.pdf_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300">
                              <Download size={14} /> PDF
                            </a>
                          )}
                          {req.xml_url && (
                            <a href={req.xml_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300">
                              <Download size={14} /> XML
                            </a>
                          )}
                        </div>
                      )}
                      {req.status === 'pendiente' && (
                        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-700">
                          <button
                            onClick={async () => {
                              await updateCFDIStatus(req.id, 'cancelada')
                              showToast('Solicitud cancelada')
                              fetchRequests()
                            }}
                            className="text-xs font-medium text-red-400 hover:text-red-300"
                          >
                            Cancelar solicitud
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[var(--surface-2)] border border-slate-600 text-white px-6 py-3 rounded-xl shadow-xl text-sm font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  )
}
