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

      </div>
    </div>
  )
}
