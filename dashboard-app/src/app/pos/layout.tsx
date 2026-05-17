'use client'

import { useState, useEffect } from 'react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Fallback PIN for when DB is not available
const FALLBACK_PIN = '2835'

interface StaffMember {
  id: string
  name: string
  role: string
}

export default function POSLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [unlocked, setUnlocked] = useState(false)
  const [staff, setStaff] = useState<StaffMember | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('pos_staff')
      if (saved) {
        try {
          setStaff(JSON.parse(saved))
          setUnlocked(true)
        } catch { /* ignore */ }
      }
    }
  }, [])

  const handleSubmit = async () => {
    if (pin.length < 4) return
    setChecking(true)
    setError(false)

    try {
      // Try staff table first
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pos_staff?pin=eq.${pin}&active=eq.true&client_id=eq.amalay&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      if (res.ok) {
        const rows = await res.json()
        if (rows.length > 0) {
          const member = { id: rows[0].id, name: rows[0].name, role: rows[0].role }
          setStaff(member)
          setUnlocked(true)
          sessionStorage.setItem('pos_staff', JSON.stringify(member))
          sessionStorage.setItem('pos_unlocked', 'true')
          setChecking(false)
          return
        }
      }
    } catch { /* DB not available, try fallback */ }

    // Fallback PIN
    if (pin === FALLBACK_PIN) {
      const member = { id: 'admin', name: 'Admin', role: 'admin' }
      setStaff(member)
      setUnlocked(true)
      sessionStorage.setItem('pos_staff', JSON.stringify(member))
      sessionStorage.setItem('pos_unlocked', 'true')
    } else {
      setError(true)
      setPin('')
      setTimeout(() => setError(false), 1500)
    }
    setChecking(false)
  }

  if (unlocked) return <>{children}</>

  return (
    <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
      <div className="text-center w-full max-w-xs mx-4">
        <div className="mb-6">
          <span className="text-white font-black text-2xl tracking-tight">
            fullsite
            <span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-1" />
          </span>
          <p className="text-slate-400 text-sm mt-1">POS — Ingresa tu PIN</p>
        </div>

        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="PIN"
          autoFocus
          className={`w-full bg-slate-800 border rounded-xl px-6 py-4 text-white text-center text-3xl tracking-[0.5em] focus:outline-none mb-4 ${
            error ? 'border-red-500' : 'border-slate-700 focus:border-emerald-500'
          }`}
        />

        <button
          onClick={handleSubmit}
          disabled={pin.length < 4 || checking}
          className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold text-lg transition-colors"
        >
          {checking ? 'Verificando...' : 'Entrar'}
        </button>

        {error && <p className="text-red-400 text-sm mt-3">PIN incorrecto</p>}

        {staff && (
          <p className="text-emerald-400 text-sm mt-3">Bienvenido, {staff.name}</p>
        )}
      </div>
    </div>
  )
}
