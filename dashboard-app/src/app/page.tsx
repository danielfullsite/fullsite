'use client'

// Dashboard (home) — rediseñado con el lenguaje del artifact, theme-aware
// (tokens del esqueleton, dark/light), conservando features (toggle de periodo,
// agentes, notificaciones viven en AppShell). Datos reales por tenant activo.
// Regla esqueleton: costos/margen SOLO en dashboard del dueño, NUNCA en el PDV.

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Wifi, TrendingUp, TrendingDown, Bot, Check, X, ArrowRight } from 'lucide-react'
import { getRecentDays, getLatestDay, getDashboardFromPosOrders, getDeepTable } from '@/lib/data'
import { agentName } from '@/lib/agent-names'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { WansoftDaily } from '@/lib/types'

type Detection = { agent_id: string; priority: string; summary: string; fecha: string }
type Kind = 'crit' | 'warn' | 'ok'
type Action = 'aplicado' | 'recordar' | 'descartado'
type Period = 'dia' | 'semana' | 'mes'

const kindOf = (p?: string): Kind => (p === 'critical' || p === 'high') ? 'crit' : (p === 'warning' || p === 'medium') ? 'warn' : 'ok'
const sev = (p?: string): number => { const k = kindOf(p); return k === 'crit' ? 3 : k === 'warn' ? 2 : 1 }
const KIND_COLOR: Record<Kind, string> = { crit: 'var(--crit)', warn: 'var(--warn, #d97706)', ok: 'var(--accent)' }
const KIND_LABEL: Record<Kind, string> = { crit: 'Atender hoy', warn: 'Revisar', ok: 'Todo bien' }
const num = (v: unknown) => Number(v) || 0

function areaPath(vals: number[], w: number, h: number, pad = 8): { line: string; area: string } {
  if (vals.length < 2) return { line: '', area: '' }
  const max = Math.max(...vals), min = Math.min(...vals), range = max - min || 1
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, pad + (1 - (v - min) / range) * (h - pad * 2)] as const)
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  return { line, area: `${line} L ${w} ${h} L 0 ${h} Z` }
}

