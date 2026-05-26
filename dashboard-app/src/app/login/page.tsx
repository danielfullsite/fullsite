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
        // Check if demo user → redirect to demo dashboard
        const clientId = data.user?.user_metadata?.client_id
        window.location.href = clientId === 'demo' ? '/demo/dashboard' : '/'
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
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left — photo */}
      <div className="hidden lg:block lg:w-[55%] relative">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80')` }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/50" />
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
            <span className="text-gray-900 font-black text-3xl tracking-tight">
              fullsite<span className="inline-block w-3 h-3 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Bienvenido</h2>
          <p className="text-gray-400 text-sm mb-10">Inicia sesion para continuar</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-900 mb-1.5">
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
                className="w-full text-sm bg-white border border-gray-300 rounded-lg px-4 py-3 text-gray-900 autofill:bg-white autofill:shadow-[inset_0_0_0px_1000px_rgb(255,255,255)] autofill:[-webkit-text-fill-color:rgb(17,24,39)] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-900 mb-1.5">
                Contrasena
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className="w-full text-sm bg-white border border-gray-300 rounded-lg px-4 py-3 text-gray-900 autofill:bg-white autofill:shadow-[inset_0_0_0px_1000px_rgb(255,255,255)] autofill:[-webkit-text-fill-color:rgb(17,24,39)] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-600 rounded-lg px-4 py-3 text-sm">{error}</div>
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

          <p className="mt-6 text-center text-sm text-gray-500">
            No tienes cuenta?{' '}
            <a
              href="https://wa.me/528115324371?text=Hola%20Daniel%2C%20me%20interesa%20crear%20una%20cuenta%20en%20Fullsite."
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-600 font-medium hover:text-emerald-700 transition-colors"
            >
              Contactanos
            </a>
          </p>

          <div className="mt-8 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center">
              <a href="/privacidad" className="hover:text-gray-500 transition-colors">Privacidad</a>
              {' · '}
              <a href="/terminos" className="hover:text-gray-500 transition-colors">Terminos</a>
              {' · '}
              <a href="/seguridad" className="hover:text-gray-500 transition-colors">Seguridad</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
