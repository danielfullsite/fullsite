'use client'

import { useState, useRef } from 'react'
import {
  DollarSign, Receipt, TrendingUp, Users, Flame, Bot,
  AlertTriangle, BarChart3, ChefHat, Shield, Zap, Clock,
  ArrowUpRight, UserCheck, CalendarDays, UtensilsCrossed,
  Monitor, MessageSquare, Send, Loader2, Package, Activity,
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

// ─── NEW DATA ────────────────────────────────────────────

const REVENUE_TREND = [
  { dia: 'Lun', ventas: 385200 },
  { dia: 'Mar', ventas: 412800 },
  { dia: 'Mie', ventas: 398500 },
  { dia: 'Jue', ventas: 425100 },
  { dia: 'Vie', ventas: 478900 },
  { dia: 'Sab', ventas: 521300 },
  { dia: 'Dom', ventas: 487350 },
]

const HEATMAP_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]

const HEATMAP_DATA: Record<string, number[]> = {
  'Paseo Tec':        [15, 25, 55, 95, 90, 60, 30, 25, 45, 85, 90, 75, 40, 15],
  'Patio Lincoln':    [10, 20, 50, 80, 75, 55, 25, 20, 50, 80, 85, 70, 35, 12],
  'Cumbres Elite':    [12, 22, 48, 78, 72, 50, 28, 22, 48, 78, 82, 68, 32, 10],
  'Centro':           [8,  18, 42, 72, 68, 45, 22, 20, 55, 92, 95, 85, 50, 20],
  'La Ladrillera':    [10, 18, 45, 75, 70, 48, 25, 18, 42, 75, 80, 65, 30, 10],
  'Sendero Escobedo': [8,  15, 40, 70, 65, 42, 20, 15, 40, 70, 72, 58, 28, 8],
  'Juarez':           [6,  12, 35, 62, 58, 38, 18, 14, 38, 65, 68, 55, 25, 6],
  'Sendero La Fe':    [5,  10, 32, 58, 55, 35, 15, 12, 35, 60, 62, 50, 22, 5],
}

const WATERFALL_ITEMS = [
  { label: 'Ingresos', amount: 487350, pct: 100, type: 'positive' as const },
  { label: 'Costo de venta', amount: -165700, pct: 34, type: 'negative' as const },
  { label: 'Utilidad bruta', amount: 321650, pct: 66, type: 'positive' as const },
  { label: 'Gastos operativos', amount: -195000, pct: 40, type: 'negative' as const },
  { label: 'Utilidad neta', amount: 126650, pct: 26, type: 'result' as const },
]

const MESERO_RADAR = [
  {
    nombre: 'Carlos Mendoza',
    scores: { Ventas: 95, 'Ticket Prom.': 92, 'Propinas %': 88, 'Upselling': 45, 'Velocidad': 85 },
    color: '#10b981',
  },
  {
    nombre: 'Miguel A. Torres',
    scores: { Ventas: 85, 'Ticket Prom.': 88, 'Propinas %': 82, 'Upselling': 72, 'Velocidad': 78 },
    color: '#3b82f6',
  },
  {
    nombre: 'Ana L. Villarreal',
    scores: { Ventas: 72, 'Ticket Prom.': 95, 'Propinas %': 90, 'Upselling': 68, 'Velocidad': 70 },
    color: '#a855f7',
  },
]

const FRAUD_TIMELINE = [
  { time: '2:15 PM', status: 'normal' as const, label: 'Cancelacion aprobada por gerente', location: 'Paseo Tec' },
  { time: '5:30 PM', status: 'normal' as const, label: 'Descuento 10% — cliente frecuente', location: 'Cumbres Elite' },
  { time: '8:12 PM', status: 'alert' as const, label: 'Cancelacion sin preparar', location: 'La Ladrillera', actor: 'Roberto Garza' },
  { time: '8:28 PM', status: 'alert' as const, label: '2da cancelacion en 16 min', location: 'La Ladrillera', actor: 'Roberto Garza' },
  { time: '8:45 PM', status: 'alert' as const, label: '3ra cancelacion — patron detectado', location: 'La Ladrillera' },
  { time: '9:01 PM', status: 'action' as const, label: 'Notificacion enviada a gerente de zona', location: 'Sistema' },
]

const SUCURSAL_DETAILS = [
  { nombre: 'Paseo Tec', ventas: 82400, tp: 285, vsProm: 14.2, trend: [62, 68, 72, 75, 70, 78, 82] },
  { nombre: 'Patio Lincoln', ventas: 71200, tp: 271, vsProm: 4.8, trend: [58, 62, 65, 60, 68, 72, 71] },
  { nombre: 'Cumbres Elite', ventas: 65800, tp: 268, vsProm: 1.3, trend: [55, 58, 60, 62, 58, 64, 66] },
  { nombre: 'Centro', ventas: 61500, tp: 256, vsProm: -2.1, trend: [52, 56, 58, 55, 60, 62, 62] },
  { nombre: 'La Ladrillera', ventas: 58900, tp: 248, vsProm: -5.8, trend: [50, 52, 55, 54, 56, 58, 59] },
  { nombre: 'Sendero Escobedo', ventas: 54200, tp: 242, vsProm: -9.4, trend: [48, 50, 52, 50, 54, 55, 54] },
  { nombre: 'Juarez', ventas: 48350, tp: 235, vsProm: -14.2, trend: [42, 44, 46, 45, 48, 50, 48] },
  { nombre: 'Sendero La Fe', ventas: 45000, tp: 228, vsProm: -17.8, trend: [38, 40, 42, 41, 44, 46, 45] },
]

