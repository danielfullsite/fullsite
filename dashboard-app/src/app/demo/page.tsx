'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

export default function DemoLoginPage() {
  const router = useRouter()
  const [email] = useState('admin@casamontana.mx')
  const [password] = useState('••••••••')
  const [loading, setLoading] = useState(false)

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // Simulate login delay
    setTimeout(() => {
      router.push('/demo/dashboard')
    }, 800)
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left — photo */}
      <div className="hidden lg:block lg:w-[55%] relative">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1920&q=80')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/50" />
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-12">
          <span className="text-white font-black text-7xl tracking-tight drop-shadow-2xl mb-4">
            fullsite
            <span className="inline-block w-5 h-5 bg-emerald-400 ml-1 mb-1 rounded-none" />
          </span>
          <p className="text-white/70 text-lg text-center max-w-md">
            La plataforma de IA que transforma la operación de tu restaurante
          </p>
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex-1 bg-white flex flex-col items-center justify-center px-6 py-10 sm:px-8 sm:py-12 lg:px-16">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <span className="text-gray-900 font-black text-3xl tracking-tight">
              fullsite<span className="inline-block w-3 h-3 bg-emerald-500 ml-0.5 mb-0.5 rounded-none" />
            </span>
          </div>

          {/* Demo badge */}
          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-center">
            <p className="text-emerald-700 text-sm font-medium">
              Demo interactivo — Casa Montaña
            </p>
            <p className="text-emerald-600 text-xs mt-0.5">
              Explora el dashboard y POS con datos simulados
            </p>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-1">Bienvenido</h2>
          <p className="text-gray-400 text-sm mb-8">Inicia sesión para continuar</p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1.5">
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                readOnly
                className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-900 cursor-default"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                readOnly
                className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-gray-900 cursor-default"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 text-white font-semibold text-sm rounded-lg px-4 py-3.5 hover:bg-emerald-600 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 group"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Ingresando...</>
              ) : (
                <>Entrar al demo <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" /></>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              ¿Quieres esto para tu restaurante?{' '}
              <a
                href="https://wa.me/528115324371?text=Hola%20Daniel%2C%20vi%20el%20demo%20de%20Fullsite%20y%20me%20interesa."
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-600 font-medium hover:text-emerald-700 transition-colors"
              >
                Contáctanos
              </a>
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center">
              <a href="/privacidad" className="hover:text-gray-500 transition-colors">Privacidad</a>
              {' · '}
              <a href="/terminos" className="hover:text-gray-500 transition-colors">Términos</a>
              {' · '}
              <a href="/seguridad" className="hover:text-gray-500 transition-colors">Seguridad</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
