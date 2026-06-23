'use client'

import { useState, useEffect } from 'react'
import { Shield, Lock } from 'lucide-react'

const INTERNAL_KEY = 'fullsite_internal_auth'

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const saved = sessionStorage.getItem(INTERNAL_KEY)
    if (saved === 'true') setAuthed(true)
  }, [])

  const handleLogin = async () => {
    const res = await fetch('/api/internal-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      sessionStorage.setItem(INTERNAL_KEY, 'true')
      setAuthed(true)
      setError('')
    } else {
      setError('Contraseña incorrecta')
    }
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="bg-[#111118] border border-[#222] rounded-2xl p-8 w-full max-w-sm">
          <div className="flex items-center gap-3 mb-6">
            <Shield size={28} className="text-emerald-500" />
            <div>
              <h1 className="text-lg font-bold text-white">Fullsite Internal</h1>
              <p className="text-sm text-gray-500">Panel de administracion</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="***"
                autoFocus
                className="w-full bg-[#1a1a24] border border-[#333] rounded-lg px-4 py-3 text-white text-center text-lg focus:outline-none focus:border-emerald-500"
              />
              {error && <p className="text-red-400 text-sm mt-1 text-center">{error}</p>}
            </div>
            <button
              onClick={handleLogin}
              disabled={!password}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-[#333] text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Lock size={16} />
              Entrar
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
