'use client'

import Link from 'next/link'
import { ArrowLeft, Brain, TrendingUp, Users, Zap } from 'lucide-react'
import { DEMO_RESTAURANT } from '@/lib/demo-data'

const TIPS = [
  {
    mesero: 'Alejandro Trevino',
    tip: 'Alejandro tiene el mejor ticket promedio del equipo. Su tecnica: sugiere entrada + bebida antes del plato fuerte. Compartir su metodo en la junta del lunes.',
    prioridad: 'Alta',
    categoria: 'Ventas',
    icon: TrendingUp,
  },
  {
    mesero: 'Camila Ruiz',
    tip: 'Camila necesita mejorar venta de postres — solo 8% de sus mesas piden. El promedio del equipo es 22%. Sugerir que mencione el postre del dia al entregar el plato fuerte.',
    prioridad: 'Alta',
    categoria: 'Ventas',
    icon: TrendingUp,
  },
  {
    mesero: 'Diego Cantu',
    tip: 'Diego tiene el mayor tiempo promedio por mesa (48 min vs 35 min del equipo). Revisar si esta atendiendo demasiadas mesas a la vez o si necesita apoyo en horas pico.',
    prioridad: 'Media',
    categoria: 'Eficiencia',
    icon: Zap,
  },
  {
    mesero: 'Sofia Garza',
    tip: 'Sofia recibio 3 comentarios positivos esta semana mencionando su atencion personalizada. Reconocerla en la junta y pedirle que comparta tips con el equipo.',
    prioridad: 'Media',
    categoria: 'Servicio',
    icon: Users,
  },
  {
    mesero: 'Emilio Salinas',
    tip: 'Emilio no ha ofrecido el menu de temporada en sus ultimas 12 mesas. Recordarle que el especial de la semana tiene 40% de margen — es prioridad de venta.',
    prioridad: 'Alta',
    categoria: 'Ventas',
    icon: TrendingUp,
  },
]

const prioridadColor: Record<string, string> = {
  'Alta': 'bg-red-500/10 text-red-400',
  'Media': 'bg-amber-500/10 text-amber-400',
}

const categoriaColor: Record<string, string> = {
  'Ventas': 'bg-emerald-500/10 text-emerald-400',
  'Servicio': 'bg-blue-500/10 text-blue-400',
  'Eficiencia': 'bg-violet-500/10 text-violet-400',
}

export default function DemoCoach() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Coach IA</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · Recomendaciones del equipo</p>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Brain size={22} className="text-violet-400" />
          </div>
          <div>
            <p className="font-semibold">Analisis de hoy</p>
            <p className="text-sm text-zinc-400">
              {TIPS.length} recomendaciones basadas en datos de las ultimas 2 semanas. {TIPS.filter(t => t.prioridad === 'Alta').length} de prioridad alta.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {TIPS.map((t, i) => (
            <div
              key={i}
              className="bg-white/[0.02] border border-white/5 rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center">
                    <t.icon size={16} className="text-zinc-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{t.mesero}</p>
                    <div className="flex gap-2 mt-0.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${prioridadColor[t.prioridad]}`}>
                        {t.prioridad}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${categoriaColor[t.categoria]}`}>
                        {t.categoria}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">{t.tip}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
