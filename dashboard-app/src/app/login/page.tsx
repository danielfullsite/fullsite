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
    <div className="min-h-screen relative">
      {/* Full background */}
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80')` }} />
      <div className="absolute inset-0 bg-black/65" />

      {/* Content centered */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6">
        {/* Logo */}
        <div className="mb-8">
          <span className="text-white font-black text-4xl tracking-tight">
            fullsite
            <span className="inline-block w-3.5 h-3.5 bg-emerald-400 ml-1 mb-1 rounded-none" />
          </span>
        </div>

        {/* Login card */}
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-8 sm:p-10">
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Iniciar sesión</h2>
            <p className="text-slate-400 text-sm mb-8">Ingresa a tu panel de operaciones</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-slate-500 mb-1.5">
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
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 focus:bg-white transition-all"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-semibold text-slate-500 mb-1.5">
                  Contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 focus:bg-white transition-all"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-500 rounded-xl px-4 py-3 text-sm">{error}</div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 text-white font-semibold text-sm rounded-xl px-4 py-3.5 hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 group"
              >
                {loading ? (
                  <><span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> Ingresando...</>
                ) : (
                  <>Ingresar <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" /></>
                )}
              </button>
            </form>
          </div>

          <div className="bg-slate-50 px-8 sm:px-10 py-4 border-t border-slate-100">
            <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
              <a href="/privacidad" className="hover:text-slate-600 transition-colors">Privacidad</a>
              <span className="text-slate-200">·</span>
              <a href="/terminos" className="hover:text-slate-600 transition-colors">Términos</a>
              <span className="text-slate-200">·</span>
              <a href="/seguridad" className="hover:text-slate-600 transition-colors">Seguridad</a>
            </div>
          </div>
        </div>

        {/* Stats below card */}
        <div className="flex items-center gap-10 mt-10">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">580+</p>
            <p className="text-xs text-white/40">Días de historial</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">17</p>
            <p className="text-xs text-white/40">Módulos</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">24/7</p>
            <p className="text-xs text-white/40">Asistente IA</p>
          </div>
        </div>
      </div>
    </div>
  )
}