const INVENTORY_ITEMS = [
  { nombre: 'Arrachera', actual: 45, max: 80, unit: 'kg', status: 'warning' as const, note: 'Reordenar hoy' },
  { nombre: 'Rib Eye', actual: 28, max: 50, unit: 'kg', status: 'warning' as const, note: 'Reordenar hoy' },
  { nombre: 'Carbon', actual: 120, max: 200, unit: 'kg', status: 'warning' as const, note: 'Reordenar manana' },
  { nombre: 'Tortilla Harina', actual: 180, max: 200, unit: 'kg', status: 'ok' as const, note: 'OK' },
  { nombre: 'Coca-Cola', actual: 4, max: 24, unit: 'cajas', status: 'critical' as const, note: 'Critico — Juarez' },
  { nombre: 'Cebolla', actual: 95, max: 100, unit: 'kg', status: 'ok' as const, note: 'OK' },
]

const formatMXN = (n: number) => `$${Math.abs(n).toLocaleString('es-MX')}`

// ─── PAGE ────────────────────────────────────────────────

const themes: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    bg: '#0a0a0f', text: '#fff', textStrong: 'rgba(255,255,255,0.8)', textSoft: 'rgba(255,255,255,0.6)',
    textMuted: 'rgba(255,255,255,0.45)', textFaint: 'rgba(255,255,255,0.35)',
    text70: 'rgba(255,255,255,0.7)', text50: 'rgba(255,255,255,0.5)', text40: 'rgba(255,255,255,0.4)', text30: 'rgba(255,255,255,0.3)',
    card: 'rgba(255,255,255,0.03)', cardBorder: 'rgba(255,255,255,0.06)', line: 'rgba(255,255,255,0.06)',
    surfaceLight: 'rgba(255,255,255,0.04)', surfaceHover: 'rgba(255,255,255,0.08)', surfaceSubtle: 'rgba(255,255,255,0.05)',
    surfaceFaint: 'rgba(255,255,255,0.02)', surface10: 'rgba(255,255,255,0.1)', surface15: 'rgba(255,255,255,0.15)', surface20: 'rgba(255,255,255,0.2)',
    headerGrad: 'linear-gradient(180deg, rgba(16,185,129,0.04) 0%, transparent 100%)',
    pillBg: 'rgba(16,185,129,0.1)', pillBorder: 'rgba(16,185,129,0.2)', pillText: 'rgba(255,255,255,0.6)',
    kpiBg: 'rgba(255,255,255,0.03)', kpiBorder: 'rgba(255,255,255,0.06)',
    chartArea: 'rgba(16,185,129,0.15)', chartLine: '#10b981',
    barBg: 'rgba(255,255,255,0.06)', toggleBg: 'rgba(255,255,255,0.08)', toggleText: 'rgba(255,255,255,0.5)',
  },
  light: {
    bg: '#f8f9fa', text: '#1a1a2e', textStrong: '#1f2937', textSoft: '#4a4a5a',
    textMuted: '#6b7280', textFaint: '#9ca3af',
    text70: '#374151', text50: '#6b7280', text40: '#9ca3af', text30: '#d1d5db',
    card: '#ffffff', cardBorder: '#e5e7eb', line: '#e5e7eb',
    surfaceLight: '#f3f4f6', surfaceHover: '#e5e7eb', surfaceSubtle: '#f9fafb',
    surfaceFaint: '#f9fafb', surface10: '#e5e7eb', surface15: '#d1d5db', surface20: '#d1d5db',
    headerGrad: 'linear-gradient(180deg, rgba(16,185,129,0.06) 0%, transparent 100%)',
    pillBg: 'rgba(16,185,129,0.08)', pillBorder: 'rgba(16,185,129,0.2)', pillText: '#374151',
    kpiBg: '#ffffff', kpiBorder: '#e5e7eb',
    chartArea: 'rgba(16,185,129,0.1)', chartLine: '#059669',
    barBg: '#e5e7eb', toggleBg: '#e5e7eb', toggleText: '#6b7280',
  },
}

// Module-level theme state for sub-components
let _currentTheme = themes.dark

