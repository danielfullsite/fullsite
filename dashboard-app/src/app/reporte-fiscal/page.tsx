'use client'

import { useState } from 'react'
import { FileText, Download, TrendingUp, TrendingDown, DollarSign, Receipt, AlertTriangle } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

interface FiscalSummary {
  periodo: string
  ingresos: { count: number; subtotal: number; iva: number; total: number }
  egresos: { count: number; subtotal: number; iva: number; total: number }
  pagos: { count: number; total: number }
  canceladas: { count: number; total: number }
  ivaTraslado: number
  ivaAcreditable: number
  ivaPorPagar: number
  ventasDiarias: { fecha: string; total: number; tickets: number }[]
  topClientes: { rfc: string; nombre: string; total: number; count: number }[]
}

export default function ReporteFiscalPage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<FiscalSummary | null>(null)

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

  const generate = async () => {
    setLoading(true)
    setData(null)
    try {
      const from = `${year}-${String(month).padStart(2, '0')}-01`
      const lastDay = new Date(year, month, 0).getDate()
      const to = `${year}-${String(month).padStart(2, '0')}-${lastDay}`
      const h = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }

      // Fetch CFDI requests, POS orders, and purchase orders (egresos)
      const [cfdiRes, ordersRes, purchasesRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/pos_cfdi_requests?client_id=eq.${_cid()}&created_at=gte.${from}T00:00:00&created_at=lte.${to}T23:59:59&select=*&order=created_at.asc&limit=1000`, { headers: h }),
        fetch(`${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${_cid()}&status=eq.cerrada&created_at=gte.${from}T00:00:00&created_at=lte.${to}T23:59:59&select=total,created_at&order=created_at.asc&limit=5000`, { headers: h }),
        fetch(`${SUPABASE_URL}/rest/v1/pos_purchase_orders?client_id=eq.${_cid()}&created_at=gte.${from}T00:00:00&created_at=lte.${to}T23:59:59&status=neq.cancelada&select=total,subtotal,tax,created_at,supplier,status&order=created_at.asc&limit=1000`, { headers: h }),
      ])

      const cfdis = cfdiRes.ok ? await cfdiRes.json() : []
      const orders = ordersRes.ok ? await ordersRes.json() : []
      const purchases = purchasesRes.ok ? await purchasesRes.json() : []

      // Classify CFDIs
      const emitidas = cfdis.filter((c: { status: string }) => c.status === 'emitida' || c.status === 'timbrada')
      const canceladas = cfdis.filter((c: { status: string }) => c.status === 'cancelada')

      // Calculate ingresos (facturas emitidas)
      const ingresos = {
        count: emitidas.length,
        subtotal: emitidas.reduce((s: number, c: { subtotal: number; total: number }) => s + (Number(c.subtotal) || Math.round(Number(c.total || 0) / 1.16 * 100) / 100), 0),
        iva: emitidas.reduce((s: number, c: { iva: number; total: number }) => s + (Number(c.iva) || Math.round((Number(c.total || 0) - Number(c.total || 0) / 1.16) * 100) / 100), 0),
        total: emitidas.reduce((s: number, c: { total: number }) => s + (Number(c.total) || 0), 0),
      }

      // Egresos from purchase orders (facturas de proveedores)
      const egresosTotal = purchases.reduce((s: number, p: { total: number }) => s + (Number(p.total) || 0), 0)
      const egresosSubtotal = purchases.reduce((s: number, p: { subtotal: number; total: number }) => s + (Number(p.subtotal) || Math.round(Number(p.total || 0) / 1.16 * 100) / 100), 0)
      const egresosIva = purchases.reduce((s: number, p: { tax: number; total: number }) => s + (Number(p.tax) || Math.round((Number(p.total || 0) - Number(p.total || 0) / 1.16) * 100) / 100), 0)
      const egresos = { count: purchases.length, subtotal: egresosSubtotal, iva: egresosIva, total: egresosTotal }

      // IVA calculation
      const ivaTraslado = ingresos.iva
      const ivaAcreditable = egresos.iva
      const ivaPorPagar = Math.max(0, ivaTraslado - ivaAcreditable)

      // Ventas diarias (from pos_orders)
      const ventasMap = new Map<string, { total: number; tickets: number }>()
      for (const o of orders) {
        const fecha = o.created_at?.slice(0, 10) || ''
        if (!fecha) continue
        const entry = ventasMap.get(fecha) || { total: 0, tickets: 0 }
        entry.total += Number(o.total) || 0
        entry.tickets += 1
        ventasMap.set(fecha, entry)
      }
      const ventasDiarias = Array.from(ventasMap.entries())
        .map(([fecha, v]) => ({ fecha, ...v }))
        .sort((a, b) => a.fecha.localeCompare(b.fecha))

      // Top clientes (by RFC from CFDIs)
      const clienteMap = new Map<string, { nombre: string; total: number; count: number }>()
      for (const c of emitidas) {
        const rfc = c.rfc || 'XAXX010101000'
        const entry = clienteMap.get(rfc) || { nombre: c.razon_social || 'Público general', total: 0, count: 0 }
        entry.total += Number(c.total) || 0
        entry.count += 1
        clienteMap.set(rfc, entry)
      }
      const topClientes = Array.from(clienteMap.entries())
        .map(([rfc, v]) => ({ rfc, ...v }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)

      setData({
        periodo: `${monthNames[month - 1]} ${year}`,
        ingresos,
        egresos,
        pagos: { count: 0, total: 0 },
        canceladas: { count: canceladas.length, total: canceladas.reduce((s: number, c: { total: number }) => s + (Number(c.total) || 0), 0) },
        ivaTraslado,
        ivaAcreditable,
        ivaPorPagar,
        ventasDiarias,
        topClientes,
      })
    } catch (err) {
      console.error('Error generating report:', err)
    }
    setLoading(false)
  }

  const fmt = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <FileText size={24} className="text-emerald-400" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-1)]">Reporte Fiscal Mensual</h1>
          <p className="text-sm text-[var(--text-3)]">Ingresos, egresos, IVA trasladado vs acreditable, conciliacion SAT</p>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-3 mb-6">
        <select value={month} onChange={e => setMonth(Number(e.target.value))}
          className="bg-[var(--surface)] border border-[var(--line)] rounded-lg px-4 py-2.5 text-[var(--text-1)]">
          {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="bg-[var(--surface)] border border-[var(--line)] rounded-lg px-4 py-2.5 text-[var(--text-1)]">
          {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={generate} disabled={loading}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-semibold rounded-lg transition-colors">
          {loading ? 'Generando...' : 'Generar reporte'}
        </button>
        {data && (
          <a
            href={`/api/export/polizas?from=${year}-${String(month).padStart(2, '0')}-01&to=${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}&client_id=${_cid()}`}
            download
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg transition-colors"
          >
            <Download size={16} />
            Descargar CSV contable
          </a>
        )}
      </div>

      {data && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-emerald-400" />
                <span className="text-xs text-[var(--text-3)]">Ingresos facturados</span>
              </div>
              <p className="text-xl font-bold text-emerald-400">{fmt(data.ingresos.total)}</p>
              <p className="text-xs text-[var(--text-3)]">{data.ingresos.count} CFDIs emitidos</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={16} className="text-red-400" />
                <span className="text-xs text-[var(--text-3)]">Egresos facturados</span>
              </div>
              <p className="text-xl font-bold text-red-400">{fmt(data.egresos.total)}</p>
              <p className="text-xs text-[var(--text-3)]">{data.egresos.count} facturas proveedor</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={16} className="text-amber-400" />
                <span className="text-xs text-[var(--text-3)]">IVA por pagar</span>
              </div>
              <p className="text-xl font-bold text-amber-400">{fmt(data.ivaPorPagar)}</p>
              <p className="text-xs text-[var(--text-3)]">Traslado {fmt(data.ivaTraslado)} - Acred {fmt(data.ivaAcreditable)}</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Receipt size={16} className="text-sky-400" />
                <span className="text-xs text-[var(--text-3)]">Ventas del mes</span>
              </div>
              <p className="text-xl font-bold text-sky-400">{fmt(data.ventasDiarias.reduce((s, d) => s + d.total, 0))}</p>
              <p className="text-xs text-[var(--text-3)]">{data.ventasDiarias.reduce((s, d) => s + d.tickets, 0)} tickets</p>
            </div>
          </div>

          {/* Canceladas warning */}
          {data.canceladas.count > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">{data.canceladas.count} factura(s) cancelada(s) — {fmt(data.canceladas.total)}</p>
                <p className="text-xs text-[var(--text-3)]">Las facturas canceladas no se incluyen en el calculo de IVA</p>
              </div>
            </div>
          )}

          {/* IVA Detail */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--line)] bg-[var(--surface-2)]">
              <h3 className="font-bold text-[var(--text-1)]">Desglose IVA — {data.periodo}</h3>
            </div>
            <div className="p-5">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[var(--line-soft)]">
                  <tr>
                    <td className="py-2 text-[var(--text-2)]">Ingresos (subtotal)</td>
                    <td className="py-2 text-right text-[var(--text-1)] font-medium">{fmt(data.ingresos.subtotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-[var(--text-2)]">IVA trasladado (16%)</td>
                    <td className="py-2 text-right text-emerald-400 font-medium">{fmt(data.ivaTraslado)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-[var(--text-2)]">Egresos (subtotal)</td>
                    <td className="py-2 text-right text-[var(--text-1)] font-medium">{fmt(data.egresos.subtotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-[var(--text-2)]">IVA acreditable (16%)</td>
                    <td className="py-2 text-right text-red-400 font-medium">{fmt(data.ivaAcreditable)}</td>
                  </tr>
                  <tr className="border-t-2 border-[var(--line)]">
                    <td className="py-3 text-[var(--text-1)] font-bold">IVA por pagar al SAT</td>
                    <td className="py-3 text-right text-amber-400 font-bold text-lg">{fmt(data.ivaPorPagar)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Top clientes */}
          {data.topClientes.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--line)] bg-[var(--surface-2)]">
                <h3 className="font-bold text-[var(--text-1)]">Top Clientes Facturados</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line-soft)]">
                    <th className="text-left px-5 py-2 text-xs text-[var(--text-3)]">RFC</th>
                    <th className="text-left px-5 py-2 text-xs text-[var(--text-3)]">Razon social</th>
                    <th className="text-right px-5 py-2 text-xs text-[var(--text-3)]">Facturas</th>
                    <th className="text-right px-5 py-2 text-xs text-[var(--text-3)]">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line-soft)]">
                  {data.topClientes.map(c => (
                    <tr key={c.rfc}>
                      <td className="px-5 py-2 text-[var(--text-2)] font-mono text-xs">{c.rfc}</td>
                      <td className="px-5 py-2 text-[var(--text-1)]">{c.nombre}</td>
                      <td className="px-5 py-2 text-right text-[var(--text-2)]">{c.count}</td>
                      <td className="px-5 py-2 text-right text-[var(--text-1)] font-medium">{fmt(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Ventas diarias */}
          {data.ventasDiarias.length > 0 && (
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
                <h3 className="font-bold text-[var(--text-1)]">Ventas Diarias</h3>
                <span className="text-xs text-[var(--text-3)]">{data.ventasDiarias.length} dias con ventas</span>
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--surface)]">
                    <tr className="border-b border-[var(--line-soft)]">
                      <th className="text-left px-5 py-2 text-xs text-[var(--text-3)]">Fecha</th>
                      <th className="text-right px-5 py-2 text-xs text-[var(--text-3)]">Tickets</th>
                      <th className="text-right px-5 py-2 text-xs text-[var(--text-3)]">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line-soft)]">
                    {data.ventasDiarias.map(d => (
                      <tr key={d.fecha}>
                        <td className="px-5 py-2 text-[var(--text-2)]">{d.fecha}</td>
                        <td className="px-5 py-2 text-right text-[var(--text-2)]">{d.tickets}</td>
                        <td className="px-5 py-2 text-right text-[var(--text-1)] font-medium">{fmt(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
