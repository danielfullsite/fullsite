'use client'

import { useEffect, useState } from 'react'
import { Store, Plus, Activity, AlertTriangle, ArrowUpRight, Bot, RefreshCw, X, Sparkles, Circle } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function sb(table: string, params = ''): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

interface Tenant {
  id: string
  name: string
  lastData: string | null
  hoursAgo: number | null
  openEvents: number
}

function hoursSince(dateStr: string): number {
  const then = new Date(dateStr + 'T23:59:00')
  return Math.max(0, Math.round((Date.now() - then.getTime()) / 3_600_000))
}

export default function TenantsConsole() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  async function load() {
    setLoading(true)
    // OCM: freshness desde ops_daily (canónico, source-agnostic) — no wansoft_daily
    const [clients, daily, events] = await Promise.all([
      sb('clients', 'select=id,display_name&order=display_name'),
      sb('ops_daily', 'select=client_id,fecha&order=fecha.desc&limit=2000'),
      sb('agent_events', 'select=client_id,status&status=eq.open&limit=5000'),
    ])
    const latest = new Map<string, string>()
    for (const r of daily) {
      const cid = r.client_id as string
      if (cid && !latest.has(cid)) latest.set(cid, r.fecha as string)
    }
    const eventCount = new Map<string, number>()
    for (const e of events) {
      const cid = e.client_id as string
      if (cid) eventCount.set(cid, (eventCount.get(cid) || 0) + 1)
    }
    setTenants(
      clients.map(c => {
        const id = c.id as string
        const fecha = latest.get(id) || null
        return {
          id,
          name: (c.display_name as string) || id,
          lastData: fecha,
          hoursAgo: fecha ? hoursSince(fecha) : null,
          openEvents: eventCount.get(id) || 0,
        }
      })
    )
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const withData = tenants.filter(t => t.hoursAgo !== null).length
  const totalAlerts = tenants.reduce((s, t) => s + t.openEvents, 0)

  const kpis = [
    { label: 'Tenants', value: tenants.length, icon: Store, color: 'var(--accent-bright)' },
    { label: 'Con datos', value: withData, icon: Activity, color: 'var(--accent-bright)' },
    { label: 'Detecciones abiertas', value: totalAlerts, icon: AlertTriangle, color: '#fbbf24' },
    { label: 'Agentes', value: 'activos', icon: Bot, color: 'var(--accent-bright)' },
  ]

  return (
    <>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <PageHeader title="Tenants" subtitle="Todos los clientes de Fullsite · un solo cerebro" eyebrow="PLATAFORMA" />
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"
            aria-label="Refrescar"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-[#04120c] font-bold text-sm hover:brightness-110 transition"
          >
            <Plus size={16} /> Nuevo cliente
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpis.map(k => {
          const Icon = k.icon
          return (
            <div key={k.label} className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-4">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-3)]">
                <Icon size={13} style={{ color: k.color }} /> {k.label}
              </div>
              <div className="text-2xl font-black text-[var(--text-1)] mt-2 tabular-nums">{k.value}</div>
            </div>
          )
        })}
      </div>

      {/* Tenants table */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--line)] flex items-center gap-2">
          <Store size={15} className="text-[var(--accent-bright)]" />
          <b className="text-sm text-[var(--text-1)]">Clientes</b>
          <span className="ml-auto text-[11px] text-[var(--text-4)] font-mono">{tenants.length} tenants · misma app, mismo Core</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  {['Cliente', 'ID', 'Últimos datos', 'Detecciones', ''].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-[var(--text-4)] font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => {
                  const stale = t.hoursAgo !== null && t.hoursAgo > 48
                  const warn = t.hoursAgo !== null && t.hoursAgo > 24
                  const dot = t.hoursAgo === null ? 'var(--text-4)' : stale ? '#f43f5e' : warn ? '#fbbf24' : 'var(--accent)'
                  return (
                    <tr key={t.id} className="border-t border-[var(--line-soft)] hover:bg-[var(--surface-2)] transition-colors">
                      <td className="px-4 py-3 font-semibold text-[var(--text-1)]">
                        <span className="inline-flex items-center gap-2">
                          <Circle size={8} fill={dot} stroke="none" /> {t.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--text-3)]">{t.id}</td>
                      <td className="px-4 py-3 text-[var(--text-2)] tabular-nums">
                        {t.hoursAgo === null ? <span className="text-[var(--text-4)]">sin datos aún</span> : `${t.hoursAgo}h`}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {t.openEvents > 0
                          ? <span style={{ color: '#fbbf24' }} className="font-semibold">{t.openEvents}</span>
                          : <span className="text-[var(--text-4)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="inline-flex items-center gap-1 text-[var(--accent-bright)] font-semibold text-xs hover:underline">
                          Entrar <ArrowUpRight size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Nuevo cliente (clonar) */}
      {showNew && <NewTenantModal onClose={() => setShowNew(false)} />}
    </>
  )
}

function NewTenantModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const autoSlug = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--bg)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--line)] flex items-center gap-3">
          <Sparkles size={18} className="text-[var(--accent-bright)]" />
          <div>
            <div className="font-bold text-[var(--text-1)]">Nuevo cliente</div>
            <div className="text-[11px] text-[var(--text-3)]">Clonar Fullsite completo · onboarding cero-código</div>
          </div>
          <button onClick={onClose} className="ml-auto text-[var(--text-3)] hover:text-[var(--text-1)]"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs text-[var(--text-3)]">Nombre del restaurante</span>
            <input
              value={name}
              onChange={e => { setName(e.target.value); setSlug(autoSlug(e.target.value)) }}
              placeholder="La Costa Verde"
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[var(--text-1)] outline-none focus:border-[var(--accent-line)]"
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-3)]">Subdominio (tenant)</span>
            <div className="mt-1 flex items-center rounded-lg border border-[var(--line)] bg-[var(--surface-2)] overflow-hidden">
              <input
                value={slug}
                onChange={e => setSlug(autoSlug(e.target.value))}
                placeholder="lacostaverde"
                className="flex-1 bg-transparent px-3 py-2.5 text-[var(--text-1)] outline-none font-mono text-sm"
              />
              <span className="px-3 text-[var(--text-4)] text-sm font-mono border-l border-[var(--line)]">.app.fullsite.mx</span>
            </div>
          </label>
          <div className="rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-line)] p-3 text-[12px] text-[var(--text-2)] leading-relaxed">
            Al clonar se ejecuta <span className="font-mono">bootstrap_client.py</span> con el <span className="font-mono">RestaurantManifest</span>: crea el tenant en la BD compartida, mapea el subdominio, y siembra menú/staff/pagos. <b>Cero código, cero deploy nuevo.</b>
          </div>
          <button
            disabled={!name || !slug}
            className="w-full py-3 rounded-xl bg-[var(--accent)] text-[#04120c] font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Plus size={16} /> Clonar cliente
          </button>
        </div>
      </div>
    </div>
  )
}
