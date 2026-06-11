'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'
import { getClientConfig, getClientIdFromEmail, fetchClientConfig, type ClientConfig } from '@/lib/client-config'

import { canAccessPage, resolveRole, ROLE_MAP, type DashboardRole } from '@/lib/roles'

// Re-export para compatibilidad (Sidebar, tests importan desde aquí)
export { canAccessPage, type DashboardRole }

export interface ClientLocation {
  id: string
  name: string
  address?: string
}

interface AuthContextType {
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
  const [role, setRole] = useState<DashboardRole>('staff')
  const [loading, setLoading] = useState(true)

  // createBrowserClient from @supabase/ssr is a singleton by default
  const supabase = useMemo(() => createClient(), [])

  const loadClientData = useCallback(async (userId: string, userEmail?: string, userMeta?: Record<string, unknown>) => {
    // Priority 1: user_metadata.client_id (set at signup, instant)
    const metaClientId = userMeta?.client_id as string | undefined

    // Priority 2: client_users table (DB lookup) — también es la fuente de verdad del rol
    let dbClientId: string | null = null
    try {
      const { data: clientUser } = await supabase
        .from('client_users')
        .select('client_id, role')
        .eq('user_id', userId)
        .limit(1)
        .single()
      const cu = clientUser as { client_id: string; role: string | null } | null
      dbClientId = cu?.client_id || null
      setRole(resolveRole(cu?.role || null, userEmail))
    } catch { /* table might not exist for new installs */ }

    // Priority 3: email-to-client mapping
    const emailClientId = getClientIdFromEmail(userEmail || '')

    // Use first available
    const cid = metaClientId || dbClientId || emailClientId
    setClientId(cid)

    // Persist for data.ts getActiveClientSlug() — allows data functions to auto-resolve client
    if (cid) {
      try { localStorage.setItem('fullsite_client_id', cid) } catch { /* SSR */ }
    }

    // Load full client config from Supabase (with fallback to hardcoded)
    const config = await fetchClientConfig(cid)
    setClientConfig(config)

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
              await loadClientData(parsed.user.id, parsed.user.email, parsed.user.user_metadata)
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
          await loadClientData(currentUser.id, currentUser.email || undefined, currentUser.user_metadata)
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
          await loadClientData(currentUser.id, currentUser.email || undefined, currentUser.user_metadata)
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
    <AuthContext.Provider value={{ user, role, clientId, clientConfig, locations, locationId, setLocationId, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
