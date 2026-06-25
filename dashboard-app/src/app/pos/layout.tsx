'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { registerServiceWorker, requestNotificationPermission } from '@/lib/service-worker'
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

    // 3. Auto-fullscreen — only on first interaction, only if not in kiosk/PWA
    const goFullscreen = () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen && !window.matchMedia('(display-mode: standalone)').matches) {
        document.documentElement.requestFullscreen().catch(() => {})
      }
      // Remove after first successful attempt
      document.removeEventListener('click', goFullscreen)
      document.removeEventListener('touchstart', goFullscreen)
    }
    document.addEventListener('click', goFullscreen, { once: true })
    document.addEventListener('touchstart', goFullscreen, { once: true })

    return () => {
      if (link && prevManifest) link.href = prevManifest
      document.removeEventListener('contextmenu', blockCtx)
      document.removeEventListener('click', goFullscreen)
      document.removeEventListener('touchstart', goFullscreen)
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
            setStaff(JSON.parse(saved))
            setUnlocked(true)
            // Auto-redirect to mesas if on /pos
            if (window.location.pathname === '/pos') {
              window.location.href = '/pos/mesas'
            }
          } catch { /* ignore */ }
        } else {
          // Session expired
          sessionStorage.removeItem('pos_staff')
          sessionStorage.removeItem('pos_last_activity')
        }
      }
      // Pre-populate PIN cache for offline-first: fetch all staff PINs once when online
      // This ensures the terminal can authenticate even if internet drops on first use
      ;(async () => {
        try {
          const res = await fetch(apiUrl('/api/pos/staff-cache'), { headers: { 'x-client-id': _cid() } })
          if (res.ok) {
            const { staff: allStaff } = await res.json()
            if (Array.isArray(allStaff) && allStaff.length > 0) {
              const cached = JSON.parse(localStorage.getItem('pos_pin_cache') || '{}')
              for (const s of allStaff) {
                if (s.pin && s.id) cached[s.pin] = { id: s.id, name: s.name, role: s.role, cached_at: Date.now() }
              }
              localStorage.setItem('pos_pin_cache', JSON.stringify(cached))
            }
          }
        } catch { /* offline — use existing cache */ }
      })()
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
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricChecking, setBiometricChecking] = useState(false)

  // Check if WebAuthn/biometric is available
  useEffect(() => {
    if (typeof window !== 'undefined' && window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
        .then(ok => setBiometricAvailable(ok))
        .catch(() => {})
    }
  }, [])

  // Register fingerprint for current staff member
  const handleBiometricRegister = async (staffMember: StaffMember) => {
    try {
      const challenge = new Uint8Array(32)
      crypto.getRandomValues(challenge)
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Fullsite POS', id: window.location.hostname },
          user: {
            id: new TextEncoder().encode(staffMember.id),
            name: staffMember.name,
            displayName: staffMember.name,
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
          },
          timeout: 60000,
        },
      })
      if (credential) {
        // Save credential ID linked to staff member
        const credId = btoa(String.fromCharCode(...new Uint8Array((credential as PublicKeyCredential).rawId)))
        const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
        stored[credId] = { id: staffMember.id, name: staffMember.name, role: staffMember.role }
        localStorage.setItem('pos_biometric_credentials', JSON.stringify(stored))
        return true
      }
    } catch (e) {
      console.warn('[biometric] Registration failed:', e)
    }
    return false
  }

  // Authenticate with fingerprint
  const handleBiometricLogin = async () => {
    setBiometricChecking(true)
    try {
      const stored = JSON.parse(localStorage.getItem('pos_biometric_credentials') || '{}')
      const credIds = Object.keys(stored)
      if (credIds.length === 0) {
        setBiometricChecking(false)
        return
      }

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
        const member = stored[credId]
        if (member) {
          setStaff(member)
          setUnlocked(true)
          setAttempts(0)
          sessionStorage.setItem('pos_staff', JSON.stringify(member))
          sessionStorage.setItem('pos_last_activity', Date.now().toString())
          // Ask for notification permission after biometric login
          requestNotificationPermission().catch(() => {})
        }
      }
    } catch (e) {
      console.warn('[biometric] Auth failed:', e)
    }
    setBiometricChecking(false)
  }

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
      // Always go to table map after login
      if (window.location.pathname === '/pos') {
        window.location.href = '/pos/mesas'
      }
      // Ask for notification permission after login (non-blocking, user gesture context)
      requestNotificationPermission().catch(() => {})
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
      background:'#0a0a0f', color:'#fff', height:'100dvh', overflow:'hidden',
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
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
                window.close()
                // Fallback if window.close doesn't work in kiosk
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
