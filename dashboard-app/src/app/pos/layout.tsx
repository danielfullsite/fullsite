'use client'

import { useState, useEffect } from 'react'

const POS_PIN = '2835'

export default function POSLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('pos_unlocked')
      if (saved === 'true') setUnlocked(true)
    }
  }, [])

  const handleSubmit = () => {
    if (pin === POS_PIN) {
      setUnlocked(true)
      sessionStorage.setItem('pos_unlocked', 'true')
    } else {
      setError(true)
      setPin('')
      setTimeout(() => setError(false), 1500)
    }
  }

  if (unlocked) return <>{children}</>

  return (
    <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
      <div className="text-center w-full max-w-xs mx-4">
        <div className="mb-6">
          <span className="text-white font-black text-2xl tracking-tight">
            fullsite
            <span className="inline-block w-2 h-2 bg-emerald-500 ml-0.5 mb-1" />
          </span>
          <p className="text-slate-400 text-sm mt-1">POS — Acceso restringido</p>
        </div>

        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="PIN"
          autoFocus
          className={`w-full bg-slate-800 border rounded-xl px-6 py-4 text-white text-center text-3xl tracking-[0.5em] focus:outline-none mb-4 ${
            error ? 'border-red-500 animate-shake' : 'border-slate-700 focus:border-emerald-500'
          }`}
        />

        <button
          onClick={handleSubmit}
          disabled={pin.length < 4}
          className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold text-lg transition-colors"
        >
          Entrar
        </button>

        {error && <p className="text-red-400 text-sm mt-3">PIN incorrecto</p>}
      </div>
    </div>
  )
}
