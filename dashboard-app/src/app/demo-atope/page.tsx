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
const tabs = ['Dashboard', 'Agentes IA', 'Bot IA', 'POS', 'ROI', 'Food Cost', 'Vinos', 'Anti-Fraude'] as const

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
        {tab === 'Bot IA' && <BotIATab />}
        {tab === 'POS' && <POSTab />}
        {tab === 'ROI' && <ROITab />}
        {tab === 'Food Cost' && <FoodCostTab />}
        {tab === 'Vinos' && <VinosTab />}
        {tab === 'Anti-Fraude' && <AntiFraudeTab />}
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

// ─── Bot IA Tab (Simulated Telegram Chat) ─────────────────
const CHAT_MESSAGES = [
  { from: 'user', text: 'Como vamos hoy?', time: '14:02' },
  { from: 'bot', text: 'HOY SABADO — VENTAS: $68,500\n\nTickets: 86 | Personas: 178\nTicket promedio: $797\nPropinas: $10,275 (15%)\n\nVas 10.5% arriba del promedio de sabados.\nProyeccion de cierre: $94,500 (confianza 87%)\n\nTop mesero: Rodrigo Martinez $12,400', time: '14:02' },
  { from: 'user', text: 'Cuanto cuesta hacer la paella valenciana?', time: '14:05' },
  { from: 'bot', text: 'PAELLA VALENCIANA\n\nPrecio venta: $1,150\nCosto ideal: $287\nFood cost: 25%\nMargen: 75%\n\nCategoria: ESTRELLA\nVende mucho + margen alto. Perfecto.', time: '14:05' },
  { from: 'user', text: 'Quien vendio mas vino hoy?', time: '14:08' },
  { from: 'bot', text: 'RANKING VINOS HOY:\n\n1. Rodrigo Martinez — 8 botellas ($14,200)\n   Muga Rsva x3, Atope España x5\n2. Valentina Solis — 5 botellas ($8,950)\n3. Andres Navarro — 4 botellas ($6,800)\n\nDato: Rodrigo cierra maridaje en 78% de sus paellas. El resto del equipo en 38%.', time: '14:08' },
  { from: 'user', text: 'Que recomiendas para subir el ticket?', time: '14:12' },
  { from: 'bot', text: 'OPORTUNIDADES HOY:\n\n1. MARIDAJE VINO + PAELLA: 62% de mesas con paella NO piden vino. Potencial: +$890/mesa\n\n2. POSTRE DESPUES DE PLATO FUERTE: Solo 28% pide postre. La Tarta Vasca tiene 80% margen. Potencial: +$330/mesa\n\n3. UPGRADE JAMON: Ofrecer Iberico de Salamanca ($1,190) vs tabla de quesos ($385). 3 de cada 10 aceptan.\n\nAccion: briefear a meseros en cambio de turno a las 3pm.', time: '14:12' },
  { from: 'user', text: 'Algo raro hoy?', time: '16:30' },
  { from: 'bot', text: 'ALERTA DETECTADA:\n\nCarlos Ruiz autorizo cortesia de $790 (Chuletillas de Cordero) en mesa 14. El es mesero, no supervisor.\n\nRegla: meseros no pueden autorizar cortesias. Solo el gerente.\n\nRevisa con el encargado de turno.', time: '16:30' },
]

