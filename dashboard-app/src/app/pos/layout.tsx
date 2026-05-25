'use client'

import { useState, useEffect, useCallback } from 'react'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Fallback PIN for when DB is not available (override via env)
const FALLBACK_PIN = process.env.NEXT_PUBLIC_POS_FALLBACK_PIN || '2835'
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 60000 // 1 minute lockout
const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

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
  const [attempts, setAttempts] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)

  // Restore session
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('pos_staff')
      const lastActivity = sessionStorage.getItem('pos_last_activity')
      if (saved && lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity)
        if (elapsed < IDLE_TIMEOUT_MS) {
          try {
            setStaff(JSON.parse(saved))
            setUnlocked(true)
          } catch { /* ignore */ }
        } else {
          // Session expired
          sessionStorage.removeItem('pos_staff')
          sessionStorage.removeItem('pos_last_activity')
        }
      }
    }
  }, [])

  // Idle timeout — track last activity
  const resetIdleTimer = useCallback(() => {
    if (typeof window !== 'undefined' && unlocked) {
      sessionStorage.setItem('pos_last_activity', Date.now().toString())
    }
  }, [unlocked])

  useEffect(() => {
    if (!unlocked) return
    // Set initial activity
    resetIdleTimer()

    // Listen for user interaction
    const events = ['mousedown', 'touchstart', 'keydown', 'scroll']
    events.forEach(e => window.addEventListener(e, resetIdleTimer))

    // Check idle every minute
    const interval = setInterval(() => {
      const lastActivity = sessionStorage.getItem('pos_last_activity')
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity)
        if (elapsed >= IDLE_TIMEOUT_MS) {
          // Lock the POS
          setUnlocked(false)
          setStaff(null)
          setPin('')
          sessionStorage.removeItem('pos_staff')
          sessionStorage.removeItem('pos_last_activity')
        }
      }
    }, 60000)

    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdleTimer))
      clearInterval(interval)
    }
  }, [unlocked, resetIdleTimer])

  const isLocked = lockedUntil > Date.now()

  const handleSubmit = async () => {
    if (pin.length < 4 || isLocked) return
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
          setAttempts(0)
          sessionStorage.setItem('pos_staff', JSON.stringify(member))
          sessionStorage.setItem('pos_last_activity', Date.now().toString())
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
      setAttempts(0)
      sessionStorage.setItem('pos_staff', JSON.stringify(member))
      sessionStorage.setItem('pos_last_activity', Date.now().toString())
    } else {
      const newAttempts = attempts + 1
      setAttempts(newAttempts)
      setError(true)
      setPin('')
      if (newAttempts >= MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_MS)
        setTimeout(() => { setLockedUntil(0); setAttempts(0) }, LOCKOUT_MS)
      }
      setTimeout(() => setError(false), 1500)
    }
    setChecking(false)
  }

  if (unlocked) return <>{children}</>

  const remainingAttempts = MAX_ATTEMPTS - attempts

  return (
    <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
      <div className="text-center w-full max-w-xs mx-4">
        <div className="mb-6">
          <span className="text-white font-black text-2xl tracking-tight">
            fullsite
            <span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-1" />
          </span>
          <p className="text-[var(--text-3)] text-sm mt-1">POS — Ingresa tu PIN</p>
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
          disabled={isLocked}
          className={`w-full bg-slate-800 border rounded-xl px-6 py-4 text-white text-center text-3xl tracking-[0.5em] focus:outline-none mb-4 placeholder-slate-500 ${
            error ? 'border-red-500' : isLocked ? 'border-red-800 opacity-50' : 'border-slate-600 focus:border-emerald-500'
          }`}
        />

        <button
          onClick={handleSubmit}
          disabled={pin.length < 4 || checking || isLocked}
          className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.97] disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-lg transition-all min-h-[56px]"
        >
          {checking ? 'Verificando...' : isLocked ? 'Bloqueado (1 min)' : 'Entrar'}
        </button>

        {error && !isLocked && (
          <p className="text-red-400 text-sm mt-3">
            PIN incorrecto {remainingAttempts > 0 && remainingAttempts <= 3 && `(${remainingAttempts} intentos restantes)`}
          </p>
        )}
        {isLocked && (
          <p className="text-red-400 text-sm mt-3">Demasiados intentos. Espera 1 minuto.</p>
        )}
      </div>
    </div>
  )
}
