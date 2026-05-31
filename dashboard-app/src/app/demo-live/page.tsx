'use client'

import { useState } from 'react'
import { Bot, TrendingUp, AlertTriangle, Shield, Package, Users, ChefHat, DollarSign, Clock, CheckCircle2, Zap, Target, Star, BarChart3, FileText, PieChart, MessageCircle } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════════
// DEMO MODE — Fake data that looks real for prospect demos
// No Supabase calls, no real data, 100% self-contained
// ═══════════════════════════════════════════════════════════════════════

const DEMO_RESTAURANT = 'Tu Restaurante'

const DEMO_VENTAS = {
  hoy: 68450, ayer: 54200, semana: 412800, mes: 1645000,
  tickets: 182, personas: 156, ticketPromedio: 439,
  vsAyer: 26.3, vsSemana: 8.7,
}

const DEMO_MESEROS = [
  { nombre: 'Carlos M.', ventas: 22400, tickets: 48, tp: 467, propinas: 3580 },
  { nombre: 'Andrea L.', ventas: 18200, tickets: 42, tp: 433, propinas: 2910 },
  { nombre: 'Roberto S.', ventas: 14800, tickets: 38, tp: 389, propinas: 2370 },
  { nombre: 'Luis G.', ventas: 8200, tickets: 32, tp: 256, propinas: 1310 },
  { nombre: 'Diana R.', ventas: 4850, tickets: 22, tp: 220, propinas: 776 },
]

const DEMO_AGENTS = [
  { id: 'anomaly', name: 'Anomalías', icon: AlertTriangle, color: 'text-red-400', status: 'Carlos M. vendió $5,200 con $0 postres — 3 días consecutivos', time: '2h', priority: 'warning' },
  { id: 'auto86', name: 'Auto-86', icon: Package, color: 'text-red-500', status: '2 ingredientes en cero: harina integral, mantequilla. 12 platillos afectados.', time: '1h', priority: 'critical' },
  { id: 'predictor', name: 'Cierre', icon: Target, color: 'text-blue-400', status: 'Proyección 6PM: $22,400 (+8% vs meta)', time: '30m', priority: 'info' },
  { id: 'purchase', name: 'Compras', icon: Zap, color: 'text-cyan-400', status: 'Mañana miércoles: 132 tickets est. Comprar 2.3kg arándano, 2kg limón. Total: $2,373', time: '5PM', priority: 'info' },
  { id: 'antifraud', name: 'Anti-Fraude', icon: Shield, color: 'text-pink-400', status: 'Riesgo 0/100 — 0 hallazgos esta semana', time: '1d', priority: 'info' },
  { id: 'staffing', name: 'Staffing', icon: Users, color: 'text-amber-400', status: 'Lunes 2-4PM: sobran 2 meseros. Sábado 1PM: faltan 2. Ahorro: $3,200/sem', time: '1d', priority: 'info' },
  { id: 'menu', name: 'Menu Eng.', icon: Star, color: 'text-violet-400', status: 'Margaritas: 78% margen (estrella). Sandwich: 18% (perro) — mover página 2', time: '2d', priority: 'info' },
  { id: 'briefing', name: 'Briefing 7AM', icon: FileText, color: 'text-blue-400', status: 'Enviado a las 7:01 AM con 3 acciones específicas', time: '7AM', priority: 'info' },
]

const DEMO_CATEGORIES = [
  { name: 'Especialidades', ventas: 18200, pct: 26.6 },
  { name: 'Desayunos', ventas: 12400, pct: 18.1 },
  { name: 'Café & Bebidas', ventas: 9800, pct: 14.3 },
  { name: 'Panadería', ventas: 7200, pct: 10.5 },
  { name: 'Jugos & Smoothies', ventas: 6800, pct: 9.9 },
  { name: 'Postres', ventas: 5400, pct: 7.9 },
  { name: 'Ensaladas & Bowls', ventas: 4800, pct: 7.0 },
  { name: 'Extras', ventas: 3850, pct: 5.6 },
]

const DEMO_ROI = {
  total: 80000,
  monthly: 80000,
  agents: [
    { name: 'Reducción de merma', value: 39000, desc: 'De 3.2% a 0.8% — ahorro 75%' },
    { name: 'Food cost optimizado', value: 22000, desc: '-9 pts de margen (38% → 29%)' },
    { name: 'Upselling incremental', value: 8500, desc: 'Coach de meseros — postres y extras' },
    { name: 'Reportes eliminados', value: 6400, desc: '12h/semana × $133/hr gerente' },
    { name: 'Anti-Fraude', value: 4100, desc: '4 fraudes detectados/mes promedio' },
  ],
}

