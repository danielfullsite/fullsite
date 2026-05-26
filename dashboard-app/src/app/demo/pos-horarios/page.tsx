'use client'

import { Clock } from 'lucide-react'
import { formatDemoMXN } from '@/lib/demo-data'

const DIAS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
const HORAS = Array.from({ length: 15 }, (_, i) => i + 8) // 8am to 10pm

const BLOQUES = [
  { nombre: 'Desayuno', inicio: 8, fin: 12, color: 'amber', bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' },
  { nombre: 'Comida', inicio: 12, fin: 17, color: 'blue', bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400' },
  { nombre: 'Cena', inicio: 17, fin: 22, color: 'violet', bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400' },
]

function getBloque(hora: number) {
  return BLOQUES.find(b => hora >= b.inicio && hora < b.fin)
}

export default function PosHorariosPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)] p-6 md:p-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
          <Clock size={20} className="text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Horarios</h1>
          <p className="text-sm text-[var(--text-3)]">Horario semanal &middot; Casa Montana</p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-6">
        {BLOQUES.map(b => (
          <div key={b.nombre} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${b.bg} border ${b.border}`}>
              <div className={`w-3 h-3 rounded-full ${b.bg}`} />
            </div>
            <span className={`text-sm font-medium ${b.text}`}>
              {b.nombre} ({b.inicio}:00 - {b.fin}:00)
            </span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            {/* Header row */}
            <div className="grid grid-cols-8 border-b border-[var(--line)]">
              <div className="p-3 text-xs text-[var(--text-4)] font-medium">Hora</div>
              {DIAS.map(d => (
                <div key={d} className="p-3 text-xs text-[var(--text-2)] font-semibold text-center">{d}</div>
              ))}
            </div>

            {/* Time rows */}
            {HORAS.map(h => {
              const bloque = getBloque(h)
              return (
                <div key={h} className="grid grid-cols-8 border-b border-white/[0.03] last:border-b-0">
                  <div className="p-3 text-xs text-[var(--text-4)] font-mono">
                    {h.toString().padStart(2, '0')}:00
                  </div>
                  {DIAS.map(d => (
                    <div key={d} className="p-1.5">
                      {bloque ? (
                        <div className={`h-full min-h-[32px] rounded-lg ${bloque.bg} border ${bloque.border} flex items-center justify-center`}>
                          {(h === bloque.inicio) && (
                            <span className={`text-[10px] font-semibold ${bloque.text}`}>{bloque.nombre}</span>
                          )}
                        </div>
                      ) : (
                        <div className="h-full min-h-[32px]" />
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
