'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sliders, ChefHat, Wine, Package, Check } from 'lucide-react'

// Panel de config POS por-tenant (super-admin). Ver/editar los settings de cada
// restaurante sin SQL. v1: estaciones/KDS. Extensible a los demás pos.* settings.

type Client = { id: string; display_name?: string }
const STATIONS: { key: 'cocina' | 'barra' | 'caja'; label: string; icon: typeof ChefHat }[] = [
  { key: 'cocina', label: 'Cocina', icon: ChefHat },
  { key: 'barra', label: 'Barra', icon: Wine },
  { key: 'caja', label: 'Market / Caja', icon: Package },
]

export default function PlatformConfigPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [clientId, setClientId] = useState('')
  const [kdsStations, setKdsStations] = useState<string[]>(['cocina', 'barra', 'caja'])
  const [loading, setLoading] = useState(true)
  const [loadingTenant, setLoadingTenant] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/platform/config', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { clients: [] })
      .then(j => setClients(Array.isArray(j.clients) ? j.clients : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const loadTenant = useCallback((cid: string) => {
    setClientId(cid)
    if (!cid) return
    setLoadingTenant(true)
    fetch(`/api/platform/tenant-settings?clientId=${encodeURIComponent(cid)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        const s = j?.pos_settings?.['pos.kds_stations']
        setKdsStations(Array.isArray(s) && s.length > 0 ? s : ['cocina', 'barra', 'caja'])
      })
      .catch(() => {})
      .finally(() => setLoadingTenant(false))
  }, [])

  const toggleStation = (k: string) => {
    setKdsStations(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
  }

  const save = async () => {
    if (!clientId || kdsStations.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/platform/tenant-settings', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, key: 'pos.kds_stations', value: kdsStations }),
      })
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1800) }
    } finally { setBusy(false) }
  }

  return (
    <div className="h-dvh overflow-y-auto p-6 max-w-3xl mx-auto w-full" style={{ color: 'var(--text-1)' }}>
      <div className="flex items-center gap-3 mb-1">
        <Sliders size={24} style={{ color: 'var(--accent-ink)' }} />
        <h1 className="text-2xl font-bold">Config de restaurante</h1>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--text-3)' }}>
        Configura qué tiene cada cliente en su POS — sin SQL. Empieza por las pantallas KDS.
      </p>

      {/* Selector de tenant */}
      <div className="rounded-2xl border p-5 mb-5" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
        <label className="text-xs font-semibold uppercase tracking-wide block mb-2" style={{ color: 'var(--text-3)' }}>Cliente</label>
        <select
          value={clientId}
          onChange={e => loadTenant(e.target.value)}
          className="w-full rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
        >
          <option value="">{loading ? 'Cargando…' : 'Selecciona un restaurante…'}</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.display_name || c.id}</option>)}
        </select>
      </div>

      {/* Config de estaciones/KDS */}
      {clientId && (
        <div className="rounded-2xl border p-5" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
          <h2 className="font-bold mb-1">Pantallas KDS</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
            Qué pantallas de cocina tiene este restaurante. Las estaciones sin pantalla no
            aparecen en el POS; sus comandas siguen imprimiéndose. (AMALAY = solo Cocina.)
          </p>
          {loadingTenant ? (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>Cargando…</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                {STATIONS.map(s => {
                  const on = kdsStations.includes(s.key)
                  return (
                    <button
                      key={s.key}
                      onClick={() => toggleStation(s.key)}
                      className="flex flex-col items-center gap-2 rounded-xl border px-3 py-4 min-h-[88px] transition-colors"
                      style={on
                        ? { background: 'var(--accent-soft)', borderColor: 'var(--accent-line)', color: 'var(--accent-ink)' }
                        : { background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--text-3)' }}
                    >
                      <s.icon size={22} />
                      <span className="text-sm font-semibold">{s.label}</span>
                      {on && <Check size={14} />}
                    </button>
                  )
                })}
              </div>
              {kdsStations.length === 0 && (
                <p className="text-xs mb-3" style={{ color: 'var(--crit-ink)' }}>Debe haber al menos una pantalla.</p>
              )}
              <button
                onClick={save}
                disabled={busy || kdsStations.length === 0}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold min-h-[44px] disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {busy ? 'Guardando…' : saved ? '✓ Guardado' : 'Guardar'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
