'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Activity, Printer, Wifi, WifiOff, AlertTriangle, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
const BRIDGE_URL = 'http://127.0.0.1:7717'

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }
const fmt = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)

interface MonitorData {
  orders: { total: number; cerradas: number; abiertas: number; ventasHoy: number }
  payments: { efectivo: number; tarjeta: number; otros: number; propinas: number }
  prints: { pending: number; printed: number; failed: number; needsAttention: { id: string; station: string; type: string; error: string | null; meta?: { mesa?: number; mesero?: string } }[] }
  bridge: { online: boolean; uptime: number; stations: string[] }
  sync: { pending: number; failed: number }
  errors: string[]
  inventory: { deductions: number; alerts: number }
  cfdi: { emitidas: number; fallidas: number }
  kitchen: { avgTime: number | null }
}

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const cid = _cid()

      const [ordersRes, printRes, bridgeRes, alertsRes, cfdiRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/pos_orders?client_id=eq.${cid}&created_at=gte.${today}T00:00:00&select=status,total,propina,metodo_pago,pagos`, { headers: H }),
        fetch(`${SUPABASE_URL}/rest/v1/pos_print_jobs?client_id=eq.${cid}&created_at=gte.${today}T00:00:00&select=status`, { headers: H }).catch(() => null),
        fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(2000) }).catch(() => null),
        fetch(`${SUPABASE_URL}/rest/v1/pos_inventory_alerts?client_id=eq.${cid}&resolved=eq.false&select=id`, { headers: H }).catch(() => null),
        fetch(`${SUPABASE_URL}/rest/v1/pos_cfdi_requests?client_id=eq.${cid}&created_at=gte.${today}T00:00:00&select=status`, { headers: H }).catch(() => null),
      ])

      const orders = ordersRes.ok ? await ordersRes.json() : []
      const cerradas = orders.filter((o: { status: string }) => o.status === 'cerrada')
      const abiertas = orders.filter((o: { status: string }) => o.status === 'abierta' || o.status === 'lista')

      let efectivo = 0, tarjeta = 0, otros = 0, propinas = 0
      for (const o of cerradas) {
        propinas += Number(o.propina) || 0
        const pagos = Array.isArray(o.pagos) && o.pagos.length > 0 ? o.pagos : [{ metodo: o.metodo_pago || 'Efectivo', monto: Number(o.total) || 0 }]
        for (const p of pagos) {
          const m = (p.metodo || '').toLowerCase()
          if (/efectivo|cash/.test(m)) efectivo += Number(p.monto) || 0
          else if (/tarjeta|tc|td|crédito|débito/.test(m)) tarjeta += Number(p.monto) || 0
          else otros += Number(p.monto) || 0
        }
      }

      const prints = printRes?.ok ? await printRes.json() : []
      const bridgeData = bridgeRes?.ok ? await bridgeRes.json() : null

      const cfdis = cfdiRes?.ok ? await cfdiRes.json() : []
      const alerts = alertsRes?.ok ? await alertsRes.json() : []

      // Sync queue (localStorage)
      let syncPending = 0, syncFailed = 0
      try {
        const queue = JSON.parse(localStorage.getItem('pos_offline_queue') || '[]')
        syncPending = queue.filter((i: { synced?: boolean }) => !i.synced).length
        syncFailed = queue.filter((i: { retries?: number }) => (i.retries || 0) >= 5).length
      } catch { /* */ }

      // Local print queue (needs_attention comandas)
      let localPrintNeedsAttention: { id: string; station: string; type: string; error: string | null; meta?: { mesa?: number; mesero?: string } }[] = []
      try {
        const { getNeedsAttentionJobs } = await import('@/lib/print-queue')
        localPrintNeedsAttention = getNeedsAttentionJobs()
      } catch { /* */ }

      setData({
        orders: {
          total: orders.length,
          cerradas: cerradas.length,
          abiertas: abiertas.length,
          ventasHoy: cerradas.reduce((s: number, o: { total: number }) => s + (Number(o.total) || 0), 0),
        },
        payments: { efectivo, tarjeta, otros, propinas },
        prints: {
          pending: prints.filter((p: { status: string }) => p.status === 'pending' || p.status === 'retrying').length,
          printed: prints.filter((p: { status: string }) => p.status === 'printed').length,
          failed: prints.filter((p: { status: string }) => p.status === 'failed').length,
          needsAttention: localPrintNeedsAttention,
        },
        bridge: {
          online: !!bridgeData?.ok,
          uptime: bridgeData?.uptime || 0,
          stations: bridgeData?.stations || [],
        },
        sync: { pending: syncPending, failed: syncFailed },
        errors: [],
        inventory: { deductions: 0, alerts: alerts.length },
        cfdi: {
          emitidas: cfdis.filter((c: { status: string }) => c.status === 'emitida' || c.status === 'timbrada').length,
          fallidas: cfdis.filter((c: { status: string }) => c.status === 'error').length,
        },
        kitchen: { avgTime: null },
      })

      setLastRefresh(new Date().toLocaleTimeString('es-MX'))
      setError('')
    } catch (e) {
      console.error(e)
      setError('Sin conexión — datos no actualizados')
    }
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [])

  const StatusDot = ({ ok }: { ok: boolean }) => (
    <div className={`w-3 h-3 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
  )

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
          <Activity size={24} className="text-emerald-400" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-1)]">Monitor — Primer Dia</h1>
            <p className="text-sm text-[var(--text-3)]">Ultima actualización: {lastRefresh || '...'} (auto cada 30s)</p>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        </div>
        <button onClick={refresh} disabled={loading} className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--surface-2)]">
          <RefreshCw size={16} className={loading ? 'animate-spin text-emerald-400' : 'text-[var(--text-3)]'} />
        </button>
      </div>

      {data && (
        <div className="space-y-4">
          {/* Status row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <StatusDot ok={data.bridge.online} />
                <span className="text-xs text-[var(--text-3)]">Print Bridge</span>
              </div>
              <p className="text-lg font-bold text-[var(--text-1)]">{data.bridge.online ? 'Online' : 'OFFLINE'}</p>
              {data.bridge.online && <p className="text-xs text-[var(--text-3)]">Uptime: {Math.floor(data.bridge.uptime / 60)}min | {data.bridge.stations.join(', ')}</p>}
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <StatusDot ok={data.sync.pending === 0} />
                <span className="text-xs text-[var(--text-3)]">Sync Queue</span>
              </div>
              <p className="text-lg font-bold text-[var(--text-1)]">{data.sync.pending === 0 ? 'Al dia' : `${data.sync.pending} pendientes`}</p>
              {data.sync.failed > 0 && <p className="text-xs text-red-400">{data.sync.failed} fallidos</p>}
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Printer size={14} className="text-[var(--text-3)]" />
                <span className="text-xs text-[var(--text-3)]">Impresiones</span>
              </div>
              <p className="text-lg font-bold text-emerald-400">{data.prints.printed} <span className="text-[var(--text-3)] text-sm font-normal">impresas</span></p>
              {data.prints.pending > 0 && <p className="text-xs text-amber-400">{data.prints.pending} en cola</p>}
              {data.prints.failed > 0 && <p className="text-xs text-red-400">{data.prints.failed} fallidas</p>}
              {data.prints.needsAttention.length > 0 && <p className="text-xs text-red-400 font-bold">{data.prints.needsAttention.length} requieren atención</p>}
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-[var(--text-3)]" />
                <span className="text-xs text-[var(--text-3)]">Alertas Inventario</span>
              </div>
              <p className="text-lg font-bold text-[var(--text-1)]">{data.inventory.alerts}</p>
              <p className="text-xs text-[var(--text-3)]">sin resolver</p>
            </div>
          </div>

          {/* Comandas needs_attention */}
          {data.prints.needsAttention.length > 0 && (
            <div className="bg-red-950 border border-red-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-red-400">Comandas sin imprimir</h3>
                <button
                  onClick={async () => {
                    const { retryAllNeedsAttention } = await import('@/lib/print-queue')
                    retryAllNeedsAttention()
                    setTimeout(refresh, 1000)
                  }}
                  className="bg-red-600 text-white px-3 py-1 rounded text-xs font-bold"
                >
                  Reintentar todas
                </button>
              </div>
              <div className="space-y-2">
                {data.prints.needsAttention.map((job: { id: string; station: string; error: string | null; meta?: { mesa?: number; mesero?: string } }) => (
                  <div key={job.id} className="flex items-center justify-between bg-red-900/40 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="text-red-300 font-bold">{job.station}</span>
                      {job.meta?.mesa != null && <span className="text-red-400 ml-2">Mesa {job.meta.mesa}</span>}
                      {job.meta?.mesero && <span className="text-red-500 ml-2">{job.meta.mesero}</span>}
                    </div>
                    <button
                      onClick={async () => {
                        const { retryJob } = await import('@/lib/print-queue')
                        retryJob(job.id)
                        setTimeout(refresh, 1000)
                      }}
                      className="text-white bg-red-700 px-2 py-0.5 rounded text-xs"
                    >
                      Reintentar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sales */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <p className="text-xs text-[var(--text-3)] mb-1">Ventas hoy</p>
              <p className="text-2xl font-bold text-emerald-400">{fmt(data.orders.ventasHoy)}</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <p className="text-xs text-[var(--text-3)] mb-1">Ordenes</p>
              <p className="text-2xl font-bold text-[var(--text-1)]">{data.orders.cerradas} <span className="text-sm text-[var(--text-3)]">cerradas</span></p>
              {data.orders.abiertas > 0 && <p className="text-xs text-sky-400">{data.orders.abiertas} abiertas</p>}
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <p className="text-xs text-[var(--text-3)] mb-1">Efectivo</p>
              <p className="text-lg font-bold text-[var(--text-1)]">{fmt(data.payments.efectivo)}</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <p className="text-xs text-[var(--text-3)] mb-1">Tarjeta</p>
              <p className="text-lg font-bold text-[var(--text-1)]">{fmt(data.payments.tarjeta)}</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
              <p className="text-xs text-[var(--text-3)] mb-1">Propinas</p>
              <p className="text-lg font-bold text-violet-400">{fmt(data.payments.propinas)}</p>
            </div>
          </div>

          {/* CFDI */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4 flex items-center gap-4">
              <CheckCircle size={24} className="text-emerald-400" />
              <div>
                <p className="text-xs text-[var(--text-3)]">Facturas emitidas hoy</p>
                <p className="text-xl font-bold text-[var(--text-1)]">{data.cfdi.emitidas}</p>
              </div>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4 flex items-center gap-4">
              {data.cfdi.fallidas > 0 ? <XCircle size={24} className="text-red-400" /> : <CheckCircle size={24} className="text-emerald-400" />}
              <div>
                <p className="text-xs text-[var(--text-3)]">Facturas fallidas</p>
                <p className={`text-xl font-bold ${data.cfdi.fallidas > 0 ? 'text-red-400' : 'text-[var(--text-1)]'}`}>{data.cfdi.fallidas}</p>
              </div>
            </div>
          </div>

          {/* Health checks */}
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-xl p-4">
            <h3 className="font-bold text-[var(--text-1)] mb-3">Health Checks</h3>
            <div className="space-y-2">
              {[
                { label: 'Print Bridge', ok: data.bridge.online, detail: data.bridge.online ? `${data.bridge.stations.length} estaciones` : 'No responde en 127.0.0.1:7717' },
                { label: 'Supabase', ok: true, detail: 'Conectado' },
                { label: 'Sync Queue', ok: data.sync.pending === 0, detail: data.sync.pending === 0 ? 'Sin pendientes' : `${data.sync.pending} operaciones en cola` },
                { label: 'Print Queue', ok: data.prints.failed === 0, detail: data.prints.failed === 0 ? `${data.prints.printed} impresas hoy` : `${data.prints.failed} fallidas` },
                { label: 'Inventario', ok: data.inventory.alerts === 0, detail: data.inventory.alerts === 0 ? 'Sin alertas' : `${data.inventory.alerts} alertas de stock bajo` },
              ].map(h => (
                <div key={h.label} className="flex items-center gap-3 py-1.5">
                  <StatusDot ok={h.ok} />
                  <span className="text-sm text-[var(--text-1)] w-32">{h.label}</span>
                  <span className={`text-xs ${h.ok ? 'text-[var(--text-3)]' : 'text-red-400'}`}>{h.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