export default function Home() {
  const [recent, setRecent] = useState<WansoftDaily[]>([])
  const [latest, setLatest] = useState<WansoftDaily | null>(null)
  const [dets, setDets] = useState<Detection[]>([])
  const [actioned, setActioned] = useState<Record<string, Action>>({})
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(true)
  const [period, setPeriod] = useState<Period>('dia')

  const load = useCallback(async () => {
    try {
      let [rec, lat] = await Promise.all([
        getRecentDays(1000).catch(() => [] as WansoftDaily[]),
        getLatestDay().catch(() => null as WansoftDaily | null),
      ])
      if (rec.length === 0) { rec = await getDashboardFromPosOrders(30).catch(() => []); lat = rec[rec.length - 1] || null }
      setRecent(rec); setLatest(lat)
      try {
        const [results, fb] = await Promise.all([
          getDeepTable('agent_results', 80).catch(() => []),
          fetch('/api/agents/feedback', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
        ])
        const byAgent = new Map<string, Detection>()
        for (const r of results as Detection[]) if (r?.summary && !byAgent.has(r.agent_id)) byAgent.set(r.agent_id, r)
        setDets([...byAgent.values()].sort((a, b) => sev(b.priority) - sev(a.priority)))
        if (fb?.feedback) { const m: Record<string, Action> = {}; for (const row of fb.feedback) m[row.agent_id] = row.action; setActioned(m) }
      } catch {}
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load(); const i = setInterval(load, 5 * 60 * 1000); const f = () => load(); window.addEventListener('focus', f); return () => { clearInterval(i); window.removeEventListener('focus', f) } }, [load])
  useEffect(() => { const on = () => setOnline(navigator.onLine); on(); window.addEventListener('online', on); window.addEventListener('offline', on); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) } }, [])

  const saveAction = (agentId: string, action: Action, det?: Detection) => {
    setActioned(a => ({ ...a, [agentId]: action }))
    fetch('/api/agents/feedback', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, action, insight_fecha: det?.fecha, insight_summary: det?.summary }) }).catch(() => {})
  }

  if (loading) return <div className="grid place-items-center h-96"><div className="w-9 h-9 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} /></div>

  // ── Agregación por periodo ──
  const day = latest
  const sum = (days: WansoftDaily[], f: keyof WansoftDaily) => days.reduce((s, d) => s + num(d[f]), 0)
  const last7 = recent.slice(-7)
  const prev7 = recent.slice(-14, -7)
  const monthKey = day ? day.fecha.slice(0, 7) : ''
  const monthDays = recent.filter(d => d.fecha.slice(0, 7) === monthKey)
  const sameDOWavg = (() => {
    if (!day) return 0
    const dow = new Date(day.fecha + 'T12:00:00').getDay()
    const s = recent.filter(d => d.fecha !== day.fecha && new Date(d.fecha + 'T12:00:00').getDay() === dow).slice(-4)
    return s.length ? s.reduce((a, d) => a + num(d.ventas_dia), 0) / s.length : 0
  })()

  const P = (() => {
    if (period === 'semana') {
      const v = sum(last7, 'ventas_dia'), pv = sum(prev7, 'ventas_dia')
      return { venta: v, tickets: sum(last7, 'tickets_count'), personas: sum(last7, 'personas_restaurant'), propinas: sum(last7, 'propinas_total'), prev: pv, prevLbl: 'semana anterior', sub: 'últimos 7 días' }
    }
    if (period === 'mes') {
      const v = sum(monthDays, 'ventas_dia')
      return { venta: v, tickets: sum(monthDays, 'tickets_count'), personas: sum(monthDays, 'personas_restaurant'), propinas: sum(monthDays, 'propinas_total'), prev: 0, prevLbl: '', sub: `${monthDays.length} días del mes` }
    }
    const dowName = day ? ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][new Date(day.fecha + 'T12:00:00').getDay()] : ''
    return { venta: num(day?.ventas_dia), tickets: num(day?.tickets_count), personas: num(day?.personas_restaurant), propinas: num(day?.propinas_total), prev: sameDOWavg, prevLbl: `${dowName} promedio`, sub: 'hoy' }
  })()
  const tp = P.personas > 0 ? Math.round(P.venta / P.personas) : (P.tickets > 0 ? Math.round(P.venta / P.tickets) : 0)
  const deltaPct = P.prev > 0 ? ((P.venta - P.prev) / P.prev) * 100 : null

  const series = recent.slice(-14).map(d => num(d.ventas_dia))
  const { line, area } = areaPath(series, 720, 150)

  const dd = (day || {}) as unknown as Record<string, unknown>
  const topDishes = (Array.isArray(dd.platillos_top) ? dd.platillos_top : []).slice(0, 6) as Array<{ nombre: string; total: number; cantidad?: number }>
  const canalesRaw = Array.isArray(dd.pago_metodos) ? dd.pago_metodos : (Array.isArray(dd['pago_métodos']) ? dd['pago_métodos'] : [])
  const canales = canalesRaw as Array<{ nombre: string; total: number }>
  const canalTotal = canales.reduce((s, c) => s + num(c.total), 0) || 1
  const topDets = dets.filter(d => actioned[d.agent_id] !== 'descartado').slice(0, 3)

  const TABS: { k: Period; l: string }[] = [{ k: 'dia', l: 'Día' }, { k: 'semana', l: 'Semana' }, { k: 'mes', l: 'Mes' }]

  return (
    <div className="max-w-[1180px] mx-auto w-full" style={{ color: 'var(--text-1)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <h1 className="text-2xl font-extrabold tracking-tight">Resumen</h1>
        <span className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border"
          style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--text-2)' }}>
          <span className="w-2 h-2 rounded-full" style={{ background: online ? 'var(--accent)' : 'var(--warn, #d97706)', boxShadow: '0 0 0 3px var(--accent-soft)' }} />
          <Wifi size={13} /> {online ? 'En línea' : 'Sin internet'} · <b style={{ color: 'var(--text-1)' }}>cobra sin caerse</b>
        </span>
        <div className="flex-1" />
        <div className="inline-flex rounded-xl border p-0.5" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          {TABS.map(t => (
            <button key={t.k} onClick={() => setPeriod(t.k)} className="text-sm font-semibold px-3.5 py-1.5 rounded-lg transition-colors"
              style={period === t.k ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-3)' }}>{t.l}</button>
          ))}
        </div>
      </div>

      {/* Hoy/Periodo + Agentes */}
      <div className="grid gap-3.5 mb-3.5" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)' }}>
        <div className="rounded-2xl border p-5" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
          <h2 className="text-sm font-bold flex items-baseline gap-2">Venta <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>· {P.sub}</span></h2>
          <div className="text-[42px] font-extrabold tabular-nums leading-none mt-2.5 mb-2 tracking-tight">{formatCurrency(P.venta)}</div>
          {deltaPct !== null && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
              style={{ background: deltaPct >= 0 ? 'var(--accent-soft)' : 'var(--crit-soft)', color: deltaPct >= 0 ? 'var(--accent-ink)' : 'var(--crit-ink)' }}>
              {deltaPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}% vs. {P.prevLbl}
            </span>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-5">
            {[{ l: 'Órdenes', n: formatNumber(P.tickets) }, { l: 'Ticket promedio', n: formatCurrency(tp) }, { l: 'Personas', n: formatNumber(P.personas) }, { l: 'Propinas', n: formatCurrency(P.propinas) }].map((k, i) => (
              <div key={i}><div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-3)' }}>{k.l}</div><div className="text-lg font-bold tabular-nums mt-0.5">{k.n}</div></div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border p-5" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold flex items-center gap-2"><Bot size={16} style={{ color: 'var(--accent-ink)' }} />Tus agentes hoy</h2>
            <span className="text-[10px] font-bold tracking-wide inline-flex items-center gap-1.5" style={{ color: 'var(--accent-ink)' }}><span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />EN VIVO</span>
          </div>
          {topDets.length === 0 ? <div className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>Todo en orden — sin alertas de tus agentes.</div> : topDets.map(d => {
            const k = kindOf(d.priority), act = actioned[d.agent_id]
            return (
              <div key={d.agent_id} className="flex gap-3 rounded-xl border p-3 mb-2" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
                <span className="w-1.5 rounded-full flex-shrink-0" style={{ background: KIND_COLOR[k] }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold truncate">{agentName(d.agent_id)}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ color: KIND_COLOR[k], background: k === 'crit' ? 'var(--crit-soft)' : k === 'warn' ? 'var(--warn-soft, rgba(217,119,6,.12))' : 'var(--accent-soft)' }}>{KIND_LABEL[k]}</span>
                  </div>
                  <p className="text-xs mt-1 leading-snug" style={{ color: 'var(--text-2)' }}>{d.summary}</p>
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={() => saveAction(d.agent_id, 'aplicado', d)} className="text-[11px] font-bold rounded-lg px-2.5 py-1 inline-flex items-center gap-1" style={act === 'aplicado' ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}><Check size={12} />{act === 'aplicado' ? 'Aplicado' : 'Aplicar'}</button>
                    <button onClick={() => saveAction(d.agent_id, 'descartado', d)} className="text-[11px] font-bold rounded-lg px-2.5 py-1 border inline-flex items-center gap-1" style={{ borderColor: 'var(--line)', color: 'var(--text-3)' }}><X size={12} />Descartar</button>
                  </div>
                </div>
              </div>
            )
          })}
          <Link href="/mission-control" className="inline-flex items-center gap-1.5 text-xs font-semibold mt-1" style={{ color: 'var(--accent-ink)' }}>Ver todos los agentes <ArrowRight size={13} /></Link>
        </div>
      </div>

      {/* Ventas 14 días */}
      <div className="rounded-2xl border p-5 mb-3.5" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
        <div className="flex items-center justify-between mb-1"><h2 className="text-sm font-bold">Ventas · últimos 14 días</h2><span className="text-xs" style={{ color: 'var(--text-3)' }}>{series.length} días</span></div>
        {series.length >= 2 ? (
          <svg viewBox="0 0 720 150" preserveAspectRatio="none" className="w-full" style={{ height: 150 }}>
            <defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
            <path d={area} fill="url(#rg)" /><path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : <p className="text-sm py-8 text-center" style={{ color: 'var(--text-3)' }}>Aún no hay suficientes días para graficar.</p>}
      </div>

      {/* Canales + Top platillos */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)' }}>
        <div className="rounded-2xl border p-5" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
          <h2 className="text-sm font-bold mb-3">Cómo cobraste · hoy</h2>
          {canales.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-3)' }}>Sin datos aún.</p> : (
            <div className="space-y-2.5">{canales.sort((a, b) => b.total - a.total).slice(0, 5).map((c, i) => (
              <div key={i}><div className="flex justify-between text-xs mb-1"><span style={{ color: 'var(--text-2)' }}>{c.nombre}</span><span className="font-bold tabular-nums">{formatCurrency(num(c.total))}</span></div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}><div className="h-full rounded-full" style={{ width: `${(num(c.total) / canalTotal) * 100}%`, background: 'var(--accent)' }} /></div></div>
            ))}</div>
          )}
        </div>
        <div className="rounded-2xl border p-5" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
          <h2 className="text-sm font-bold mb-3">Lo que más se vende · hoy</h2>
          {topDishes.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-3)' }}>Sin datos aún.</p> : (
            <table className="w-full text-sm"><tbody>{topDishes.map((p, i) => (
              <tr key={i} style={{ borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <td className="py-2 pr-2" style={{ color: 'var(--text-1)' }}>{p.nombre}</td>
                {typeof p.cantidad === 'number' && <td className="py-2 px-2 text-right tabular-nums" style={{ color: 'var(--text-3)' }}>{formatNumber(p.cantidad)}</td>}
                <td className="py-2 pl-2 text-right font-bold tabular-nums">{formatCurrency(num(p.total))}</td>
              </tr>
            ))}</tbody></table>
          )}
          <Link href="/rentabilidad" className="inline-flex items-center gap-1.5 text-xs font-semibold mt-3" style={{ color: 'var(--accent-ink)' }}>Ver margen por platillo <ArrowRight size={13} /></Link>
        </div>
      </div>
    </div>
  )
}
