'use client'

import Link from 'next/link'
import { ArrowLeft, Zap, Bot, Clock, CheckCircle2, Calendar } from 'lucide-react'
import { DEMO_RESTAURANT, DEMO_INSIGHTS } from '@/lib/demo-data'

const AGENTS = [
  { name: 'Anomaly Detector', desc: 'Detecta metricas fuera de patron historico en ventas, tickets y propinas', status: 'activo', schedule: 'Cada 2 horas (2pm, 4pm, 6pm)', tentacle: 'ops' },
  { name: 'Close Predictor', desc: 'Predice el cierre del dia basado en tendencia horaria y dia de la semana', status: 'activo', schedule: 'Cada 2 horas (2pm, 4pm, 6pm)', tentacle: 'ops' },
  { name: 'Upselling Coach', desc: 'Detecta oportunidades de upselling por mesero comparando ticket promedio', status: 'activo', schedule: 'Cada 2 horas (2pm, 4pm, 6pm)', tentacle: 'ops' },
  { name: 'Kitchen Quality', desc: 'Monitorea cancelaciones, devoluciones y tiempos vs baseline', status: 'activo', schedule: 'Diario 7am, 4pm, 7pm', tentacle: 'ops' },
  { name: 'Table Time', desc: 'Analiza rotacion de mesas y tiempo promedio por comensal', status: 'activo', schedule: 'Diario 7am, 4pm, 7pm', tentacle: 'ops' },
  { name: 'Config Validator', desc: 'Valida que la configuracion del sistema sea consistente y sin errores', status: 'activo', schedule: 'Diario 7am, 4pm, 7pm', tentacle: 'ops' },
  { name: 'Daily Briefing', desc: 'Briefing matutino completo: reservas, calendario, KPIs, 3 acciones del dia', status: 'activo', schedule: 'Diario 7am MX', tentacle: 'reportes' },
  { name: 'Weekly Report', desc: 'Reporte ejecutivo semanal con tendencias, top meseros y recomendaciones', status: 'activo', schedule: 'Lunes 9am MX', tentacle: 'reportes' },
  { name: 'Intraday Sales', desc: 'Reporte de ventas intraday con comparativo vs dia anterior', status: 'activo', schedule: 'Cron variable', tentacle: 'reportes' },
  { name: 'Staffing Optimizer', desc: 'Sugiere horarios optimos basado en patrones de demanda historicos', status: 'activo', schedule: 'Lunes', tentacle: 'ops' },
  { name: 'Menu Engineering', desc: 'Clasifica platillos: estrellas, vacas, interrogantes y perros', status: 'activo', schedule: 'Lunes', tentacle: 'ops' },
  { name: 'Anti-Fraud', desc: 'Detecta patrones sospechosos en cancelaciones, descuentos y devoluciones', status: 'activo', schedule: 'Viernes', tentacle: 'ops' },
  { name: 'Tips Analyzer', desc: 'Analisis de propinas por mesero, deteccion de anomalias', status: 'activo', schedule: 'Viernes', tentacle: 'ops' },
  { name: 'Reservas Pendientes', desc: 'Alerta de reservaciones sin confirmar o sin telefono de contacto', status: 'activo', schedule: 'Diario 10am MX', tentacle: 'ops' },
  { name: 'Wansoft Staleness', desc: 'Alerta si la sincronizacion con Wansoft tiene mas de 24h', status: 'activo', schedule: 'Diario 8am MX', tentacle: 'ops' },
  { name: 'Wansoft Query (KB)', desc: 'Responde preguntas ad-hoc sobre ventas, meseros, platillos 24/7', status: 'activo', schedule: 'On-demand (Telegram)', tentacle: 'kb' },
  { name: 'Orquestador', desc: 'Router central: clasifica intent del mensaje y despacha al agente correcto', status: 'activo', schedule: 'On-demand (webhook)', tentacle: 'orquestador' },
  { name: 'Wansoft Scraper', desc: 'Scraper automatico de reportes de Wansoft POS via Playwright', status: 'activo', schedule: '3pm avance, 8:30pm/11pm cierre', tentacle: 'ops' },
  { name: 'Supplier Monitor', desc: 'Monitorea precios de proveedores y sugiere compras optimas', status: 'activo', schedule: 'Semanal', tentacle: 'ops' },
  { name: 'Waste Tracker', desc: 'Rastrea merma y desperdicio, genera alertas cuando excede umbral', status: 'activo', schedule: 'Semanal', tentacle: 'ops' },
  { name: 'Google Reviews', desc: 'Monitorea resenas de Google Maps y genera respuestas sugeridas', status: 'programado', schedule: 'Pendiente OAuth', tentacle: 'resenas' },
  { name: 'WhatsApp Bot', desc: 'Atencion automatica de reservaciones y consultas por WhatsApp', status: 'programado', schedule: 'Pendiente Meta API', tentacle: 'ops' },
  { name: 'Food Cost Monitor', desc: 'Calcula food cost real vs teorico por platillo', status: 'programado', schedule: 'TBD', tentacle: 'ops' },
  { name: 'Weather Impact', desc: 'Correlaciona clima con ventas para predicciones mas precisas', status: 'programado', schedule: 'TBD', tentacle: 'ops' },
  { name: 'Loyalty Program', desc: 'Identifica clientes frecuentes y sugiere programas de fidelizacion', status: 'programado', schedule: 'TBD', tentacle: 'ops' },
  { name: 'Competitor Tracker', desc: 'Monitorea precios y promociones de competencia en la zona', status: 'programado', schedule: 'TBD', tentacle: 'ops' },
]

