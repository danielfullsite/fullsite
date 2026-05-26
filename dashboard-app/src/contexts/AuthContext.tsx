'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

// Dashboard roles — controls page visibility
// dueño: sees EVERYTHING (financials, gastos, nómina, P&L, all agents)
// gerente: sees operations (ventas, meseros, inventario, coach) but NOT financials
// staff: sees only POS-related pages
export type DashboardRole = 'dueño' | 'gerente' | 'staff'

// Role-based page access
const FINANCIAL_PAGES = ['/estado-resultados', '/nomina', '/ingresos', '/proveedores', '/food-cost']
const OPERATIONS_PAGES = ['/', '/ventas', '/cortes', '/meseros', '/platillos', '/tendencias', '/propinas', '/inventario', '/ecommerce', '/reportes', '/coach', '/chat']
const STAFF_PAGES = ['/pos']

export function canAccessPage(role: DashboardRole, path: string): boolean {
  if (role === 'dueño') return true
  if (role === 'gerente') return !FINANCIAL_PAGES.some(p => path.startsWith(p)) || OPERATIONS_PAGES.some(p => path === p || path.startsWith(p + '/'))
  if (role === 'staff') return STAFF_PAGES.some(p => path.startsWith(p))
  return false
}

// Map emails to roles (in production, move to Supabase table)
const ROLE_MAP: Record<string, DashboardRole> = {
  'ramonfaur.daniel@gmail.com': 'dueño',
  'monica@fullsite.mx': 'dueño',
  // Add more users here or migrate to DB
}

export interface ClientLocation {
  id: string
  name: string
  address?: string
}

interface AuthContextType {
  user: User | null
  role: DashboardRole
  clientId: string | null
  clientConfig: { id: string; name?: string } | null
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
  const [clientConfig, setClientConfig] = useState<{ id: string; name?: string } | null>(null)
  const [locations, setLocations] = useState<ClientLocation[]>([])
  const [locationId, setLocationId] = useState<string | null>(null)
  const [role, setRole] = useState<DashboardRole>('staff')
  const [loading, setLoading] = useState(true)

  // createBrowserClient from @supabase/ssr is a singleton by default
  const supabase = useMemo(() => createClient(), [])

  const loadClientData = useCallback(async (userId: string) => {
    try {
      // Look up client_id from client_users table
      const { data: clientUser, error } = await supabase
        .from('client_users')
        .select('client_id')
        .eq('user_id', userId)
        .limit(1)
        .single()

      const cid = (clientUser as { client_id: string } | null)?.client_id
      if (error || !cid) {
        // Fallback to 'amalay' for graceful degradation
        console.warn('No client_users mapping found, falling back to amalay')
        setClientId('amalay')
        setClientConfig({ id: 'amalay', name: 'AMALAY Coffee & Market' })
        return
      }

      setClientId(cid)

      // Fetch client config
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('id', cid)
        .single()

      setClientConfig(client ? { id: (client as { id: string }).id, name: (client as { id: string }).id } : { id: cid })

      // Fetch locations for this client
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
    } catch {
      // Fallback
      console.warn('Error loading client data, falling back to amalay')
      setClientId('amalay')
      setClientConfig({ id: 'amalay', name: 'AMALAY Coffee & Market' })
    }
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
              await loadClientData(parsed.user.id)
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
          await loadClientData(currentUser.id)
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
          setRole(ROLE_MAP[currentUser.email || ''] || 'staff')
          await loadClientData(currentUser.id)
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
