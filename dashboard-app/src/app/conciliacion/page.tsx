'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { Upload, CheckCircle, AlertTriangle, DollarSign, CreditCard, Banknote, ArrowUpDown, FileSpreadsheet, TrendingUp } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import KPICard from '@/components/KPICard'
import { getRecentDays } from '@/lib/data'
import { formatCurrency } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

interface BankRow {
  fecha: string
  concepto: string
  deposito: number
  retiro: number
  referencia: string
}

interface ConciliacionRow {
  fecha: string
  ventasTarjeta: number
  depositoBanco: number
  diferencia: number
  pctComision: number
  status: 'ok' | 'alerta' | 'pendiente'
}

function parseCSV(text: string): BankRow[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  const header = lines[0].toLowerCase()
  // Auto-detect columns
  const cols = header.split(',').map(c => c.trim().replace(/"/g, ''))
  const fechaIdx = cols.findIndex(c => c.includes('fecha'))
  const conceptoIdx = cols.findIndex(c => c.includes('concepto') || c.includes('descripcion') || c.includes('descripción'))
  const depositoIdx = cols.findIndex(c => c.includes('deposito') || c.includes('depósito') || c.includes('abono') || c.includes('credito') || c.includes('crédito'))
  const retiroIdx = cols.findIndex(c => c.includes('retiro') || c.includes('cargo') || c.includes('debito') || c.includes('débito'))
  const refIdx = cols.findIndex(c => c.includes('referencia') || c.includes('ref'))

  return lines.slice(1).map(line => {
    // Handle CSV with quoted fields
    const parts: string[] = []
    let current = '', inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue }
      if (ch === ',' && !inQuote) { parts.push(current.trim()); current = ''; continue }
      current += ch
    }
    parts.push(current.trim())

    const parseNum = (s: string) => {
      if (!s) return 0
      return parseFloat(s.replace(/[$,]/g, '').replace(/\s/g, '')) || 0
    }

    return {
      fecha: fechaIdx >= 0 ? parts[fechaIdx] || '' : parts[0] || '',
      concepto: conceptoIdx >= 0 ? parts[conceptoIdx] || '' : parts[1] || '',
      deposito: depositoIdx >= 0 ? parseNum(parts[depositoIdx]) : parseNum(parts[2]),
      retiro: retiroIdx >= 0 ? parseNum(parts[retiroIdx]) : 0,
      referencia: refIdx >= 0 ? parts[refIdx] || '' : '',
    }
  }).filter(r => r.fecha && (r.deposito > 0 || r.retiro > 0))
}

function normalizeFecha(raw: string): string {
  // Try common formats: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD
  if (raw.includes('-') && raw.length === 10) return raw // already YYYY-MM-DD
  const parts = raw.split(/[/\-.]/)
  if (parts.length === 3) {
    const [a, b, c] = parts.map(Number)
    if (a > 31) return `${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}` // YYYY-MM-DD
    if (c > 100) return `${c}-${String(b > 12 ? a : b).padStart(2, '0')}-${String(b > 12 ? b : a).padStart(2, '0')}` // DD/MM/YYYY
  }
  return raw
}