function BotIATab() {
  return (
    <div style={{ maxWidth: 500, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Bot de Fullsite — WhatsApp / Telegram</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Pregunta lo que quieras sobre tu restaurante. Responde en 2 segundos.</div>
      </div>
      <div style={{ background: '#0d1117', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
        {CHAT_MESSAGES.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.from === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            <div style={{
              maxWidth: '85%', padding: '10px 14px', borderRadius: 12,
              background: m.from === 'user' ? '#1a472a' : '#1a1a2e',
              borderTopRightRadius: m.from === 'user' ? 2 : 12,
              borderTopLeftRadius: m.from === 'bot' ? 2 : 12,
            }}>
              <div style={{ fontSize: 13, whiteSpace: 'pre-line', lineHeight: 1.5, color: 'rgba(255,255,255,0.85)' }}>{m.text}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 4, textAlign: 'right' }}>{m.time}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
        Preguntas reales, datos reales, respuestas en 2 segundos. 24/7.
      </div>
    </div>
  )
}

// ─── POS Tab (Interactive) ────────────────────────────────
const POS_MENU = [
  { cat: 'TAPAS', items: [
    { name: 'Patatas Bravas', price: 255 }, { name: 'Gambas al Ajillo', price: 380 },
    { name: 'Croquetas Jamon Iberico', price: 250 }, { name: 'Pulpo a la Gallega', price: 445 },
    { name: 'Tortilla Española', price: 265 }, { name: 'Alcachofas de Sevilla', price: 445 },
  ]},
  { cat: 'PAELLAS', items: [
    { name: 'Paella Valenciana', price: 1150 }, { name: 'Paella Negra', price: 1290 },
    { name: 'Paella Mixta', price: 990 }, { name: 'Paella Solomillo', price: 1390 },
    { name: 'Meloso de Bogavante', price: 990 }, { name: 'Meloso Hongos Trufa', price: 590 },
  ]},
  { cat: 'FUERTES', items: [
    { name: 'Cochinillo Atope', price: 1150 }, { name: 'Solomillo con Foie', price: 845 },
    { name: 'Solomillo Pimienta', price: 790 }, { name: 'Chuletillas Cordero', price: 790 },
    { name: 'Rabo de Toro', price: 480 }, { name: 'Bacalao a la Gallega', price: 590 },
  ]},
  { cat: 'POSTRES', items: [
    { name: 'Tarta Queso Vasca', price: 330 }, { name: 'Torrija Valenciana', price: 340 },
    { name: 'Peras al Obispo', price: 290 }, { name: 'La Merienda', price: 345 },
    { name: 'Socarrat Arroz con Leche', price: 310 },
  ]},
  { cat: 'VINOS', items: [
    { name: 'Atope España (Copa)', price: 240 }, { name: 'Muga Reserva', price: 1990 },
    { name: 'Sol y Nieve (Copa)', price: 190 }, { name: 'Sangria Tinto (Jarra)', price: 385 },
  ]},
]

function POSTab() {
  const [selectedCat, setSelectedCat] = useState('TAPAS')
  const [order, setOrder] = useState<Array<{ name: string; price: number; qty: number }>>([])

  const addItem = (name: string, price: number) => {
    setOrder(prev => {
      const existing = prev.find(i => i.name === name)
      if (existing) return prev.map(i => i.name === name ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { name, price, qty: 1 }]
    })
  }

  const total = order.reduce((s, i) => s + i.price * i.qty, 0)
  const currentItems = POS_MENU.find(c => c.cat === selectedCat)?.items || []

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, minHeight: 500 }}>
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {POS_MENU.map(c => (
            <button key={c.cat} onClick={() => setSelectedCat(c.cat)} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: selectedCat === c.cat ? '#10b981' : '#1a1a24', color: '#fff',
            }}>{c.cat}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {currentItems.map(item => (
            <button key={item.name} onClick={() => addItem(item.name, item.price)} style={{
              background: '#111118', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
              padding: 14, cursor: 'pointer', textAlign: 'left', color: '#fff',
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{item.name}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#10b981' }}>{formatMXN(item.price)}</div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, color: '#818cf8', fontWeight: 600, marginBottom: 4 }}>IA COPILOT</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
            {order.some(i => i.name.includes('Paella')) && !order.some(i => i.name.includes('Copa') || i.name.includes('Muga') || i.name.includes('Sangria'))
              ? '💡 Esta mesa pidio paella sin vino. Ofrece Atope España copa ($240) o Muga Reserva ($1,990). El maridaje sube el ticket $890 promedio.'
              : order.length >= 2 && !order.some(i => POS_MENU.find(c => c.cat === 'POSTRES')?.items.some(p => p.name === i.name))
              ? '💡 Mesa sin postre. Ofrece Tarta de Queso Vasca ($330) — 80% margen, la favorita de la casa.'
              : order.length > 0
              ? '💡 Tip: el Jamon Iberico de Salamanca ($1,190) como entrada compartida sube el ticket $600+ en 30% de las mesas.'
              : 'Selecciona platillos para ver sugerencias de IA en tiempo real.'}
          </div>
        </div>
      </div>
      <div style={{ background: '#111118', borderRadius: 12, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Mesa 7 · Rodrigo M.</div>
        {order.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: 40 }}>Toca un platillo para agregarlo</div>
        ) : (
          <>
            {order.map(item => (
              <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 13 }}>
                <span>{item.qty}x {item.name}</span>
                <span style={{ fontWeight: 600 }}>{formatMXN(item.price * item.qty)}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 12, paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800 }}>
                <span>TOTAL</span><span>{formatMXN(total)}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => setOrder([])} style={{ flex: 1, padding: 12, background: '#1e293b', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Limpiar</button>
                <button style={{ flex: 1, padding: 12, background: '#10b981', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Cobrar</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Anti-Fraude Tab ──────────────────────────────────────
const FRAUD_ALERTS = [
  { severity: 'high', title: 'Auto-descuento detectado', detail: 'Carlos Ruiz (mesero) autorizo cortesia de Chuletillas de Cordero ($790) en Mesa 14. El mesero no tiene permiso de autorizar cortesias — solo el gerente.', fecha: 'Hoy 16:30', action: 'Revisar con encargado de turno. Configurar permisos: cortesia solo para perfil Gerente.' },
  { severity: 'medium', title: 'Descuentos concentrados', detail: 'Ana Beltran aplico 4 descuentos en las ultimas 2 horas por un total de $1,280. Patron inusual vs su promedio de 0.5 descuentos/turno.', fecha: 'Hoy 15:45', action: 'Verificar si hubo evento especial o promocion activa.' },
  { severity: 'low', title: 'Cancelacion de Paella Negra', detail: 'Mesa 9 cancelo Paella Negra ($1,290) despues de 25 minutos. Motivo: "cliente cambio de opinion". Food cost perdido: ~$412.', fecha: 'Hoy 14:20', action: 'Verificar con cocina si la paella se preparo. Si si, registrar como merma.' },
  { severity: 'info', title: 'Semana sin alertas criticas', detail: 'Esta semana: 0 fraudes confirmados, 2 alertas investigadas y resueltas, $0 en perdidas por cortesias no autorizadas.', fecha: 'Resumen semanal', action: 'Buen trabajo del equipo. Mantener protocolos.' },
]

function AntiFraudeTab() {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KPI label="Alertas esta semana" value="3" icon={Shield} />
        <KPI label="Fraudes confirmados" value="0" sub="Semana limpia" icon={Shield} color="#10b981" />
        <KPI label="Cortesias no autorizadas" value="$790" sub="1 caso" icon={AlertTriangle} color="#f59e0b" />
        <KPI label="Perdida prevenida/mes" value="$12,800" sub="Deteccion automatica" icon={DollarSign} color="#10b981" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {FRAUD_ALERTS.map((a, i) => (
          <div key={i} style={{
            background: '#111118', borderRadius: 12, padding: 20, border: '1px solid rgba(255,255,255,0.06)',
            borderLeft: `4px solid ${a.severity === 'high' ? '#ef4444' : a.severity === 'medium' ? '#f59e0b' : a.severity === 'low' ? '#3b82f6' : '#10b981'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{a.title}</div>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                background: a.severity === 'high' ? 'rgba(239,68,68,0.15)' : a.severity === 'medium' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
                color: a.severity === 'high' ? '#ef4444' : a.severity === 'medium' ? '#f59e0b' : '#10b981',
              }}>{a.severity === 'high' ? 'ALTA' : a.severity === 'medium' ? 'MEDIA' : a.severity === 'low' ? 'BAJA' : 'INFO'}</span>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 10 }}>{a.detail}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 8 }}>{a.fecha}</div>
            <div style={{ fontSize: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, color: 'rgba(255,255,255,0.5)' }}>
              Accion recomendada: {a.action}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
