'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { registerServiceWorker, requestNotificationPermission } from '@/lib/service-worker'
import { apiUrl } from '@/lib/api-base'
import { checkActiveSession, registerSession, startHeartbeat, removeSession, getTerminalId } from '@/lib/pos-sessions'
import TurnoGate from '@/components/pos/TurnoGate'
import { getActiveClientSlug as _cid } from '@/lib/data'
import { getEffectiveSetting } from '@/lib/settings'
import { initStationRouting, initNoPrintStations, initCancellationReasons, initDiscountCatalog, initKdsStations } from '@/lib/pos-constants'
import { inventoryPolicyService } from '@/lib/inventory-policy'
import { getFingerprintUrl } from '@/lib/fingerprint-url'
import { provisionManagerCredential, verifyPinOffline, estadoCredencialesOffline } from '@/lib/pos-manager-auth'
import { POSLockContext } from './pos-lock-context'

async function hashPin(pin: string, staffId: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(`${pin}:${staffId}`)
    const buf = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch { return '' }
}


const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/** Silent attendance: register entrada if no open session exists for this staff + turno */
async function ensureAttendanceEntry(staffId: string, staffName: string, method: 'pin' | 'huella') {
  try {
    const clientId = _cid()
    const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }
    // Check for open entrada (no salida after it)
    const res = await fetch(
      `${SB_URL}/rest/v1/pos_attendance?client_id=eq.${clientId}&staff_id=eq.${encodeURIComponent(staffId)}&order=registered_at.desc&limit=1`,
      { headers, cache: 'no-store' }
    )
    if (res.ok) {
      const rows = await res.json()
      // If latest event is already an entrada, session is open — do nothing
      if (rows.length > 0 && rows[0].type === 'entrada') return
    }
    // No open session — register entrada silently
    await fetch(`${SB_URL}/rest/v1/pos_attendance`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ client_id: clientId, staff_id: staffId, staff_name: staffName, type: 'entrada', method }),
    })
  } catch { /* silent — attendance is non-blocking */ }
}

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 60000 // 1 minute lockout
const FP_AVAILABLE_KEY = 'pos_fingerprint_service_available'
// Resolved at startup from settings contract; fallback = 30 min (registry default)
let IDLE_TIMEOUT_MS = 30 * 60 * 1000

interface StaffMember {
  id: string
  name: string
  role: string
}

// KDS/display paths that don't require login — no keyboard on these terminals
const KDS_PATHS = ['/pos/cocina', '/pos/barra', '/pos/panaderia', '/pos/kds']

