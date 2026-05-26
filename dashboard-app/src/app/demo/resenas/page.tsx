'use client'

import Link from 'next/link'
import { ArrowLeft, Star } from 'lucide-react'
import { DEMO_RESTAURANT } from '@/lib/demo-data'

const RATING = 4.7
const TOTAL_RESENAS = 142
const DISTRIBUCION = [
  { estrellas: 5, pct: 68 },
  { estrellas: 4, pct: 22 },
  { estrellas: 3, pct: 7 },
  { estrellas: 2, pct: 2 },
  { estrellas: 1, pct: 1 },
]

const RESENAS = [
  {
    nombre: 'Carolina M.',
    rating: 5,
    comentario: 'Los mejores chilaquiles de Monterrey. El servicio de Alejandro fue impecable, siempre atento sin ser invasivo. Volveremos pronto.',
    fecha: '2026-05-24',
    plataforma: 'Google',
  },
  {
    nombre: 'Jorge P.',
    rating: 5,
    comentario: 'Brunch espectacular. La granola con fruta fresca y el cafe de olla son una combinacion perfecta. Ambiente muy agradable.',
    fecha: '2026-05-22',
    plataforma: 'Google',
  },
  {
    nombre: 'Laura S.',
    rating: 4,
    comentario: 'Excelente comida y ambiente. El unico detalle fue que tardaron un poco en traer la cuenta, pero nada grave. La terraza es hermosa.',
    fecha: '2026-05-20',
    plataforma: 'TripAdvisor',
  },
  {
    nombre: 'Miguel R.',
    rating: 4,
    comentario: 'Buena experiencia general. Los precios son un poco elevados pero la calidad lo justifica. El bowl de acai es top.',
    fecha: '2026-05-18',
    plataforma: 'Google',
  },
  {
    nombre: 'Patricia G.',
    rating: 5,
    comentario: 'Celebramos un cumpleanos en el jardin y todo salio perfecto. La decoracion, la comida, el pastel... todo de 10. Gracias al equipo!',
    fecha: '2026-05-15',
    plataforma: 'TripAdvisor',
  },
]

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={14}
          className={i <= count ? 'text-amber-400 fill-amber-400' : 'text-zinc-700'}
        />
      ))}
    </div>
  )
}

export default function DemoResenas() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-zinc-500 hover:text-white">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Resenas</h1>
            <p className="text-xs text-zinc-500">{DEMO_RESTAURANT.name} · Google & TripAdvisor</p>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        {/* Rating summary */}
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 flex flex-col sm:flex-row gap-8 items-center">
          <div className="text-center">
            <p className="text-5xl font-bold">{RATING}</p>
            <Stars count={Math.round(RATING)} />
            <p className="text-xs text-zinc-500 mt-1">{TOTAL_RESENAS} resenas</p>
          </div>
          <div className="flex-1 w-full space-y-2">
            {DISTRIBUCION.map((d) => (
              <div key={d.estrellas} className="flex items-center gap-3 text-sm">
                <span className="w-4 text-right text-zinc-400">{d.estrellas}</span>
                <Star size={12} className="text-amber-400 fill-amber-400" />
                <div className="flex-1 bg-white/5 rounded-full h-2">
                  <div
                    className="bg-amber-400 rounded-full h-2"
                    style={{ width: `${d.pct}%` }}
                  />
                </div>
                <span className="w-10 text-right text-xs text-zinc-500">{d.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent reviews */}
        <div className="space-y-3">
          {RESENAS.map((r, i) => (
            <div
              key={i}
              className="bg-white/[0.02] border border-white/5 rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs font-bold text-zinc-400">
                    {r.nombre.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{r.nombre}</p>
                    <Stars count={r.rating} />
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-zinc-400">
                    {r.plataforma}
                  </span>
                  <p className="text-xs text-zinc-600 mt-1">{r.fecha}</p>
                </div>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">{r.comentario}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
