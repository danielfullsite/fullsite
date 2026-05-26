'use client'

import { useState, useEffect } from 'react'
import { Trophy, TrendingUp, Flame, Target } from 'lucide-react'
import { formatMXN } from '@/lib/pos-data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface MeseroStats {
  name: string
  ventas: number
  tickets: number
  ticketPromedio: number
  personas: number
}

interface MeseroLeaderboardProps {
  currentMesero?: string
  compact?: boolean
  meta?: number // daily goal
}

export default function MeseroLeaderboard({ currentMesero, compact = false, meta = 60000 }: MeseroLeaderboardProps) {
  const [meseros, setMeseros] = useState<MeseroStats[]>([])
  const [totalVentas, setTotalVentas] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLeaderboard()
    const interval = setInterval(fetchLeaderboard, 60000) // refresh every minute
    return () => clearInterval(interval)
  }, [])

  async function fetchLeaderboard() {
    try {
      const today = new Date()
      const todayStr = new Date(today.toLocaleString('en-US', { timeZone: 'America/Monterrey' })).toISOString().split('T')[0]

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_orders?select=mesero,total,personas&status=eq.cerrada&client_id=eq.amalay&created_at=gte.${todayStr}T00:00:00`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (!res.ok) return

      const orders = await res.json()
      const byMesero = new Map<string, MeseroStats>()
      let total = 0

      for (const o of orders) {
        const name = o.mesero || 'Sin mesero'
        if (!byMesero.has(name)) {
          byMesero.set(name, { name, ventas: 0, tickets: 0, ticketPromedio: 0, personas: 0 })
        }
        const m = byMesero.get(name)!
        m.ventas += Number(o.total) || 0
        m.tickets += 1
        m.personas += Number(o.personas) || 0
        total += Number(o.total) || 0
      }

      // Calculate ticket promedio
      for (const m of byMesero.values()) {
        m.ticketPromedio = m.tickets > 0 ? m.ventas / m.tickets : 0
      }

      const sorted = Array.from(byMesero.values()).sort((a, b) => b.ventas - a.ventas)
      setMeseros(sorted)
      setTotalVentas(total)
    } catch { /* */ }
    setLoading(false)
  }

  if (loading) return null

  const pctMeta = meta > 0 ? Math.min((totalVentas / meta) * 100, 100) : 0
  const topMesero = meseros[0]

  if (compact) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 bg-[var(--surface)] rounded-xl border border-[var(--line)]">
        <div className="flex items-center gap-1.5">
          <Target size={14} className="text-emerald-400" />
          <span className="text-xs text-[var(--text-3)]">Meta:</span>
          <span className="text-sm font-bold text-emerald-400">{pctMeta.toFixed(0)}%</span>
        </div>
        <div className="flex-1 h-1.5 bg-[var(--line)] rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pctMeta}%` }} />
        </div>
        {topMesero && (
          <div className="flex items-center gap-1">
            <Trophy size={12} className="text-amber-400" />
            <span className="text-xs text-amber-400 font-medium">{topMesero.name.split(' ')[0]}</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--line)] rounded-2xl overflow-hidden">
      {/* Daily goal progress */}
      <div className="px-4 py-3 bg-gradient-to-r from-emerald-900/30 to-emerald-800/10 border-b border-[var(--line)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-emerald-400" />
            <span className="text-sm font-bold text-[var(--text-1)]">Meta del día</span>
          </div>
          <span className="text-lg font-black text-emerald-400">{formatMXN(totalVentas)}<span className="text-xs text-[var(--text-3)] font-normal"> / {formatMXN(meta)}</span></span>
        </div>
        <div className="w-full h-2.5 bg-[var(--line)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{
              width: `${pctMeta}%`,
              background: pctMeta >= 100 ? 'linear-gradient(90deg, #10b981, #34d399)' :
                         pctMeta >= 70 ? 'linear-gradient(90deg, #10b981, #6ee7b7)' :
                         'linear-gradient(90deg, #f59e0b, #fbbf24)',
            }}
          />
        </div>
        <p className="text-xs text-[var(--text-3)] mt-1">
          {pctMeta >= 100 ? 'Meta alcanzada!' : `Faltan ${formatMXN(meta - totalVentas)}`}
        </p>
      </div>

      {/* Leaderboard */}
      <div className="px-4 py-2">
        {meseros.length === 0 ? (
          <p className="text-center text-[var(--text-3)] text-sm py-4">Sin ventas hoy</p>
        ) : (
          <div className="space-y-1">
            {meseros.map((m, i) => {
              const isMe = m.name === currentMesero
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
              return (
                <div
                  key={m.name}
                  className={`flex items-center gap-3 py-2 px-2 rounded-lg transition-colors ${
                    isMe ? 'bg-emerald-500/10 border border-emerald-500/20' : ''
                  }`}
                >
                  <span className="text-lg w-8 text-center">{medal}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isMe ? 'text-emerald-400' : 'text-[var(--text-1)]'}`}>
                      {m.name.split(' ').slice(0, 2).join(' ')}
                    </p>
                    <p className="text-xs text-[var(--text-3)]">
                      {m.tickets} tickets · TP {formatMXN(m.ticketPromedio)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-bold ${isMe ? 'text-emerald-400' : 'text-[var(--text-1)]'}`}>{formatMXN(m.ventas)}</p>
                    {i === 0 && <Flame size={14} className="text-amber-400 ml-auto" />}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
