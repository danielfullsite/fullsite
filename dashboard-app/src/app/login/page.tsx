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
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) { setError(authError.message); setLoading(false); return }
      if (data?.session) { window.location.href = '/' }
      else { setError('No se pudo crear la sesión.'); setLoading(false) }
    } catch {
      setError('Error de conexión.'); setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left — photo */}
      <div className="hidden lg:block lg:w-[55%] relative">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80')` }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
        <div className="relative z-10 flex flex-col justify-end h-full p-12 pb-16">
          <p className="text-emerald-400 text-sm font-semibold mb-3 tracking-wide uppercase">Fullsite Platform</p>
          <h1 className="text-4xl font-bold text-white leading-tight max-w-lg">
            Inteligencia operativa para restaurantes
          </h1>
          <p className="text-white/50 text-base mt-4 max-w-md">
            Ventas, meseros, platillos, tendencias — todo impulsado por IA.
          </p>
          <div className="flex items-center gap-8 mt-8">
            <div>
              <p className="text-xl font-bold text-white">580+</p>
              <p className="text-xs text-white/40">Días de historial</p>
            </div>
            <div>
              <p className="text-xl font-bold text-white">17</p>
              <p className="text-xs text-white/40">Módulos</p>
            </div>
            <div>
              <p className="text-xl font-bold text-white">24/7</p>
              <p className="text-xs text-white/40">Asistente IA</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right — white form panel */}
      <div className="flex-1 bg-white flex flex-col px-8 py-12 lg:px-16">
        {/* Logo top */}
        <div className="mb-auto">
          <span className="text-slate-900 font-black text-2xl tracking-tight">
            fullsite
            <span className="inline-block w-2.5 h-2.5 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
          </span>
        </div>

        {/* Form centered */}
        <div className="w-full max-w-sm mx-auto">
          <h2 className="text-2xl font-bold text-slate-900 mb-1">Bienvenido</h2>
          <p className="text-slate-400 text-sm mb-10">Inicia sesión para continuar</p>

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

          {/* Footer */}
          <div className="mt-12 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-400 text-center">
              <a href="/privacidad" className="hover:text-slate-600 transition-colors">Privacidad</a>
              {' · '}
              <a href="/terminos" className="hover:text-slate-600 transition-colors">Términos</a>
              {' · '}
              <a href="/seguridad" className="hover:text-slate-600 transition-colors">Seguridad</a>
            </p>
          </div>
        </div>

        {/* Bottom spacer */}
        <div className="mb-auto" />
      </div>
    </div>
  )
}
