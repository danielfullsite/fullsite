'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'apikey': supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        const rawMsg = data.error_description || data.msg || ''
        const errorMap: Record<string, string> = {
          'Invalid login credentials': 'Credenciales incorrectas',
          'Email not confirmed': 'Correo no confirmado. Revisa tu bandeja.',
          'User not found': 'Usuario no encontrado',
          'Too many requests': 'Demasiados intentos. Espera un momento.',
        }
        setError(errorMap[rawMsg] || rawMsg || 'Credenciales incorrectas')
        setLoading(false)
        return
      }
      if (data.access_token) {
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
        setError('No se pudo crear la sesion.')
        setLoading(false)
      }
    } catch {
      setError('Error de conexion.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative">
      {/* Photo background — visible on ALL devices */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80')` }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/40" />
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Logo — top on mobile, centered on desktop */}
        <div className="lg:hidden pt-16 pb-6 px-6">
          <span className="text-white font-black text-3xl tracking-tight drop-shadow-xl">
            fullsite<span className="inline-block w-3 h-3 bg-emerald-400 ml-0.5 mb-0.5 rounded-none" />
          </span>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row">
          {/* Left — big logo on desktop */}
          <div className="hidden lg:flex lg:w-[55%] items-center justify-center">
            <span className="text-white font-black text-7xl tracking-tight drop-shadow-2xl">
              fullsite
              <span className="inline-block w-5 h-5 bg-emerald-400 ml-1 mb-1 rounded-none" />
            </span>
          </div>

          {/* Right — form */}
          <div className="flex-1 flex items-end lg:items-center justify-center px-6 pb-8 lg:pb-0 lg:px-16">
            <div className="w-full max-w-sm">
              {/* Glass card */}
              <div className="rounded-2xl border border-white/10 p-6 backdrop-blur-xl" style={{ background: 'rgba(0,0,0,0.6)' }}>
                <h2 className="text-2xl font-bold text-white mb-1">Bienvenido</h2>
                <p className="text-white/40 text-sm mb-6">Inicia sesion para continuar</p>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-white/60 mb-1.5">
                      Correo electronico
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nombre@empresa.com"
                      required
                      disabled={loading}
                      className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all backdrop-blur-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-white/60 mb-1.5">
                      Contrasena
                    </label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading}
                      className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all backdrop-blur-sm"
                    />
                  </div>

                  {error && (
                    <div className="bg-red-500/15 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{error}</div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-emerald-500 text-white font-semibold text-sm rounded-xl px-4 py-3.5 hover:bg-emerald-400 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 group"
                  >
                    {loading ? (
                      <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Ingresando...</>
                    ) : (
                      <>Continuar <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" /></>
                    )}
                  </button>
                </form>
              </div>

              {/* Contact */}
              <p className="mt-5 text-center text-sm text-white/30">
                No tienes cuenta?{' '}
                <a
                  href="https://wa.me/528115324371?text=Hola%20Daniel%2C%20me%20interesa%20crear%20una%20cuenta%20en%20Fullsite."
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 font-medium hover:text-emerald-300 transition-colors"
                >
                  Contactanos
                </a>
              </p>

              {/* Footer */}
              <div className="mt-6 pt-4 border-t border-white/5">
                <p className="text-[10px] text-white/20 text-center">
                  <a href="/privacidad" className="hover:text-white/40 transition-colors">Privacidad</a>
                  {' · '}
                  <a href="/terminos" className="hover:text-white/40 transition-colors">Terminos</a>
                  {' · '}
                  <a href="/seguridad" className="hover:text-white/40 transition-colors">Seguridad</a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
