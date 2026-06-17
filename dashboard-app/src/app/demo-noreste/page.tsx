'use client'

import {
  DollarSign, Receipt, TrendingUp, Users, Flame, Bot,
  AlertTriangle, BarChart3, ChefHat, Shield, Zap, Clock,
  ArrowUpRight, UserCheck, CalendarDays, UtensilsCrossed,
  Monitor, MessageSquare,
} from 'lucide-react'

// ─── DATA ────────────────────────────────────────────────

const SUCURSALES = [
  { nombre: 'Paseo Tec', ventas: 82400 },
  { nombre: 'Patio Lincoln', ventas: 71200 },
  { nombre: 'Cumbres Elite', ventas: 65800 },
  { nombre: 'Centro', ventas: 61500 },
  { nombre: 'La Ladrillera', ventas: 58900 },
  { nombre: 'Sendero Escobedo', ventas: 54200 },
  { nombre: 'Juarez', ventas: 48350 },
  { nombre: 'Sendero La Fe', ventas: 45000 },
]

const MESEROS = [
  { nombre: 'Carlos Mendoza', sucursal: 'Patio Lincoln', ventas: 28400, tickets: 42, tp: 676 },
  { nombre: 'Roberto Garza', sucursal: 'La Ladrillera', ventas: 26100, tickets: 38, tp: 687 },
  { nombre: 'Luis Fernando Cantu', sucursal: 'Paseo Tec', ventas: 24800, tickets: 45, tp: 551 },
  { nombre: 'Ana Lizeth Trevino', sucursal: 'Centro', ventas: 23500, tickets: 41, tp: 573 },
  { nombre: 'Jorge Alejandro Salinas', sucursal: 'Cumbres Elite', ventas: 22100, tickets: 37, tp: 597 },
  { nombre: 'Miguel Angel Villarreal', sucursal: 'Paseo Tec', ventas: 21600, tickets: 40, tp: 540 },
  { nombre: 'Daniela Rios', sucursal: 'Sendero Escobedo', ventas: 19800, tickets: 34, tp: 582 },
  { nombre: 'Fernando Elizondo', sucursal: 'Juarez', ventas: 18200, tickets: 33, tp: 552 },
]

const PLATILLOS = [
  { nombre: '5 Tacos Arrachera', qty: 312, revenue: 60840 },
  { nombre: '5 Tacos Rib Eye', qty: 248, revenue: 54312 },
  { nombre: '5 Tacos Sirloin', qty: 231, revenue: 36729 },
  { nombre: '5 Tacos de Picana', qty: 198, revenue: 39996 },
  { nombre: 'Parrillada Sultana p/4', qty: 145, revenue: 108750 },
  { nombre: 'Quesabirrias', qty: 134, revenue: 29480 },
  { nombre: 'Alitas', qty: 128, revenue: 24192 },
  { nombre: 'Mix Carne Asada/Pechuga p/2', qty: 115, revenue: 36800 },
  { nombre: 'Hamburguesa Monster', qty: 104, revenue: 19240 },
  { nombre: '5 Tacos de Pechuga', qty: 97, revenue: 11543 },
]

const AGENTS = [
  {
    emoji: '\uD83D\uDD34',
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.25)',
    name: 'ANOMALY DETECTOR',
    message: 'Sucursal La Ladrillera: cancelaciones 340% arriba del promedio (8 vs 2.3 normal). Mesero: Roberto Garza. Investigar.',
    time: 'Hace 14 min',
  },
  {
    emoji: '\uD83D\uDFE1',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
    name: 'FOOD COST',
    message: 'Arrachera subio 18% esta semana ($289 -> $341/kg). Margen en Tacos Arrachera bajo de 62% a 51%. Considerar ajuste de precio.',
    time: 'Hace 1 hr',
  },
  {
    emoji: '\uD83D\uDFE2',
    color: '#10b981',
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.25)',
    name: 'CLOSE PREDICTOR',
    message: 'Proyeccion de cierre hoy: $502,100 (+3% vs meta). Sucursal Paseo Tec lleva el ritmo mas fuerte.',
    time: 'Hace 22 min',
  },
  {
    emoji: '\uD83D\uDD35',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.08)',
    border: 'rgba(59,130,246,0.25)',
    name: 'UPSELLING',
    message: 'Mesero Carlos Mendoza (Patio Lincoln) tiene 0% de venta de Parrilladas en 3 dias. Promedio del equipo: 12%. Oportunidad de coaching.',
    time: 'Hace 45 min',
  },
  {
    emoji: '\uD83D\uDFE0',
    color: '#f97316',
    bg: 'rgba(249,115,22,0.08)',
    border: 'rgba(249,115,22,0.25)',
    name: 'STAFFING',
    message: 'Domingo proximo: demanda estimada +35% vs domingo pasado (evento Tigres). Sugiero 2 meseros extra en Paseo Tec y Cumbres.',
    time: 'Hace 2 hrs',
  },
  {
    emoji: '\uD83D\uDFE3',
    color: '#a855f7',
    bg: 'rgba(168,85,247,0.08)',
    border: 'rgba(168,85,247,0.25)',
    name: 'MENU ENGINEERING',
    message: 'Quesabirrias: estrella emergente. Ventas +45% en 2 semanas. Considerar promocion en sucursales con menor penetracion.',
    time: 'Hace 3 hrs',
  },
]

