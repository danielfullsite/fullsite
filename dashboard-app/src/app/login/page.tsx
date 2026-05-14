'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        if (authError.message.includes('Invalid login')) {
          setError('Credenciales incorrectas. Verifica tu email y contrasena.')
        } else {
          setError(authError.message)
        }
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError('Error al iniciar sesion. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-[#1a1a1a] font-black text-3xl tracking-tight">
            fullsite
            <span className="inline-block w-2.5 h-2.5 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
          </span>
          <p className="text-text-soft text-sm mt-2">Panel de operaciones</p>
        </div>

        {/* Login Card */}
        <div className="bg-card rounded-xl border border-border card-shadow p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-text mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                required
                className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text mb-1.5">
                Contrasena
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full text-sm bg-surface border border-border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="bg-danger-bg border border-danger/20 text-danger rounded-lg px-3 py-2 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent text-white font-medium text-sm rounded-lg px-4 py-2.5 hover:bg-accent-dark transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Iniciando sesion...
                </span>
              ) : (
                'Iniciar sesion'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-text-muted mt-6">
          Fullsite Dashboard &mdash; Acceso restringido
        </p>
      </div>
    </div>
  )
}
