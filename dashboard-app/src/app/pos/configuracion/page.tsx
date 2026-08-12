'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Printer, Users, Tag, Wifi, WifiOff, Settings, Shield,
  RefreshCw, CheckCircle, XCircle, AlertCircle, Monitor, Smartphone, RotateCcw,
} from 'lucide-react'
import { getActiveClientSlug as _cid } from '@/lib/data'
import { getBridgeUrl, setBridgeUrl, DEFAULT_BRIDGE_URL } from '@/lib/bridge-url'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }


interface PrinterStatus {
  station: string
  ip: string
  online: boolean
  lastCheck: string
}

// Estación → tinte estable (mapeo DS v2.1, no es el acento)
const STATION_TINT: Record<string, { bg: string; fg: string }> = {
  cocina:     { bg: 'var(--warn-soft)', fg: 'var(--st-cocina)' },
  barra:      { bg: 'color-mix(in srgb, var(--st-barra) 13%, transparent)', fg: 'var(--st-barra)' },
  caja:       { bg: 'color-mix(in srgb, var(--st-caja) 13%, transparent)',  fg: 'var(--st-caja)' },
  panaderia:  { bg: 'color-mix(in srgb, var(--st-pan) 13%, transparent)',   fg: 'var(--st-pan)' },
  'panadería':{ bg: 'color-mix(in srgb, var(--st-pan) 13%, transparent)',   fg: 'var(--st-pan)' },
  pan:        { bg: 'color-mix(in srgb, var(--st-pan) 13%, transparent)',   fg: 'var(--st-pan)' },
}
function stationTint(name: string) {
  const key = name.trim().toLowerCase()
  return STATION_TINT[key] || { bg: 'var(--accent-soft)', fg: 'var(--accent-ink)' }
}

// Tokens de estación DS v2.1 (no viven en globals — scoped a esta página)
const CONFIG_TOKENS = `
  .cfg-scope{ --st-cocina:#f5a524; --st-barra:#a78bfa; --st-pan:#fb923c; --st-caja:#22d3ee; }
  [data-theme="light"] .cfg-scope{ --st-cocina:#c2740a; --st-barra:#7c3aed; --st-pan:#c2410c; --st-caja:#0891b2; }
`

