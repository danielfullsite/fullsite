'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { ArrowRight } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error_description || data.msg || 'Credenciales incorrectas')
        setLoading(false)
        return
      }
      if (data.access_token) {
        // Store tokens directly in localStorage (skip SDK setSession which hangs)
        const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
        localStorage.setItem(storageKey, JSON.stringify({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at,
          expires_in: data.expires_in,
          token_type: data.token_type,
          user: data.user,
        }))
        window.location.href = '/'
      } else {
        setError('No se pudo crear la sesión.')
        setLoading(false)
      }
    } catch {
      setError('Error de conexión.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left — photo */}
      <div className="hidden lg:block lg:w-[55%] relative">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80')` }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/50" />
        {/* Logo centered on photo — white text */}
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <span className="text-white font-black text-7xl tracking-tight drop-shadow-2xl">
            fullsite
            <span className="inline-block w-5 h-5 bg-emerald-400 ml-1 mb-1 rounded-none" />
          </span>
        </div>
      </div>

      {/* Right — white form panel */}
      <div className="flex-1 bg-white flex flex-col items-center justify-center px-6 py-10 sm:px-8 sm:py-12 lg:px-16">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <span className="text-[#1a1a1a] font-black text-3xl tracking-tight">
              fullsite<span className="inline-block w-3 h-3 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-1">Bienvenido</h2>
          <p className="text-slate-400 text-sm mb-10">Inicia sesión para continuar</p>

          {/* Google OAuth */}
          <button
            type="button"
            onClick={async () => {
              setError(null)
              setLoading(true)
              try {
                const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
                  provider: 'google',
                  options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                  },
                })
                if (oauthError) {
                  setError(oauthError.message)
                  setLoading(false)
                }
              } catch {
                setError('Error al conectar con Google')
                setLoading(false)
              }
            }}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 border border-slate-300 rounded-lg px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continuar con Google
          </button>

          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium">o</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Correo electrónico
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@empresa.com"
                required
                disabled={loading}
                className="w-full text-sm border border-slate-300 rounded-lg px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className="w-full text-sm border border-slate-300 rounded-lg px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 text-white font-semibold text-sm rounded-lg px-4 py-3.5 hover:bg-emerald-600 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Ingresando...</>
              ) : (
                <>Continuar <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" /></>
              )}
            </button>
          </form>

          {/* Create account */}
          <p className="mt-6 text-center text-sm text-slate-500">
            ¿No tienes cuenta?{' '}
            <a
              href="https://wa.me/528115324371?text=Hola%20Daniel%2C%20me%20interesa%20crear%20una%20cuenta%20en%20Fullsite."
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-600 font-medium hover:text-emerald-700 transition-colors"
            >
              Contáctanos
            </a>
          </p>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-400 text-center">
              <a href="/privacidad" className="hover:text-slate-600 transition-colors">Privacidad</a>
              {' · '}
              <a href="/terminos" className="hover:text-slate-600 transition-colors">Términos</a>
              {' · '}
              <a href="/seguridad" className="hover:text-slate-600 transition-colors">Seguridad</a>
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}