export default function ConciliacionPage() {
  const [salesData, setSalesData] = useState<WansoftDaily[]>([])
  const [bankData, setBankData] = useState<BankRow[]>([])
  const [loading, setLoading] = useState(true)
  const [fileName, setFileName] = useState('')
  const [sortBy, setSortBy] = useState<'fecha' | 'diferencia'>('fecha')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    getRecentDays(90).then(d => { setSalesData(d); setLoading(false) })
  }, [])

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      const rows = parseCSV(text)
      setBankData(rows)
    }
    reader.readAsText(file)
  }, [])

  // Build conciliación: match sales card payments vs bank deposits by date
  const conciliacion = useMemo(() => {
    if (bankData.length === 0) return []

    // Group bank deposits by normalized date
    const bankByDate: Record<string, number> = {}
    for (const row of bankData) {
      const fecha = normalizeFecha(row.fecha)
      bankByDate[fecha] = (bankByDate[fecha] || 0) + row.deposito
    }

    // Match against sales data (tarjeta payments)
    const results: ConciliacionRow[] = []
    for (const day of salesData) {
      const fecha = day.fecha
      // Get card sales from pago_metodos
      let tarjeta = 0
      let pagos = day.pago_métodos as unknown
      // Handle double-escaped JSON
      if (typeof pagos === 'string') { try { pagos = JSON.parse(pagos) } catch {} }
      if (typeof pagos === 'string') { try { pagos = JSON.parse(pagos) } catch {} }
      if (Array.isArray(pagos)) {
        for (const p of pagos) {
          const nm = ((p as { nombre?: string }).nombre || '').toLowerCase()
          if (nm.includes('tarjeta') || nm.includes('credito') || nm.includes('crédito') || nm.includes('debito') || nm.includes('débito')) {
            tarjeta += (p as { total?: number }).total || 0
          }
        }
      }

      if (tarjeta <= 0) continue

      const deposito = bankByDate[fecha] || 0
      const diferencia = tarjeta - deposito
      const pctComision = deposito > 0 ? ((tarjeta - deposito) / tarjeta) * 100 : 0

      let status: 'ok' | 'alerta' | 'pendiente' = 'pendiente'
      if (deposito > 0) {
        // Normal bank commission is 1.5-3.5%
        status = pctComision >= 0 && pctComision <= 4 ? 'ok' : 'alerta'
      }

      results.push({ fecha, ventasTarjeta: tarjeta, depositoBanco: deposito, diferencia, pctComision, status })
    }

    // Sort
    results.sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1
      if (sortBy === 'diferencia') return (Math.abs(a.diferencia) - Math.abs(b.diferencia)) * mul * -1
      return a.fecha.localeCompare(b.fecha) * mul
    })

    return results
  }, [salesData, bankData, sortBy, sortDir])

  // KPIs
  const totalVentasTarjeta = conciliacion.reduce((s, r) => s + r.ventasTarjeta, 0)
  const totalDepositos = conciliacion.reduce((s, r) => s + r.depositoBanco, 0)
  const totalDiferencia = totalVentasTarjeta - totalDepositos
  const avgComision = totalVentasTarjeta > 0 ? (totalDiferencia / totalVentasTarjeta) * 100 : 0
  const alertas = conciliacion.filter(r => r.status === 'alerta').length
  const pendientes = conciliacion.filter(r => r.status === 'pendiente').length
  const conciliados = conciliacion.filter(r => r.status === 'ok').length

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <>
      <PageHeader title="Conciliación de Pagos" subtitle="Ventas con tarjeta vs depósitos bancarios" />

      {/* Upload */}
      <div className="mb-6">
        <label className="flex items-center gap-3 bg-[var(--surface)] border-2 border-dashed border-[var(--line)] rounded-xl p-6 cursor-pointer hover:border-emerald-500/50 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <Upload size={20} className="text-emerald-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-[var(--text-1)]">
              {fileName || 'Sube el estado de cuenta del banco'}
            </p>
            <p className="text-xs text-[var(--text-3)]">
              CSV con columnas: fecha, concepto, depósito. Se compara automáticamente contra las ventas con tarjeta.
            </p>
          </div>
          <input type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={handleUpload} />
          <span className="text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-3 py-1.5 rounded-lg shrink-0">Seleccionar archivo</span>
        </label>
      </div>

      {bankData.length === 0 ? (
        <>
          {/* Preview with sales data only */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KPICard label="Ventas tarjeta (90d)" value={formatCurrency(salesData.reduce((s, d) => {
              const pagos = d.pago_métodos
              if (!Array.isArray(pagos)) return s
              return s + pagos.filter((p: any) => {
                const nm = (p.nombre || '').toLowerCase()
                return nm.includes('tarjeta') || nm.includes('credito') || nm.includes('debito')
              }).reduce((t: number, p: any) => t + (p.total || 0), 0)
            }, 0))} icon={CreditCard} accentClass="kpi-accent-blue" />
            <KPICard label="Ventas efectivo (90d)" value={formatCurrency(salesData.reduce((s, d) => {
              const pagos = d.pago_métodos
              if (!Array.isArray(pagos)) return s
              return s + pagos.filter((p: any) => (p.nombre || '').toLowerCase().includes('efectivo')).reduce((t: number, p: any) => t + (p.total || 0), 0)
            }, 0))} icon={Banknote} accentClass="kpi-accent-green" />
            <KPICard label="Días con datos" value={`${salesData.length}`} icon={FileSpreadsheet} accentClass="kpi-accent-amber" />
            <KPICard label="Pendiente" value="Sube CSV" icon={Upload} accentClass="kpi-accent-purple" />
          </div>
          <EmptyState
            icon={FileSpreadsheet}
            title="Sube tu estado de cuenta"
            description="Exporta el CSV de tu banco y súbelo aquí. Fullsite compara automáticamente cada venta con tarjeta contra el depósito real. Detecta comisiones, faltantes y anomalías."
            iconColor="text-blue-500"
            iconBg="bg-blue-500/10"
          />
        </>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <KPICard label="Ventas tarjeta" value={formatCurrency(totalVentasTarjeta)} icon={CreditCard} accentClass="kpi-accent-blue" />
            <KPICard label="Depósitos banco" value={formatCurrency(totalDepositos)} icon={Banknote} accentClass="kpi-accent-green" />
            <KPICard label="Diferencia" value={formatCurrency(totalDiferencia)} subtitle={`${avgComision.toFixed(1)}% comisión prom.`} icon={TrendingUp} accentClass="kpi-accent-amber" />
            <KPICard
              label="Status"
              value={alertas > 0 ? `${alertas} alertas` : `${conciliados} OK`}
              subtitle={`${pendientes} pendientes`}
              icon={alertas > 0 ? AlertTriangle : CheckCircle}
              accentClass={alertas > 0 ? 'kpi-accent-pink' : 'kpi-accent-green'}
            />
          </div>

          {/* Table */}
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-1)]">Detalle por día</h3>
              <span className="text-xs text-[var(--text-3)]">{conciliacion.length} días · {fileName}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line-soft)] text-[var(--text-2)]">
                    <th className="text-left px-4 py-3 font-medium cursor-pointer" onClick={() => { setSortBy('fecha'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}>
                      Fecha <ArrowUpDown size={12} className="inline" />
                    </th>
                    <th className="text-right px-4 py-3 font-medium">Venta tarjeta</th>
                    <th className="text-right px-4 py-3 font-medium">Depósito banco</th>
                    <th className="text-right px-4 py-3 font-medium cursor-pointer" onClick={() => { setSortBy('diferencia'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}>
                      Diferencia <ArrowUpDown size={12} className="inline" />
                    </th>
                    <th className="text-right px-4 py-3 font-medium">% Comisión</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {conciliacion.map((row, i) => (
                    <tr key={i} className="border-b border-[var(--line-soft)] hover:bg-[var(--surface-2)]">
                      <td className="px-4 py-3 font-medium text-[var(--text-1)]">{row.fecha}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-1)]">{formatCurrency(row.ventasTarjeta)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">{row.depositoBanco > 0 ? formatCurrency(row.depositoBanco) : '—'}</td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${row.status === 'alerta' ? 'text-red-500' : 'text-[var(--text-2)]'}`}>
                        {formatCurrency(row.diferencia)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text-2)]">
                        {row.depositoBanco > 0 ? `${row.pctComision.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.status === 'ok' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            <CheckCircle size={12} /> OK
                          </span>
                        )}
                        {row.status === 'alerta' && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full">
                            <AlertTriangle size={12} /> Alerta
                          </span>
                        )}
                        {row.status === 'pendiente' && (
                          <span className="text-xs text-[var(--text-3)]">Sin depósito</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Summary footer */}
            <div className="px-4 py-3 border-t border-[var(--line)] bg-[var(--surface-2)] flex flex-wrap gap-4 text-xs">
              <span className="text-[var(--text-3)]">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1"></span>
                Conciliados: <strong className="text-[var(--text-1)]">{conciliados}</strong> (comisión 1.5-4%)
              </span>
              <span className="text-[var(--text-3)]">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1"></span>
                Alertas: <strong className="text-red-500">{alertas}</strong> (comisión {'>'} 4% o negativa)
              </span>
              <span className="text-[var(--text-3)]">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--text-4)] mr-1"></span>
                Pendientes: <strong className="text-[var(--text-1)]">{pendientes}</strong> (sin depósito)
              </span>
            </div>
          </div>
        </>
      )}
    </>
  )
}
