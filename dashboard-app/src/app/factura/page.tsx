'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { Suspense } from 'react'

const REGIMENES = [
  { code: '601', name: 'General de Ley Personas Morales' },
  { code: '603', name: 'Personas Morales con Fines no Lucrativos' },
  { code: '605', name: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { code: '606', name: 'Arrendamiento' },
  { code: '607', name: 'Régimen de Enajenación o Adquisición de Bienes' },
  { code: '608', name: 'Demás Ingresos' },
  { code: '610', name: 'Residentes en el Extranjero sin EP' },
  { code: '611', name: 'Ingresos por Dividendos' },
  { code: '612', name: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { code: '614', name: 'Ingresos por Intereses' },
  { code: '616', name: 'Sin Obligaciones Fiscales' },
  { code: '620', name: 'Sociedades Cooperativas de Producción' },
  { code: '621', name: 'Incorporación Fiscal' },
  { code: '622', name: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { code: '623', name: 'Opcional para Grupos de Sociedades' },
  { code: '624', name: 'Coordinados' },
  { code: '625', name: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { code: '626', name: 'Régimen Simplificado de Confianza' },
]

const USOS_CFDI = [
  { code: 'G01', name: 'Adquisición de mercancías' },
  { code: 'G03', name: 'Gastos en general' },
  { code: 'I01', name: 'Construcciones' },
  { code: 'I02', name: 'Mobiliario y equipo de oficina' },
  { code: 'P01', name: 'Por definir' },
  { code: 'S01', name: 'Sin efectos fiscales' },
  { code: 'CP01', name: 'Pagos' },
]

function FacturaForm() {
  const params = useSearchParams()
  const orderId = params.get('order') || ''
  const total = params.get('total') || ''
  const fecha = params.get('fecha') || ''

  const [form, setForm] = useState({
    rfc: '',
    razon_social: '',
    regimen_fiscal: '612',
    codigo_postal: '',
    email: '',
    uso_cfdi: 'G03',
  })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError('')
  }

  const validateRFC = (rfc: string): boolean => {
    // RFC: 12 chars (moral) or 13 chars (física)
    const clean = rfc.trim().toUpperCase()
    return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(clean)
  }

  const handleSubmit = async () => {
    // Validate
    if (!validateRFC(form.rfc)) {
      setError('RFC inválido. Verifica que sea correcto.')
      return
    }
    if (!form.razon_social.trim()) {
      setError('Ingresa la razón social.')
      return
    }
    if (!form.codigo_postal.match(/^\d{5}$/)) {
      setError('Código postal debe ser 5 dígitos.')
      return
    }
    if (!form.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      setError('Email inválido.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/cfdi_requests`,
        {
          method: 'POST',
          headers: {
            'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            order_id: orderId || null,
            total: total ? parseFloat(total) : null,
            fecha_venta: fecha || null,
            rfc: form.rfc.trim().toUpperCase(),
            razon_social: form.razon_social.trim(),
            regimen_fiscal: form.regimen_fiscal,
            codigo_postal: form.codigo_postal.trim(),
            email: form.email.trim().toLowerCase(),
            uso_cfdi: form.uso_cfdi,
            status: 'pendiente',
          }),
        }
      )

      if (!res.ok) throw new Error('Error al enviar')
      setSuccess(true)
    } catch (e) {
      setError('Error al enviar la solicitud. Intenta de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-4">
        <div className="bg-[#111114] rounded-2xl border border-[rgba(255,255,255,0.06)] p-8 max-w-md w-full text-center">
          <CheckCircle2 size={48} className="text-emerald-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Solicitud enviada</h2>
          <p className="text-sm text-[rgba(255,255,255,0.5)]">
            Tu factura se enviará a <strong className="text-white">{form.email}</strong> en las próximas 24 horas.
          </p>
          {orderId && <p className="text-xs text-[rgba(255,255,255,0.3)] mt-4">Orden: {orderId}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-4">
      <div className="bg-[#111114] rounded-2xl border border-[rgba(255,255,255,0.06)] p-6 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
            <FileText size={24} className="text-emerald-500" />
          </div>
          <h1 className="text-lg font-bold text-white">
            fullsite<span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5" />
          </h1>
          <p className="text-sm text-[rgba(255,255,255,0.4)] mt-1">Solicitar factura CFDI 4.0</p>
          {total && (
            <p className="text-lg font-bold text-emerald-400 mt-2">${parseFloat(total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
          )}
          {fecha && <p className="text-xs text-[rgba(255,255,255,0.3)]">{fecha}</p>}
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1">RFC *</label>
            <input
              type="text"
              value={form.rfc}
              onChange={e => updateField('rfc', e.target.value.toUpperCase())}
              placeholder="XAXX010101000"
              maxLength={13}
              className="w-full bg-[#1a1a1d] border border-[rgba(255,255,255,0.1)] rounded-lg px-4 py-3 text-white placeholder-[rgba(255,255,255,0.2)] text-sm focus:outline-none focus:border-emerald-500 uppercase"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1">Razón Social *</label>
            <input
              type="text"
              value={form.razon_social}
              onChange={e => updateField('razon_social', e.target.value)}
              placeholder="Nombre o razón social"
              className="w-full bg-[#1a1a1d] border border-[rgba(255,255,255,0.1)] rounded-lg px-4 py-3 text-white placeholder-[rgba(255,255,255,0.2)] text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1">Régimen Fiscal *</label>
            <select
              value={form.regimen_fiscal}
              onChange={e => updateField('regimen_fiscal', e.target.value)}
              className="w-full bg-[#1a1a1d] border border-[rgba(255,255,255,0.1)] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500"
            >
              {REGIMENES.map(r => (
                <option key={r.code} value={r.code}>{r.code} — {r.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1">Código Postal *</label>
              <input
                type="text"
                value={form.codigo_postal}
                onChange={e => updateField('codigo_postal', e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="66220"
                maxLength={5}
                className="w-full bg-[#1a1a1d] border border-[rgba(255,255,255,0.1)] rounded-lg px-4 py-3 text-white placeholder-[rgba(255,255,255,0.2)] text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1">Uso CFDI</label>
              <select
                value={form.uso_cfdi}
                onChange={e => updateField('uso_cfdi', e.target.value)}
                className="w-full bg-[#1a1a1d] border border-[rgba(255,255,255,0.1)] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500"
              >
                {USOS_CFDI.map(u => (
                  <option key={u.code} value={u.code}>{u.code} — {u.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1">Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => updateField('email', e.target.value)}
              placeholder="tu@email.com"
              className="w-full bg-[#1a1a1d] border border-[rgba(255,255,255,0.1)] rounded-lg px-4 py-3 text-white placeholder-[rgba(255,255,255,0.2)] text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 rounded-lg px-3 py-2">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
            {submitting ? 'Enviando...' : 'Solicitar Factura'}
          </button>

          <p className="text-[11px] text-[rgba(255,255,255,0.25)] text-center leading-relaxed">
            La factura se generará y enviará a tu email en un plazo máximo de 24 horas.
            Asegúrate de que tu constancia de situación fiscal esté actualizada.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function FacturaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500" size={32} /></div>}>
      <FacturaForm />
    </Suspense>
  )
}
