'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Lock, Mail, ArrowRight, Shield, BarChart3, MessageCircle } from 'lucide-react'

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
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        setError(authError.message)
        setLoading(false)
        return
      }

      if (data?.session) {
        window.location.href = '/'
      } else {
        setError('No se pudo crear la sesión. Intenta de nuevo.')
        setLoading(false)
      }
    } catch {
      setError('Error de conexión. Intenta de nuevo.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left side — background image with overlay */}
      <div className="hidden lg:flex lg:w-3/5 relative overflow-hidden">
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80')`,
          }}
        />
        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/90 via-slate-900/80 to-blue-900/70" />

        {/* Content on image */}
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Logo */}
          <div>
            <span className="text-white font-black text-3xl tracking-tight">
              fullsite
              <span className="inline-block w-3 h-3 bg-emerald-400 ml-1 mb-1 rounded-none" />
            </span>
          </div>

          {/* Middle — value prop */}
          <div className="max-w-lg">
            <h1 className="text-4xl font-bold text-white leading-tight mb-4">
              Inteligencia artificial para tu restaurante
            </h1>
            <p className="text-lg text-white/70 mb-8">
              Dashboard en tiempo real, reportes automáticos, y un asistente IA que responde cualquier pregunta sobre tu negocio.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2">
                <BarChart3 size={16} className="text-emerald-400" />
                <span className="text-sm text-white/90">Analytics en tiempo real</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2">
                <MessageCircle size={16} className="text-blue-400" />
                <span className="text-sm text-white/90">Chat IA 24/7</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2">
                <Shield size={16} className="text-amber-400" />
                <span className="text-sm text-white/90">Datos encriptados</span>
              </div>
            </div>
          </div>

          {/* Bottom — testimonial or stats */}
          <div className="flex items-center gap-8">
            <div>
              <p className="text-2xl font-bold text-white">580+</p>
              <p className="text-sm text-white/50">Días de datos</p>
            </div>
            <div className="w-px h-10 bg-white/20" />
            <div>
              <p className="text-2xl font-bold text-white">17</p>
              <p className="text-sm text-white/50">Reportes</p>
            </div>
            <div className="w-px h-10 bg-white/20" />
            <div>
              <p className="text-2xl font-bold text-white">24/7</p>
              <p className="text-sm text-white/50">Asistente IA</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right side — login form */}
      <div className="flex-1 flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo (hidden on desktop) */}
          <div className="lg:hidden text-center mb-10">
            <span className="text-slate-900 font-black text-3xl tracking-tight">
              fullsite
              <span className="inline-block w-2.5 h-2.5 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </div>

          {/* Welcome text */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Bienvenido</h2>
            <p className="text-sm text-slate-400 mt-1">Ingresa a tu panel de operaciones</p>
          </div>

          {/* Login form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@restaurante.com"
                  required
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 focus:bg-white transition-all"
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full text-sm bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 focus:bg-white transition-all"
                  disabled={loading}
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white font-medium text-sm rounded-xl px-4 py-3 hover:bg-slate-800 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Ingresando...
                </>
              ) : (
                <>
                  Ingresar
                  <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Footer links */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center justify-center gap-4 text-xs text-slate-400">
              <a href="/privacidad" className="hover:text-slate-600 transition-colors">Privacidad</a>
              <span>•</span>
              <a href="/terminos" className="hover:text-slate-600 transition-colors">Términos</a>
              <span>•</span>
              <a href="/seguridad" className="hover:text-slate-600 transition-colors">Seguridad</a>
            </div>
            <p className="text-center text-[11px] text-slate-300 mt-3">
              fullsite. — Inteligencia artificial para restaurantes
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
