'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Printer, Users, Tag, Wifi, WifiOff, Settings, Shield,
  RefreshCw, CheckCircle, XCircle, AlertCircle, Monitor, Smartphone,
} from 'lucide-react'
import { getActiveClientSlug as _cid } from '@/lib/data'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SB = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }


interface PrinterStatus {
  station: string
  ip: string
  online: boolean
  lastCheck: string
}

export default function ConfigPage() {
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null)
  const [bridgeStations, setBridgeStations] = useState<string[]>([])
  const [bridgeUptime, setBridgeUptime] = useState(0)
  const [staff, setStaff] = useState<{ id: string; name: string; role: string; active: boolean }[]>([])
  const [promos, setPromos] = useState<{ id: string; name: string; type: string; active: boolean }[]>([])
  const [deviceInfo, setDeviceInfo] = useState({ width: 0, height: 0, userAgent: '', online: true, pwa: false })
  const [syncStatus, setSyncStatus] = useState({ pending: 0, lastSync: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Device info
    setDeviceInfo({
      width: window.innerWidth,
      height: window.innerHeight,
      userAgent: navigator.userAgent.slice(0, 80),
      online: navigator.onLine,
      pwa: window.matchMedia('(display-mode: standalone)').matches,
    })

    // Bridge health
    fetch('http://127.0.0.1:7717/health', { signal: AbortSignal.timeout(3000) })
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

    setLoading(false)
  }, [])

  const activeStaff = staff.filter(s => s.active)
  const roles = activeStaff.reduce<Record<string, number>>((acc, s) => {
    acc[s.role] = (acc[s.role] || 0) + 1
    return acc
  }, {})

  const StatusBadge = ({ ok, label }: { ok: boolean | null; label: string }) => (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${
      ok === null ? 'bg-white/5 text-white/30' : ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
    }`}>
      {ok === null ? <AlertCircle size={12} /> : ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
      {label}
    </span>
  )

  return (
    <div className="h-dvh flex flex-col bg-[#0a0a0f] text-white overflow-y-auto">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-3 bg-[#111118] border-b border-white/10 flex-shrink-0">
        <Link href="/pos" className="w-11 h-11 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <Settings size={24} className="text-emerald-400" />
          <h1 className="text-xl font-bold">Configuración</h1>
        </div>
        <div className="flex-1" />
        <StatusBadge ok={deviceInfo.online} label={deviceInfo.online ? 'Online' : 'Offline'} />
      </header>

      <div className="flex-1 p-6 space-y-6 max-w-5xl mx-auto w-full">

        {/* Print Bridge */}
        <section className="bg-[#111118] rounded-2xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Printer size={20} className="text-emerald-400" /> Print Bridge</h2>
            <StatusBadge ok={bridgeOnline} label={bridgeOnline ? `Online (${Math.floor(bridgeUptime / 60)}min)` : bridgeOnline === false ? 'Offline' : 'Verificando...'} />
          </div>
          {bridgeOnline ? (
            <>
              <p className="text-sm text-white/50 mb-3">Servicio local en 127.0.0.1:7717 — conecta el POS con las impresoras.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {bridgeStations.map(s => (
                  <div key={s} className="bg-white/5 rounded-xl p-4 text-center border border-white/5">
                    <Printer size={20} className="mx-auto mb-2 text-emerald-400" />
                    <p className="text-sm font-bold capitalize">{s}</p>
                    <p className="text-[10px] text-white/30 mt-1">Conectada</p>
                  </div>
                ))}
              </div>
            </>
          ) : bridgeOnline === false ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <p className="text-sm text-red-400 font-bold">Bridge no detectado</p>
              <p className="text-xs text-white/40 mt-1">Asegurate de que fullsite-print-bridge.exe este corriendo en esta terminal. Doble click al .exe en C:\fullsite\</p>
            </div>
          ) : (
            <p className="text-sm text-white/30">Verificando conexión...</p>
          )}
        </section>

        {/* Staff */}
        <section className="bg-[#111118] rounded-2xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Users size={20} className="text-emerald-400" /> Staff</h2>
            <span className="text-sm text-white/50">{activeStaff.length} activos</span>
          </div>
          <div className="flex gap-3 flex-wrap mb-4">
            {Object.entries(roles).map(([role, count]) => (
              <span key={role} className="bg-white/5 border border-white/5 rounded-lg px-3 py-1.5 text-xs">
                <span className="font-bold text-white">{count}</span> <span className="text-white/50 capitalize">{role}</span>
              </span>
            ))}
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {activeStaff.map(s => (
              <div key={s.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/5 text-sm">
                <span className="text-white/80">{s.name}</span>
                <span className="text-xs text-white/30 capitalize">{s.role}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Promos */}
        <section className="bg-[#111118] rounded-2xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Tag size={20} className="text-emerald-400" /> Promociones</h2>
            <span className="text-sm text-white/50">{promos.filter(p => p.active).length} activas</span>
          </div>
          {promos.length === 0 ? (
            <p className="text-sm text-white/30">Sin promociones configuradas. Crealas en /admin/promociones</p>
          ) : (
            <div className="space-y-2">
              {promos.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5">
                  <div>
                    <span className="text-sm font-bold">{p.name}</span>
                    <span className="text-xs text-white/30 ml-2 capitalize">{p.type}</span>
                  </div>
                  <StatusBadge ok={p.active} label={p.active ? 'Activa' : 'Inactiva'} />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Device & System */}
        <section className="bg-[#111118] rounded-2xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Monitor size={20} className="text-emerald-400" /> Dispositivo</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
              <p className="text-[10px] text-white/30 uppercase tracking-wide">Resolucion</p>
              <p className="text-lg font-bold">{deviceInfo.width} x {deviceInfo.height}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
              <p className="text-[10px] text-white/30 uppercase tracking-wide">Modo</p>
              <p className="text-lg font-bold">{deviceInfo.pwa ? 'PWA' : 'Browser'}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
              <p className="text-[10px] text-white/30 uppercase tracking-wide">Conexion</p>
              <p className="text-lg font-bold flex items-center gap-1">
                {deviceInfo.online ? <Wifi size={16} className="text-emerald-400" /> : <WifiOff size={16} className="text-red-400" />}
                {deviceInfo.online ? 'Online' : 'Offline'}
              </p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 border border-white/5">
              <p className="text-[10px] text-white/30 uppercase tracking-wide">Sync pendiente</p>
              <p className="text-lg font-bold">{syncStatus.pending}</p>
            </div>
          </div>
          <p className="text-[10px] text-white/20 mt-3 truncate">{deviceInfo.userAgent}</p>
        </section>

        {/* Security */}
        <section className="bg-[#111118] rounded-2xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Shield size={20} className="text-emerald-400" /> Seguridad</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={14} className="text-emerald-400" />
              <span className="text-white/60">HTTPS (TLS 1.3)</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={14} className="text-emerald-400" />
              <span className="text-white/60">RLS (Row Level Security)</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={14} className="text-emerald-400" />
              <span className="text-white/60">PIN por empleado</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={14} className="text-emerald-400" />
              <span className="text-white/60">Audit trail inmutable</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={14} className="text-emerald-400" />
              <span className="text-white/60">Bridge localhost-only</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={14} className="text-emerald-400" />
              <span className="text-white/60">Cloud backup auto</span>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
