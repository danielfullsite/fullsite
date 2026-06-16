'use client'

import { useEffect, useState, useMemo } from 'react'
import {
  DollarSign, FileSpreadsheet, Download, Calculator,
  AlertTriangle, TrendingUp, Receipt, BarChart3, Search,
  ChevronDown, ChevronUp, FileText,
} from 'lucide-react'
import KPICard from '@/components/KPICard'
import PageHeader from '@/components/PageHeader'
import { formatCurrency } from '@/lib/format'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function _cid() {
  try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' }
}

function fmtMXDate(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function fmtMonth(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

interface Movimiento {
  cuenta: string
  cuentaNombre: string
  debe: number
  haber: number
  concepto: string
}

interface Poliza {
  numero: number
  fecha: string
  tipo: string
  tipoLabel: string
  concepto: string
  movimientos: Movimiento[]
}

interface PolizasResponse {
  fecha: string
  polizas: Poliza[]
  resumen: {
    totalPolizas: number
    totalDebe: number
    totalHaber: number
    balanceado: boolean
    ordenesPOS: number
    movimientosInventario: number
  }
}

interface ResumenMensual {
  mes: string
  ventasBrutas: number
  ventasNetas: number
  ivaTrasladadoMes: number
  costoVentas: number
  margenBruto: number
  margenPct: number
  entradasInventario: number
  merma: number
  desglosePagos: Record<string, number>
  diasConDatos: number
}

interface FiscalAnalysis {
  ventasPOS: number
  ventasCFDI: number
  diferencia: number
  pctFacturado: number
  ivaEstimado: number
  isrEstimado: number
  ivaPorPagar: number
  facturasEmitidas: number
  alertas: string[]
}

export default function ContabilidadPage() {
  const [fecha, setFecha] = useState(fmtMXDate())
  const [polizas, setPolizas] = useState<PolizasResponse | null>(null)
  const [resumenMes, setResumenMes] = useState<ResumenMensual | null>(null)
  const [fiscal, setFiscal] = useState<FiscalAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMes, setLoadingMes] = useState(true)
  const [expandedPoliza, setExpandedPoliza] = useState<number | null>(null)
  const [mesSeleccionado, setMesSeleccionado] = useState(fmtMonth())

  // Load daily polizas
  useEffect(() => {
    setLoading(true)
    fetch(`/api/contabilidad/polizas?fecha=${fecha}`)
      .then(r => r.json())
      .then((data: PolizasResponse) => {
        setPolizas(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [fecha])

  // Load monthly summary
  useEffect(() => {
    setLoadingMes(true)
    fetch(`/api/contabilidad/polizas?mes=${mesSeleccionado}`)
      .then(r => r.json())
      .then((data: ResumenMensual) => {
        setResumenMes(data)
        setLoadingMes(false)
      })
      .catch(() => setLoadingMes(false))
  }, [mesSeleccionado])

  // Load fiscal analysis
  useEffect(() => {
    loadFiscalAnalysis(mesSeleccionado)
  }, [mesSeleccionado])

  async function loadFiscalAnalysis(mes: string) {
    try {
      const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      const startDate = `${mes}-01`
      const [y, m] = mes.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      const endDate = `${mes}-${String(lastDay).padStart(2, '0')}`

      // Fetch POS sales and CFDI invoices in parallel
      const [posRes, cfdiRes, wansoftRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/pos_orders?created_at=gte.${startDate}T00:00:00&created_at=lte.${endDate}T23:59:59&status=neq.cancelled&select=total,subtotal,tax&limit=5000`,
          { headers }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/pos_invoices?created_at=gte.${startDate}T00:00:00&created_at=lte.${endDate}T23:59:59&select=total,subtotal,tax,status&limit=5000`,
          { headers }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/wansoft_daily?fecha=gte.${startDate}&fecha=lte.${endDate}&select=ventas_dia&limit=50`,
          { headers }
        ),
      ])

      const posOrders = posRes.ok ? await posRes.json() : []
      const cfdis = cfdiRes.ok ? await cfdiRes.json() : []
      const wansoftDays = wansoftRes.ok ? await wansoftRes.json() : []

      // POS sales total
      let ventasPOS = 0
      if (posOrders.length > 0) {
        ventasPOS = posOrders.reduce((s: number, o: { total: number }) => s + (o.total || 0), 0)
      } else {
        ventasPOS = wansoftDays.reduce((s: number, d: { ventas_dia: number }) => s + (d.ventas_dia || 0), 0)
      }

      // CFDI total (only timbradas/active)
      const activeCfdis = cfdis.filter((c: { status: string }) => c.status !== 'cancelled')
      const ventasCFDI = activeCfdis.reduce((s: number, c: { total: number }) => s + (c.total || 0), 0)

      const diferencia = ventasPOS - ventasCFDI
      const pctFacturado = ventasPOS > 0 ? (ventasCFDI / ventasPOS) * 100 : 0

      // Tax estimates
      const ventasNetas = ventasPOS / 1.16
      const ivaEstimado = ventasPOS - ventasNetas
      // ISR simplified regime estimate (2.5% on gross income for restaurants)
      const isrEstimado = ventasNetas * 0.025
      // IVA por pagar = IVA trasladado - IVA acreditable (estimate 40% of purchases have IVA)
      const ivaPorPagar = ivaEstimado * 0.7 // Net after acreditable estimate

      const alertas: string[] = []
      if (pctFacturado < 80 && ventasPOS > 0) {
        alertas.push(`Solo ${pctFacturado.toFixed(0)}% de ventas facturadas. Riesgo fiscal.`)
      }
      if (diferencia > 50000) {
        alertas.push(`${formatCurrency(diferencia)} en ventas sin facturar este mes.`)
      }
      if (ventasPOS === 0) {
        alertas.push('Sin datos de ventas POS para este mes.')
      }

      setFiscal({
        ventasPOS: Math.round(ventasPOS),
        ventasCFDI: Math.round(ventasCFDI),
        diferencia: Math.round(diferencia),
        pctFacturado: Math.round(pctFacturado * 10) / 10,
        ivaEstimado: Math.round(ivaEstimado),
        isrEstimado: Math.round(isrEstimado),
        ivaPorPagar: Math.round(ivaPorPagar),
        facturasEmitidas: activeCfdis.length,
        alertas,
      })
    } catch (e) {
      console.error('[contabilidad] Fiscal analysis error:', e)
    }
  }

  // Download handlers
  function downloadXML() {
    window.open(`/api/contabilidad/polizas?fecha=${fecha}&formato=xml`, '_blank')
  }
  function downloadCSV() {
    window.open(`/api/contabilidad/polizas?fecha=${fecha}&formato=csv`, '_blank')
  }

  const tipoColors: Record<string, string> = {
    'I': 'bg-emerald-500/15 text-emerald-500',
    'E': 'bg-red-500/15 text-red-500',
    'D': 'bg-blue-500/15 text-blue-500',
  }

  return (
    <>
      <PageHeader
        title="Contabilidad"
        subtitle="Polizas contables CONTPAQi -- generacion automatica desde POS"
        eyebrow="Finanzas"
      />

      {/* ── KPI Cards (Monthly) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard
          label="Ventas del Mes"
          value={resumenMes ? formatCurrency(resumenMes.ventasBrutas) : '--'}
          icon={DollarSign}
          accentClass="kpi-accent-blue"
          index={0}
          subtitle={resumenMes ? `${resumenMes.diasConDatos} dias con datos` : ''}
        />
        <KPICard
          label="IVA Trasladado"
          value={resumenMes ? formatCurrency(resumenMes.ivaTrasladadoMes) : '--'}
          icon={Receipt}
          accentClass="kpi-accent-amber"
          index={1}
        />
        <KPICard
          label="Costo de Ventas"
          value={resumenMes ? formatCurrency(resumenMes.costoVentas) : '--'}
          icon={Calculator}
          accentClass="kpi-accent-pink"
          index={2}
          subtitle={resumenMes ? `${resumenMes.margenPct.toFixed(1)}% margen` : ''}
        />
        <KPICard
          label="Margen Bruto"
          value={resumenMes ? formatCurrency(resumenMes.margenBruto) : '--'}
          icon={TrendingUp}
          accentClass="kpi-accent-green"
          index={3}
        />
      </div>

      {/* ── Date selectors row ── */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <label className="text-xs font-mono uppercase tracking-wider text-[var(--text-3)]">Fecha polizas</label>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="rounded-lg border border-[var(--accent-line)] bg-[var(--bento-card)] px-3 py-1.5 text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-mono uppercase tracking-wider text-[var(--text-3)]">Mes resumen</label>
          <input
            type="month"
            value={mesSeleccionado}
            onChange={e => setMesSeleccionado(e.target.value)}
            className="rounded-lg border border-[var(--accent-line)] bg-[var(--bento-card)] px-3 py-1.5 text-sm text-[var(--text-1)] focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
        <div className="flex gap-2 ml-auto">
          <button
            onClick={downloadXML}
            className="flex items-center gap-2 rounded-lg border border-[var(--accent-line)] bg-[var(--bento-card)] px-4 py-2 text-sm font-medium text-[var(--text-1)] hover:border-blue-500/50 transition-colors"
          >
            <Download size={14} />
            Exportar XML CONTPAQi
          </button>
          <button
            onClick={downloadCSV}
            className="flex items-center gap-2 rounded-lg border border-[var(--accent-line)] bg-[var(--bento-card)] px-4 py-2 text-sm font-medium text-[var(--text-1)] hover:border-emerald-500/50 transition-colors"
          >
            <FileSpreadsheet size={14} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* ── Polizas del dia ── */}
      <section className="mb-8">
        <h3 className="text-lg font-bold text-[var(--text-1)] mb-3 flex items-center gap-2">
          <FileText size={18} className="text-blue-500" />
          Polizas del {fecha}
          {polizas && (
            <span className="text-xs font-normal text-[var(--text-3)] ml-2">
              {polizas.resumen.totalPolizas} polizas | {polizas.resumen.ordenesPOS} ordenes POS | {polizas.resumen.movimientosInventario} mov. inventario
            </span>
          )}
        </h3>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-[var(--text-3)]">Generando polizas...</p>
            </div>
          </div>
        ) : polizas && polizas.polizas.length > 0 ? (
          <div className="space-y-3">
            {polizas.polizas.map(p => {
              const isExpanded = expandedPoliza === p.numero
              const totalDebe = p.movimientos.reduce((s, m) => s + m.debe, 0)
              const totalHaber = p.movimientos.reduce((s, m) => s + m.haber, 0)

              return (
                <div
                  key={p.numero}
                  className="rounded-xl border border-[var(--accent-line)] overflow-hidden"
                  style={{ background: 'var(--bento-card)' }}
                >
                  {/* Poliza header */}
                  <button
                    onClick={() => setExpandedPoliza(isExpanded ? null : p.numero)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-[var(--surface-2)] transition-colors"
                  >
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${tipoColors[p.tipo] || 'bg-gray-500/15 text-gray-500'}`}>
                      {p.tipoLabel}
                    </span>
                    <span className="text-sm font-semibold text-[var(--text-1)] flex-1">{p.concepto}</span>
                    <span className="text-xs font-mono text-[var(--text-3)]">
                      D: {formatCurrency(totalDebe)} | H: {formatCurrency(totalHaber)}
                    </span>
                    {isExpanded ? <ChevronUp size={16} className="text-[var(--text-3)]" /> : <ChevronDown size={16} className="text-[var(--text-3)]" />}
                  </button>

                  {/* Movimientos table */}
                  {isExpanded && (
                    <div className="border-t border-[var(--accent-line)]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-[var(--surface-2)]">
                            <th className="text-left px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">Cuenta</th>
                            <th className="text-left px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">Nombre</th>
                            <th className="text-left px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">Concepto</th>
                            <th className="text-right px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">Debe</th>
                            <th className="text-right px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">Haber</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.movimientos.map((m, i) => (
                            <tr key={i} className="border-t border-[var(--accent-line)]/50 hover:bg-[var(--surface-2)]/50">
                              <td className="px-4 py-2 font-mono text-xs text-blue-400">{m.cuenta}</td>
                              <td className="px-4 py-2 text-[var(--text-2)]">{m.cuentaNombre}</td>
                              <td className="px-4 py-2 text-[var(--text-3)]">{m.concepto}</td>
                              <td className="px-4 py-2 text-right font-mono text-[var(--text-1)]">
                                {m.debe > 0 ? formatCurrency(m.debe) : ''}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-[var(--text-1)]">
                                {m.haber > 0 ? formatCurrency(m.haber) : ''}
                              </td>
                            </tr>
                          ))}
                          {/* Totals row */}
                          <tr className="border-t-2 border-[var(--accent-line)] bg-[var(--surface-2)]">
                            <td colSpan={3} className="px-4 py-2 text-right text-xs font-bold text-[var(--text-2)] uppercase">Totales</td>
                            <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">{formatCurrency(totalDebe)}</td>
                            <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">{formatCurrency(totalHaber)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Overall balance indicator */}
            {polizas.resumen.balanceado && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-semibold text-emerald-400">Todas las polizas balanceadas (Debe = Haber)</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-48 rounded-xl border border-[var(--accent-line)]" style={{ background: 'var(--bento-card)' }}>
            <div className="text-center">
              <FileSpreadsheet size={32} className="mx-auto mb-2 text-[var(--text-4)]" />
              <p className="text-sm text-[var(--text-3)]">Sin datos para generar polizas en esta fecha</p>
              <p className="text-xs text-[var(--text-4)] mt-1">Selecciona una fecha con operaciones</p>
            </div>
          </div>
        )}
      </section>

      {/* ── Resumen Mensual (desglose pagos) ── */}
      {resumenMes && (
        <section className="mb-8">
          <h3 className="text-lg font-bold text-[var(--text-1)] mb-3 flex items-center gap-2">
            <BarChart3 size={18} className="text-purple-500" />
            Resumen Mensual — {new Date(mesSeleccionado + '-15').toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Financial summary */}
            <div className="rounded-xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
              <h4 className="text-xs font-mono uppercase tracking-wider text-[var(--text-3)] mb-4">Estado de Resultados Simplificado</h4>
              <div className="space-y-3">
                {[
                  { label: 'Ventas Brutas', value: resumenMes.ventasBrutas, color: 'text-[var(--text-1)]' },
                  { label: 'IVA Trasladado', value: -resumenMes.ivaTrasladadoMes, color: 'text-amber-400' },
                  { label: 'Ventas Netas', value: resumenMes.ventasNetas, color: 'text-blue-400', bold: true },
                  { label: 'Costo de Ventas', value: -resumenMes.costoVentas, color: 'text-pink-400' },
                  { label: 'Margen Bruto', value: resumenMes.margenBruto, color: 'text-emerald-400', bold: true },
                  { label: 'Merma/Desperdicios', value: -resumenMes.merma, color: 'text-red-400' },
                  { label: 'Compras (entradas)', value: resumenMes.entradasInventario, color: 'text-cyan-400' },
                ].map((row, i) => (
                  <div key={i} className={`flex justify-between items-center ${row.bold ? 'border-t border-[var(--accent-line)] pt-2' : ''}`}>
                    <span className={`text-sm ${row.bold ? 'font-bold text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}>{row.label}</span>
                    <span className={`font-mono text-sm ${row.bold ? 'font-bold' : ''} ${row.color}`}>
                      {row.value < 0 ? `(${formatCurrency(Math.abs(row.value))})` : formatCurrency(row.value)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-[var(--accent-line)] pt-2 flex justify-between items-center">
                  <span className="text-sm font-bold text-[var(--text-1)]">Margen %</span>
                  <span className={`font-mono text-sm font-bold ${resumenMes.margenPct >= 60 ? 'text-emerald-400' : resumenMes.margenPct >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {resumenMes.margenPct.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Payment breakdown */}
            <div className="rounded-xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
              <h4 className="text-xs font-mono uppercase tracking-wider text-[var(--text-3)] mb-4">Desglose por Metodo de Pago</h4>
              {Object.keys(resumenMes.desglosePagos).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(resumenMes.desglosePagos)
                    .sort(([, a], [, b]) => b - a)
                    .map(([method, total], i) => {
                      const pct = resumenMes.ventasBrutas > 0 ? (total / resumenMes.ventasBrutas) * 100 : 0
                      const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500']
                      return (
                        <div key={method}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-[var(--text-2)]">{method}</span>
                            <span className="font-mono text-[var(--text-1)]">{formatCurrency(total)} <span className="text-[var(--text-4)]">({pct.toFixed(1)}%)</span></span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                            <div className={`h-full rounded-full ${colors[i % colors.length]}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-4)]">Sin datos de pagos</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Analisis Fiscal con IA ── */}
      <section className="mb-8">
        <h3 className="text-lg font-bold text-[var(--text-1)] mb-3 flex items-center gap-2">
          <Search size={18} className="text-amber-500" />
          Analisis Fiscal
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-500 uppercase">IA</span>
        </h3>

        {fiscal ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Ventas vs CFDI */}
            <div className="rounded-xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
              <h4 className="text-xs font-mono uppercase tracking-wider text-[var(--text-3)] mb-4">Ventas POS vs CFDI</h4>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-[var(--text-3)]">Ventas POS</p>
                  <p className="text-xl font-bold text-[var(--text-1)] font-mono">{formatCurrency(fiscal.ventasPOS)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-3)]">Facturado (CFDI)</p>
                  <p className="text-xl font-bold text-blue-400 font-mono">{formatCurrency(fiscal.ventasCFDI)}</p>
                  <p className="text-xs text-[var(--text-4)]">{fiscal.facturasEmitidas} facturas emitidas</p>
                </div>
                <div className="border-t border-[var(--accent-line)] pt-3">
                  <p className="text-xs text-[var(--text-3)]">Sin facturar</p>
                  <p className={`text-lg font-bold font-mono ${fiscal.diferencia > 10000 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {formatCurrency(fiscal.diferencia)}
                  </p>
                  <div className="mt-2 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${fiscal.pctFacturado >= 80 ? 'bg-emerald-500' : fiscal.pctFacturado >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(fiscal.pctFacturado, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-[var(--text-4)] mt-1">{fiscal.pctFacturado}% facturado</p>
                </div>
              </div>
            </div>

            {/* Tax estimates */}
            <div className="rounded-xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
              <h4 className="text-xs font-mono uppercase tracking-wider text-[var(--text-3)] mb-4">Estimacion Impuestos</h4>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-[var(--text-3)]">IVA Trasladado (estimado)</p>
                  <p className="text-xl font-bold text-amber-400 font-mono">{formatCurrency(fiscal.ivaEstimado)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-3)]">IVA por Pagar (neto)</p>
                  <p className="text-lg font-bold text-red-400 font-mono">{formatCurrency(fiscal.ivaPorPagar)}</p>
                  <p className="text-[10px] text-[var(--text-4)]">Trasladado - acreditable estimado</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-3)]">ISR Estimado (RESICO 2.5%)</p>
                  <p className="text-lg font-bold text-purple-400 font-mono">{formatCurrency(fiscal.isrEstimado)}</p>
                  <p className="text-[10px] text-[var(--text-4)]">Regimen simplificado de confianza</p>
                </div>
                <div className="border-t border-[var(--accent-line)] pt-3">
                  <p className="text-xs text-[var(--text-3)]">Total impuestos estimado</p>
                  <p className="text-xl font-bold text-[var(--text-1)] font-mono">{formatCurrency(fiscal.ivaPorPagar + fiscal.isrEstimado)}</p>
                </div>
              </div>
            </div>

            {/* Alerts */}
            <div className="rounded-xl border border-[var(--accent-line)] p-5" style={{ background: 'var(--bento-card)' }}>
              <h4 className="text-xs font-mono uppercase tracking-wider text-[var(--text-3)] mb-4">Alertas Fiscales</h4>
              {fiscal.alertas.length > 0 ? (
                <div className="space-y-3">
                  {fiscal.alertas.map((alerta, i) => (
                    <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-300">{alerta}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <p className="text-sm text-emerald-400">Sin alertas fiscales este mes</p>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-[var(--accent-line)]">
                <h5 className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-4)] mb-2">Proyeccion Flujo</h5>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-3)]">IVA mensual 17</span>
                    <span className="font-mono text-red-400">-{formatCurrency(fiscal.ivaPorPagar)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-3)]">ISR provisional 17</span>
                    <span className="font-mono text-red-400">-{formatCurrency(fiscal.isrEstimado)}</span>
                  </div>
                  <div className="flex justify-between text-xs border-t border-[var(--accent-line)] pt-2">
                    <span className="text-[var(--text-2)] font-bold">Salida fiscal estimada</span>
                    <span className="font-mono font-bold text-[var(--text-1)]">-{formatCurrency(fiscal.ivaPorPagar + fiscal.isrEstimado)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 rounded-xl border border-[var(--accent-line)]" style={{ background: 'var(--bento-card)' }}>
            <div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
          </div>
        )}
      </section>

      {/* ── Catalogo de Cuentas Reference ── */}
      <section className="mb-8">
        <details>
          <summary className="text-sm font-semibold text-[var(--text-2)] cursor-pointer hover:text-[var(--text-1)] transition-colors">
            Catalogo de Cuentas SAT (referencia)
          </summary>
          <div className="mt-3 rounded-xl border border-[var(--accent-line)] overflow-hidden" style={{ background: 'var(--bento-card)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--surface-2)]">
                  <th className="text-left px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">Cuenta</th>
                  <th className="text-left px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">Nombre</th>
                  <th className="text-left px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['1101-001', 'Caja / Efectivo', 'Activo'],
                  ['1102-001', 'Bancos -- Tarjeta credito', 'Activo'],
                  ['1102-002', 'Bancos -- Tarjeta debito', 'Activo'],
                  ['1102-003', 'Bancos -- Transferencias', 'Activo'],
                  ['1102-004', 'Bancos -- Apps delivery', 'Activo'],
                  ['1301-001', 'Inventarios', 'Activo'],
                  ['1401-001', 'IVA acreditable', 'Activo'],
                  ['2101-001', 'Proveedores', 'Pasivo'],
                  ['2201-001', 'IVA trasladado', 'Pasivo'],
                  ['4101-001', 'Ventas', 'Ingreso'],
                  ['4101-002', 'Ventas Market', 'Ingreso'],
                  ['5101-001', 'Costo de ventas', 'Gasto'],
                  ['5102-001', 'Merma y desperdicios', 'Gasto'],
                  ['6101-001', 'Comisiones plataformas', 'Gasto'],
                ].map(([cuenta, nombre, tipo]) => (
                  <tr key={cuenta} className="border-t border-[var(--accent-line)]/50 hover:bg-[var(--surface-2)]/50">
                    <td className="px-4 py-2 font-mono text-xs text-blue-400">{cuenta}</td>
                    <td className="px-4 py-2 text-[var(--text-2)]">{nombre}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        tipo === 'Activo' ? 'bg-blue-500/15 text-blue-400' :
                        tipo === 'Pasivo' ? 'bg-amber-500/15 text-amber-400' :
                        tipo === 'Ingreso' ? 'bg-emerald-500/15 text-emerald-400' :
                        'bg-pink-500/15 text-pink-400'
                      }`}>{tipo}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  )
}
