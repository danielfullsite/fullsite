'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Fingerprint, CheckCircle, XCircle, Trash2, User, Search } from 'lucide-react'
interface StaffMember { id: string; name: string; role: string; active?: boolean }

// Auth para la API del POS (shift token del login, gerente+). pos_staff no tiene acceso anon.
function apiHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('pos_shift_token') : null
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

export default function HuellaPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [registered, setRegistered] = useState<Record<string, string>>({}) // credId → staffName
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    // Check biometric
    if (window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
        .then(ok => setBiometricAvailable(ok))
        .catch(() => {})
    }

    // Load staff via la API segura (pos_staff no tiene acceso anon con la anon key)
    fetch('/api/pos/staff', { headers: apiHeaders(), cache: 'no-store' })
      .then(r => r.ok ? r.json() : { staff: [] })
      .then(d => setStaff((d.staff || []).filter((s: StaffMember) => s.active !== false)))
      .finally(() => setLoading(false))

    // Load registered credentials
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      const byStaff: Record<string, string> = {}
      for (const [credId, member] of Object.entries(stored)) {
        const m = member as { id: string; name: string }
        byStaff[m.id] = m.name
      }
      setRegistered(byStaff)
    } catch { /* */ }
  }, [])

  const handleRegister = async (member: StaffMember) => {
    setMessage('')
    setError('')
    try {
      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Fullsite POS', id: window.location.hostname },
          user: {
            id: new TextEncoder().encode(member.id),
            name: member.name,
            displayName: member.name,
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
          },
          timeout: 60000,
        },
      })
      if (credential) {
        const credId = btoa(String.fromCharCode(...new Uint8Array((credential as PublicKeyCredential).rawId)))
        const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
        stored[credId] = { id: member.id, name: member.name, role: member.role }
        localStorage.setItem('pos_biometric_credentials', JSON.stringify(stored))
        setRegistered(prev => ({ ...prev, [member.id]: member.name }))
        setMessage(`Huella registrada para ${member.name}`)
      }
    } catch (e) {
      setError(`Error al registrar huella: ${(e as Error).message}`)
    }
  }

  const handleRemove = (memberId: string) => {
    const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
    for (const [credId, member] of Object.entries(stored)) {
      if ((member as { id: string }).id === memberId) {
        delete stored[credId]
      }
    }
    localStorage.setItem('pos_biometric_credentials', JSON.stringify(stored))
    setRegistered(prev => {
      const next = { ...prev }
      delete next[memberId]
      return next
    })
    setMessage('Huella eliminada')
  }

  const registeredCount = Object.keys(registered).length
  const q = search.trim().toLowerCase()
  const visibleStaff = q
    ? staff.filter(m => m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q))
    : staff

  return (
    <div className="h-dvh flex flex-col bg-[#0a0a0f] text-white overflow-hidden">
      <header className="flex items-center gap-4 px-6 py-4 bg-[#111118] border-b border-white/10 flex-shrink-0">
        <Link href="/pos" className="w-11 h-11 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center"><ArrowLeft size={20} /></Link>
        <Fingerprint size={28} className="text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold">Registro de Huellas</h1>
          <p className="text-sm text-white/50">{registeredCount} de {staff.length} empleados registrados</p>
        </div>
        <div className="ml-auto relative w-full max-w-xs">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar empleado…"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-3 py-3 text-base text-white placeholder-white/40 focus:outline-none focus:border-blue-500"
          />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full" style={{ WebkitOverflowScrolling: 'touch' }}>

      {!biometricAvailable && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4">
          <p className="text-red-400 font-semibold">Lector de huella no detectado</p>
          <p className="text-sm text-[var(--text-3)] mt-1">Verifica que el lector HID DigitalPersona esté conectado y que Windows Hello esté configurado con huellas.</p>
        </div>
      )}

      {message && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 mb-4 flex items-center gap-2">
          <CheckCircle size={16} className="text-emerald-400" />
          <p className="text-emerald-400">{message}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4 flex items-center gap-2">
          <XCircle size={16} className="text-red-400" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      <div className="space-y-1.5">
        {visibleStaff.map(member => {
          const isRegistered = member.id in registered
          return (
            <div key={member.id}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                isRegistered ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/5 border-white/10'
              }`}>
              <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${
                isRegistered ? 'bg-emerald-600' : 'bg-white/10'
              }`}>
                {isRegistered ? <Fingerprint size={22} className="text-white" /> : <User size={22} className="text-white/40" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-base truncate">{member.name}</p>
                <p className="text-xs text-white/50">{member.role}{isRegistered ? ' — registrada ✓' : ''}</p>
              </div>
              {isRegistered ? (
                <button onClick={() => handleRemove(member.id)}
                  className="w-11 h-11 rounded-xl hover:bg-red-500/10 text-red-400 flex items-center justify-center flex-shrink-0">
                  <Trash2 size={20} />
                </button>
              ) : (
                <button onClick={() => handleRegister(member)}
                  disabled={!biometricAvailable}
                  className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-sm flex items-center gap-2 flex-shrink-0 min-h-[48px]">
                  <Fingerprint size={20} />
                  Registrar
                </button>
              )}
            </div>
          )
        })}
        {visibleStaff.length === 0 && (
          <p className="text-center text-white/40 py-8 text-sm">Sin resultados para “{search}”.</p>
        )}
      </div>
      </div>
    </div>
  )
}
