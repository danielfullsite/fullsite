'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sliders, ChefHat, Wine, Package, Check, MonitorSmartphone, Power, Plus, ShieldCheck } from 'lucide-react'

// Panel de config POS por-tenant (super-admin). Ver/editar los settings de cada
// restaurante sin SQL. v1: estaciones/KDS. Extensible a los demás pos.* settings.

type Client = { id: string; display_name?: string }
type Terminal = { device_id: string; label?: string; active: boolean; enrolled_at?: string; last_seen?: string }
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
  // Device binding
  const [requireEnrolled, setRequireEnrolled] = useState(false)
  const [terminals, setTerminals] = useState<Terminal[]>([])
  const [newDev, setNewDev] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([])
  const [newLocation, setNewLocation] = useState('')
  const [termBusy, setTermBusy] = useState(false)

  useEffect(() => {
    fetch('/api/platform/config', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { clients: [] })
      .then(j => setClients(Array.isArray(j.clients) ? j.clients : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Loaders declarados ANTES de loadTenant, que los invoca: el compilador de React marca
  // el acceso a un callback antes de su declaración.
  const loadTerminals = useCallback((cid: string) => {
    fetch(`/api/platform/terminals?clientId=${encodeURIComponent(cid)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => setTerminals(Array.isArray(j?.terminals) ? j.terminals : []))
      .catch(() => setTerminals([]))
  }, [])

  // Sucursales del cliente, para exigir una al enrolar (la API la valida server-side).
  const loadLocations = useCallback((cid: string) => {
    if (!cid) { setLocations([]); setNewLocation(''); return }
    fetch(`/api/platform/locations?clientId=${encodeURIComponent(cid)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        const list = Array.isArray(j?.locations) ? j.locations : []
        setLocations(list)
        setNewLocation(list[0]?.id || '')
      })
      .catch(() => { setLocations([]); setNewLocation('') })
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
        setRequireEnrolled(j?.pos_settings?.['pos.require_enrolled_terminal'] === true)
      })
      .catch(() => {})
      .finally(() => setLoadingTenant(false))
    loadTerminals(cid)
    loadLocations(cid)
  }, [loadTerminals, loadLocations])

  const saveRequire = async (next: boolean) => {
    setRequireEnrolled(next)
    await fetch('/api/platform/tenant-settings', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, key: 'pos.require_enrolled_terminal', value: next }),
    }).catch(() => {})
  }

  const enroll = async () => {
    const dev = newDev.trim()
    if (!clientId || !dev || !newLocation) return
    setTermBusy(true)
    try {
      const res = await fetch('/api/platform/terminals', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, device_id: dev, location_id: newLocation, label: newLabel.trim() || undefined }),
      })
      if (res.ok) { setNewDev(''); setNewLabel(''); loadTerminals(clientId) }
    } finally { setTermBusy(false) }
  }

  const toggleTerminal = async (device_id: string, active: boolean) => {
    setTerminals(prev => prev.map(t => t.device_id === device_id ? { ...t, active } : t))
    await fetch('/api/platform/terminals', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, device_id, active }),
    }).catch(() => {})
  }

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

      {/* Terminales autorizadas (device binding) */}
      {clientId && (
        <div className="rounded-2xl border p-5 mt-5" style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}>
          <div className="flex items-center gap-2 mb-1">
            <MonitorSmartphone size={18} style={{ color: 'var(--accent-ink)' }} />
            <h2 className="font-bold">Terminales autorizadas</h2>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
            Con esto activado, solo las terminales dadas de alta aquí pueden llegar al login por PIN.
            Un equipo desconocido con la liga ni ve el teclado.
          </p>

          {/* Toggle require */}
          <button
            onClick={() => saveRequire(!requireEnrolled)}
            className="w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 mb-4 min-h-[56px]"
            style={requireEnrolled
              ? { background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }
              : { background: 'var(--surface)', borderColor: 'var(--line)' }}
          >
            <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: requireEnrolled ? 'var(--accent-ink)' : 'var(--text-1)' }}>
              <ShieldCheck size={18} />
              Exigir terminal enrolada para entrar
            </span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full"
              style={requireEnrolled
                ? { background: 'var(--accent)', color: '#fff' }
                : { background: 'var(--line)', color: 'var(--text-3)' }}>
              {requireEnrolled ? 'ACTIVADO' : 'APAGADO'}
            </span>
          </button>

          {/* Enrolar nueva */}
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              value={newDev} onChange={e => setNewDev(e.target.value)}
              placeholder="ID de terminal (aparece en la pantalla del POS)"
              className="flex-1 min-w-[200px] rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
            />
            <select
              value={newLocation} onChange={e => setNewLocation(e.target.value)}
              disabled={locations.length === 0}
              className="w-44 rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
            >
              {locations.length === 0 && <option value="">— sin sucursales —</option>}
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <input
              value={newLabel} onChange={e => setNewLabel(e.target.value)}
              placeholder="Etiqueta (ej. Caja 1)"
              className="w-40 rounded-lg px-3 py-2.5 text-sm min-h-[44px]"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
            />
            <button
              onClick={enroll} disabled={termBusy || !newDev.trim() || !newLocation}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold min-h-[44px] inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <Plus size={16} /> Enrolar
            </button>
          </div>

          {/* Lista */}
          {terminals.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>Aún no hay terminales dadas de alta.</p>
          ) : (
            <div className="grid gap-2">
              {terminals.map(t => (
                <div key={t.device_id} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{t.label || t.device_id}</div>
                    <div className="text-xs font-mono truncate" style={{ color: 'var(--text-3)' }}>{t.device_id}</div>
                  </div>
                  <button
                    onClick={() => toggleTerminal(t.device_id, !t.active)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full min-h-[36px]"
                    style={t.active
                      ? { background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: '1px solid var(--accent-line)' }
                      : { background: 'var(--line)', color: 'var(--text-3)' }}
                  >
                    <Power size={13} /> {t.active ? 'Activa' : 'Inactiva'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
