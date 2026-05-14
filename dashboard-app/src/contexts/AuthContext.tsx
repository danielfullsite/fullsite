'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  clientId: string | null
  clientConfig: { id: string; name?: string } | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  clientId: null,
  clientConfig: null,
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

      if (error || !clientUser) {
        // Fallback to 'amalay' for graceful degradation
        console.warn('No client_users mapping found, falling back to amalay')
        setClientId('amalay')
        setClientConfig({ id: 'amalay', name: 'AMALAY Coffee & Market' })
        return
      }

      setClientId(clientUser.client_id)

      // Fetch client config
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('id', clientUser.client_id)
        .single()

      setClientConfig(client ? { id: client.id, name: client.id } : { id: clientUser.client_id })
    } catch {
      // Fallback
      console.warn('Error loading client data, falling back to amalay')
      setClientId('amalay')
      setClientConfig({ id: 'amalay', name: 'AMALAY Coffee & Market' })
    }
  }, [supabase])

  useEffect(() => {
    // Get initial session
    const initAuth = async () => {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        setUser(currentUser)
        if (currentUser) {
          await loadClientData(currentUser.id)
        }
      } catch {
        console.error('Error initializing auth')
      } finally {
        setLoading(false)
      }
    }

    initAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const currentUser = session?.user ?? null
        setUser(currentUser)
        if (currentUser) {
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

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setClientId(null)
    setClientConfig(null)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{ user, clientId, clientConfig, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
