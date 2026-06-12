'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { registerServiceWorker } from '@/lib/service-worker'
import { apiUrl } from '@/lib/api-base'

function _cid() { try { return localStorage.getItem('fullsite_client_id') || 'amalay' } catch { return 'amalay' } }

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

  // Register service worker for offline support
  const swRegistered = useRef(false)
  useEffect(() => {
    if (!swRegistered.current) {
      swRegistered.current = true
      registerServiceWorker()
    }
  }, [])

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

    const unlock = (member: StaffMember) => {
      setStaff(member)
      setUnlocked(true)
      setAttempts(0)
      sessionStorage.setItem('pos_staff', JSON.stringify(member))
      sessionStorage.setItem('pos_last_activity', Date.now().toString())
      setChecking(false)
    }

    try {
      // Validación server-side (service key) — el cliente ya no lee pos_staff
      const res = await fetch(apiUrl('/api/pos/pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, client_id: _cid() }),
      })
      if (res.ok) {
        const { staff: member } = await res.json()
        if (member?.id) {
          // Cache PIN for offline auth
          try {
            const cached = JSON.parse(localStorage.getItem('pos_pin_cache') || '{}')
            cached[pin] = { ...member, cached_at: Date.now() }
            localStorage.setItem('pos_pin_cache', JSON.stringify(cached))
          } catch { /* ignore */ }
          unlock(member)
          return
        }
      }
    } catch {
      // Sin red (modo offline) — check cached PINs
      try {
        const cached = JSON.parse(localStorage.getItem('pos_pin_cache') || '{}')
        if (cached[pin]) {
          unlock({ id: cached[pin].id, name: cached[pin].name, role: cached[pin].role })
          return
        }
      } catch { /* ignore */ }
    }

    const newAttempts = attempts + 1
    setAttempts(newAttempts)
    setError(true)
    setPin('')
    if (newAttempts >= MAX_ATTEMPTS) {
      setLockedUntil(Date.now() + LOCKOUT_MS)
      setTimeout(() => { setLockedUntil(0); setAttempts(0) }, LOCKOUT_MS)
    }
    setTimeout(() => setError(false), 1500)
    setChecking(false)
  }

  if (unlocked) return (
    <div className="pos-kiosk" style={{
      background:'#0a0a0f', color:'#fff', minHeight:'100dvh',
      colorScheme:'dark',
      // Force all CSS variables to dark values for POS
      // @ts-expect-error CSS custom properties
      '--bg':'#0a0a0f','--bg-1':'#0f0f14','--surface':'#111118','--surface-2':'#1a1a24',
      '--line':'rgba(255,255,255,0.08)','--line-soft':'rgba(255,255,255,0.04)',
      '--text-1':'#fff','--text-2':'rgba(255,255,255,0.7)','--text-3':'rgba(255,255,255,0.45)',
      '--text-4':'rgba(255,255,255,0.25)',
    }}>{children}</div>
  )

  const remainingAttempts = MAX_ATTEMPTS - attempts

  return (
    <div className="pos-kiosk h-dvh flex items-center justify-center bg-slate-900 text-white select-none" style={{background: 'linear-gradient(180deg, #0a0a14 0%, #111827 100%)'}}>
      <div className="text-center w-full max-w-xs mx-4">
        <div className="mb-8">
          {/* Restaurant logo — /logos/{clientId}.png per client */}
          <img
            src={`/logos/${_cid()}.png`}
            alt=""
            className="h-24 mx-auto mb-4 object-contain"
            onError={(e) => { const el = e.target as HTMLImageElement; el.style.display = 'none' }}
          />
          <p className="text-slate-400 text-sm mt-2">Ingresa tu PIN para abrir</p>
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
