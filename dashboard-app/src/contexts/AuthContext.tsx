'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'
import { getClientConfig, getClientIdFromEmail, fetchClientConfig, type ClientConfig } from '@/lib/client-config'
import { applyAccent } from '@/lib/accent'
import { applyTenantDefaultTheme } from '@/lib/tenant-theme'

import { canAccessPage, resolveRole, ROLE_MAP, type DashboardRole, type StaffPermissions } from '@/lib/roles'

// Re-export para compatibilidad (Sidebar, tests importan desde aquí)
export { canAccessPage, type DashboardRole }

export interface ClientLocation {
  id: string
  name: string
  address?: string
}

interface AuthContextType {
  /** Permisos por empleado (override opcional del rol). undefined = usar rol. */
  permissions?: StaffPermissions
  user: User | null
  role: DashboardRole
  clientId: string | null
  clientConfig: ClientConfig | null
  locations: ClientLocation[]
  locationId: string | null
  setLocationId: (id: string | null) => void
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: 'staff',
  clientId: null,
  clientConfig: null,
  locations: [],
  locationId: null,
  setLocationId: () => {},
  loading: true,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientConfig, setClientConfig] = useState<ClientConfig | null>(null)
  const [locations, setLocations] = useState<ClientLocation[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<StaffPermissions | undefined>(undefined)
  const [role, setRole] = useState<DashboardRole>('staff')
  const [loading, setLoading] = useState(true)

  // createBrowserClient from @supabase/ssr is a singleton by default
  const supabase = useMemo(() => createClient(), [])

  const loadClientData = useCallback(async (userId: string, userEmail?: string, userMeta?: Record<string, unknown>, appMeta?: Record<string, unknown>) => {
    // Priority 1: app_metadata.client_id (admin-only, not user-writable in Supabase)
    // Fall back to user_metadata.client_id for users not yet migrated
    const metaClientId = (appMeta?.client_id ?? userMeta?.client_id) as string | undefined

    // Priority 2: client_users table (DB lookup) — también es la fuente de verdad del rol
    let dbClientId: string | null = null
    try {
      const { data: clientUser } = await supabase
        .from('client_users')
        .select('client_id, role')
        .eq('user_id', userId)
        .neq('role', 'platform_actas')           // una membresía de impersonación NUNCA es el "home"
        .order('client_id', { ascending: true })  // determinista: si es dueño de varios, home estable (no aleatorio)
        .limit(1)
        .maybeSingle()
      const cu = clientUser as { client_id: string; role: string | null } | null
      dbClientId = cu?.client_id || null
      // Role: DB row wins; fall back to app_metadata.role (admin-set, not user-writable)
      const effectiveRole = cu?.role || (appMeta?.role as string | undefined) || null
      setRole(resolveRole(effectiveRole, userEmail))
    } catch { /* table might not exist for new installs */
      // If DB query fails entirely, still try app_metadata.role
      const metaRole = appMeta?.role as string | undefined
      if (metaRole) setRole(resolveRole(metaRole, userEmail))
    }

    // Priority 3: email-to-client mapping
    const emailClientId = getClientIdFromEmail(userEmail || '')

    // Use first available
    let cid = metaClientId || dbClientId || emailClientId

    // Act-as: si hay un tenant de impersonación activo (lo fija "Entrar" en
    // /platform/tenants, endpoint server-gated por is_platform_admin), ese tenant
    // manda. NO se depende de app_metadata.platform_admin del JWT: la sesión puede
    // traerlo viejo/ausente y el override no aplicaba, dejando el banner "viendo X"
    // desincronizado del tenant real. La seguridad real es RLS (BUG-019): si el
    // usuario no es miembro del tenant, sus lecturas quedan vacías (no hay fuga).
    // "Salir" limpia el flag.
    try {
      const actas = typeof window !== 'undefined' ? localStorage.getItem('fullsite_actas') : null
      if (actas) {
        // localStorage es por-origen, no por-cuenta: un act-as dejado por un admin
        // sobrevive a un cambio de cuenta en el mismo navegador y contaminaba la
        // sesión de un usuario normal (cid ajeno + rol dueño forzado → RLS deja los
        // dashboards vacíos y el banner "viendo X" aparece a quien nunca impersonó;
        // visto en campo 2026-08-28 con demo.diezmex heredando amalay). Antes de
        // honrar el flag se verifica contra el server que ESTA sesión es admin de
        // plataforma; si no, el flag es huérfano y se limpia (self-healing).
        let isAdmin = false
        try {
          const probe = await fetch('/api/platform/2fa/status', { credentials: 'include', cache: 'no-store' })
          isAdmin = probe.ok
        } catch { /* red caída → no elevar */ }
        if (isAdmin) {
          cid = actas
          setRole(resolveRole('dueño', userEmail)) // ve el tenant con acceso completo
        } else {
          try { localStorage.removeItem('fullsite_actas') } catch { /* SSR */ }
        }
      }
    } catch { /* SSR */ }

    setClientId(cid)

    // Persist for data.ts getActiveClientSlug() — allows data functions to auto-resolve client
    if (cid) {
      try {
        // Cambio de tenant en el MISMO navegador: purgar los cachés de identidad
        // y turno del tenant anterior. Sin esto, el turno cacheado de un
        // restaurante aparecía en el POS de otro ("Turno del día anterior —
        // Daniel, 25 ago" de amalay dentro de carls-jr, visto en campo
        // 2026-08-29) y su botón de Corte Z apuntaba a la caja equivocada.
        // NO se tocan las colas (print/offline): son operaciones pendientes que
        // deben sincronizar aunque cambie la sesión.
        const prev = localStorage.getItem('fullsite_client_id')
        if (prev && prev !== cid) {
          // Al cambiar de tenant hay que barrer TODO caché de negocio del
          // anterior. El crítico es pos_shift_token (fuga F-7): withPOSAuth lo
          // valida antes que la sesión, así que un token viejo seguía leyendo/
          // escribiendo en el restaurante anterior. Se incluyen aquí todas las
          // llaves con datos de un tenant; las de prefijo (pos_order_*) se
          // barren por recorrido abajo. NO se tocan las colas de sincronización
          // (print/offline): son operaciones pendientes que deben subir.
          const exactKeys = [
            'pos_cached_turno', 'pos_turno_cache', 'pos_staff_cache',
            'pos_manager_credentials_v2', 'pos_service_model',
            'pos_shift_token', 'pos_turno_id', 'pos_manager_pin_cache',
            'pos_meseros_cache', 'pos_mesero', 'pos_last_turno_sync',
            'pos_fingerprint_staff', 'pos_terminal_id',
          ]
          for (const k of exactKeys) {
            try { localStorage.removeItem(k) } catch { /* — */ }
          }
          // Cachés por-mesa/orden con prefijo de tenant anterior.
          try {
            for (const k of Object.keys(localStorage)) {
              if (/^pos_(order|draft|plano)_/.test(k)) localStorage.removeItem(k)
            }
          } catch { /* — */ }
          for (const k of [] as string[]) {
            try { localStorage.removeItem(k) } catch { /* — */ }
          }
        }
        localStorage.setItem('fullsite_client_id', cid)
      } catch { /* SSR */ }
    }

    // Load full client config from Supabase (with fallback to hardcoded)
    const config = await fetchClientConfig(cid)
    setClientConfig(config)
    // Contrato multi-tenant (Hallazgo #1): marca + tema por cliente en runtime.
    // Acento: AMALAY=emerald → no-op; otros heredan su color. Tema: adopta default_theme si el usuario no eligió.
    applyAccent(config?.accent_color)
    applyTenantDefaultTheme(config?.default_theme)

    // Set data source switch (wansoft or fullsite)
    const ds = config?.data_source
    if (ds === 'fullsite') {
      try { localStorage.setItem('fullsite_data_source', 'fullsite') } catch {}
    } else {
      try { localStorage.setItem('fullsite_data_source', 'wansoft') } catch {}
    }

    // Fetch locations for this client
    try {
      const { data: locs } = await supabase
        .from('client_locations')
        .select('id,name,address')
        .eq('client_id', cid)
        .eq('active', true)
        .order('name')

      const locList = (locs || []) as ClientLocation[]
      setLocations(locList)
      if (locList.length > 0 && !locationId) {
        setLocationId(locList[0].id)
      }
    } catch { /* locations table might not exist */ }

    // Permisos por empleado (override opcional del rol). staffId es el auth user
    // en sesión dashboard. Sin fila → permissions queda undefined → canAccessPage
    // cae al rol (comportamiento de siempre). La tabla puede no existir aún.
    try {
      const { data: perm } = await supabase
        .from('pos_staff_permissions')
        .select('sections')
        .eq('client_id', cid)
        .eq('staff_id', userId)
        .maybeSingle()
      const sections = (perm as { sections?: StaffPermissions } | null)?.sections
      setPermissions(sections && Object.keys(sections).length > 0 ? sections : undefined)
    } catch { setPermissions(undefined) }
  }, [supabase])

  useEffect(() => {
    const initAuth = async () => {
      try {
        // First check localStorage for tokens (set by login page)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
        const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
        const stored = localStorage.getItem(storageKey)

        if (stored) {
          try {
            const parsed = JSON.parse(stored)
            if (parsed.user) {
              setUser(parsed.user)
              setRole(ROLE_MAP[parsed.user.email || ''] || 'staff')
              await loadClientData(parsed.user.id, parsed.user.email, parsed.user.user_metadata, parsed.user.app_metadata)
              setLoading(false)
              return
            }
          } catch { /* ignore parse errors */ }
        }

        // Fallback: try SDK getSession
        const { data: { session } } = await supabase.auth.getSession()
        const currentUser = session?.user ?? null
        setUser(currentUser)
        if (currentUser) {
          setRole(ROLE_MAP[currentUser.email || ''] || 'staff')
          await loadClientData(currentUser.id, currentUser.email || undefined, currentUser.user_metadata, currentUser.app_metadata)
        }
      } catch (err) {
        console.error('Error initializing auth:', err)
      } finally {
        setLoading(false)
      }
    }

    // Timeout safety — never stay loading forever
    const timeout = setTimeout(() => setLoading(false), 5000)
    initAuth().finally(() => clearTimeout(timeout))

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const currentUser = session?.user ?? null
        setUser(currentUser)
        if (currentUser) {
          // Mantener fresco el cookie del middleware (p. ej. en TOKEN_REFRESHED)
          if (session?.access_token) {
            try {
              document.cookie = `fs-at=${session.access_token}; path=/; max-age=${session.expires_in || 3600}; secure; samesite=lax`
            } catch { /* SSR */ }
          }
          setRole(ROLE_MAP[currentUser.email || ''] || 'staff')
          await loadClientData(currentUser.id, currentUser.email || undefined, currentUser.user_metadata, currentUser.app_metadata)
        } else {
          setClientId(null)
          setClientConfig(null)
        }
        setLoading(false)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase, loadClientData])

  // Auto-logout: clear tokens when browser/tab closes
  // sessionStorage survives reloads but dies on tab close
  useEffect(() => {
    // En la app nativa (Capacitor) cada arranque en frío es "tab nueva" —
    // no borrar el token o pediría login en cada apertura de la app
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    if (cap?.isNativePlatform?.()) return

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    let storageKey = ''
    try { storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token` } catch {}
    if (!storageKey) return

    // On mount: check if this is a fresh tab (no sessionStorage marker)
    if (!sessionStorage.getItem('fullsite_session')) {
      // Fresh tab — clear any stale auth tokens from previous sessions
      localStorage.removeItem(storageKey)
    }
    // Mark this tab as active
    sessionStorage.setItem('fullsite_session', '1')
  }, [])

  const signOut = async () => {
    try { await supabase.auth.signOut() } catch { /* */ }
    // Clear manually-stored tokens from login page
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    try {
      const hostname = new URL(supabaseUrl).hostname.split('.')[0]
      localStorage.removeItem(`sb-${hostname}-auth-token`)
    } catch { /* */ }
    try { document.cookie = 'fs-at=; path=/; max-age=0' } catch { /* */ }
    setUser(null)
    setClientId(null)
    setClientConfig(null)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{ user, role, clientId, clientConfig, locations, locationId, setLocationId, loading, signOut, permissions }}>
      {children}
    </AuthContext.Provider>
  )
}
