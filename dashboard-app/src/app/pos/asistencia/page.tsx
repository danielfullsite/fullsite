'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, LogIn, LogOut, Clock, User, Fingerprint } from 'lucide-react'
import { apiUrl } from '@/lib/api-base'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SB_HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

interface AttendanceRecord {
  id: string
  staff_id: string
  staff_name: string
  type: 'entrada' | 'salida'
  registered_at: string
  method: string
}

interface StaffMember {
  id: string
  name: string
  role: string
}

export default function AsistenciaPage() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [staff, setStaff] = useState<StaffMember | null>(null)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([])
  const [lastAction, setLastAction] = useState<'entrada' | 'salida' | null>(null)
  const [success, setSuccess] = useState('')
  const [clock, setClock] = useState('')
  const authMethodRef = useRef<'pin' | 'huella'>('pin')

  // Live clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    tick()
    const i = setInterval(tick, 1000)
    return () => clearInterval(i)
  }, [])

  // Load today's records
  const loadToday = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/pos_attendance?client_id=eq.${_cid()}&registered_at=gte.${today}T00:00:00&order=registered_at.desc`,
      { headers: SB_HEADERS },
    )
    if (res.ok) setTodayRecords(await res.json())
  }, [])

  useEffect(() => { loadToday() }, [loadToday])

  // Verify PIN and show staff + history
  const handlePin = async () => {
    if (pin.length < 4 || checking) return
    setChecking(true)
    setError('')
    authMethodRef.current = 'pin'
    setStaff(null)
    setLastAction(null)

    try {
      const res = await fetch(apiUrl('/api/pos/pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, client_id: _cid() }),
      })
      if (!res.ok) { setError('PIN incorrecto'); setPin(''); setChecking(false); return }
      const { staff: member } = await res.json()
      if (!member?.id) { setError('PIN incorrecto'); setPin(''); setChecking(false); return }

      setStaff(member)

      // Load this person's recent records
      const histRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_attendance?client_id=eq.${_cid()}&staff_id=eq.${encodeURIComponent(member.id)}&order=registered_at.desc&limit=14`,
        { headers: SB_HEADERS },
      )
      if (histRes.ok) {
        const hist = await histRes.json()
        setRecords(hist)
        // Determine last action
        if (hist.length > 0) setLastAction(hist[0].type)
      }
    } catch {
      setError('Error de conexión')
    }
    setChecking(false)
  }

  // Register entrada or salida — with server-side sequence enforcement
  const handleRegister = async (type: 'entrada' | 'salida') => {
    if (!staff) return

    // REPAIR 1: Enforce valid attendance sequence before writing.
    // Query the most recent attendance event for this exact staff_id.
    try {
      const latestRes = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_attendance?client_id=eq.${_cid()}&staff_id=eq.${encodeURIComponent(staff.id)}&order=registered_at.desc&limit=1`,
        { headers: SB_HEADERS },
      )
      if (latestRes.ok) {
        const latestRows = await latestRes.json()
        const latestType = latestRows.length > 0 ? latestRows[0].type : null

        if (type === 'entrada' && latestType === 'entrada') {
          setError('Ya tienes una entrada activa. Registra tu salida antes de volver a entrar.')
          return
        }
        if (type === 'salida' && (latestType === 'salida' || latestType === null)) {
          setError('No hay una entrada activa para registrar salida.')
          return
        }
      }
    } catch {
      // Network error during validation — reject to be safe
      setError('Error de conexión al validar asistencia')
      return
    }

    const row = {
      client_id: _cid(),
      staff_id: staff.id,
      staff_name: staff.name,
      type,
      method: authMethodRef.current,
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_attendance`, {
      method: 'POST',
      headers: { ...SB_HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    if (res.ok) {
      const [newRec] = await res.json()
      setRecords(prev => [newRec, ...prev])
      setLastAction(type)
      setSuccess(`${type === 'entrada' ? 'Entrada' : 'Salida'} registrada — ${staff.name}`)
      setTimeout(() => {
        setSuccess('')
        setStaff(null)
        setPin('')
        setRecords([])
        setLastAction(null)
        loadToday()
      }, 3000)
    }
  }

  // Reset after timeout
  useEffect(() => {
    if (!staff) return
    const t = setTimeout(() => {
      setStaff(null)
      setPin('')
      setRecords([])
      setLastAction(null)
    }, 30000) // 30s timeout
    return () => clearTimeout(t)
  }, [staff])

  // Biometric auth for attendance
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricChecking, setBiometricChecking] = useState(false)

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      if (Object.keys(stored).length > 0 && window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          .then(ok => setBiometricAvailable(ok))
          .catch(() => {})
      }
    } catch {}
  }, [])

  const handleBiometric = async () => {
    setBiometricChecking(true)
    setError('')
    authMethodRef.current = 'huella'
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      const credIds = Object.keys(stored)
      if (credIds.length === 0) { setError('No hay huellas registradas'); setBiometricChecking(false); return }

      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          allowCredentials: credIds.map(id => ({
            id: Uint8Array.from(atob(id), c => c.charCodeAt(0)),
            type: 'public-key' as const,
          })),
          userVerification: 'required',
          timeout: 30000,
        },
      })
      if (assertion) {
        const credId = btoa(String.fromCharCode(...new Uint8Array((assertion as PublicKeyCredential).rawId)))
        const member = stored[credId] as StaffMember | undefined
        if (member?.id) {
          setStaff(member)
          // Load history
          const histRes = await fetch(
            `${SUPABASE_URL}/rest/v1/pos_attendance?client_id=eq.${_cid()}&staff_id=eq.${encodeURIComponent(member.id)}&order=registered_at.desc&limit=14`,
            { headers: SB_HEADERS },
          )
          if (histRes.ok) {
            const hist = await histRes.json()
            setRecords(hist)
            if (hist.length > 0) setLastAction(hist[0].type)
          }
        }
      }
    } catch {
      setError('Huella no reconocida')
    }
    setBiometricChecking(false)
  }

  const today = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  // REPAIR 2+3: Derive attendance state per staff using staff_id (UUID), not staff_name.
  // Detects STALE_ENTRADA (open entrada > 18 hours) for manager visibility.
  const STALE_HOURS = 18
  const todayByStaff = todayRecords.reduce<Record<string, { name: string; staffId: string; entrada?: string; salida?: string; status: 'ACTIVE_ON_SHIFT' | 'STALE_ENTRADA' | 'NOT_ON_SHIFT' }>>((acc, r) => {
    if (!acc[r.staff_id]) acc[r.staff_id] = { name: r.staff_name, staffId: r.staff_id, status: 'NOT_ON_SHIFT' }
    // Process chronologically (records are desc, but we overwrite to get latest state)
    if (r.type === 'entrada') {
      if (!acc[r.staff_id].entrada) acc[r.staff_id].entrada = r.registered_at
      // Only set active if no salida recorded after this entrada
      if (!acc[r.staff_id].salida) {
        const hoursOpen = (Date.now() - new Date(r.registered_at).getTime()) / 3600000
        acc[r.staff_id].status = hoursOpen >= STALE_HOURS ? 'STALE_ENTRADA' : 'ACTIVE_ON_SHIFT'
      }
    }
    if (r.type === 'salida') {
      if (!acc[r.staff_id].salida) acc[r.staff_id].salida = r.registered_at
      acc[r.staff_id].status = 'NOT_ON_SHIFT'
    }
    return acc
  }, {})

  return (
    <div className="h-dvh flex flex-col bg-[#0a0a0f] text-white overflow-hidden select-none">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-3 bg-[#111118] border-b border-white/10 flex-shrink-0">
        <Link href="/pos" className="w-11 h-11 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <Fingerprint size={24} className="text-emerald-400" />
          <h1 className="text-xl font-bold">Registro de Asistencia</h1>
        </div>
        <div className="flex-1" />
        <div className="text-right">
          <p className="text-3xl font-mono font-bold text-emerald-400">{clock}</p>
          <p className="text-xs text-white/50 capitalize">{today}</p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left — PIN entry + staff action */}
        <div className="w-1/2 flex flex-col items-center justify-center p-8 border-r border-white/10">
          {success ? (
            <div className="text-center animate-pulse">
              <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                {lastAction === 'entrada' ? <LogIn size={48} className="text-emerald-400" /> : <LogOut size={48} className="text-amber-400" />}
              </div>
              <p className="text-2xl font-bold text-emerald-400">{success}</p>
              <p className="text-lg text-white/60 mt-2">{new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          ) : !staff ? (
            <div className="text-center w-full max-w-xs">
              <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-6">
                <Fingerprint size={40} className="text-white/40" />
              </div>
              <p className="text-white/60 text-sm mb-6">
                {biometricAvailable ? 'Pon tu huella o ingresa tu PIN' : 'Ingresa tu PIN para registrar asistencia'}
              </p>

              {biometricAvailable && (
                <button
                  onClick={handleBiometric}
                  disabled={biometricChecking}
                  className="w-full py-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.97] disabled:bg-emerald-800 text-white font-bold text-xl transition-all min-h-[80px] mb-4 flex flex-col items-center gap-2"
                >
                  <Fingerprint size={36} className={biometricChecking ? 'animate-pulse' : ''} />
                  {biometricChecking ? 'Esperando huella...' : 'Registrar con huella'}
                </button>
              )}

              {biometricAvailable && (
                <p className="text-white/30 text-xs mb-3 text-center">— o usa tu PIN —</p>
              )}

              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handlePin()}
                placeholder="PIN"
                autoFocus={!biometricAvailable}
                className={`w-full bg-white/5 border rounded-xl px-6 py-4 text-white text-center text-3xl tracking-[0.5em] focus:outline-none mb-4 placeholder-white/20 ${error ? 'border-red-500' : 'border-white/20 focus:border-emerald-500'}`}
              />
              <button
                onClick={handlePin}
                disabled={pin.length < 4 || checking}
                className="w-full py-4 rounded-xl bg-white/10 hover:bg-white/20 active:scale-[0.97] disabled:bg-white/5 disabled:text-white/30 text-white font-bold text-lg transition-all min-h-[56px]"
              >
                {checking ? 'Verificando...' : 'Entrar con PIN'}
              </button>
              {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
            </div>
          ) : (
            <div className="text-center w-full max-w-sm">
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <User size={40} className="text-emerald-400" />
              </div>
              <p className="text-2xl font-bold mb-1">{staff.name}</p>
              <p className="text-white/50 text-sm mb-8 capitalize">{staff.role}</p>

              <div className="flex gap-4 mb-8">
                <button
                  onClick={() => handleRegister('entrada')}
                  className={`flex-1 flex flex-col items-center gap-2 py-6 rounded-2xl font-bold text-lg transition-all active:scale-95 ${
                    lastAction === 'entrada'
                      ? 'bg-white/10 text-white/30 border border-white/10'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  <LogIn size={32} />
                  Entrada
                </button>
                <button
                  onClick={() => handleRegister('salida')}
                  className={`flex-1 flex flex-col items-center gap-2 py-6 rounded-2xl font-bold text-lg transition-all active:scale-95 ${
                    lastAction === 'salida' || lastAction === null
                      ? 'bg-white/10 text-white/30 border border-white/10'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  <LogOut size={32} />
                  Salida
                </button>
              </div>

              {/* This person's history */}
              {records.length > 0 && (
                <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left px-4 py-2 text-xs text-white/40">Fecha</th>
                        <th className="text-left px-4 py-2 text-xs text-white/40">Entrada</th>
                        <th className="text-left px-4 py-2 text-xs text-white/40">Salida</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Group by date
                        const byDate: Record<string, { entrada?: string; salida?: string }> = {}
                        for (const r of records) {
                          const d = r.registered_at.slice(0, 10)
                          if (!byDate[d]) byDate[d] = {}
                          if (r.type === 'entrada' && !byDate[d].entrada) byDate[d].entrada = r.registered_at
                          if (r.type === 'salida' && !byDate[d].salida) byDate[d].salida = r.registered_at
                        }
                        return Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7).map(([date, rec]) => (
                          <tr key={date} className="border-b border-white/5">
                            <td className="px-4 py-2 text-white/60">{new Date(date + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
                            <td className="px-4 py-2 text-emerald-400">{rec.entrada ? new Date(rec.entrada).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                            <td className="px-4 py-2 text-amber-400">{rec.salida ? new Date(rec.salida).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                          </tr>
                        ))
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right — Today's attendance list */}
        <div className="w-1/2 flex flex-col p-6 overflow-y-auto">
          <h2 className="text-sm font-semibold text-white/50 uppercase tracking-wide mb-4 flex items-center gap-2">
            <Clock size={14} /> Asistencia de hoy
          </h2>
          {Object.keys(todayByStaff).length === 0 ? (
            <p className="text-white/30 text-center py-12">Sin registros hoy</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(todayByStaff).map(([staffId, info]) => (
                <div key={staffId} className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${info.status === 'STALE_ENTRADA' ? 'bg-red-500/10 border-red-500/30' : 'bg-white/5 border-white/5'}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${info.status === 'STALE_ENTRADA' ? 'bg-red-500/20' : 'bg-emerald-500/20'}`}>
                    <User size={18} className={info.status === 'STALE_ENTRADA' ? 'text-red-400' : 'text-emerald-400'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{info.name}</p>
                    <div className="flex gap-4 text-xs">
                      <span className="text-emerald-400">
                        {info.entrada ? '↗ ' + new Date(info.entrada).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                      <span className="text-amber-400">
                        {info.salida ? '↙ ' + new Date(info.salida).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    {info.status === 'STALE_ENTRADA' && info.entrada && (
                      <p className="text-red-400 text-xs mt-1">Posible salida no registrada (entrada hace {Math.round((Date.now() - new Date(info.entrada).getTime()) / 3600000)}h)</p>
                    )}
                  </div>
                  <div className={`w-3 h-3 rounded-full ${
                    info.status === 'STALE_ENTRADA' ? 'bg-red-500 animate-pulse' :
                    info.status === 'ACTIVE_ON_SHIFT' ? 'bg-emerald-500 animate-pulse' :
                    'bg-white/20'
                  }`} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