export default function DemoNorestePage() {
  const maxSucursal = Math.max(...SUCURSALES.map(s => s.ventas))
  const [mode, setMode] = useState<'dark' | 'light'>('dark')
  const t = themes[mode]
  _currentTheme = t

  return (
    <div style={{ background: t.bg, color: t.text, minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', transition: 'background 0.3s, color 0.3s' }}>

      {/* ── Section 1: Header ── */}
      <div style={{
        borderBottom: `1px solid ${t.line}`,
        background: t.headerGrad,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: -1.5 }}>Noreste Grill</span>
              <span style={{ width: 6, height: 6, background: '#10b981', display: 'inline-block', borderRadius: 1 }} />
              <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: -1.5, color: '#10b981' }}>Fullsite</span>
            </div>
            <button
              onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: t.toggleBg, border: `1px solid ${t.line}`, color: t.toggleText, transition: 'all 0.3s',
              }}
            >
              {mode === 'dark' ? '☀ Light' : '● Dark'}
            </button>
          </div>
          <p style={{ color: t.textMuted, fontSize: 16, margin: 0, maxWidth: 600 }}>
            Demo personalizado — asi se veria tu operacion con IA en las 8 sucursales
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {['Centro', 'Patio Lincoln', 'Cumbres Elite', 'La Ladrillera', 'Paseo Tec', 'Sendero Escobedo', 'Sendero La Fe', 'Juarez'].map(loc => (
              <span key={loc} style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                background: t.pillBg, border: `1px solid ${t.pillBorder}`, color: t.pillText,
              }}>{loc}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>

        {/* ── Section 2: KPIs ── */}
        <div style={{ padding: '32px 0 24px' }}>
          <div style={{ fontSize: 13, color: t.textFaint, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
            Resumen del dia — Domingo 15 Jun 2026
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <KPICard t={t} label="Ventas del dia" value="$487,350" sub="8 sucursales" icon={DollarSign} accent="#10b981" />
            <KPICard t={t} label="Tickets" value="1,847" sub="4,210 personas" icon={Receipt} accent="#3b82f6" />
            <KPICard t={t} label="Ticket promedio" value="$263.80" sub="+12.3% vs ayer" icon={TrendingUp} accent="#818cf8" positive />
            <KPICard t={t} label="Personas" value="4,210" sub="525 por sucursal prom." icon={Users} accent="#f59e0b" />
            <KPICard t={t} label="Sucursal lider" value="Paseo Tec" sub="$82,400 — 16.9%" icon={Flame} accent="#ef4444" />
          </div>
        </div>

        {/* ── NEW: Revenue Trend Chart ── */}
        <SectionTitle title="Tendencia de Ingresos — 7 Dias" icon={TrendingUp} />
        <RevenueTrendChart />

        {/* ── NEW: Sucursal Comparison Cards ── */}
        <SectionTitle title="Comparativo por Sucursal" icon={BarChart3} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 32 }}>
          {SUCURSAL_DETAILS.map((s, i) => (
            <SucursalCard key={s.nombre} sucursal={s} rank={i + 1} />
          ))}
        </div>

        {/* ── NEW: Heatmap ── */}
        <SectionTitle title="Heatmap de Demanda por Hora" icon={Flame} />
        <div style={{ fontSize: 13, color: _currentTheme.text40, marginBottom: 16, marginTop: -16 }}>
          Identifica horas pico por sucursal para optimizar staffing
        </div>
        <HeatmapSection />

        {/* ── NEW: Food Cost Waterfall ── */}
        <SectionTitle title="Food Cost — Cascada P&L" icon={DollarSign} />
        <WaterfallChart />

        {/* ── NEW: Mesero Performance Radar ── */}
        <SectionTitle title="Performance — Top 3 Meseros" icon={UserCheck} />
        <div style={{ fontSize: 13, color: _currentTheme.text40, marginBottom: 16, marginTop: -16 }}>
          Comparativo multidimensional: ventas, ticket promedio, propinas, upselling y velocidad
        </div>
        <MeseroRadar />

        {/* ── NEW: Anti-Fraud Timeline ── */}
        <SectionTitle title="Anti-Fraude — Timeline 24h" icon={Shield} />
        <FraudTimeline />

        {/* ── Section: Top Meseros (original table) ── */}
        <SectionTitle title="Top Meseros del Dia" icon={UserCheck} />
        <div style={{ background: _currentTheme.kpiBg, borderRadius: 14, padding: 24, border: `1px solid ${t.cardBorder}`, marginBottom: 32, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${_currentTheme.surfaceHover}` }}>
                {['#', 'Mesero', 'Sucursal', 'Ventas', 'Tickets', 'Ticket Prom.'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, color: t.textFaint, fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MESEROS.map((m, i) => (
                <tr key={m.nombre} style={{ borderBottom: `1px solid ${_currentTheme.surfaceLight}` }}>
                  <td style={{ padding: '12px', width: 40 }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : _currentTheme.surfaceHover,
                      color: i < 3 ? '#000' : _currentTheme.text50,
                    }}>{i + 1}</span>
                  </td>
                  <td style={{ padding: '12px', fontSize: 13, fontWeight: 600 }}>{m.nombre}</td>
                  <td style={{ padding: '12px', fontSize: 12, color: _currentTheme.text50 }}>{m.sucursal}</td>
                  <td style={{ padding: '12px', fontSize: 14, fontWeight: 700, color: '#10b981', fontVariantNumeric: 'tabular-nums' }}>{formatMXN(m.ventas)}</td>
                  <td style={{ padding: '12px', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{m.tickets}</td>
                  <td style={{ padding: '12px', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{formatMXN(m.tp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Section: Top Platillos ── */}
        <SectionTitle title="Top 10 Platillos" icon={ChefHat} />
        <div style={{ background: _currentTheme.kpiBg, borderRadius: 14, padding: 24, border: `1px solid ${t.cardBorder}`, marginBottom: 32 }}>
          {PLATILLOS.map((p, i) => {
            const maxRev = PLATILLOS[0].revenue
            const pct = (p.revenue / maxRev) * 100
            return (
              <div key={p.nombre} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: i < PLATILLOS.length - 1 ? 12 : 0 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                  background: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : _currentTheme.barBg,
                  color: i < 3 ? '#000' : _currentTheme.text40,
                }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                    <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, color: _currentTheme.text40, fontVariantNumeric: 'tabular-nums' }}>{p.qty} vendidos</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981', fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>{formatMXN(p.revenue)}</span>
                    </div>
                  </div>
                  <div style={{ background: _currentTheme.surfaceLight, borderRadius: 4, height: 5, overflow: 'hidden' }}>
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

        {/* ── NEW: Inventory Alerts ── */}
        <SectionTitle title="Alertas de Inventario" icon={Package} />
        <InventoryPanel />

        {/* ── Section: AI Agents ── */}
        <SectionTitle title="Agentes de IA — Alertas en Vivo" icon={Bot} />
        <div style={{ fontSize: 13, color: _currentTheme.text40, marginBottom: 16, marginTop: -16 }}>
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
                <span style={{ fontSize: 11, color: _currentTheme.text30 }}>{a.time}</span>
              </div>
              <div style={{
                fontSize: 13, color: _currentTheme.text70, lineHeight: 1.6,
                padding: '12px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 8,
              }}>
                {a.message}
              </div>
            </div>
          ))}
        </div>

        {/* ── Section: POS Preview ── */}
        <SectionTitle title="Vista Previa del POS" icon={Monitor} />
        <div style={{ fontSize: 13, color: _currentTheme.text40, marginBottom: 16, marginTop: -16 }}>
          Asi se veria el punto de venta en cada sucursal. Corre en cualquier tablet o computadora.
        </div>
        <div style={{
          background: _currentTheme.kpiBg, borderRadius: 14, border: `1px solid ${t.cardBorder}`,
          marginBottom: 32, overflow: 'hidden',
        }}>
          {/* POS Top bar */}
          <div style={{
            padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderBottom: `1px solid ${t.line}`, background: 'rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>NORESTE GRILL</span>
              <span style={{ color: _currentTheme.text30, fontSize: 12 }}>Paseo Tec</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12, color: _currentTheme.text40 }}>Mesa 5 &middot; Luis F.</span>
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
                    background: i === 0 ? c.color : _currentTheme.barBg,
                    color: i === 0 ? '#fff' : _currentTheme.text50,
                    border: i === 0 ? 'none' : `1px solid ${_currentTheme.surfaceHover}`,
                  }}>{c.name}</span>
                ))}
              </div>
              {/* Items */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {POS_ITEMS.filter(i => i.cat === 'Tacos' || i.cat === 'Parrilladas' || i.cat === 'Quesabirrias').map(item => (
                  <div key={item.name} style={{
                    background: t.card, border: `1px solid ${t.cardBorder}`,
                    borderRadius: 10, padding: '12px 10px', cursor: 'default',
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, lineHeight: 1.3, color: _currentTheme.textStrong }}>{item.name}</div>
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
                <div style={{ fontSize: 12, color: t.textSoft, lineHeight: 1.5 }}>
                  Mesa 5 pidio 5 Tacos Arrachera sin complementos. Ofrece Papas Galeana NG ($85) + Guacamole ($74) — sube ticket $159 y 72% de clientes aceptan combo.
                </div>
              </div>
            </div>

            {/* Order panel */}
            <div style={{ borderLeft: `1px solid ${_currentTheme.barBg}`, padding: 16, background: 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column' }}>
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
                  borderBottom: `1px solid ${_currentTheme.surfaceLight}`, fontSize: 12,
                }}>
                  <span style={{ color: _currentTheme.text70 }}>{item.qty}x {item.name}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatMXN(item.price)}</span>
                </div>
              ))}
              <div style={{ marginTop: 'auto', borderTop: `1px solid ${_currentTheme.surface10}`, paddingTop: 14 }}>
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

        {/* ── Section: Chat IA ── */}
        <div style={{ marginBottom: 48 }}>
          <SectionTitle title="Chat IA — Preguntale a tu restaurante" icon={Bot} />
          <NoresteChat />
        </div>

        {/* ── Section: CTA ── */}
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
          <p style={{ color: t.textMuted, fontSize: 16, marginBottom: 40, maxWidth: 500, margin: '0 auto 40px' }}>
            Todo esto corriendo con los datos reales de tus 8 sucursales. Implementacion en 48 horas.
          </p>

          {/* 5 Key Value Props */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, maxWidth: 960, margin: '0 auto 48px', textAlign: 'left' }}>
            {[
              { icon: '🕐', title: 'Prediccion de cierre en tiempo real', desc: 'A las 2pm ya sabes cuanto vas a facturar hoy en las 8 sucursales. Sin esperar al cierre, sin juntar reportes.' },
              { icon: '🥩', title: 'Food cost automatico', desc: 'Si la arrachera sube de precio, el sistema te avisa antes de que pierdas margen. Costos reales por platillo, no estimados.' },
              { icon: '🚨', title: 'Anti-fraude inteligente', desc: 'Si un mesero cancela 8 ordenes cuando el promedio es 2, te llega alerta. No puedes estar en 8 sucursales a la vez, pero la IA si.' },
              { icon: '📊', title: 'Un dashboard, todas las sucursales', desc: 'Ventas, tickets, meseros, inventario — todo en tiempo real. Quien vende mas, quien vende menos, que sucursal esta abajo.' },
              { icon: '🔥', title: 'Heatmap de demanda por hora', desc: 'Sabes exactamente a que hora pegar en cada sucursal. Optimiza turnos, promo happy hour, y staffing por franja horaria.' },
            ].map((item, i) => (
              <div key={i} style={{
                background: t.card, border: `1px solid ${_currentTheme.cardBorder}`, borderRadius: 16, padding: 24,
                display: 'flex', gap: 16, alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: 28, lineHeight: 1 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: t.text, marginBottom: 6 }}>{item.title}</div>
                  <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          {/* Pricing Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, maxWidth: 900, margin: '0 auto 40px', textAlign: 'left' }}>
            {/* Esencial */}
            <div style={{ background: t.card, border: `1px solid ${_currentTheme.surfaceHover}`, borderRadius: 16, padding: 28, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>Esencial</span>
              <div style={{ marginTop: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: _currentTheme.text }}>$1,499</span>
                <span style={{ fontSize: 14, color: _currentTheme.text40 }}>/mes por sucursal</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {[
                  'Punto de venta táctil (órdenes, mesas, split cuenta, asientos)',
                  'Pantalla de cocina y barra (KDS) con ruteo automático',
                  'Dashboard de ventas del día con ticket promedio y meseros',
                  'Corte de caja (X, Z, turno, mesero)',
                  'Cobro efectivo, tarjeta y mixto',
                  'Comandas impresas por estación',
                  'Soporte por chat IA 24/7',
                ].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: t.textSoft }}>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <a href="https://wa.me/528115324371?text=Me%20interesa%20el%20plan%20Esencial" target="_blank" rel="noopener" style={{
                display: 'block', textAlign: 'center', padding: '12px 0', borderRadius: 10,
                background: t.barBg, border: `1px solid ${_currentTheme.surface10}`,
                color: _currentTheme.text, fontWeight: 700, fontSize: 14, textDecoration: 'none',
              }}>Contactar</a>
            </div>

            {/* Pro — recommended */}
            <div style={{ background: 'rgba(16,185,129,0.05)', border: '2px solid rgba(16,185,129,0.3)', borderRadius: 16, padding: 28, display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: '#10b981', color: '#fff', fontSize: 11, fontWeight: 800, padding: '4px 16px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1 }}>
                Recomendado
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1 }}>Pro</span>
              <div style={{ marginTop: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: _currentTheme.text }}>$2,499</span>
                <span style={{ fontSize: 14, color: _currentTheme.text40 }}>/mes por sucursal</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {[
                  'Todo lo de Esencial +',
                  '30 agentes de IA analizando tu operación 24/7',
                  'Anti-fraude: detecta cancelaciones y descuentos sospechosos',
                  'Food cost real por platillo con recetas y costos de insumos',
                  'Predicción de cierre: a las 2pm sabes cuánto vas a facturar',
                  'Coaching automático: identifica meseros que no venden postres o bebidas',
                  'Inventario con recetas: auto-deducción al vender, alertas de reorden',
                  'CFDI facturación electrónica integrada (timbrado automático)',
                  'Delivery integrado (Uber Eats + Rappi directo al POS)',
                  'Checador de asistencia con huella digital',
                  'Historial y auditoría de cada acción',
                ].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: f.startsWith('Todo') ? '#10b981' : _currentTheme.textSoft, fontWeight: f.startsWith('Todo') ? 700 : 400 }}>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <a href="https://wa.me/528115324371?text=Me%20interesa%20el%20plan%20Pro" target="_blank" rel="noopener" style={{
                display: 'block', textAlign: 'center', padding: '14px 0', borderRadius: 10,
                background: '#10b981', color: '#fff', fontWeight: 800, fontSize: 15, textDecoration: 'none',
                boxShadow: '0 4px 20px rgba(16,185,129,0.3)',
              }}>Agendar demo</a>
            </div>

            {/* Enterprise */}
            <div style={{ background: t.card, border: `1px solid ${_currentTheme.surfaceHover}`, borderRadius: 16, padding: 28, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 1 }}>Enterprise</span>
              <div style={{ marginTop: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 36, fontWeight: 900, color: _currentTheme.text }}>$3,499</span>
                <span style={{ fontSize: 14, color: _currentTheme.text40 }}>/mes por sucursal</span>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {[
                  'Todo lo de Pro +',
                  'Dashboard multi-sucursal: todas tus ubicaciones en una pantalla',
                  'Comparativa entre sucursales: quién vende más, quién tiene problemas',
                  'Heatmap de demanda: horas pico por sucursal para optimizar turnos',
                  'Onboarding dedicado: tu sistema corriendo en 48 horas',
                  'Soporte prioritario: respuesta en menos de 1 hora',
                  'API abierta para integraciones custom',
                  'Reportes ejecutivos automáticos cada lunes por email',
                  'Capacitación presencial a tu equipo en cada sucursal',
                  'Gerente de cuenta asignado',
                ].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: f.startsWith('Todo') ? '#a78bfa' : _currentTheme.textSoft, fontWeight: f.startsWith('Todo') ? 700 : 400 }}>
                    <span style={{ color: '#a78bfa', fontWeight: 700 }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <a href="https://wa.me/528115324371?text=Me%20interesa%20el%20plan%20Enterprise" target="_blank" rel="noopener" style={{
                display: 'block', textAlign: 'center', padding: '12px 0', borderRadius: 10,
                background: t.barBg, border: `1px solid ${_currentTheme.surface10}`,
                color: _currentTheme.text, fontWeight: 700, fontSize: 14, textDecoration: 'none',
              }}>Contactar</a>
            </div>
          </div>

          <p style={{ color: _currentTheme.text30, fontSize: 13, marginBottom: 32, textAlign: 'center' }}>
            Sin contrato a largo plazo · Implementación en 48 horas · Cancela cuando quieras
          </p>

          <div style={{ textAlign: 'center' }}>
            <a href="https://wa.me/528115324371" target="_blank" rel="noopener" style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '16px 36px', background: '#25D366', color: _currentTheme.text,
              borderRadius: 14, fontWeight: 800, fontSize: 17, textDecoration: 'none',
              boxShadow: '0 4px 24px rgba(37,211,102,0.3)',
            }}>
              <MessageSquare size={20} />
              Hablar con Daniel por WhatsApp
            </a>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          textAlign: 'center', padding: '24px 0 40px',
          borderTop: `1px solid ${_currentTheme.surfaceLight}`,
          color: _currentTheme.surface20, fontSize: 12,
        }}>
          fullsite.mx — El copiloto operativo para restaurantes
        </div>
      </div>
    </div>
  )
}

// ─── COMPONENTS ──────────────────────────────────────────

type Theme = typeof themes.dark

function KPICard({ label, value, sub, icon: Icon, accent, positive, t }: {
  label: string; value: string; sub?: string; icon: React.ElementType; accent: string; positive?: boolean; t: Theme
}) {
  return (
    <div style={{
      background: _currentTheme.kpiBg, borderRadius: 14, padding: 20,
      border: `1px solid ${_currentTheme.kpiBorder}`,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -20, right: -20, width: 60, height: 60,
        background: accent, opacity: 0.04, borderRadius: '50%', filter: 'blur(20px)',
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: _currentTheme.textMuted, fontSize: 12, marginBottom: 8, fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, color: accent }}>{value}</div>
          {sub && (
            <div style={{ color: positive ? '#10b981' : _currentTheme.text30, fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
              {positive && <ArrowUpRight size={12} />}
              {sub}
            </div>
          )}
        </div>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: _currentTheme.surfaceLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} style={{ color: _currentTheme.surface20 }} />
        </div>
      </div>
    </div>
  )
}

// ─── Revenue Trend Chart (SVG) ──────────────────────────

function RevenueTrendChart() {
  const data = REVENUE_TREND
  const minVal = 360000
  const maxVal = 540000
  const W = 700
  const H = 260
  const padL = 70
  const padR = 30
  const padT = 20
  const padB = 40
  const chartW = W - padL - padR
  const chartH = H - padT - padB

  const points = data.map((d, i) => {
    const x = padL + (i / (data.length - 1)) * chartW
    const y = padT + chartH - ((d.ventas - minVal) / (maxVal - minVal)) * chartH
    return { x, y, ...d }
  })

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ')
  const areaPath = `M${points[0].x},${padT + chartH} ${points.map(p => `L${p.x},${p.y}`).join(' ')} L${points[points.length - 1].x},${padT + chartH} Z`

  const gridLines = [360000, 400000, 440000, 480000, 520000]

  return (
    <div style={{
      background: 'inherit', borderRadius: 14, padding: '24px 16px', border: '1px solid inherit',
      marginBottom: 32, overflowX: 'auto',
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto', display: 'block', margin: '0 auto' }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {gridLines.map(v => {
          const y = padT + chartH - ((v - minVal) / (maxVal - minVal)) * chartH
          return (
            <g key={v}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={_currentTheme.barBg} strokeWidth="1" />
              <text x={padL - 8} y={y + 4} textAnchor="end" fill={_currentTheme.text30} fontSize="10" fontFamily="system-ui">
                ${(v / 1000).toFixed(0)}K
              </text>
            </g>
          )
        })}
        {/* Area fill */}
        <path d={areaPath} fill="url(#areaGrad)" />
        {/* Line */}
        <polyline points={polyline} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots + labels */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="#0a0a0f" stroke="#10b981" strokeWidth="2" />
            <text x={p.x} y={p.y - 12} textAnchor="middle" fill={_currentTheme.textSoft} fontSize="10" fontWeight="600" fontFamily="system-ui">
              ${(p.ventas / 1000).toFixed(0)}K
            </text>
            <text x={p.x} y={H - 8} textAnchor="middle" fill={_currentTheme.text40} fontSize="11" fontFamily="system-ui">
              {p.dia}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ─── Sucursal Comparison Card ───────────────────────────

function SucursalCard({ sucursal, rank }: {
  sucursal: typeof SUCURSAL_DETAILS[0]; rank: number
}) {
  const medal = rank === 1 ? '\uD83E\uDD47' : rank === 2 ? '\uD83E\uDD48' : rank === 3 ? '\uD83E\uDD49' : null
  const trend = sucursal.trend
  const tMax = Math.max(...trend)
  const tMin = Math.min(...trend)
  const sparkW = 80
  const sparkH = 28
  const sparkPoints = trend.map((v, i) => {
    const x = (i / (trend.length - 1)) * sparkW
    const y = sparkH - ((v - tMin) / (tMax - tMin || 1)) * (sparkH - 4) - 2
    return `${x},${y}`
  }).join(' ')

  return (
    <div style={{
      background: 'inherit', borderRadius: 14, padding: 18, border: '1px solid rgba(128,128,128,0.15)',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {medal ? (
            <span style={{ fontSize: 18 }}>{medal}</span>
          ) : (
            <span style={{
              width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, background: _currentTheme.surfaceHover, color: _currentTheme.text50,
            }}>{rank}</span>
          )}
          <span style={{ fontSize: 14, fontWeight: 600 }}>{sucursal.nombre}</span>
        </div>
        <svg width={sparkW} height={sparkH} style={{ flexShrink: 0 }}>
          <defs>
            <linearGradient id={`spark-${rank}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            points={`0,${sparkH} ${sparkPoints} ${sparkW},${sparkH}`}
            fill={`url(#spark-${rank})`}
          />
          <polyline points={sparkPoints} fill="none" stroke="#10b981" strokeWidth="1.5" />
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981', fontVariantNumeric: 'tabular-nums' }}>
            {formatMXN(sucursal.ventas)}
          </div>
          <div style={{ fontSize: 12, color: _currentTheme.text40, marginTop: 2 }}>
            TP: {formatMXN(sucursal.tp)}
          </div>
        </div>
        <div style={{
          fontSize: 13, fontWeight: 700,
          color: sucursal.vsProm >= 0 ? '#10b981' : '#ef4444',
          display: 'flex', alignItems: 'center', gap: 2,
        }}>
          {sucursal.vsProm >= 0 ? '+' : ''}{sucursal.vsProm}%
          <span style={{ fontSize: 10, fontWeight: 400, color: _currentTheme.text30, marginLeft: 4 }}>vs prom</span>
        </div>
      </div>
    </div>
  )
}

// ─── Heatmap ────────────────────────────────────────────

function HeatmapSection() {
  const maxIntensity = 95
  const sucNames = Object.keys(HEATMAP_DATA)

  return (
    <div style={{
      background: _currentTheme.kpiBg, borderRadius: 14, padding: '20px 16px', border: `1px solid ${_currentTheme.cardBorder}`,
      marginBottom: 32, overflowX: 'auto',
    }}>
      <div style={{ minWidth: 700 }}>
        {/* Hour headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '130px repeat(14, 1fr)', gap: 2, marginBottom: 2 }}>
          <div />
          {HEATMAP_HOURS.map(h => (
            <div key={h} style={{ textAlign: 'center', fontSize: 10, color: _currentTheme.textFaint, padding: '4px 0' }}>
              {h > 12 ? `${h - 12}pm` : h === 12 ? '12pm' : `${h}am`}
            </div>
          ))}
        </div>
        {/* Rows */}
        {sucNames.map(name => (
          <div key={name} style={{ display: 'grid', gridTemplateColumns: '130px repeat(14, 1fr)', gap: 2, marginBottom: 2 }}>
            <div style={{ fontSize: 11, color: _currentTheme.textSoft, display: 'flex', alignItems: 'center', paddingRight: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {name}
            </div>
            {HEATMAP_DATA[name].map((val, i) => {
              const intensity = val / maxIntensity
              const alpha = 0.05 + intensity * 0.85
              return (
                <div key={i} style={{
                  height: 28, borderRadius: 4,
                  background: `rgba(16, 185, 129, ${alpha})`,
                  position: 'relative',
                  cursor: 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {val >= 70 && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(0,0,0,0.6)' }}>{val}</span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 10, color: _currentTheme.text30 }}>Baja</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {[0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((a, i) => (
              <div key={i} style={{ width: 16, height: 10, borderRadius: 2, background: `rgba(16,185,129,${a})` }} />
            ))}
          </div>
          <span style={{ fontSize: 10, color: _currentTheme.text30 }}>Alta</span>
        </div>
      </div>
    </div>
  )
}

// ─── Waterfall Chart ────────────────────────────────────

function WaterfallChart() {
  const maxAmount = 487350
  return (
    <div style={{
      background: _currentTheme.kpiBg, borderRadius: 14, padding: 24, border: `1px solid ${_currentTheme.cardBorder}`,
      marginBottom: 32,
    }}>
      {WATERFALL_ITEMS.map((item, i) => {
        const absAmount = Math.abs(item.amount)
        const barWidth = (absAmount / maxAmount) * 100
        const isNeg = item.type === 'negative'
        const isResult = item.type === 'result'
        const barColor = isNeg
          ? 'linear-gradient(90deg, #ef4444, #f87171)'
          : isResult
            ? 'linear-gradient(90deg, #10b981, #34d399)'
            : 'linear-gradient(90deg, #10b981, #34d399)'
        // For waterfall effect, offset negative bars
        const offset = isNeg ? ((maxAmount - absAmount) / maxAmount) * 100 * 0.15 : 0

        return (
          <div key={item.label} style={{ marginBottom: i < WATERFALL_ITEMS.length - 1 ? 16 : 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'baseline' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                  background: isNeg ? '#ef4444' : isResult ? '#10b981' : '#10b981',
                }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: _currentTheme.textStrong }}>{item.label}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                  fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                  color: isNeg ? '#ef4444' : isResult ? '#10b981' : '#10b981',
                }}>
                  {isNeg ? '-' : ''}{formatMXN(absAmount)}
                </span>
                <span style={{
                  fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                  background: isNeg ? 'rgba(239,68,68,0.15)' : isResult ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)',
                  color: isNeg ? '#ef4444' : '#10b981',
                }}>
                  {item.pct}%
                </span>
              </div>
            </div>
            <div style={{ background: _currentTheme.surfaceLight, borderRadius: 6, height: 12, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                height: '100%', borderRadius: 6,
                width: `${barWidth}%`,
                marginLeft: isNeg ? `${offset}%` : 0,
                background: barColor,
                transition: 'width 0.5s ease',
                boxShadow: isResult ? '0 0 12px rgba(16,185,129,0.3)' : 'none',
              }} />
            </div>
            {isResult && (
              <div style={{
                marginTop: 4, borderTop: '1px dashed rgba(16,185,129,0.3)', paddingTop: 0,
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Mesero Performance Comparison ──────────────────────

function MeseroRadar() {
  const dimensions = ['Ventas', 'Ticket Prom.', 'Propinas %', 'Upselling', 'Velocidad']

  return (
    <div style={{
      background: _currentTheme.kpiBg, borderRadius: 14, padding: 24, border: `1px solid ${_currentTheme.cardBorder}`,
      marginBottom: 32,
    }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
        {MESERO_RADAR.map(m => (
          <div key={m.nombre} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: m.color }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: _currentTheme.textStrong }}>{m.nombre}</span>
          </div>
        ))}
      </div>

      {/* Dimension rows */}
      {dimensions.map(dim => (
        <div key={dim} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: _currentTheme.text40, marginBottom: 6, fontWeight: 500 }}>{dim}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {MESERO_RADAR.map(m => {
              const score = m.scores[dim as keyof typeof m.scores]
              return (
                <div key={m.nombre} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 100, fontSize: 11, color: _currentTheme.text50, textAlign: 'right', flexShrink: 0 }}>
                    {m.nombre.split(' ')[0]}
                  </div>
                  <div style={{ flex: 1, background: _currentTheme.surfaceLight, borderRadius: 4, height: 14, overflow: 'hidden', position: 'relative' }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      width: `${score}%`,
                      background: m.color,
                      opacity: 0.7,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: m.color, width: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {score}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Fraud Timeline ─────────────────────────────────────

function FraudTimeline() {
  return (
    <div style={{
      background: _currentTheme.kpiBg, borderRadius: 14, padding: 24, border: `1px solid ${_currentTheme.cardBorder}`,
      marginBottom: 32,
    }}>
      <div style={{ position: 'relative', paddingLeft: 28 }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute', left: 8, top: 6, bottom: 6, width: 2,
          background: 'linear-gradient(180deg, rgba(16,185,129,0.3), rgba(239,68,68,0.5), rgba(245,158,11,0.3))',
        }} />

        {FRAUD_TIMELINE.map((event, i) => {
          const dotColor = event.status === 'normal' ? '#10b981' : event.status === 'alert' ? '#ef4444' : '#f59e0b'
          const bgColor = event.status === 'normal'
            ? 'rgba(16,185,129,0.06)'
            : event.status === 'alert'
              ? 'rgba(239,68,68,0.06)'
              : 'rgba(245,158,11,0.06)'
          const borderColor = event.status === 'normal'
            ? 'rgba(16,185,129,0.15)'
            : event.status === 'alert'
              ? 'rgba(239,68,68,0.2)'
              : 'rgba(245,158,11,0.2)'
          const icon = event.status === 'normal' ? '\u2705' : event.status === 'alert' ? '\uD83D\uDD34' : '\uD83D\uDFE1'

          return (
            <div key={i} style={{ position: 'relative', marginBottom: i < FRAUD_TIMELINE.length - 1 ? 12 : 0 }}>
              {/* Dot */}
              <div style={{
                position: 'absolute', left: -24, top: 14, width: 12, height: 12, borderRadius: '50%',
                background: dotColor, border: '2px solid #111118',
                boxShadow: `0 0 8px ${dotColor}40`,
              }} />
              {/* Card */}
              <div style={{
                background: bgColor, border: `1px solid ${borderColor}`,
                borderRadius: 10, padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: dotColor }}>
                      {event.status === 'normal' ? 'Normal' : event.status === 'alert' ? 'ALERTA' : 'ACCION'}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: _currentTheme.textFaint, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{event.time}</span>
                </div>
                <div style={{ fontSize: 13, color: _currentTheme.text70, lineHeight: 1.5 }}>
                  {event.label}
                  <span style={{ color: _currentTheme.text40, fontSize: 12 }}> — {event.location}</span>
                  {event.actor && <span style={{ color: _currentTheme.text40, fontSize: 12 }}> ({event.actor})</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Inventory Panel ────────────────────────────────────

function InventoryPanel() {
  return (
    <div style={{
      background: _currentTheme.kpiBg, borderRadius: 14, padding: 24, border: `1px solid ${_currentTheme.cardBorder}`,
      marginBottom: 32,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {INVENTORY_ITEMS.map(item => {
          const pct = Math.round((item.actual / item.max) * 100)
          const barColor = item.status === 'critical'
            ? '#ef4444'
            : item.status === 'warning'
              ? '#f59e0b'
              : '#10b981'
          const bgColor = item.status === 'critical'
            ? 'rgba(239,68,68,0.06)'
            : item.status === 'warning'
              ? 'rgba(245,158,11,0.06)'
              : 'rgba(16,185,129,0.06)'
          const statusIcon = item.status === 'critical' ? '\uD83D\uDD34' : item.status === 'warning' ? '\uD83D\uDFE1' : '\uD83D\uDFE2'

          return (
            <div key={item.nombre} style={{
              background: bgColor, borderRadius: 10, padding: '14px 16px',
              border: `1px solid ${barColor}20`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>{statusIcon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{item.nombre}</span>
                </div>
                <span style={{ fontSize: 12, color: barColor, fontWeight: 600 }}>{item.note}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, background: _currentTheme.barBg, borderRadius: 4, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4,
                    width: `${pct}%`,
                    background: barColor,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
                <span style={{ fontSize: 12, color: _currentTheme.text50, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {item.actual}/{item.max} {item.unit} ({pct}%)
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Chat IA ────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  '¿Cómo vamos hoy?',
  '¿Quién es el mejor mesero?',
  '¿Qué sucursal va ganando?',
  '¿Cuánto vendimos de arrachera?',
  '¿Hay alertas de fraude?',
  '¿Cómo va el food cost?',
]

function NoresteChat() {
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg = text.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)
    try {
      const res = await fetch('/api/demo-chat-noreste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'ai', text: data.response || 'Sin respuesta' }])
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Ayer cerraron con $487,350 en las 8 sucursales. Intenta de nuevo.' }])
    }
    setLoading(false)
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 100)
  }

  return (
    <div style={{ background: _currentTheme.surfaceFaint, border: `1px solid ${_currentTheme.cardBorder}`, borderRadius: 20, overflow: 'hidden' }}>
      {/* Messages area */}
      <div ref={scrollRef} style={{ height: 360, overflowY: 'auto', padding: 20 }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <Bot size={40} style={{ color: _currentTheme.surface15, margin: '0 auto 16px' }} />
            <p style={{ color: _currentTheme.text40, fontSize: 15, marginBottom: 24 }}>
              Preguntale cualquier cosa a Noreste Grill
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGESTED_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  style={{
                    padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                    background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
                    color: '#10b981', cursor: 'pointer',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {m.role === 'ai' && (
                  <div style={{ width: 32, height: 32, borderRadius: 16, background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Bot size={16} style={{ color: '#10b981' }} />
                  </div>
                )}
                <div style={{
                  maxWidth: '75%', padding: '10px 16px', borderRadius: 16, fontSize: 14, lineHeight: 1.5,
                  background: m.role === 'user' ? 'rgba(16,185,129,0.15)' : _currentTheme.surfaceSubtle,
                  border: m.role === 'user' ? '1px solid rgba(16,185,129,0.3)' : `1px solid ${_currentTheme.surfaceHover}`,
                  whiteSpace: 'pre-wrap',
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 16, background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Loader2 size={16} style={{ color: '#10b981', animation: 'spin 1s linear infinite' }} />
                </div>
                <div style={{ padding: '10px 16px', borderRadius: 16, background: _currentTheme.surfaceSubtle, border: `1px solid ${_currentTheme.surfaceHover}`, fontSize: 14, color: _currentTheme.text40 }}>
                  Analizando datos...
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ borderTop: `1px solid ${_currentTheme.line}`, padding: 16, display: 'flex', gap: 10 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage(input)}
          placeholder="Pregunta algo... ej: ¿cuánto vendimos de quesabirrias?"
          style={{
            flex: 1, background: _currentTheme.surfaceSubtle, border: `1px solid ${_currentTheme.surface10}`,
            borderRadius: 12, padding: '12px 16px', color: _currentTheme.text, fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          style={{
            width: 48, height: 48, borderRadius: 12, background: '#10b981', border: 'none',
            color: _currentTheme.text, cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
            opacity: input.trim() && !loading ? 1 : 0.4, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Send size={18} />
        </button>
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