const activeCount = AGENTS.filter(a => a.status === 'activo').length
const scheduledCount = AGENTS.filter(a => a.status === 'programado').length

const tentacleColors: Record<string, string> = {
  ops: 'bg-blue-500/10 text-blue-400',
  reportes: 'bg-emerald-500/10 text-emerald-400',
  kb: 'bg-purple-500/10 text-purple-400',
  orquestador: 'bg-amber-500/10 text-amber-400',
  resenas: 'bg-pink-500/10 text-pink-400',
}

export default function DemoAgentes() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Agentes IA</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · War Room</p>
          </div>
        </div>
      </header>

      <div className="p-6 max-w-[1400px] mx-auto space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Bot size={18} className="text-emerald-400" />
            </div>
            <p className="text-3xl font-bold">{AGENTS.length}</p>
            <p className="text-xs text-zinc-500 mt-1">Agentes totales</p>
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={18} className="text-emerald-400" />
            </div>
            <p className="text-3xl font-bold text-emerald-400">{activeCount}</p>
            <p className="text-xs text-zinc-500 mt-1">Activos</p>
          </div>
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={18} className="text-amber-400" />
            </div>
            <p className="text-3xl font-bold text-amber-400">{scheduledCount}</p>
            <p className="text-xs text-zinc-500 mt-1">Programados</p>
          </div>
        </div>

        {/* Latest insights */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-4">
            <Zap size={18} className="text-emerald-400" /> Ultimos hallazgos
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {DEMO_INSIGHTS.map((insight, i) => (
              <div key={i} className={`rounded-xl border p-4 ${
                insight.type === 'alert' ? 'bg-red-500/5 border-red-500/20' :
                insight.type === 'upsell' ? 'bg-amber-500/5 border-amber-500/20' :
                insight.type === 'staff' ? 'bg-purple-500/5 border-purple-500/20' :
                'bg-emerald-500/5 border-emerald-500/20'
              }`}>
                <p className="text-sm font-bold mb-1">{insight.title}</p>
                <p className="text-xs text-zinc-400 leading-relaxed">{insight.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Agent list */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
          <h3 className="flex items-center gap-2 font-bold mb-4">
            <Bot size={18} className="text-blue-400" /> Todos los agentes
          </h3>
          <div className="space-y-2">
            {AGENTS.map(agent => (
              <div key={agent.name} className="flex items-center gap-4 py-3 border-b border-white/5 last:border-0">
                <div className="flex-shrink-0">
                  <div className={`w-2 h-2 rounded-full ${agent.status === 'activo' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold">{agent.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tentacleColors[agent.tentacle] || 'bg-zinc-500/10 text-zinc-400'}`}>
                      {agent.tentacle}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">{agent.desc}</p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className={`text-xs font-medium ${agent.status === 'activo' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {agent.status}
                  </span>
                  <p className="text-[10px] text-zinc-600 mt-0.5 flex items-center gap-1 justify-end">
                    <Calendar size={10} /> {agent.schedule}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-xs text-zinc-600">Powered by <strong>fullsite</strong> — IA operativa para restaurantes</p>
        </div>
      </div>
    </div>
  )
}
