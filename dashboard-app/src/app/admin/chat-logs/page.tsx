'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { MessageCircle, AlertTriangle, Clock, Search, Filter, ChevronDown, ChevronUp } from 'lucide-react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface ChatLog {
  id: string
  client_id: string
  user_id: string | null
  user_message: string
  ai_response: string
  model: string
  had_error: boolean
  error_type: string | null
  created_at: string
}

export default function ChatLogsPage() {
  const { clientId } = useAuth()
  const [logs, setLogs] = useState<ChatLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'errors'>('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [limit, setLimit] = useState(50)

  useEffect(() => {
    async function fetchLogs() {
      setLoading(true)
      const params = new URLSearchParams({
        order: 'created_at.desc',
        limit: String(limit),
      })
      if (filter === 'errors') params.append('had_error', 'eq.true')
      if (search) params.append('user_message', `ilike.*${search}*`)

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_logs?${params}`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, cache: 'no-store' }
      )
      if (res.ok) setLogs(await res.json())
      setLoading(false)
    }
    fetchLogs()
  }, [clientId, filter, search, limit])

  const stats = {
    total: logs.length,
    errors: logs.filter(l => l.had_error).length,
    today: logs.filter(l => l.created_at.startsWith(new Date().toISOString().split('T')[0])).length,
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-1)]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <MessageCircle size={28} className="text-emerald-500" />
              Chat Logs
            </h1>
            <p className="text-[var(--text-3)] text-sm mt-1">Conversaciones del agente IA por restaurante</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="bg-[var(--surface-2)] px-4 py-2 rounded-xl">
              <span className="text-[var(--text-3)]">Total:</span>{' '}
              <span className="font-bold">{stats.total}</span>
            </div>
            <div className="bg-red-500/10 text-red-400 px-4 py-2 rounded-xl">
              <span>Errores:</span>{' '}
              <span className="font-bold">{stats.errors}</span>
            </div>
            <div className="bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-xl">
              <span>Hoy:</span>{' '}
              <span className="font-bold">{stats.today}</span>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar en preguntas..."
              className="w-full bg-[var(--surface-2)] border border-[var(--line)] rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex items-center gap-1 bg-[var(--surface-2)] rounded-xl p-1">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === 'all' ? 'bg-emerald-500 text-white' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setFilter('errors')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                filter === 'errors' ? 'bg-red-500 text-white' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}
            >
              <AlertTriangle size={14} />
              Solo errores
            </button>
          </div>
        </div>

        {/* Logs list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-20 text-[var(--text-3)]">
            <MessageCircle size={48} className="mx-auto mb-3 opacity-30" />
            <p>No hay conversaciones registradas</p>
            <p className="text-sm mt-1">Las nuevas conversaciones del chat aparecen aqui automaticamente</p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map(log => {
              const isExpanded = expandedId === log.id
              return (
                <div
                  key={log.id}
                  className={`bg-[var(--surface-2)] border rounded-xl overflow-hidden transition-colors ${
                    log.had_error ? 'border-red-500/30' : 'border-[var(--line)]'
                  }`}
                >
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-[var(--surface-2)]/80"
                  >
                    {log.had_error && <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{log.user_message}</p>
                      <p className="text-xs text-[var(--text-3)] truncate mt-0.5">{log.ai_response.slice(0, 100)}...</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-[var(--text-3)] flex items-center gap-1">
                        <Clock size={12} />
                        {formatTime(log.created_at)}
                      </span>
                      {log.client_id !== 'amalay' && (
                        <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">{log.client_id}</span>
                      )}
                      {log.had_error && log.error_type && (
                        <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">{log.error_type}</span>
                      )}
                      {isExpanded ? <ChevronUp size={16} className="text-[var(--text-3)]" /> : <ChevronDown size={16} className="text-[var(--text-3)]" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-[var(--line)] pt-3 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-emerald-400 uppercase mb-1">Pregunta</p>
                        <div className="bg-emerald-500/10 rounded-xl p-3 text-sm whitespace-pre-wrap">{log.user_message}</div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-blue-400 uppercase mb-1">Respuesta del AI</p>
                        <div className={`rounded-xl p-3 text-sm whitespace-pre-wrap ${log.had_error ? 'bg-red-500/10' : 'bg-[var(--line)]/50'}`}>
                          {log.ai_response}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-[var(--text-3)]">
                        <span>Modelo: {log.model}</span>
                        <span>Cliente: {log.client_id}</span>
                        <span>{new Date(log.created_at).toLocaleString('es-MX')}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {logs.length >= limit && (
          <button
            onClick={() => setLimit(l => l + 50)}
            className="w-full mt-4 py-3 bg-[var(--surface-2)] border border-[var(--line)] rounded-xl text-sm font-medium text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
          >
            Cargar mas...
          </button>
        )}
      </div>
    </div>
  )
}
