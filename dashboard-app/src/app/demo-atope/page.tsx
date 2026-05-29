'use client'

import { useState } from 'react'
import {
  ATOPE_RESTAURANT, ATOPE_KPIS, ATOPE_MESEROS, ATOPE_PLATILLOS,
  ATOPE_CATEGORIAS, ATOPE_PAGOS, ATOPE_INSIGHTS, ATOPE_AGENTS,
  ATOPE_ROI, ATOPE_CHART, ATOPE_PREDICTION, ATOPE_MONTHLY,
  ATOPE_FOOD_COST, ATOPE_VINOS, ATOPE_YESTERDAY,
} from '@/lib/demo-atope'
import {
  TrendingUp, Users, Receipt, DollarSign, ChefHat, Wine,
  Bot, Shield, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Utensils, Clock, Flame, BarChart3, PieChart, Zap,
} from 'lucide-react'

const formatMXN = (n: number) => `$${n.toLocaleString('es-MX')}`
const tabs = ['Dashboard', 'Agentes IA', 'ROI', 'Food Cost', 'Vinos'] as const

export default function DemoAtopePage() {
  const [tab, setTab] = useState<typeof tabs[number]>('Dashboard')
  const r = ATOPE_RESTAURANT
  const k = ATOPE_KPIS

  return (
    <div style={{ background: '#0a0a0f', color: '#fff', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24, fontWeight: 900, letterSpacing: -1 }}>fullsite</span>
            <span style={{ width: 8, height: 8, background: '#10b981', display: 'inline-block' }} />
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Demo personalizado</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4 }}>
            {r.name} · {r.type} · {r.location}
          </div>
        </div>
        <a href="https://wa.me/528115324371" target="_blank" rel="noopener"
          style={{ padding: '10px 20px', background: '#10b981', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
          Agenda demo con tus datos
        </a>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingLeft: 24 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: '12px 20px', background: 'none', border: 'none', color: tab === t ? '#10b981' : 'rgba(255,255,255,0.5)',
              fontSize: 14, fontWeight: tab === t ? 700 : 400, cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #10b981' : '2px solid transparent',
            }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
        {tab === 'Dashboard' && <DashboardTab />}
        {tab === 'Agentes IA' && <AgentesTab />}
        {tab === 'ROI' && <ROITab />}
        {tab === 'Food Cost' && <FoodCostTab />}
        {tab === 'Vinos' && <VinosTab />}
      </div>

      {/* Footer CTA */}
      <div style={{ textAlign: 'center', padding: '48px 24px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Todo esto corriendo con los datos reales de {r.name}</p>
        <p style={{ fontSize: 28, fontWeight: 800, marginBottom: 16 }}>$4,999 MXN/mes. Todo incluido.</p>
        <a href="https://wa.me/528115324371" target="_blank" rel="noopener"
          style={{ padding: '14px 32px', background: '#10b981', color: '#fff', borderRadius: 10, fontWeight: 700, fontSize: 16, textDecoration: 'none', display: 'inline-block' }}>
          Agenda 20 minutos — te lo muestro en vivo
        </a>
      </div>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────
function KPI({ label, value, sub, icon: Icon, color = '#10b981' }: { label: string; value: string; sub?: string; icon: React.ElementType; color?: string }) {
  return (
    <div style={{ background: '#111118', borderRadius: 12, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 6 }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
          {sub && <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 4 }}>{sub}</div>}
        </div>
        <Icon size={20} style={{ color: 'rgba(255,255,255,0.2)' }} />
      </div>
    </div>
  )
}

// ─── Dashboard Tab ────────────────────────────────────────
function DashboardTab() {
  const k = ATOPE_KPIS
  const pred = ATOPE_PREDICTION
  const m = ATOPE_MONTHLY

  return (
    <div>
      {/* Prediction Banner */}
      <div style={{ background: 'linear-gradient(135deg, #0f172a, #1e1b4b)', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid rgba(99,102,241,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: '#818cf8', fontWeight: 600, marginBottom: 4 }}>PREDICCION DE CIERRE</div>
            <div style={{ fontSize: 32, fontWeight: 900 }}>{formatMXN(pred.projected_close)}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4 }}>Confianza: {pred.confidence}%</div>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#10b981', fontWeight: 700 }}>{pred.vs_yesterday}</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>vs ayer</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#10b981', fontWeight: 700 }}>{pred.vs_last_week}</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>vs semana pasada</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#10b981', fontWeight: 700 }}>{pred.vs_dow_avg}</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>vs promedio sabado</div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPI label="Ventas del dia" value={formatMXN(k.ventas_dia)} sub="En curso — 4:08pm" icon={DollarSign} />
        <KPI label="Tickets" value={String(k.tickets_count)} sub={`${k.personas_restaurant} personas`} icon={Receipt} />
        <KPI label="Ticket promedio" value={formatMXN(k.ticket_promedio)} sub={`Ayer: ${formatMXN(ATOPE_YESTERDAY.ticket_promedio)}`} icon={TrendingUp} color="#818cf8" />
        <KPI label="Propinas" value={formatMXN(k.propinas_total)} sub="15% sobre ventas" icon={Users} color="#f59e0b" />
        <KPI label="Mesas atendidas" value={`${k.mesas_atendidas}/${ATOPE_RESTAURANT.mesas}`} sub={`Hora pico: ${k.hora_pico}`} icon={Utensils} />
        <KPI label="Meta mensual" value={`${m.pct_meta}%`} sub={`${formatMXN(m.ventas_mes)} de ${formatMXN(m.meta_mensual)}`} icon={Flame} color="#ef4444" />
      </div>

      {/* Month Progress */}
      <div style={{ background: '#111118', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Progreso del mes</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{formatMXN(m.ventas_mes)} / {formatMXN(m.meta_mensual)}</span>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 8, height: 10, overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(90deg, #10b981, #059669)', height: '100%', width: `${m.pct_meta}%`, borderRadius: 8 }} />
        </div>
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 6 }}>
          Proyeccion: {formatMXN(m.ventas_proyectadas)} · {30 - m.dias_transcurridos} dias restantes
        </div>
      </div>

      {/* Revenue Chart */}
      <div style={{ background: '#111118', borderRadius: 12, padding: 20, marginBottom: 24, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Ventas ultimos 14 dias</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
          {ATOPE_CHART.map((d, i) => {
            const max = Math.max(...ATOPE_CHART.map(x => x.ventas))
            const h = (d.ventas / max) * 100
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{Math.round(d.ventas / 1000)}K</div>
                <div style={{ width: '100%', height: `${h}%`, background: i === ATOPE_CHART.length - 1 ? '#10b981' : 'rgba(16,185,129,0.3)', borderRadius: 4, minHeight: 4 }} />
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>{d.fecha.split(' ')[0]}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Two columns: Meseros + Categorias */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Top Meseros */}
        <div style={{ background: '#111118', borderRadius: 12, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Top Meseros del Mes</div>
          {ATOPE_MESEROS.slice(0, 5).map((m, i) => (
            <div key={m.nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 24, height: 24, borderRadius: 6, background: i < 3 ? ['#f59e0b', '#94a3b8', '#b45309'][i] : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                <span style={{ fontSize: 13 }}>{m.nombre}</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{formatMXN(m.total)}</span>
            </div>
          ))}
        </div>

        {/* Categorias */}
        <div style={{ background: '#111118', borderRadius: 12, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Ventas por Categoria</div>
          {ATOPE_CATEGORIAS.map(c => (
            <div key={c.nombre} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>{c.nombre}</span>
                <span style={{ fontWeight: 600 }}>{formatMXN(c.total)} ({c.pct}%)</span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ background: '#10b981', height: '100%', width: `${c.pct * 3.5}%`, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Insights */}
      <div style={{ background: '#111118', borderRadius: 12, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Zap size={16} style={{ color: '#f59e0b' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Insights de IA — Hoy</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          {ATOPE_INSIGHTS.map((ins, i) => (
            <div key={i} style={{
              padding: 14, borderRadius: 8,
              background: ins.priority === 'critical' ? 'rgba(239,68,68,0.08)' : ins.priority === 'high' ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${ins.priority === 'critical' ? 'rgba(239,68,68,0.2)' : ins.priority === 'high' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)'}`,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{ins.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{ins.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Agentes Tab ──────────────────────────────────────────
function AgentesTab() {
  return (
    <div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>
        {ATOPE_AGENTS.length} agentes activos monitoreando {ATOPE_RESTAURANT.name} 24/7
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
        {ATOPE_AGENTS.map(a => (
          <div key={a.id} style={{ background: '#111118', borderRadius: 10, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</span>
              </div>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Ultimo: {a.last_run}</span>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
              {a.finding}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── ROI Tab ──────────────────────────────────────────────
function ROITab() {
  const roi = ATOPE_ROI
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <KPI label="Valor generado/mes" value={formatMXN(roi.total_mensual)} icon={TrendingUp} color="#10b981" />
        <KPI label="Costo Fullsite" value={formatMXN(roi.costo_fullsite)} sub="/mes" icon={DollarSign} color="#ef4444" />
        <KPI label="ROI" value={`${roi.roi_multiplier}x`} sub="Por cada $1 invertido" icon={ArrowUpRight} color="#f59e0b" />
      </div>

      <div style={{ background: '#111118', borderRadius: 12, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Desglose por agente</div>
        {roi.desglose.map(d => (
          <div key={d.agente} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{d.agente}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{d.desc}</div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#10b981' }}>{formatMXN(d.ahorro)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Food Cost Tab ────────────────────────────────────────
function FoodCostTab() {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <KPI label="Platillos analizados" value={String(ATOPE_FOOD_COST.length)} icon={ChefHat} />
        <KPI label="Margen promedio" value="68.5%" icon={PieChart} color="#10b981" />
        <KPI label="Problema (>50% cost)" value="1" sub="Coquinas — revisar" icon={AlertTriangle} color="#ef4444" />
      </div>

      <div style={{ background: '#111118', borderRadius: 12, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              {['Platillo', 'Precio', 'Costo', 'Margen'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ATOPE_FOOD_COST.map(p => (
              <tr key={p.platillo} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500 }}>{p.platillo}</td>
                <td style={{ padding: '10px 12px', fontSize: 13 }}>{formatMXN(p.precio)}</td>
                <td style={{ padding: '10px 12px', fontSize: 13 }}>{formatMXN(p.costo)}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                    background: p.margen_pct >= 70 ? 'rgba(16,185,129,0.15)' : p.margen_pct >= 50 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
                    color: p.margen_pct >= 70 ? '#10b981' : p.margen_pct >= 50 ? '#f59e0b' : '#ef4444',
                  }}>
                    {p.margen_pct}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Vinos Tab ────────────────────────────────────────────
function VinosTab() {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <KPI label="Venta de vinos/mes" value={formatMXN(215600)} sub="14.6% de ventas totales" icon={Wine} color="#818cf8" />
        <KPI label="Botella mas vendida" value="Muga Reserva" sub="20 botellas · $1,990 c/u" icon={BarChart3} />
      </div>

      <div style={{ background: '#111118', borderRadius: 12, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Top Vinos del Mes</div>
        {ATOPE_VINOS.map((v, i) => (
          <div key={v.nombre} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, width: 20 }}>{i + 1}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{v.nombre}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{v.qty} vendidos · {formatMXN(v.precio)} c/u</div>
              </div>
            </div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{formatMXN(v.total)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
