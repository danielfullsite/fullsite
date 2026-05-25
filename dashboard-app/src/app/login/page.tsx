'use client'

import { useState } from 'react'
import { ArrowRight, Zap, Shield, Bot } from 'lucide-react'

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
    <div className="min-h-screen bg-black flex flex-col">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full opacity-30" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.25), transparent 70%)', filter: 'blur(100px)' }} />
        <div className="absolute bottom-[-10%] right-[-5%] w-[400px] h-[400px] rounded-full opacity-20" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.2), transparent 70%)', filter: 'blur(80px)' }} />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative z-10">
        <div className="w-full max-w-sm">

          {/* Logo */}
          <div className="text-center mb-10">
            <span className="text-white font-black text-4xl tracking-tight">
              fullsite<span className="inline-block w-3.5 h-3.5 bg-emerald-500 ml-1 mb-1 rounded-none" />
            </span>
            <p className="text-white/40 text-xs font-medium tracking-[0.2em] uppercase mt-3">POS con IA para restaurantes</p>
          </div>

          {/* Features pills */}
          <div className="flex justify-center gap-2 mb-10">
            {[
              { icon: Zap, label: '26 agentes' },
              { icon: Shield, label: 'Anti-fraude' },
              { icon: Bot, label: 'IA 24/7' },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/50 text-[10px] font-medium">
                <f.icon size={10} />
                {f.label}
              </div>
            ))}
          </div>

          {/* Card */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 p-6 backdrop-blur-xl" style={{ background: 'linear-gradient(165deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}>
            {/* Bevel line */}
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.4) 50%, transparent 100%)' }} />

            <h2 className="text-xl font-bold text-white mb-1">Bienvenido</h2>
            <p className="text-white/40 text-sm mb-6">Inicia sesion para continuar</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-[11px] font-semibold text-white/50 uppercase tracking-[0.1em] mb-2">
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
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-[11px] font-semibold text-white/50 uppercase tracking-[0.1em] mb-2">
                  Contrasena
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-500 text-black font-bold text-sm rounded-xl px-4 py-4 hover:bg-emerald-400 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 group mt-2"
                style={{ boxShadow: '0 0 30px rgba(16,185,129,0.3), 0 8px 32px rgba(16,185,129,0.2)' }}
              >
                {loading ? (
                  <><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> Ingresando...</>
                ) : (
                  <>Continuar <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" /></>
                )}
              </button>
            </form>
          </div>

          {/* Contact */}
          <p className="mt-6 text-center text-sm text-white/30">
            No tienes cuenta?{' '}
            <a
              href="https://wa.me/528115324371?text=Hola%20Daniel%2C%20me%20interesa%20crear%20una%20cuenta%20en%20Fullsite."
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-500 font-medium hover:text-emerald-400 transition-colors"
            >
              Contactanos
            </a>
          </p>

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-white/5">
            <p className="text-[10px] text-white/20 text-center tracking-wide">
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
  )
}