function fmt(n: number) {
  return '$' + n.toLocaleString('es-MX')
}

export default function DemoLivePage() {
  const [tab, setTab] = useState<'dashboard' | 'agents' | 'roi' | 'auto86' | 'foodcost' | 'bot'>('dashboard')

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white p-4 md:p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white font-black text-lg tracking-tight">fullsite<span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-0.5" /></span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold uppercase">Demo</span>
            </div>
            <p className="text-sm text-white/40">{DEMO_RESTAURANT} — datos de ejemplo</p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-emerald-400">30 agentes activos</span>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 mb-6">
          {[
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'agents', label: 'Agentes IA' },
            { id: 'foodcost', label: 'Food Cost' },
            { id: 'roi', label: 'ROI' },
            { id: 'auto86', label: 'Auto-86' },
            { id: 'bot', label: 'Bot 24/7' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id ? 'bg-emerald-600 text-white' : 'bg-white/5 text-white/50 hover:text-white/80'
              }`}
            >{t.label}</button>
          ))}
        </div>

        {/* DASHBOARD TAB */}
        {tab === 'dashboard' && (
          <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40 mb-1">Ventas hoy</p>
                <p className="text-2xl font-bold">{fmt(DEMO_VENTAS.hoy)}</p>
                <p className="text-xs text-emerald-400 mt-1">+{DEMO_VENTAS.vsAyer}% vs ayer</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40 mb-1">Tickets</p>
                <p className="text-2xl font-bold">{DEMO_VENTAS.tickets}</p>
                <p className="text-xs text-white/40 mt-1">{DEMO_VENTAS.personas} personas</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40 mb-1">Ticket promedio</p>
                <p className="text-2xl font-bold">{fmt(DEMO_VENTAS.ticketPromedio)}</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40 mb-1">Ventas del mes</p>
                <p className="text-2xl font-bold">{fmt(DEMO_VENTAS.mes)}</p>
                <p className="text-xs text-emerald-400 mt-1">+{DEMO_VENTAS.vsSemana}% vs mes ant.</p>
              </div>
            </div>

            {/* Meseros + Categories */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><Users size={14} className="text-emerald-400" /> Top meseros hoy</h3>
                <div className="space-y-2.5">
                  {DEMO_MESEROS.map((m, i) => (
                    <div key={m.nombre} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white/30 w-4">{i + 1}</span>
                        <span className="text-sm">{m.nombre}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-white/50">{m.tickets} tickets</span>
                        <span className="text-white/50">TP {fmt(m.tp)}</span>
                        <span className="font-bold text-emerald-400">{fmt(m.ventas)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white/5 rounded-xl border border-white/10 p-5">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-2"><BarChart3 size={14} className="text-violet-400" /> Ventas por categoría</h3>
                <div className="space-y-2">
                  {DEMO_CATEGORIES.map(c => (
                    <div key={c.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span>{c.name}</span>
                        <span className="text-white/50">{fmt(c.ventas)} ({c.pct}%)</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${c.pct * 4}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AGENTS TAB */}
        {tab === 'agents' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40">Agentes activos</p>
                <p className="text-2xl font-bold text-emerald-400">30</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40">Ejecuciones hoy</p>
                <p className="text-2xl font-bold">147</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40">Errores</p>
                <p className="text-2xl font-bold text-emerald-400">0</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40">Alertas críticas</p>
                <p className="text-2xl font-bold text-red-400">1</p>
              </div>
            </div>
            {DEMO_AGENTS.map(agent => {
              const Icon = agent.icon
              return (
                <div key={agent.id} className={`bg-white/5 rounded-xl border p-4 ${
                  agent.priority === 'critical' ? 'border-red-500/30' :
                  agent.priority === 'warning' ? 'border-amber-500/20' : 'border-white/10'
                }`}>
                  <div className="flex items-start gap-3">
                    <Icon size={18} className={agent.color} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold">{agent.name}</span>
                        <span className="text-[10px] text-white/30">hace {agent.time}</span>
                        {agent.priority === 'critical' && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400">CRÍTICO</span>}
                        {agent.priority === 'warning' && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400">ALERTA</span>}
                      </div>
                      <p className="text-xs text-white/50">{agent.status}</p>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0 mt-2" />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ROI TAB */}
        {tab === 'roi' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 rounded-2xl border border-emerald-500/20 p-6">
              <p className="text-xs text-emerald-400 uppercase tracking-wider mb-2">Valor generado este mes</p>
              <p className="text-4xl font-black">{fmt(DEMO_ROI.total)}</p>
              <p className="text-sm text-white/40 mt-1">~{fmt(DEMO_ROI.monthly)}/mes · Costo Fullsite: $4,999/mes</p>
              <p className="text-emerald-400 font-bold text-lg mt-2">ROI: {Math.round(DEMO_ROI.monthly / 4999 * 100)}%</p>
            </div>
            <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <h3 className="text-sm font-bold">Valor por agente</h3>
              </div>
              {DEMO_ROI.agents.map(a => (
                <div key={a.name} className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-white/40">{a.desc}</p>
                  </div>
                  <p className="text-emerald-400 font-bold">+{fmt(a.value)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AUTO-86 TAB */}
        {tab === 'auto86' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white/5 rounded-xl border border-red-500/20 p-4">
                <p className="text-xs text-white/40">86'd (sin stock)</p>
                <p className="text-2xl font-bold text-red-400">12</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-amber-500/20 p-4">
                <p className="text-xs text-white/40">Stock bajo</p>
                <p className="text-2xl font-bold text-amber-400">8</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-emerald-500/20 p-4">
                <p className="text-xs text-white/40">Disponibles</p>
                <p className="text-2xl font-bold text-emerald-400">210</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40">Ingredientes críticos</p>
                <p className="text-2xl font-bold">2</p>
              </div>
            </div>

            <div className="bg-white/5 rounded-xl border border-white/10 p-5">
              <h3 className="text-sm font-bold mb-3 text-red-400">Ingredientes en cero</h3>
              <div className="space-y-3">
                {[
                  { name: 'Harina integral', unit: 'kg', stock: 0, reorder: 5, affected: 8 },
                  { name: 'Mantequilla artesanal', unit: 'pza', stock: 0, reorder: 10, affected: 4 },
                ].map(ing => (
                  <div key={ing.name} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{ing.name}</p>
                      <p className="text-xs text-white/40">{ing.stock}/{ing.reorder} {ing.unit} — {ing.affected} platillos afectados</p>
                    </div>
                    <div className="w-16 bg-white/5 rounded-full h-1.5"><div className="h-1.5 rounded-full bg-red-500" style={{ width: '0%' }} /></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white/5 rounded-xl border border-white/10 p-5">
              <h3 className="text-sm font-bold mb-3 text-amber-400">Compras sugeridas para mañana</h3>
              <div className="space-y-2">
                {[
                  { name: 'Harina integral', qty: 5, unit: 'kg', cost: 250 },
                  { name: 'Mantequilla artesanal', qty: 10, unit: 'pza', cost: 180 },
                  { name: 'Arándano', qty: 2.3, unit: 'kg', cost: 115 },
                  { name: 'Fresas', qty: 2.3, unit: 'kg', cost: 92 },
                  { name: 'Limón', qty: 2, unit: 'kg', cost: 40 },
                ].map(p => (
                  <div key={p.name} className="flex items-center justify-between text-sm">
                    <span>{p.name}</span>
                    <span className="text-white/50">{p.qty} {p.unit} · {fmt(p.cost)}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-white/10 flex justify-between font-bold">
                  <span>Total</span>
                  <span className="text-emerald-400">{fmt(677)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FOOD COST TAB */}
        {tab === 'foodcost' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <p className="text-xs text-white/40">Platillos costeados</p>
                <p className="text-2xl font-bold">63</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-emerald-500/20 p-4">
                <p className="text-xs text-white/40">Margen promedio</p>
                <p className="text-2xl font-bold text-emerald-400">68%</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-violet-500/20 p-4">
                <p className="text-xs text-white/40">Estrellas (&gt;70%)</p>
                <p className="text-2xl font-bold text-violet-400">24</p>
              </div>
              <div className="bg-white/5 rounded-xl border border-red-500/20 p-4">
                <p className="text-xs text-white/40">Problema (&lt;30%)</p>
                <p className="text-2xl font-bold text-red-400">3</p>
              </div>
            </div>
            <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <PieChart size={14} className="text-emerald-400" />
                <h3 className="text-sm font-bold">Costo por platillo</h3>
                <span className="text-xs text-white/30 ml-auto">Con yield factor y merma real</span>
              </div>
              {[
                { name: 'Chilaquiles Verdes', precio: 195, costo: 30.85, margen: 84.2 },
                { name: 'Huevos Benedict', precio: 225, costo: 42.30, margen: 81.2 },
                { name: 'Avocado Toast', precio: 185, costo: 38.50, margen: 79.2 },
                { name: 'Pancakes Stack', precio: 175, costo: 28.40, margen: 83.8 },
                { name: 'Acai Bowl', precio: 195, costo: 52.80, margen: 72.9 },
                { name: 'Salmon Bowl', precio: 265, costo: 112.40, margen: 57.6 },
                { name: 'Club Sandwich', precio: 195, costo: 68.20, margen: 65.0 },
                { name: 'Pizza Margarita', precio: 185, costo: 142.50, margen: 23.0 },
              ].map(p => (
                <div key={p.name} className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                  <span className="text-sm">{p.name}</span>
                  <div className="flex items-center gap-6 text-xs">
                    <span className="text-white/40">{fmt(p.precio)}</span>
                    <span className="text-white/40">{fmt(p.costo)}</span>
                    <div className="w-20">
                      <div className="flex justify-between mb-1">
                        <span className={`font-bold ${p.margen < 30 ? 'text-red-400' : p.margen > 70 ? 'text-emerald-400' : 'text-white'}`}>
                          {p.margen.toFixed(0)}%
                        </span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${p.margen < 30 ? 'bg-red-500' : p.margen > 70 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(p.margen, 100)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BOT TAB */}
        {tab === 'bot' && (
          <div className="max-w-lg mx-auto">
            <div className="bg-[#1a1a1a] rounded-2xl border border-white/10 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
                <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center">
                  <Bot size={20} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-bold">Fullsite Bot</p>
                  <p className="text-xs text-emerald-400">Telegram · en línea</p>
                </div>
              </div>
              <div className="p-4 space-y-3 min-h-[400px]">
                <div className="bg-white/5 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%] text-sm text-white/70">
                  <p className="font-bold text-emerald-400 text-xs mb-1">7:01 AM · Briefing</p>
                  Buenos días. Ayer cerraron con <strong className="text-white">$68,450</strong>. Ticket promedio <strong className="text-white">$439</strong>. Carlos M. fue top con <strong className="text-white">$22,400</strong>. Hoy hay reserva de 25 personas a las 10am en jardín.
                </div>
                <div className="bg-emerald-600/20 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[75%] ml-auto text-sm text-white/80">
                  Cuánto cuesta el huevo benedict?
                </div>
                <div className="bg-white/5 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%] text-sm text-white/70">
                  Precio: <strong className="text-white">$225</strong><br/>
                  Costo: <strong className="text-white">$42.30</strong><br/>
                  Margen: <strong className="text-emerald-400">81.2%</strong><br/>
                  Subreceta: 3 ingredientes, yield factor 0.85
                </div>
                <div className="bg-emerald-600/20 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[75%] ml-auto text-sm text-white/80">
                  Quién vendió más esta semana?
                </div>
                <div className="bg-white/5 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%] text-sm text-white/70">
                  Top meseros semana:<br/>
                  1. Carlos M. — <strong className="text-white">$98,200</strong><br/>
                  2. Andrea L. — <strong className="text-white">$82,400</strong><br/>
                  3. Roberto S. — <strong className="text-white">$67,100</strong><br/>
                  <span className="text-white/40 text-xs">Responde en 2 segundos. Datos reales. 24/7.</span>
                </div>
                <div className="bg-emerald-600/20 rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[75%] ml-auto text-sm text-white/80">
                  Hay algo raro hoy?
                </div>
                <div className="bg-white/5 rounded-2xl rounded-bl-sm px-4 py-2.5 max-w-[85%] text-sm text-white/70">
                  <span className="text-amber-400 font-bold text-xs">⚠ ALERTA</span><br/>
                  Luis G. tiene 3 cancelaciones en la última hora. Patrón inusual — normalmente cancela 1/día. Anti-fraude lo marcó para revisión.
                </div>
              </div>
            </div>
            <p className="text-center text-white/30 text-xs mt-4">El bot responde preguntas sobre ventas, meseros, costos, inventario, reservas — en tiempo real por Telegram.</p>
          </div>
        )}

        {/* CTA */}
        <div className="mt-8 text-center">
          <p className="text-white/30 text-xs mb-3">Esto es una demo con datos de ejemplo. ¿Quieres verlo con los datos de tu restaurante?</p>
          <a href="https://wa.me/528112741000?text=Hola%20Daniel%2C%20vi%20la%20demo%20de%20Fullsite%20y%20quiero%20probarlo%20en%20mi%20restaurante." target="_blank" rel="noopener"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors">
            Agendar demo con datos reales →
          </a>
        </div>
      </div>
    </div>
  )
}