export default function ConfigPage() {
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null)
  const [bridgeStations, setBridgeStations] = useState<string[]>([])
  const [bridgeUptime, setBridgeUptime] = useState(0)
  const [staff, setStaff] = useState<{ id: string; name: string; role: string; active: boolean }[]>([])
  const [promos, setPromos] = useState<{ id: string; name: string; type: string; active: boolean }[]>([])
  const [deviceInfo, setDeviceInfo] = useState({ width: 0, height: 0, userAgent: '', online: true, pwa: false })
  const [syncStatus, setSyncStatus] = useState({ pending: 0, lastSync: '' })
  const [terminalInfo, setTerminalInfo] = useState({ restaurantId: '', terminalId: '', isElectron: false })
  const [reprovisionState, setReprovisionState] = useState<'idle' | 'confirm' | 'done'>('idle')
  const [loading, setLoading] = useState(true)
  const [bridgeUrlInput, setBridgeUrlInput] = useState('')
  const [bridgeUrlSaved, setBridgeUrlSaved] = useState(false)

  useEffect(() => {
    // Device info
    setDeviceInfo({
      width: window.innerWidth,
      height: window.innerHeight,
      userAgent: navigator.userAgent.slice(0, 80),
      online: navigator.onLine,
      pwa: window.matchMedia('(display-mode: standalone)').matches,
    })

    // Bridge URL config (secondary terminals set this to Caja's LAN IP)
    setBridgeUrlInput(getBridgeUrl())

    // Bridge health
    fetch(`${getBridgeUrl()}/health`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.json())
      .then(d => {
        setBridgeOnline(true)
        setBridgeStations(d.stations || [])
        setBridgeUptime(d.uptime || 0)
      })
      .catch(() => setBridgeOnline(false))

    // Staff
    fetch(`${SUPABASE_URL}/rest/v1/pos_staff?client_id=eq.${_cid()}&select=id,name,role,active&order=role`, { headers: SB })
      .then(r => r.json()).then(setStaff).catch(() => {})

    // Promos
    fetch(`${SUPABASE_URL}/rest/v1/pos_promotions?client_id=eq.${_cid()}&select=id,name,type,active`, { headers: SB })
      .then(r => r.json()).then(setPromos).catch(() => {})

    // Sync status
    try {
      const pending = JSON.parse(localStorage.getItem('pos_offline_queue') || '[]')
      const lastSync = localStorage.getItem('pos_last_sync') || ''
      setSyncStatus({ pending: pending.length, lastSync })
    } catch { /* */ }

    // Terminal identity (injected by Electron main on boot)
    setTerminalInfo({
      restaurantId: localStorage.getItem('fullsite_client_id') || '',
      terminalId:   localStorage.getItem('pos_terminal_id') || '',
      isElectron:   !!(window as unknown as Record<string, unknown>).fullsiteApp,
    })

    setLoading(false)
  }, [])

  const activeStaff = staff.filter(s => s.active)
  const roles = activeStaff.reduce<Record<string, number>>((acc, s) => {
    acc[s.role] = (acc[s.role] || 0) + 1
    return acc
  }, {})

  const StatusBadge = ({ ok, label }: { ok: boolean | null; label: string }) => (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border"
      style={
        ok === null
          ? { color: 'var(--text-3)', borderColor: 'var(--line)', background: 'var(--surface-2)' }
          : ok
            ? { color: 'var(--accent-ink)', borderColor: 'var(--accent-line)', background: 'var(--accent-soft)' }
            : { color: 'var(--crit-ink)', borderColor: 'color-mix(in srgb, var(--crit) 40%, transparent)', background: 'var(--crit-soft)' }
      }
    >
      {ok === null
        ? <AlertCircle size={12} />
        : ok
          ? <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent-ink)' }} />
          : <XCircle size={12} />}
      {label}
    </span>
  )

  return (
    <div className="cfg-scope h-dvh flex flex-col overflow-y-auto" style={{ background: 'var(--bg)', color: 'var(--text-1)' }}>
      <style dangerouslySetInnerHTML={{ __html: CONFIG_TOKENS }} />
      {/* Header */}
      <header
        className="flex items-center gap-4 px-6 py-3 border-b flex-shrink-0"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <Link
          href="/pos"
          className="w-11 h-11 rounded-lg flex items-center justify-center transition-colors"
          style={{ background: 'var(--surface-2)', color: 'var(--text-1)', border: '1px solid var(--line)' }}
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <Settings size={24} style={{ color: 'var(--accent-ink)' }} />
          <h1 className="text-xl font-bold tracking-tight">Configuración</h1>
        </div>
        <div className="flex-1" />
        <StatusBadge ok={deviceInfo.online} label={deviceInfo.online ? 'Online' : 'Offline'} />
      </header>

      <div className="flex-1 p-6 space-y-6 max-w-5xl mx-auto w-full">

        {/* Print Bridge */}
        <section
          className="rounded-2xl border p-6"
          style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Printer size={20} style={{ color: 'var(--accent-ink)' }} /> Print Bridge</h2>
            <StatusBadge ok={bridgeOnline} label={bridgeOnline ? `Online (${Math.floor(bridgeUptime / 60)}min)` : bridgeOnline === false ? 'Offline' : 'Verificando...'} />
          </div>
          {bridgeOnline ? (
            <>
              <p className="text-sm mb-3" style={{ color: 'var(--text-2)' }}>Conectado en <span className="font-mono" style={{ color: 'var(--text-1)' }}>{getBridgeUrl()}</span> — <b style={{ color: 'var(--text-1)' }}>{bridgeStations.length} estación(es)</b>.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {bridgeStations.map(s => {
                  const t = stationTint(s)
                  return (
                    <div key={s} className="rounded-xl p-4 text-center border" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
                      <span className="mx-auto mb-2 w-[34px] h-[34px] rounded-[10px] grid place-items-center" style={{ background: t.bg, color: t.fg }}>
                        <Printer size={18} />
                      </span>
                      <p className="text-sm font-bold capitalize mt-2" style={{ color: 'var(--text-1)' }}>{s}</p>
                      <p className="text-[11px] mt-1 inline-flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-ink)' }} />Conectada
                      </p>
                    </div>
                  )
                })}
              </div>
            </>
          ) : bridgeOnline === false ? (
            <div className="rounded-xl p-4 border" style={{ background: 'var(--crit-soft)', borderColor: 'color-mix(in srgb, var(--crit) 30%, transparent)' }}>
              <p className="text-sm font-bold" style={{ color: 'var(--crit-ink)' }}>Bridge no detectado en <span className="font-mono">{getBridgeUrl()}</span></p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Terminal Caja: asegurate de que fullsite-print-bridge.exe esté corriendo. Terminal secundaria: configura la URL del bridge abajo.</p>
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>Verificando conexión...</p>
          )}

          {/* Bridge URL — configurable per terminal for PDV1/PDV2/PDV3 */}
          <hr className="my-4 border-0 border-t" style={{ borderColor: 'var(--line)' }} />
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'var(--text-3)' }}>URL del Bridge</label>
            <div className="flex gap-2.5 flex-wrap">
              <input
                type="text"
                value={bridgeUrlInput}
                onChange={e => { setBridgeUrlInput(e.target.value); setBridgeUrlSaved(false) }}
                placeholder={DEFAULT_BRIDGE_URL}
                aria-label="URL del Bridge"
                className="flex-1 min-w-[230px] rounded-[11px] px-3 py-2.5 text-sm font-mono focus:outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
              />
              <button
                onClick={() => {
                  setBridgeUrl(bridgeUrlInput)
                  setBridgeUrlSaved(true)
                  setTimeout(() => setBridgeUrlSaved(false), 2000)
                }}
                className="px-4 rounded-xl text-sm font-semibold whitespace-nowrap transition-[filter] min-h-[44px] hover:brightness-105"
                style={{
                  background: 'linear-gradient(150deg, var(--accent-bright), var(--accent-deep))',
                  color: '#04140d',
                  boxShadow: '0 1px 0 rgba(255,255,255,.18) inset, 0 10px 22px -8px var(--accent)',
                }}
              >
                {bridgeUrlSaved ? 'Guardado' : 'Guardar'}
              </button>
            </div>
            <p className="text-[11.5px] mt-2" style={{ color: 'var(--text-4)' }}>PDV1-3: usar IP de Caja, ej. <span className="font-mono" style={{ color: 'var(--text-3)' }}>http://192.168.1.71:7717</span>. Caja: dejar vacío.</p>
          </div>
        </section>

        {/* Staff */}
        <section
          className="rounded-2xl border p-6"
          style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Users size={20} style={{ color: 'var(--accent-ink)' }} /> Staff</h2>
            <span className="text-sm" style={{ color: 'var(--text-3)' }}>{activeStaff.length} activos</span>
          </div>
          <div className="flex gap-2 flex-wrap mb-4">
            {Object.entries(roles).map(([role, count]) => (
              <span key={role} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs border" style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}>
                <span className="font-bold" style={{ color: 'var(--text-1)' }}>{count}</span> <span className="capitalize">{role}</span>
              </span>
            ))}
          </div>
          <div className="max-h-48 overflow-y-auto rounded-[14px] border overflow-hidden" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
            {activeStaff.map(s => (
              <div key={s.id} className="flex items-center justify-between py-2.5 px-3 text-sm border-b last:border-b-0 transition-colors hover:bg-[var(--surface-2)]" style={{ borderColor: 'var(--line-soft)' }}>
                <span style={{ color: 'var(--text-1)' }}>{s.name}</span>
                <span className="text-xs capitalize" style={{ color: 'var(--text-3)' }}>{s.role}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Promos */}
        <section
          className="rounded-2xl border p-6"
          style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Tag size={20} style={{ color: 'var(--accent-ink)' }} /> Promociones</h2>
            <span className="text-sm" style={{ color: 'var(--text-3)' }}>{promos.filter(p => p.active).length} activas</span>
          </div>
          {promos.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>Sin promociones configuradas. Crealas en /admin/promociones</p>
          ) : (
            <div className="rounded-[14px] border overflow-hidden" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
              {promos.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2.5 px-3 border-b last:border-b-0" style={{ borderColor: 'var(--line-soft)' }}>
                  <div>
                    <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{p.name}</span>
                    <span className="text-xs ml-2 capitalize" style={{ color: 'var(--text-3)' }}>{p.type}</span>
                  </div>
                  <StatusBadge ok={p.active} label={p.active ? 'Activa' : 'Inactiva'} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Device & System */}
        <section
          className="rounded-2xl border p-6"
          style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Monitor size={20} style={{ color: 'var(--accent-ink)' }} /> Dispositivo</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl p-3.5 border" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
              <p className="text-[9.5px] uppercase tracking-[0.1em] font-mono" style={{ color: 'var(--text-4)' }}>Resolución</p>
              <p className="text-[19px] font-bold mt-1.5 tnum" style={{ color: 'var(--text-1)' }}>{deviceInfo.width} × {deviceInfo.height}</p>
            </div>
            <div className="rounded-xl p-3.5 border" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
              <p className="text-[9.5px] uppercase tracking-[0.1em] font-mono" style={{ color: 'var(--text-4)' }}>Modo</p>
              <p className="text-[19px] font-bold mt-1.5" style={{ color: 'var(--text-1)' }}>{deviceInfo.pwa ? 'PWA' : 'Browser'}</p>
            </div>
            <div className="rounded-xl p-3.5 border" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
              <p className="text-[9.5px] uppercase tracking-[0.1em] font-mono" style={{ color: 'var(--text-4)' }}>Conexión</p>
              <p className="text-[15px] font-bold mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}>
                {deviceInfo.online ? <Wifi size={16} style={{ color: 'var(--accent-ink)' }} /> : <WifiOff size={16} style={{ color: 'var(--crit-ink)' }} />}
                {deviceInfo.online ? 'Online' : 'Offline'}
              </p>
            </div>
            <div className="rounded-xl p-3.5 border" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
              <p className="text-[9.5px] uppercase tracking-[0.1em] font-mono" style={{ color: 'var(--text-4)' }}>Sync pendiente</p>
              <p className="text-[19px] font-bold mt-1.5 tnum" style={{ color: 'var(--text-1)' }}>{syncStatus.pending}</p>
            </div>
          </div>
          <p className="text-[11.5px] mt-3 truncate font-mono" style={{ color: 'var(--text-4)' }}>{deviceInfo.userAgent}</p>
        </section>

        {/* Security */}
        <section
          className="rounded-2xl border p-6"
          style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Shield size={20} style={{ color: 'var(--accent-ink)' }} /> Seguridad</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 gap-x-[18px]">
            {[
              'HTTPS (TLS 1.3)',
              'RLS (Row Level Security)',
              'PIN por empleado',
              'Audit trail inmutable',
              'Bridge localhost-only',
              'Cloud backup auto',
            ].map(item => (
              <div key={item} className="flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--text-2)' }}>
                <span className="w-[18px] h-[18px] rounded-md grid place-items-center flex-none mt-px" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}>
                  <CheckCircle size={11} />
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Terminal identity + reprovisioning */}
        {terminalInfo.isElectron && (
          <section
            className="rounded-2xl border p-6"
            style={{ background: 'var(--bento-card)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-mid)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <RotateCcw size={20} style={{ color: 'var(--accent-ink)' }} /> Terminal
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="rounded-xl p-3.5 border" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
                <p className="text-[9.5px] uppercase tracking-[0.1em] font-mono mb-1" style={{ color: 'var(--text-4)' }}>Restaurant ID</p>
                <p className="text-sm font-mono font-bold truncate" style={{ color: 'var(--text-1)' }}>{terminalInfo.restaurantId || '—'}</p>
              </div>
              <div className="rounded-xl p-3.5 border" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
                <p className="text-[9.5px] uppercase tracking-[0.1em] font-mono mb-1" style={{ color: 'var(--text-4)' }}>Terminal ID</p>
                <p className="text-sm font-mono font-bold truncate" style={{ color: 'var(--text-1)' }}>{terminalInfo.terminalId || '—'}</p>
              </div>
            </div>
            {reprovisionState === 'idle' && (
              <button
                onClick={() => setReprovisionState('confirm')}
                className="w-full py-2.5 rounded-xl border text-sm font-semibold transition-colors"
                style={{ borderColor: 'color-mix(in srgb, var(--crit) 30%, transparent)', color: 'var(--crit-ink)' }}
              >
                Reprovisionar terminal...
              </button>
            )}
            {reprovisionState === 'confirm' && (
              <div className="rounded-xl p-4 border" style={{ background: 'var(--crit-soft)', borderColor: 'color-mix(in srgb, var(--crit) 30%, transparent)' }}>
                <p className="text-sm font-bold mb-1" style={{ color: 'var(--crit-ink)' }}>Confirmar reprovisioning</p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>La configuracion actual se guardara como respaldo. La aplicacion se reiniciara y mostrara el asistente de configuracion.</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setReprovisionState('idle')}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-colors"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--line)' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={async () => {
                      setReprovisionState('done')
                      const api = (window as unknown as Record<string, { startProvisioning?: () => Promise<unknown> }>).fullsiteApp
                      await api?.startProvisioning?.()
                    }}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold transition-[filter] hover:brightness-105"
                    style={{ background: 'var(--crit)', color: '#fff' }}
                  >
                    Reprovisionar
                  </button>
                </div>
              </div>
            )}
            {reprovisionState === 'done' && (
              <p className="text-sm text-center py-2" style={{ color: 'var(--text-3)' }}>Reiniciando...</p>
            )}
          </section>
        )}

      </div>
    </div>
  )
}