const POS_CATEGORIES = [
  { name: 'Tacos', color: '#ef4444' },
  { name: 'Parrilladas', color: '#f59e0b' },
  { name: 'Quesabirrias', color: '#a855f7' },
  { name: 'Entradas', color: '#10b981' },
  { name: 'Bebidas', color: '#3b82f6' },
  { name: 'Extras', color: '#6b7280' },
]

const POS_ITEMS = [
  { name: '5 Tacos Rib Eye', price: 219, cat: 'Tacos' },
  { name: '5 Tacos Arrachera', price: 195, cat: 'Tacos' },
  { name: '5 Tacos Picana', price: 202, cat: 'Tacos' },
  { name: '5 Tacos Sirloin', price: 159, cat: 'Tacos' },
  { name: '5 Tacos Pechuga', price: 119, cat: 'Tacos' },
  { name: 'Piratota Sirloin', price: 134, cat: 'Tacos' },
  { name: 'Parrillada Sultana p/4', price: 750, cat: 'Parrilladas' },
  { name: 'Mix Asada/Pechuga p/2', price: 320, cat: 'Parrilladas' },
  { name: 'Quesabirrias', price: 220, cat: 'Quesabirrias' },
  { name: 'Alitas', price: 189, cat: 'Entradas' },
  { name: 'Hamburguesa Monster', price: 185, cat: 'Entradas' },
  { name: 'Bone Res', price: 199, cat: 'Entradas' },
  { name: 'Papa Asada', price: 175, cat: 'Entradas' },
  { name: 'Frijoles a la Charra', price: 33, cat: 'Extras' },
  { name: 'Papas Galeana NG', price: 85, cat: 'Extras' },
  { name: 'Guacamole 200g', price: 74, cat: 'Extras' },
  { name: 'Agua Sabor 1Lt', price: 49, cat: 'Bebidas' },
  { name: 'Coca-Cola 355ml', price: 35, cat: 'Bebidas' },
]

const formatMXN = (n: number) => `$${n.toLocaleString('es-MX')}`

// ─── PAGE ────────────────────────────────────────────────

