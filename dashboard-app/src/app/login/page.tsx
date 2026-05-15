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
        setError('No se pudo crear la sesión.')
        setLoading(false)
      }
    } catch {
      setError('Error de conexión.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative flex">
      {/* Full background image */}
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1920&q=80')`,
          }}
        />
        <div className="absolute inset-0 bg-black/60" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-1">
        {/* Left — branding */}
        <div className="hidden lg:flex flex-col justify-between flex-1 p-16">
          {/* Logo */}
          <div>
            <span className="text-white font-black text-4xl tracking-tight">
              fullsite
              <span className="inline-block w-3.5 h-3.5 bg-emerald-400 ml-1 mb-1 rounded-none" />
            </span>
          </div>

          {/* Hero text */}
          <div className="max-w-xl">
            <h1 className="text-5xl font-bold text-white leading-[1.15] mb-6">
              Tu restaurante,
              <br />
              <span className="text-emerald-400">impulsado por IA</span>
            </h1>
            <p className="text-xl text-white/60 leading-relaxed">
              Ventas, meseros, platillos, tendencias — todo en un solo lugar. Pregúntale lo que quieras a tu asistente inteligente.
            </p>
          </div>

          {/* Bottom stats */}
          <div className="flex items-center gap-12">
            <div>
              <p className="text-3xl font-bold text-white">580+</p>
              <p className="text-sm text-white/40 mt-1">Días de historial</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">17</p>
              <p className="text-sm text-white/40 mt-1">Módulos</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">24/7</p>
              <p className="text-sm text-white/40 mt-1">Asistente IA</p>
            </div>
          </div>
        </div>

        {/* Right — login card */}
        <div className="flex items-center justify-center w-full lg:w-[480px] lg:min-w-[480px] p-6">
          <div className="w-full max-w-[420px] bg-white backdrop-blur-xl rounded-3xl shadow-2xl p-10 lg:p-12">
            {/* Form header */}
            <div className="mb-8">
              <h2 className="text-[26px] font-bold text-slate-900 tracking-tight">
                Iniciar sesión
              </h2>
              <p className="text-slate-400 text-[15px] mt-2">
                Ingresa a tu panel de operaciones
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-[13px] font-semibold text-slate-500 mb-2">
                  Correo electrónico
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@empresa.com"
                  required
                  className="w-full text-[15px] bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all"
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-[13px] font-semibold text-slate-500 mb-2">
                  Contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full text-[15px] bg-white border border-slate-200 rounded-xl px-4 py-3.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition-all"
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-500 rounded-2xl px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-slate-900 text-white font-semibold text-[15px] rounded-2xl px-6 py-4 hover:bg-slate-800 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 group mt-2"
              >
                {loading ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Ingresando...
                  </>
                ) : (
                  <>
                    Ingresar
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>

            {/* Footer */}
            <div className="mt-8 text-center">
              <div className="flex items-center justify-center gap-3 text-[12px] text-slate-300">
                <a href="/privacidad" className="hover:text-slate-500 transition-colors">Privacidad</a>
                <span className="text-slate-200">·</span>
                <a href="/terminos" className="hover:text-slate-500 transition-colors">Términos</a>
                <span className="text-slate-200">·</span>
                <a href="/seguridad" className="hover:text-slate-500 transition-colors">Seguridad</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
