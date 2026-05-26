'use client'

import Link from 'next/link'
import { ArrowLeft, Bot, User, Send, Lock } from 'lucide-react'
import { DEMO_RESTAURANT } from '@/lib/demo-data'

const MENSAJES = [
  {
    rol: 'user' as const,
    texto: 'Cuanto vendimos ayer?',
  },
  {
    rol: 'ai' as const,
    texto: 'Ayer vendimos $35,200 con 68 tickets. Ticket promedio $518. Top platillo: Chilaquiles Rojos (28 piezas). El equipo completo atendio 142 personas.',
  },
  {
    rol: 'user' as const,
    texto: 'Quien fue el mejor mesero?',
  },
  {
    rol: 'ai' as const,
    texto: 'Alejandro Trevino con $8,200 en ventas, 16 tickets y $1,640 en propinas. Su ticket promedio fue $513, el mas alto del equipo.',
  },
]

export default function DemoChat() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)] flex flex-col">
      <header className="border-b border-[var(--line)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/demo/dashboard" className="text-[var(--text-3)] hover:text-[var(--text-1)]">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold">Chat IA</h1>
            <p className="text-xs text-[var(--text-3)]">{DEMO_RESTAURANT.name} · Asistente inteligente</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-4">
          {MENSAJES.map((m, i) => (
            <div
              key={i}
              className={`flex gap-3 ${m.rol === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.rol === 'ai' && (
                <div className="w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot size={16} className="text-violet-400" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.rol === 'user'
                    ? 'bg-[var(--line)] text-[var(--text-1)]'
                    : 'bg-[var(--surface)] border border-[var(--line)] text-zinc-300'
                }`}
              >
                {m.texto}
              </div>
              {m.rol === 'user' && (
                <div className="w-8 h-8 rounded-full bg-[var(--line-soft)] flex items-center justify-center flex-shrink-0 mt-1">
                  <User size={16} className="text-[var(--text-2)]" />
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      <div className="border-t border-[var(--line)] p-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl px-4 py-3 flex items-center gap-3">
            <Lock size={14} className="text-[var(--text-4)] flex-shrink-0" />
            <span className="text-sm text-[var(--text-4)] flex-1">Disponible con suscripcion activa</span>
            <button
              disabled
              className="w-8 h-8 rounded-xl bg-[var(--line-soft)] flex items-center justify-center cursor-not-allowed"
            >
              <Send size={14} className="text-[var(--text-4)]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
