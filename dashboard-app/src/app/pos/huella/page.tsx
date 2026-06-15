'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Fingerprint, CheckCircle, XCircle, Trash2, User } from 'lucide-react'
import { apiUrl } from '@/lib/api-base'

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface StaffMember { id: string; name: string; role: string }

export default function HuellaPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [registered, setRegistered] = useState<Record<string, string>>({}) // credId → staffName
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [biometricAvailable, setBiometricAvailable] = useState(false)

  useEffect(() => {
    // Check biometric
    if (window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
        .then(ok => setBiometricAvailable(ok))
        .catch(() => {})
    }

    // Load staff
    fetch(`${SUPABASE_URL}/rest/v1/pos_staff?client_id=eq.${_cid()}&active=eq.true&select=id,name,role&order=name.asc`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    ).then(r => r.ok ? r.json() : []).then(setStaff).finally(() => setLoading(false))

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

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/pos" className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-3)]"><ArrowLeft size={16} /></Link>
        <Fingerprint size={24} className="text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-1)]">Registro de Huellas</h1>
          <p className="text-sm text-[var(--text-3)]">{registeredCount} de {staff.length} empleados registrados</p>
        </div>
      </div>

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

      <div className="space-y-2">
        {staff.map(member => {
          const isRegistered = member.id in registered
          return (
            <div key={member.id}
              className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                isRegistered ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-[var(--surface)] border-[var(--line)]'
              }`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                isRegistered ? 'bg-emerald-600' : 'bg-[var(--surface-2)]'
              }`}>
                {isRegistered ? <Fingerprint size={20} className="text-white" /> : <User size={20} className="text-[var(--text-3)]" />}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-[var(--text-1)]">{member.name}</p>
                <p className="text-xs text-[var(--text-3)]">{member.role}{isRegistered ? ' — huella registrada' : ''}</p>
              </div>
              {isRegistered ? (
                <button onClick={() => handleRemove(member.id)}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-red-400">
                  <Trash2 size={16} />
                </button>
              ) : (
                <button onClick={() => handleRegister(member)}
                  disabled={!biometricAvailable}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold text-sm">
                  Registrar huella
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