export default function DemoNorestePage() {
  const maxSucursal = Math.max(...SUCURSALES.map(s => s.ventas))

  return (
    <div style={{ background: '#0a0a0f', color: '#fff', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Section 1: Header ── */}
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'linear-gradient(180deg, rgba(16,185,129,0.04) 0%, transparent 100%)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: -1.5 }}>Noreste Grill</span>
            <span style={{ width: 6, height: 6, background: '#10b981', display: 'inline-block', borderRadius: 1 }} />
            <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: -1.5, color: '#10b981' }}>Fullsite</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16, margin: 0, maxWidth: 600 }}>
            Demo personalizado — asi se veria tu operacion con IA en las 8 sucursales
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {['Centro', 'Patio Lincoln', 'Cumbres Elite', 'La Ladrillera', 'Paseo Tec', 'Sendero Escobedo', 'Sendero La Fe', 'Juarez'].map(loc => (
              <span key={loc} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: 'rgba(255,255,255,0.6)',
              }}>{loc}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>

        {/* ── Section 2: KPIs ── */}
        <div style={{ padding: '32px 0 24px' }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
            Resumen del dia — Domingo 15 Jun 2026
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <KPICard label="Ventas del dia" value="$487,350" sub="8 sucursales" icon={DollarSign} accent="#10b981" />
            <KPICard label="Tickets" value="1,847" sub="4,210 personas" icon={Receipt} accent="#3b82f6" />
            <KPICard label="Ticket promedio" value="$263.80" sub="+12.3% vs ayer" icon={TrendingUp} accent="#818cf8" positive />
            <KPICard label="Personas" value="4,210" sub="525 por sucursal prom." icon={Users} accent="#f59e0b" />
            <KPICard label="Sucursal lider" value="Paseo Tec" sub="$82,400 — 16.9%" icon={Flame} accent="#ef4444" />
          </div>
        </div>

        {/* ── Section 3: Ventas por Sucursal ── */}
        <SectionTitle title="Ventas por Sucursal" icon={BarChart3} />
        <div style={{ background: '#111118', borderRadius: 14, padding: 24, border: '1px solid rgba(255,255,255,0.06)', marginBottom: 32 }}>
          {SUCURSALES.map((s, i) => {
            const pct = (s.ventas / maxSucursal) * 100
            return (
              <div key={s.nombre} style={{ marginBottom: i < SUCURSALES.length - 1 ? 14 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'rgba(255,255,255,0.08)',
                      color: i < 3 ? '#000' : 'rgba(255,255,255,0.5)',
                    }}>{i + 1}</span>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{s.nombre}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatMXN(s.ventas)}</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 6,
                    width: `${pct}%`,
                    background: i === 0
                      ? 'linear-gradient(90deg, #10b981, #34d399)'
                      : i < 3
                        ? 'linear-gradient(90deg, rgba(16,185,129,0.7), rgba(52,211,153,0.7))'
                        : 'linear-gradient(90deg, rgba(16,185,129,0.35), rgba(52,211,153,0.35))',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Section 4: Top Meseros ── */}
        <SectionTitle title="Top Meseros del Dia" icon={UserCheck} />
        <div style={{ background: '#111118', borderRadius: 14, padding: 24, border: '1px solid rgba(255,255,255,0.06)', marginBottom: 32, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['#', 'Mesero', 'Sucursal', 'Ventas', 'Tickets', 'Ticket Prom.'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: 'rgba(255,255,255,0.35)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MESEROS.map((m, i) => (
                <tr key={m.nombre} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '12px', width: 40 }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'rgba(255,255,255,0.08)',
                      color: i < 3 ? '#000' : 'rgba(255,255,255,0.5)',
                    }}>{i + 1}</span>
                  </td>
                  <td style={{ padding: '12px', fontSize: 13, fontWeight: 600 }}>{m.nombre}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{m.sucursal}</td>
                  <td style={{ padding: '12px', fontSize: 14, fontWeight: 700, color: '#10b981', fontVariantNumeric: 'tabular-nums' }}>{formatMXN(m.ventas)}</td>
                  <td style={{ padding: '12px', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{m.tickets}</td>
                  <td style={{ padding: '12px', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{formatMXN(m.tp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Section 5: Top Platillos ── */}
        <SectionTitle title="Top 10 Platillos" icon={ChefHat} />
        <div style={{ background: '#111118', borderRadius: 14, padding: 24, border: '1px solid rgba(255,255,255,0.06)', marginBottom: 32 }}>
          {PLATILLOS.map((p, i) => {
            const maxRev = PLATILLOS[0].revenue
            const pct = (p.revenue / maxRev) * 100
            return (
              <div key={p.nombre} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: i < PLATILLOS.length - 1 ? 12 : 0 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                  background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'rgba(255,255,255,0.06)',
                  color: i < 3 ? '#000' : 'rgba(255,255,255,0.4)',
                }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                    <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>{p.qty} vendidos</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981', fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>{formatMXN(p.revenue)}</span>
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 4, width: `${pct}%`,
                      background: i === 0 ? '#10b981' : 'rgba(16,185,129,0.4)',
                    }} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Section 6: AI Agents ── */}
        <SectionTitle title="Agentes de IA — Alertas en Vivo" icon={Bot} />
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 16, marginTop: -16 }}>
          6 agentes monitoreando las 8 sucursales 24/7. Estas son las alertas de hoy.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, marginBottom: 32 }}>
          {AGENTS.map(a => (
            <div key={a.name} style={{
              background: a.bg, borderRadius: 14, padding: 20,
              border: `1px solid ${a.border}`,
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, right: 0, width: 80, height: 80,
                background: `radial-gradient(circle at top right, ${a.border}, transparent 70%)`,
                opacity: 0.5,
              }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{a.emoji}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: a.color, letterSpacing: 0.5 }}>{a.name}</span>
                </div>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{a.time}</span>
              </div>
              <div style={{
                fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6,
                padding: '12px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 8,
              }}>
                {a.message}
              </div>
            </div>
          ))}
        </div>

        {/* ── Section 7: POS Preview ── */}
        <SectionTitle title="Vista Previa del POS" icon={Monitor} />
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 16, marginTop: -16 }}>
          Asi se veria el punto de venta en cada sucursal. Corre en cualquier tablet o computadora.
        </div>
        <div style={{
          background: '#111118', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)',
          marginBottom: 32, overflow: 'hidden',
        }}>
          {/* POS Top bar */}
          <div style={{
            padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>NORESTE GRILL</span>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Paseo Tec</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Mesa 5 &middot; Luis F.</span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px' }}>
            {/* Menu grid */}
            <div style={{ padding: 16 }}>
              {/* Category pills */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {POS_CATEGORIES.map((c, i) => (
                  <span key={c.name} style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: i === 0 ? c.color : 'rgba(255,255,255,0.06)',
                    color: i === 0 ? '#fff' : 'rgba(255,255,255,0.5)',
                    border: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)',
                  }}>{c.name}</span>
                ))}
              </div>
              {/* Items */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {POS_ITEMS.filter(i => i.cat === 'Tacos' || i.cat === 'Parrilladas' || i.cat === 'Quesabirrias').map(item => (
                  <div key={item.name} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 10, padding: '12px 10px', cursor: 'default',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, lineHeight: 1.3, color: 'rgba(255,255,255,0.8)' }}>{item.name}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>{formatMXN(item.price)}</div>
                  </div>
                ))}
              </div>
              {/* AI suggestion */}
              <div style={{
                marginTop: 14, padding: '12px 14px', borderRadius: 10,
                background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
              }}>
                <div style={{ fontSize: 11, color: '#818cf8', fontWeight: 700, marginBottom: 4, letterSpacing: 0.5 }}>IA COPILOT</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                  Mesa 5 pidio 5 Tacos Arrachera sin complementos. Ofrece Papas Galeana NG ($85) + Guacamole ($74) — sube ticket $159 y 72% de clientes aceptan combo.
                </div>
              </div>
            </div>

            {/* Order panel */}
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.06)', padding: 16, background: 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Orden Actual</div>
              {[
                { name: '5 Tacos Arrachera', qty: 2, price: 390 },
                { name: 'Parrillada Sultana p/4', qty: 1, price: 750 },
                { name: 'Alitas', qty: 1, price: 189 },
                { name: 'Coca-Cola 355ml', qty: 3, price: 105 },
                { name: 'Agua Sabor 1Lt', qty: 1, price: 49 },
              ].map(item => (
                <div key={item.name} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '7px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12,
                }}>
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>{item.qty}x {item.name}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatMXN(item.price)}</span>
                </div>
              ))}
              <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
                  <span>TOTAL</span>
                  <span>{formatMXN(1483)}</span>
                </div>
                <div style={{
                  padding: '12px 0', textAlign: 'center', background: '#10b981',
                  borderRadius: 10, fontWeight: 700, fontSize: 14,
                }}>Cobrar</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 8: CTA ── */}
        <div style={{
          textAlign: 'center', padding: '56px 24px 72px',
          background: 'linear-gradient(180deg, transparent, rgba(16,185,129,0.03) 50%, transparent)',
          borderRadius: 24, marginBottom: 32,
        }}>
          <div style={{ fontSize: 13, color: '#10b981', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
            El futuro de Noreste Grill
          </div>
          <h2 style={{ fontSize: 32, fontWeight: 900, marginBottom: 8, letterSpacing: -1 }}>
            Listo para ver Fullsite en accion?
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16, marginBottom: 32, maxWidth: 500, margin: '0 auto 32px' }}>
            Todo esto corriendo con los datos reales de tus 8 sucursales. Implementacion en 48 horas.
          </p>
          <a href="https://wa.me/528115324371" target="_blank" rel="noopener" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '16px 36px', background: '#25D366', color: '#fff',
            borderRadius: 14, fontWeight: 800, fontSize: 17, textDecoration: 'none',
            boxShadow: '0 4px 24px rgba(37,211,102,0.3)',
          }}>
            <MessageSquare size={20} />
            Agenda demo en vivo
          </a>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 24, flexWrap: 'wrap' }}>
            {[
              'Implementacion en 48 horas',
              '$4,999/mes por sucursal',
              'Sin contrato',
            ].map(item => (
              <span key={item} style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          textAlign: 'center', padding: '24px 0 40px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          color: 'rgba(255,255,255,0.2)', fontSize: 12,
        }}>
          fullsite.mx — El copiloto operativo para restaurantes
        </div>
      </div>
    </div>
  )
}

// ─── COMPONENTS ──────────────────────────────────────────

function KPICard({ label, value, sub, icon: Icon, accent, positive }: {
  label: string; value: string; sub?: string; icon: React.ElementType; accent: string; positive?: boolean
}) {
  return (
    <div style={{
      background: '#111118', borderRadius: 14, padding: 20,
      border: '1px solid rgba(255,255,255,0.06)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -20, right: -20, width: 60, height: 60,
        background: accent, opacity: 0.04, borderRadius: '50%', filter: 'blur(20px)',
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 8, fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: accent }}>{value}</div>
          {sub && (
            <div style={{ color: positive ? '#10b981' : 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              {positive && <ArrowUpRight size={12} />}
              {sub}
            </div>
          )}
        </div>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} style={{ color: 'rgba(255,255,255,0.2)' }} />
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingTop: 8 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} style={{ color: '#10b981' }} />
      </div>
      <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3 }}>{title}</span>
    </div>
  )
}
