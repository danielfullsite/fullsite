'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    // Handle the OAuth callback — Supabase sends tokens via URL hash
    async function handleCallback() {
      try {
        // Check URL hash for tokens (Supabase OAuth flow)
        const hash = window.location.hash
        if (hash) {
          const params = new URLSearchParams(hash.substring(1))
          const accessToken = params.get('access_token')
          const refreshToken = params.get('refresh_token')

          if (accessToken && refreshToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })

            if (sessionError) {
              setError(sessionError.message)
              return
            }

            window.location.href = '/'
            return
          }
        }

        // Check for error in URL params
        const urlParams = new URLSearchParams(window.location.search)
        const errorParam = urlParams.get('error')
        const errorDesc = urlParams.get('error_description')

        if (errorParam) {
          setError(errorDesc || errorParam)
          return
        }

        // Try to get session from Supabase (handles PKCE flow)
        const { data: { session }, error: getError } = await supabase.auth.getSession()
        if (getError) {
          setError(getError.message)
          return
        }

        if (session) {
          window.location.href = '/'
        } else {
          setError('No se pudo obtener la sesion. Intenta de nuevo.')
        }
      } catch {
        setError('Error procesando la autenticacion.')
      }
    }

    handleCallback()
  }, [])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--surface)] px-4">
        <div className="text-center max-w-sm">
          <p className="text-red-600 font-medium mb-4">{error}</p>
          <a
            href="/login"
            className="inline-flex items-center gap-2 bg-emerald-500/100 text-white font-semibold text-sm rounded-lg px-6 py-3 hover:bg-emerald-600 transition-colors"
          >
            Volver al login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface)]">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[var(--text-2)] text-sm font-medium">Autenticando...</p>
      </div>
    </div>
  )
}
