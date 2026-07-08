'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { registerServiceWorker, requestNotificationPermission } from '@/lib/service-worker'
import { apiUrl } from '@/lib/api-base'
import { checkActiveSession, registerSession, startHeartbeat, removeSession } from '@/lib/pos-sessions'
import TurnoGate from '@/components/pos/TurnoGate'

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
  const router = useRouter()
  const [unlocked, setUnlocked] = useState(false)
  const [staff, setStaff] = useState<StaffMember | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [showFingerprintRegister, setShowFingerprintRegister] = useState(false)
  const [registeringFingerprint, setRegisteringFingerprint] = useState(false)
  const [fingerprintMsg, setFingerprintMsg] = useState('')
  const [sessionError, setSessionError] = useState('')

  // Register service worker + start background queues on mount
  const swRegistered = useRef(false)
  useEffect(() => {
    if (!swRegistered.current) {
      swRegistered.current = true
      registerServiceWorker()
      // Auto-sync offline queue when internet returns
      import('@/lib/pos-offline-db').then(m => m.registerAutoSync()).catch(() => {})
      // Start print retry loop — processes any queued print jobs from previous sessions
      import('@/lib/print-queue').then(m => m.startRetryLoop()).catch(() => {})
    }
  }, [])

  // ── Modo kiosk para terminal de caja (hardware AMALAY: touch all-in-one) ──
  useEffect(() => {
    // 1. Manifest dedicado: fullscreen + landscape + start_url /pos
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const prevManifest = link?.href
    if (link) link.href = '/manifest-pos.json'

    // 2. Sin menú contextual (long-press en monitor touch abre click derecho)
    const blockCtx = (e: Event) => {
      const t = e.target as HTMLElement
      if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement)) e.preventDefault()
    }
    document.addEventListener('contextmenu', blockCtx)

    // 3. Fullscreen: triggered on login, not on first tap (see enterFullscreen below)

    return () => {
      if (link && prevManifest) link.href = prevManifest
      document.removeEventListener('contextmenu', blockCtx)
    }
  }, [])

  // 3. Wake Lock: la pantalla del terminal NUNCA se duerme con sesión abierta
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  const unlockedRef = useRef(unlocked)
  useEffect(() => { unlockedRef.current = unlocked }, [unlocked])
  useEffect(() => {
    let cancelled = false
    const acquire = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
        if (!nav.wakeLock) return
        const lock = await nav.wakeLock.request('screen')
        if (cancelled) { lock.release().catch(() => {}) } else { wakeLockRef.current = lock }
      } catch { /* sin permiso o batería baja — no crítico */ }
    }
    const reacquire = () => { if (document.visibilityState === 'visible' && unlockedRef.current) acquire() }

    if (unlocked) {
      acquire()
      document.addEventListener('visibilitychange', reacquire)
    }
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', reacquire)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [unlocked])

  // Restore session
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('pos_staff')
      const lastActivity = sessionStorage.getItem('pos_last_activity')
      if (saved && lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity)
        if (elapsed < IDLE_TIMEOUT_MS) {
          try {
            const parsed = JSON.parse(saved)
            setStaff(parsed)
            setUnlocked(true)
            // Restart heartbeat for restored session
            registerSession(parsed.id, parsed.name).then(() => startHeartbeat(parsed.id)).catch(() => {})
            // Don't auto-redirect — let the page handle navigation
          } catch { /* ignore */ }
        } else {
          // Session expired — clean up server session too
          sessionStorage.removeItem('pos_staff')
          sessionStorage.removeItem('pos_last_activity')
          removeSession().catch(() => {})
        }
      }
      // PIN validation is now server-side only via /api/pos/pin
      // No PINs cached in localStorage (security: prevents PIN theft via DevTools)
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
          // Lock the POS + clean up server session
          removeSession().catch(() => {})
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
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricChecking, setBiometricChecking] = useState(false)

  // Check if fingerprint reader is available (via bridge proxy on port 7717)
  const FINGERPRINT_URL = 'http://127.0.0.1:7717/fp'
  useEffect(() => {
    fetch(`${FINGERPRINT_URL}/health`, { signal: AbortSignal.timeout(1000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.ok) setBiometricAvailable(true) })
      .catch(() => setBiometricAvailable(false))
  }, [])

  // Register fingerprint via DigitalPersona service (port 7718)
  const handleBiometricRegister = async (staffMember: StaffMember) => {
    try {
      // Call fingerprint service to enroll (captures 4 samples)
      const res = await fetch(`${FINGERPRINT_URL}/enroll?id=${encodeURIComponent(staffMember.id)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(90000), // 90 sec for 4 captures
      })
      const data = await res.json()

      if (data.ok) {
        // Save mapping: staffId → staff member info (for fingerprint login)
        const fpMap = JSON.parse(localStorage.getItem('pos_fingerprint_staff') || '{}')
        fpMap[staffMember.id] = { id: staffMember.id, name: staffMember.name, role: staffMember.role }
        localStorage.setItem('pos_fingerprint_staff', JSON.stringify(fpMap))
        return true
      }
      console.warn('[fingerprint] Enrollment failed:', data.error)
    } catch (e) {
      console.warn('[fingerprint] Registration failed:', e)
    }
    return false
  }

  // Authenticate with fingerprint via DigitalPersona service (port 7718)
  const handleBiometricLogin = async () => {
    setBiometricChecking(true)
    try {
      const res = await fetch(`${FINGERPRINT_URL}/identify`, { method: 'GET', signal: AbortSignal.timeout(20000) })
      const data = await res.json()

      if (data.ok && data.staffId) {
        // Look up staff member by ID from pos_staff via API
        const staffRes = await fetch(apiUrl('/api/pos/pin'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: '___fingerprint___', client_id: _cid(), fingerprint_id: data.staffId }),
        })

        // If API doesn't support fingerprint_id yet, look up from local cache
        let member: StaffMember | null = null
        try {
          const fpMap = JSON.parse(localStorage.getItem('pos_fingerprint_staff') || '{}')
          if (fpMap[data.staffId]) member = fpMap[data.staffId]
        } catch {}

        if (!member) {
          setSessionError('Huella reconocida pero usuario no vinculado. Entra con PIN primero.')
          setBiometricChecking(false)
          return
        }

        // Session locking
        setSessionError('')
        const conflict = await checkActiveSession(member.id)
        if (conflict) {
          setSessionError('Usuario activo en otra terminal.')
          setBiometricChecking(false)
          return
        }
        await registerSession(member.id, member.name)
        startHeartbeat(member.id)

        setStaff(member)
        setUnlocked(true)
        setAttempts(0)
        sessionStorage.setItem('pos_staff', JSON.stringify(member))
        sessionStorage.setItem('pos_last_activity', Date.now().toString())
        if (!document.fullscreenElement && document.documentElement.requestFullscreen && !window.matchMedia('(display-mode: standalone)').matches) {
          document.documentElement.requestFullscreen().catch(() => {})
        }
        requestNotificationPermission().catch(() => {})
        // Go to mesas after fingerprint login
        if (window.location.pathname === '/pos' && !window.location.search) {
          router.push('/pos/mesas')
        }
      } else {
        setSessionError(data.error || 'Huella no reconocida')
      }
    } catch (e) {
      console.warn('[fingerprint] Login failed:', e)
      setSessionError('Error al leer huella. Intenta de nuevo.')
    }
    setBiometricChecking(false)
  }

  const handleSubmit = async () => {
    if (pin.length < 4 || isLocked) return
    setChecking(true)
    setError(false)

    const unlock = async (member: StaffMember) => {
      // ── Session locking: prevent concurrent login on multiple terminals ──
      setSessionError('')
      const conflict = await checkActiveSession(member.id)
      if (conflict) {
        setSessionError('Usuario activo en otra terminal. Cierra esa sesion primero.')
        setChecking(false)
        setPin('')
        return
      }
      // Register session and start heartbeat
      await registerSession(member.id, member.name)
      startHeartbeat(member.id)

      setStaff(member)
      setAttempts(0)
      sessionStorage.setItem('pos_staff', JSON.stringify(member))
      sessionStorage.setItem('pos_last_activity', Date.now().toString())
      setChecking(false)
      // Enter fullscreen on login (user gesture context — required by browser API)
      if (!document.fullscreenElement && document.documentElement.requestFullscreen && !window.matchMedia('(display-mode: standalone)').matches) {
        document.documentElement.requestFullscreen().catch(() => {})
      }
      // Ask for notification permission after login (non-blocking, user gesture context)
      requestNotificationPermission().catch(() => {})

      // Check if this staff member has a fingerprint registered
      // Verify with the fingerprint service that templates actually exist
      if (biometricAvailable) {
        let serviceHasTemplates = true
        try {
          const listRes = await fetch('http://127.0.0.1:7717/fp/list', { signal: AbortSignal.timeout(2000) })
          const listData = await listRes.json()
          serviceHasTemplates = listData.count > 0 && listData.enrolled?.includes(member.id)
        } catch { serviceHasTemplates = false }

        if (!serviceHasTemplates) {
          // Clear stale local mapping and show registration
          try {
            const fpMap = JSON.parse(localStorage.getItem('pos_fingerprint_staff') || '{}')
            delete fpMap[member.id]
            localStorage.setItem('pos_fingerprint_staff', JSON.stringify(fpMap))
          } catch {}
          setShowFingerprintRegister(true)
          return
        }
      }

      setUnlocked(true)
      // Go to table map after login (only if on bare /pos without mesa param)
      if (window.location.pathname === '/pos' && !window.location.search) {
        router.push('/pos/mesas')
      }
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
          // Cache auth token for offline (15 min TTL, no PIN stored)
          try {
            const pinHash = btoa(pin).slice(0, 8) // short non-reversible token, NOT the PIN
            const cached = JSON.parse(localStorage.getItem('pos_auth_cache') || '{}')
            cached[pinHash] = { id: member.id, name: member.name, role: member.role, exp: Date.now() + 900_000 }
            localStorage.setItem('pos_auth_cache', JSON.stringify(cached))
          } catch { /* ignore */ }
          unlock(member)
          return
        }
      }
    } catch {
      // Sin red (modo offline) — check cached auth tokens (15 min TTL)
      try {
        const pinHash = btoa(pin).slice(0, 8)
        const cached = JSON.parse(localStorage.getItem('pos_auth_cache') || '{}')
        const entry = cached[pinHash]
        if (entry && entry.exp > Date.now()) {
          unlock({ id: entry.id, name: entry.name, role: entry.role })
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

  // Auto-fullscreen: request fullscreen on first user interaction
  // This is the REAL solution — works on PWA, Chrome, any browser
  useEffect(() => {
    if (!unlocked) return
    const requestFullscreen = () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {})
      }
      // Only need to do it once
      document.removeEventListener('click', requestFullscreen)
      document.removeEventListener('touchstart', requestFullscreen)
    }
    document.addEventListener('click', requestFullscreen)
    document.addEventListener('touchstart', requestFullscreen)
    return () => {
      document.removeEventListener('click', requestFullscreen)
      document.removeEventListener('touchstart', requestFullscreen)
    }
  }, [unlocked])

  // Fingerprint registration screen — shown after PIN login when no fingerprint is registered
  if (showFingerprintRegister && staff) {
    const doRegister = async () => {
      setRegisteringFingerprint(true)
      setFingerprintMsg('')
      const ok = await handleBiometricRegister(staff)
      setRegisteringFingerprint(false)
      if (ok) {
        setFingerprintMsg('Huella registrada')
        setTimeout(() => {
          setShowFingerprintRegister(false)
          setFingerprintMsg('')
          setUnlocked(true)
          if (window.location.pathname === '/pos' && !window.location.search) {
            router.push('/pos/mesas')
          }
        }, 1200)
      } else {
        setFingerprintMsg('No se pudo registrar. Intenta de nuevo o salta este paso.')
      }
    }
    const skipRegister = () => {
      setShowFingerprintRegister(false)
      setFingerprintMsg('')
      setUnlocked(true)
      if (window.location.pathname === '/pos' && !window.location.search) {
        router.push('/pos/mesas')
      }
    }
    return (
      <div className="pos-kiosk h-dvh flex items-center justify-center bg-slate-900 text-white select-none" style={{background: 'linear-gradient(180deg, #0a0a14 0%, #111827 100%)'}}>
        <div className="text-center w-full max-w-xs mx-4">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-6">
            <path d="M12 10v4M7.5 7.5C9 6 10.5 5.5 12 5.5c3.5 0 6.5 3 6.5 6.5 0 1.5-.5 3-1.5 4" />
            <path d="M4.5 12.5c0-4 3.5-7.5 7.5-7.5" />
            <path d="M19.5 12.5c0 4-3.5 7.5-7.5 7.5-2 0-3.5-.5-5-2" />
            <path d="M12 14.5c1.5 0 2.5-1 2.5-2.5S13.5 9.5 12 9.5 9.5 10.5 9.5 12" />
          </svg>
          <h2 className="text-xl font-bold mb-2">{staff.name}</h2>
          <p className="text-slate-400 text-sm mb-2">
            Registra tu huella para entrar sin PIN.
          </p>
          <div className="text-slate-500 text-xs mb-6 space-y-1">
            <p>1. Toca el boton y pon tu dedo firme y plano en el lector</p>
            <p>2. Quita el dedo cuando la luz parpadee</p>
            <p>3. Vuelve a poner el dedo (4 veces en total)</p>
            <p>4. Espera ~20 segundos</p>
          </div>
          <button
            onClick={doRegister}
            disabled={registeringFingerprint}
            className="w-full py-5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.97] disabled:bg-blue-800 text-white font-bold text-lg transition-all min-h-[64px] mb-3 flex items-center justify-center gap-3"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 10v4M7.5 7.5C9 6 10.5 5.5 12 5.5c3.5 0 6.5 3 6.5 6.5 0 1.5-.5 3-1.5 4" />
              <path d="M4.5 12.5c0-4 3.5-7.5 7.5-7.5" />
              <path d="M19.5 12.5c0 4-3.5 7.5-7.5 7.5-2 0-3.5-.5-5-2" />
              <path d="M12 14.5c1.5 0 2.5-1 2.5-2.5S13.5 9.5 12 9.5 9.5 10.5 9.5 12" />
            </svg>
            {registeringFingerprint ? 'Pon tu dedo... quita y pon 4 veces' : 'Registrar huella'}
          </button>
          <button
            onClick={skipRegister}
            className="w-full py-3 rounded-xl bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-300 text-sm transition-all"
          >
            Saltar por ahora
          </button>
          {fingerprintMsg && (
            <p className={`text-sm mt-3 ${fingerprintMsg.includes('registrada') ? 'text-emerald-400' : 'text-amber-400'}`}>
              {fingerprintMsg}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (unlocked) return (
    <div className="pos-kiosk" style={{
      background:'#0a0a0f', color:'#fff', height:'100dvh', overflow:'hidden',
      colorScheme:'dark',
      // Force all CSS variables to dark values for POS
      // @ts-expect-error CSS custom properties
      '--bg':'#0a0a0f','--bg-1':'#0f0f14','--surface':'#111118','--surface-2':'#1a1a24',
      '--line':'rgba(255,255,255,0.08)','--line-soft':'rgba(255,255,255,0.04)',
      '--text-1':'#fff','--text-2':'rgba(255,255,255,0.7)','--text-3':'rgba(255,255,255,0.45)',
      '--text-4':'rgba(255,255,255,0.25)',
    }}>
      <TurnoGate staff={staff!}>
        {children}
      </TurnoGate>
    </div>
  )

  const remainingAttempts = MAX_ATTEMPTS - attempts

  return (
    <div className="pos-kiosk h-dvh flex items-center justify-center bg-slate-900 text-white select-none" style={{background: 'linear-gradient(180deg, #0a0a14 0%, #111827 100%)'}}
      onClick={() => {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {})
        }
      }}
    >
      <div className="text-center w-full max-w-xs mx-4">
        <div className="mb-8">
          {/* Restaurant logo — tap 5x to exit kiosk mode */}
          <img
            src={`/logos/${_cid()}.png`}
            alt=""
            className="h-24 mx-auto mb-4 object-contain"
            onError={(e) => { const el = e.target as HTMLImageElement; el.style.display = 'none' }}
            onClick={() => {
              const key = 'pos_exit_taps'
              const now = Date.now()
              const taps = JSON.parse(sessionStorage.getItem(key) || '[]').filter((t: number) => now - t < 3000)
              taps.push(now)
              sessionStorage.setItem(key, JSON.stringify(taps))
              if (taps.length >= 5) {
                sessionStorage.removeItem(key)
                // Electron app: quit via IPC bridge
                const fApp = (window as unknown as { fullsiteApp?: { quit: () => void } }).fullsiteApp
                if (fApp?.quit) { fApp.quit(); return }
                // Browser fallback
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
                window.close()
                window.location.href = 'about:blank'
              }
            }}
          />
          <p className="text-slate-400 text-sm mt-2">
            {biometricAvailable ? 'Huella digital o PIN para abrir' : 'Ingresa tu PIN para abrir'}
          </p>
        </div>

        {/* Biometric login button */}
        {biometricAvailable && (
          <button
            onClick={handleBiometricLogin}
            disabled={biometricChecking || isLocked}
            className="w-full py-5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.97] disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold text-lg transition-all min-h-[64px] mb-4 flex items-center justify-center gap-3"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 10v4M7.5 7.5C9 6 10.5 5.5 12 5.5c3.5 0 6.5 3 6.5 6.5 0 1.5-.5 3-1.5 4" />
              <path d="M4.5 12.5c0-4 3.5-7.5 7.5-7.5" />
              <path d="M19.5 12.5c0 4-3.5 7.5-7.5 7.5-2 0-3.5-.5-5-2" />
              <path d="M12 14.5c1.5 0 2.5-1 2.5-2.5S13.5 9.5 12 9.5 9.5 10.5 9.5 12" />
            </svg>
            {biometricChecking ? 'Verificando huella...' : 'Entrar con huella'}
          </button>
        )}

        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="PIN"
          autoFocus={!biometricAvailable}
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
          {checking ? 'Verificando...' : isLocked ? 'Bloqueado (1 min)' : 'Entrar con PIN'}
        </button>

        {sessionError && (
          <p className="text-amber-400 text-sm mt-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            {sessionError}
          </p>
        )}
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