export default function POSLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter()

  // KDS screens bypass auth entirely — no PIN, no turno gate
  const isKDS = typeof window !== 'undefined' && KDS_PATHS.some(p => window.location.pathname.startsWith(p))
  if (isKDS) {
    return (
      <div className="pos-kiosk" style={{
        background:'#0a0a0f', color:'#fff', minHeight:'100dvh', overflow:'auto',
        colorScheme:'dark',
        // @ts-expect-error CSS custom properties
        '--bg':'#0a0a0f','--bg-1':'#0f0f14','--surface':'#111118','--surface-2':'#1a1a24',
        '--bento-card':'#15151d','--panel':'#141420','--raised':'#1c1c26','--shadow-mid':'0 1px 2px rgba(0,0,0,0.55), 0 14px 34px rgba(0,0,0,0.4)',
        '--line':'rgba(255,255,255,0.08)','--line-soft':'rgba(255,255,255,0.04)',
        '--text-1':'#fff','--text-2':'rgba(255,255,255,0.7)','--text-3':'rgba(255,255,255,0.45)',
        '--text-4':'rgba(255,255,255,0.25)',
      }}>
        {children}
      </div>
    )
  }

  const [unlocked, setUnlocked] = useState(false)
  const [staff, setStaff] = useState<StaffMember | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [notEnrolled, setNotEnrolled] = useState<string | null>(null)
  // La terminal no sabe a qué restaurante pertenece.
  //
  // Sin esto, un 400 de /api/pos/pin caía al mismo camino que un PIN equivocado:
  // la pantalla decía "PIN incorrecto" con el PIN correcto y bloqueaba la
  // terminal 60 s a los 5 intentos. El `catch` que distingue "error de red" no
  // se alcanza, porque un 400 RESUELVE, no lanza. El cajero quedaba en bucle sin
  // ninguna pista de qué estaba mal.
  const [sinTenant, setSinTenant] = useState(false)
  const [networkError, setNetworkError] = useState(false)
  // Distinto de networkError: la terminal SÍ tiene credenciales, pero todas vencieron.
  // El PIN pudo ser correcto, así que no se cuenta como intento fallido — pero el
  // operador necesita saber que la salida es conectarse una vez, no seguir tecleando.
  const [sesionVencida, setSesionVencida] = useState(false)
  const [checking, setChecking] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [showFingerprintRegister, setShowFingerprintRegister] = useState(false)
  const [registeringFingerprint, setRegisteringFingerprint] = useState(false)
  const [logoSrc, setLogoSrc] = useState('')
  const [clientName, setClientName] = useState('')
  const [fingerprintMsg, setFingerprintMsg] = useState('')
  const [sessionError, setSessionError] = useState('')

  // Register service worker + start background queues on mount
  const swRegistered = useRef(false)
  useEffect(() => {
    if (!swRegistered.current) {
      swRegistered.current = true
      registerServiceWorker().then(() => {
        // Warm SW cache with all currently-loaded JS/CSS chunks so the app works offline
        import('@/lib/service-worker').then(({ precacheUrls }) => {
          const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
            .map(s => s.src).filter(Boolean)
          const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
            .map(l => l.href).filter(Boolean)
          precacheUrls([...scripts, ...links])
        }).catch(() => {})
      }).catch(() => {})
      // Auto-sync offline queue when internet returns
      import('@/lib/pos-offline-db').then(m => m.registerAutoSync()).catch(() => {})
      // Start print retry loop — processes any queued print jobs from previous sessions
      import('@/lib/print-queue').then(m => m.startRetryLoop()).catch(() => {})
      // Load client config for receipts, IVA, branding (cached singleton)
      import('@/lib/pos-config').then(m => m.getPosClientConfig()).then(async cfg => {
        if (cfg?.logoUrl) setLogoSrc(cfg.logoUrl)
        if (cfg?.name) setClientName(cfg.name)
        if (cfg?.ivaRate !== undefined) {
          const { setIvaRate } = await import('@/lib/pos-constants')
          setIvaRate(cfg.ivaRate)
        }
      }).catch(() => {})
      // Load operational settings — idle timeout + station routing override
      const clientId = _cid()
      if (clientId) {
        Promise.all([
          getEffectiveSetting(clientId, 'pos.idle_timeout_ms'),
          getEffectiveSetting(clientId, 'pos.station_routing'),
          getEffectiveSetting(clientId, 'pos.no_print_stations'),
          getEffectiveSetting(clientId, 'pos.cancellation_reasons'),
          getEffectiveSetting(clientId, 'pos.discount_catalog'),
          getEffectiveSetting(clientId, 'pos.kds_stations'),
          inventoryPolicyService.initialize(clientId),
        ]).then(([idleMs, stationRouting, noPrintStations, cancelReasons, discountCatalog, kdsStations]) => {
          IDLE_TIMEOUT_MS = idleMs
          initStationRouting(stationRouting as Record<string, string[]>)
          initNoPrintStations(noPrintStations)
          initCancellationReasons(cancelReasons)
          initDiscountCatalog(discountCatalog)
          initKdsStations(kdsStations)
        }).catch(() => { /* keep module-level defaults */ })
      }
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

  // Sesión expirada durante operación: la cola de sync detectó un 401/403 (el shift
  // token venció — TTL 8h, sin refresh). NUNCA fallar en silencio: bloquear el POS y
  // pedir re-PIN con un mensaje claro. Las comandas quedan guardadas (cola + Pedro);
  // al reingresar el PIN, syncAll drena todo solo. Evita que en un restaurante las
  // comandas dejen de llegar sin que nadie se entere.
  useEffect(() => {
    const onAuthRequired = () => {
      if (!unlockedRef.current) return // ya está en la pantalla de PIN
      try { sessionStorage.removeItem('pos_staff') } catch {}
      setSessionError('Tu sesión expiró — vuelve a ingresar tu PIN. Tus comandas están guardadas y se enviarán al reingresar.')
      setUnlocked(false)
    }
    window.addEventListener('pos-sync-auth-required', onAuthRequired)
    return () => window.removeEventListener('pos-sync-auth-required', onAuthRequired)
  }, [])
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
          // Don't lock while offline — staff can't re-auth without network
          // and we don't want to lose an active shift due to a cable outage.
          if (!navigator.onLine) {
            sessionStorage.setItem('pos_last_activity', Date.now().toString())
            return
          }
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
  const [biometricAvailable, setBiometricAvailable] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return localStorage.getItem(FP_AVAILABLE_KEY) === '1' } catch { return false }
  })
  const [biometricChecking, setBiometricChecking] = useState(false)

  const FINGERPRINT_URL = getFingerprintUrl()
  useEffect(() => {
    let cancelled = false
    const checkFingerprint = async () => {
      // The reader service starts beside Electron. Slow terminals can lose the
      // first race and used to hide the button until a manual Ctrl+R.
      for (let attempt = 0; attempt < 6 && !cancelled; attempt++) {
        try {
          const r = await fetch(`${FINGERPRINT_URL}/health`, { signal: AbortSignal.timeout(1000) })
          const data = r.ok ? await r.json() : null
          if (data?.ok) {
            try { localStorage.setItem(FP_AVAILABLE_KEY, '1') } catch {}
            if (!cancelled) setBiometricAvailable(true)
            return
          }
        } catch { /* service may still be starting */ }
        if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 500))
      }
      try { localStorage.removeItem(FP_AVAILABLE_KEY) } catch {}
      if (!cancelled) setBiometricAvailable(false)
    }
    checkFingerprint()
    return () => { cancelled = true }
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
        // Look up staff member by ID from pos_staff via API.
        // Offline: ni lo intentamos — son 4s de espera garantizada. Mismo guard
        // que ya usa la ruta de PIN mas abajo.
        let staffRes: Response | null = null
        if (navigator.onLine) {
          try {
            staffRes = await fetch(apiUrl('/api/pos/pin'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pin: '___fingerprint___', client_id: _cid(), fingerprint_id: data.staffId, device_id: getTerminalId() }),
              signal: AbortSignal.timeout(4000),
            })
          } catch { staffRes = null }
        }

        // Try API first (validates active status), fall back to local cache
        let member: StaffMember | null = null
        if (staffRes?.ok) {
          try {
            const staffData = await staffRes.json()
            if (staffData.staff) {
              member = staffData.staff
              // Refresh offline cache so it survives a future storage-cleared offline session
              try {
                const fpMap = JSON.parse(localStorage.getItem('pos_fingerprint_staff') || '{}')
                fpMap[data.staffId] = member
                localStorage.setItem('pos_fingerprint_staff', JSON.stringify(fpMap))
              } catch {}
            }
          } catch {}
        }
        if (!member) {
          try {
            const fpMap = JSON.parse(localStorage.getItem('pos_fingerprint_staff') || '{}')
            if (fpMap[data.staffId]) member = fpMap[data.staffId]
          } catch {}
        }

        if (!member) {
          setSessionError(
            navigator.onLine
              ? 'Huella reconocida pero usuario no vinculado. Entra con PIN primero.'
              : 'Huella reconocida, pero sin internet esta terminal aun no la conoce. Entra con PIN una vez y la huella queda lista para offline.'
          )
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
        ensureAttendanceEntry(member.id, member.name, 'huella')

        setStaff(member)
        setUnlocked(true)
        setAttempts(0)
        sessionStorage.setItem('pos_staff', JSON.stringify(member))
        sessionStorage.setItem('pos_last_activity', Date.now().toString())
        // Fullscreen handled by Electron kiosk mode
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
      ensureAttendanceEntry(member.id, member.name, 'pin')

      setStaff(member)
      setAttempts(0)
      sessionStorage.setItem('pos_staff', JSON.stringify(member))
      sessionStorage.setItem('pos_last_activity', Date.now().toString())
      setChecking(false)
      // Fullscreen handled by Electron kiosk mode
      // Ask for notification permission after login (non-blocking, user gesture context)
      requestNotificationPermission().catch(() => {})

      // Check if this staff member has a fingerprint registered
      // Verify with the fingerprint service that templates actually exist
      if (biometricAvailable) {
        let serviceHasTemplates = true
        try {
          const listRes = await fetch(`${getFingerprintUrl()}/list`, { signal: AbortSignal.timeout(2000) })
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

        // Re-arm the offline fingerprint map. Sin esto solo se escribia al enrolar,
        // asi que un localStorage limpio dejaba la huella offline muerta para siempre
        // (el match 1:N del servicio C# es local y si funciona sin red).
        try {
          const fpMap = JSON.parse(localStorage.getItem('pos_fingerprint_staff') || '{}')
          fpMap[member.id] = { id: member.id, name: member.name, role: member.role }
          localStorage.setItem('pos_fingerprint_staff', JSON.stringify(fpMap))
        } catch {}
      }

      setUnlocked(true)
      // Go to table map after login (only if on bare /pos without mesa param)
      if (window.location.pathname === '/pos' && !window.location.search) {
        router.push('/pos/mesas')
      }
    }

    try {
      // Skip network entirely when offline — go straight to local cache
      if (!navigator.onLine) throw new Error('offline')
      // Validación server-side (service key) — el cliente ya no lee pos_staff
      // 4-second timeout: on degraded LAN, browser default is 30-90s — frozen UI
      const res = await fetch(apiUrl('/api/pos/pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, client_id: _cid(), device_id: getTerminalId() }),
        signal: AbortSignal.timeout(4000),
      })
      if (res.status === 403) {
        try {
          const j = await res.json()
          if (j?.code === 'terminal_not_enrolled') { setNotEnrolled(j.device_id || getTerminalId()); return }
        } catch {}
      }
      // 400 = el servidor rechazó el client_id (vacío o mal formado). Es un
      // problema de provisionamiento de la terminal, no del PIN de quien lo
      // teclea. Se dice, y no se cuenta como intento fallido.
      if (res.status === 400) {
        setSinTenant(true)
        setPin('')
        setChecking(false)
        return
      }
      if (res.ok) {
        const { staff: member, shiftToken } = await res.json()
        if (member?.id) {
          try {
            if (shiftToken) {
              localStorage.setItem('pos_shift_token', shiftToken)
              // Sesión fresca: darle un re-intento limpio al backlog de sync con el
              // token nuevo (resetea reintentos agotados y dispara syncAll). Drena las
              // comandas/turnos/caja que se atoraron con el token vencido. No bloquea.
              import('@/lib/pos-offline-db').then(async m => {
                await m.resetSyncQueueRetries()
                await m.syncAll()
              }).catch(() => {})
            }
            // T-26: dejar el mapa de mesas listo para el proximo arranque SIN red.
            // FUERA del if(shiftToken) a proposito: una terminal sin turno abierto
            // tambien necesita ver las mesas ocupadas manana sin internet, y ahi el
            // login no emite token. Corre despues del drenado de arriba (el import es
            // el mismo modulo, ya resuelto) para que el snapshot incluya lo que subio.
            import('@/lib/pos-offline-db')
              .then(m => m.warmActiveOrdersCache(_cid()))
              .catch(() => {})
            const pinHash = await hashPin(pin, member.id)
            localStorage.setItem('pos_staff_cache', JSON.stringify({
              id: member.id, name: member.name, role: member.role,
              exp: Date.now() + 28_800_000,
              pin_hash: pinHash,
            }))
            // pos_staff_cache guarda UNA sola credencial y se sobrescribe en cada login,
            // así que offline sólo podía entrar la última persona que se logueó con red.
            // En una terminal que comparten meseros, cajero y gerente eso falla el primer
            // turno. pos-manager-auth ya tenía el almacén multi-credencial con PBKDF2,
            // salt por dispositivo, revocación y bitácora — sólo no estaba conectado.
            // Se provisiona aquí, sin tocar nada de lo de arriba. Si falla, el camino
            // validado en campo sigue funcionando igual.
            provisionManagerCredential(pin, member.id, member.name, member.role).catch(() => {})
          } catch { /* ignore */ }
          unlock(member)
          return
        }
      }
    } catch {
      // Sin red (modo offline) — check server-issued shift token session
      try {
        const staffJson = localStorage.getItem('pos_staff_cache')
        if (staffJson) {
          const entry = JSON.parse(staffJson)
          // Guard: only accept the auth-object shape. A stale array (legacy bug where
          // fetchMeseros shared this key) must never be treated as a valid session.
          if (entry && !Array.isArray(entry) && entry.exp > Date.now()) {
            // Verify PIN hash when present (new cache entries); old entries without hash pass through
            //
            // Si NO coincide, ya no se falla aquí: este caché guarda a UNA sola persona
            // (la última que se logueó con red), así que un PIN distinto puede ser
            // perfectamente válido y pertenecer a otro empleado de la misma terminal.
            // Se deja pasar al almacén multi-credencial de abajo, que sí tiene a todos.
            // El PIN correcto de la persona cacheada sigue entrando por aquí, idéntico.
            let coincideCacheSimple = true
            if (entry.pin_hash) {
              const hash = await hashPin(pin, entry.id)
              coincideCacheSimple = hash === entry.pin_hash
            }
            if (!coincideCacheSimple) throw new Error('pin-no-es-de-la-persona-cacheada')
            // Offline: bypass checkActiveSession (network-dependent) — restore session directly
            const member: StaffMember = { id: entry.id, name: entry.name, role: entry.role }
            setStaff(member)
            setUnlocked(true)
            setAttempts(0)
            sessionStorage.setItem('pos_staff', JSON.stringify(member))
            sessionStorage.setItem('pos_last_activity', Date.now().toString())
            setChecking(false)
            return
          }
        }
      } catch { /* ignore */ }

      // Almacén multi-credencial (pos-manager-auth): tiene a TODOS los que se han
      // logueado con red en esta terminal, no sólo al último. Cubre los dos casos que
      // el caché simple no puede: otro empleado teclea su PIN, o el caché simple ya
      // venció. Verifica con PBKDF2 + salt del dispositivo, respeta revocación y deja
      // bitácora que se sincroniza al reconectar.
      try {
        const offline = await verifyPinOffline(pin, 'pos_login')
        if (offline) {
          // El id viene de la credencial que acaba de coincidir, no de `pos_staff_cache`.
          // Ese caché guarda a UNA sola persona, así que buscar el id por nombre ahí
          // devolvía `''` para el segundo empleado — y un id vacío viaja a la sesión y
          // a pos_attendance. Era justo el caso que este almacén existe para cubrir.
          const member: StaffMember = { id: offline.staff_id, name: offline.name, role: offline.role }
          setStaff(member)
          setUnlocked(true)
          setAttempts(0)
          sessionStorage.setItem('pos_staff', JSON.stringify(member))
          sessionStorage.setItem('pos_last_activity', Date.now().toString())
          setChecking(false)
          return
        }
      } catch { /* almacén no disponible — cae al mensaje de abajo */ }

      // Camino de falla sin red. Son TRES casos, no dos, y lo que decide es si se
      // cuenta el intento — porque contar de más bloquea la terminal a los 5 intentos.
      //
      // El de en medio es el que muerde: un restaurante que abre pasadas las 16 h del
      // TTL tiene credenciales guardadas y ninguna válida. Tratarlo como PIN incorrecto
      // bloquearía al gerente tecleando bien, justo el día que abre sin internet.
      const estado = estadoCredencialesOffline()
      if (estado !== 'utilizable') {
        if (estado === 'todas-vencidas') setSesionVencida(true)
        else setNetworkError(true)
        setPin('')
        setTimeout(() => { setNetworkError(false); setSesionVencida(false) }, 4000)
        setChecking(false)
        return
      }
      // `utilizable`: había con qué juzgar y ninguna credencial coincidió. El PIN está
      // mal de verdad, así que cae al contador de abajo — que es lo que #133 se saltó,
      // dejando intentos infinitos sin red (comparado contra cd3bdb1e^).
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

  // Fullscreen is handled by Electron kiosk mode — no browser fullscreen needed

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
    <POSLockContext.Provider value={{ lock: () => { setUnlocked(false); setPin('') } }}>
      <div className="pos-kiosk" style={{
        background:'#0a0a0f', color:'#fff', minHeight:'100dvh', overflow:'auto',
        colorScheme:'dark',
        // Force all CSS variables to dark values for POS
        // @ts-expect-error CSS custom properties
        '--bg':'#0a0a0f','--bg-1':'#0f0f14','--surface':'#111118','--surface-2':'#1a1a24',
        '--bento-card':'#15151d','--panel':'#141420','--raised':'#1c1c26','--shadow-mid':'0 1px 2px rgba(0,0,0,0.55), 0 14px 34px rgba(0,0,0,0.4)',
        '--line':'rgba(255,255,255,0.08)','--line-soft':'rgba(255,255,255,0.04)',
        '--text-1':'#fff','--text-2':'rgba(255,255,255,0.7)','--text-3':'rgba(255,255,255,0.45)',
        '--text-4':'rgba(255,255,255,0.25)',
      }}>
        {/* Ritual de onboarding: los PINs de plantilla se muestran UNA vez en el
            alta; si alguien sigue operando con la cuenta "(plantilla)" el banner
            empuja a rotarlos. Solo visual — no toca la ruta de login offline. */}
        {staff?.name?.includes('(plantilla)') && (
          <div className="flex items-center justify-center gap-2 bg-amber-500/15 border-b border-amber-500/30 px-3 py-1.5 text-[12px] text-amber-300">
            <span>Estás usando un PIN de plantilla — crea a tu equipo y rota los PINs.</span>
            <a href="/pos/staff" className="font-bold underline underline-offset-2 hover:text-amber-200">Ir a Personal</a>
          </div>
        )}
        <TurnoGate staff={staff!}>
          {children}
        </TurnoGate>
      </div>
    </POSLockContext.Provider>
  )

  const remainingAttempts = MAX_ATTEMPTS - attempts

  return (
    <div className="pos-kiosk h-dvh flex items-center justify-center bg-slate-900 text-white select-none" style={{background: 'linear-gradient(180deg, #0a0a14 0%, #111827 100%)'}}
      onClick={() => { /* Fullscreen handled by Electron kiosk mode */ }}
    >
      <div className="text-center w-full max-w-xs mx-4">
        <div className="mb-8">
          {/* Restaurant logo — loaded async from DB to prevent tenant bleed-through */}
          <img
            src={logoSrc || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}
            alt=""
            className={`h-24 mx-auto mb-4 object-contain${logoSrc ? '' : ' opacity-0'}`}
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
          {/* Nombre del restaurante (tenant) — el header del mockup */}
          {clientName && (
            <div className="font-mono text-xs tracking-[0.22em] uppercase text-emerald-400/80 mb-2">{clientName}</div>
          )}
          {/* Marca de producto Fullsite (wordmark en CSS, crisp) */}
          <div className="mb-4 flex items-baseline justify-center" aria-label="Fullsite">
            <span className="text-white font-black tracking-[-0.04em]" style={{ fontSize: 34 }}>fullsite</span>
            <span className="inline-block bg-emerald-500" style={{ width: 11, height: 11, marginLeft: 3, borderRadius: 2 }} />
          </div>
          <p className="text-slate-400 text-sm mt-2">
            {biometricAvailable ? 'Huella digital o PIN para abrir' : 'Ingresa tu PIN para abrir'}
          </p>
          <button
            onClick={() => {
              const fApp = (window as unknown as { fullsiteApp?: { quit: () => void } }).fullsiteApp
              if (fApp?.quit) { fApp.quit(); return }
              try { document.exitFullscreen?.() } catch {}
              window.close()
              window.location.href = 'about:blank'
            }}
            className="mt-4 text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            Salir de la aplicacion
          </button>
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

        {/* Puntitos del PIN (progreso) */}
        <div className="flex items-center justify-center gap-3 mb-6" aria-hidden>
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span
              key={i}
              className="rounded-full transition-all"
              style={{
                width: 14,
                height: 14,
                background: i < pin.length ? '#10b981' : 'transparent',
                border: i < pin.length ? 'none' : '2px solid rgba(148,163,184,0.35)',
              }}
            />
          ))}
        </div>

        {/* Teclado numérico touch-first */}
        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              onClick={() => { if (!isLocked && !checking) setPin((p) => (p + d).slice(0, 10)) }}
              disabled={isLocked || checking}
              className="min-h-[64px] rounded-2xl bg-slate-800/70 hover:bg-slate-700 active:scale-95 border border-slate-700 text-white text-2xl font-bold transition-all disabled:opacity-40"
            >
              {d}
            </button>
          ))}
          {/* Borrar */}
          <button
            onClick={() => { if (!isLocked && !checking) setPin((p) => p.slice(0, -1)) }}
            disabled={isLocked || checking || pin.length === 0}
            aria-label="Borrar"
            className="min-h-[64px] rounded-2xl bg-slate-800/40 hover:bg-slate-700 active:scale-95 border border-slate-700 text-slate-300 flex items-center justify-center transition-all disabled:opacity-30"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2ZM18 9l-6 6M12 9l6 6" /></svg>
          </button>
          {/* 0 */}
          <button
            onClick={() => { if (!isLocked && !checking) setPin((p) => (p + '0').slice(0, 10)) }}
            disabled={isLocked || checking}
            className="min-h-[64px] rounded-2xl bg-slate-800/70 hover:bg-slate-700 active:scale-95 border border-slate-700 text-white text-2xl font-bold transition-all disabled:opacity-40"
          >
            0
          </button>
          {/* Entrar */}
          <button
            onClick={handleSubmit}
            disabled={pin.length < 4 || checking || isLocked}
            aria-label="Entrar"
            className="min-h-[64px] rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center transition-all"
          >
            {checking
              ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
          </button>
        </div>

        {sessionError && (
          <p className="text-amber-400 text-sm mt-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            {sessionError}
          </p>
        )}
        {networkError && (
          <p className="text-amber-400 text-sm mt-3">
            Sin conexión — espera un momento e intenta de nuevo
          </p>
        )}
        {sesionVencida && (
          <p className="text-amber-400 text-sm mt-3">
            La sesión guardada en esta terminal venció — conéctala a internet una vez
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
        {sinTenant && (
          <div className="text-sm mt-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-300">
            Esta terminal no tiene restaurante asignado, así que no puede validar el PIN.
            No es tu PIN: es configuración. Pide a tu admin que la provisione.
          </div>
        )}
        {notEnrolled && (
          <div className="text-sm mt-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-300">
            Esta terminal no está autorizada. Pide a tu admin que la dé de alta con este ID:
            <span className="block font-mono text-amber-200 mt-1 select-all break-all">{notEnrolled}</span>
          </div>
        )}
      </div>
    </div>
  )
}
