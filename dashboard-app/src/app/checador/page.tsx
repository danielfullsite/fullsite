'use client'

import { useState, useEffect, useCallback } from 'react'
import { Fingerprint, Delete, LogIn, LogOut, Check, Clock, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

// Checador (kiosk) — registro de entrada/salida por PIN. Opción de huella:
// WebAuthn donde el terminal tenga sensor; el lector USB dedicado (Wansoft) va por
// integración nativa (shell offline) más adelante.
interface Reciente { type: string; method: string; ts: string }
interface Result { staff_name: string; type: string; ts: string; recientes: Reciente[] }

function fmtTime(ts: string) { try { return new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return ts } }

export default function ChecadorPage() {
  const [now, setNow] = useState<Date | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => { setNow(new Date()); const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i) }, [])

  const submit = useCallback(async (value: string, method: 'pin' | 'huella' = 'pin') => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/pos/time-clock', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: value, method }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || 'No se pudo registrar'); setPin(''); return }
      setResult(j); setPin('')
      setTimeout(() => setResult(null), 6000)
    } catch { setError('Error de red') } finally { setBusy(false) }
  }, [])

  function press(d: string) {
    setError('')
    if (d === 'del') { setPin(p => p.slice(0, -1)); return }
    if (d === 'ok') { if (pin.length >= 3) submit(pin); return }
    if (pin.length < 8) setPin(p => p + d)
  }

  async function huella() {
    setError('')
    const hasWebAuthn = typeof window !== 'undefined' && 'PublicKeyCredential' in window
    let platform = false
    try { if (hasWebAuthn) platform = await (window as unknown as { PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean> } }).PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch { /* */ }
    if (platform) setError('Huella disponible en este terminal — el enrolamiento por empleado llega pronto. Por ahora usa tu PIN.')
    else setError('Este terminal no tiene sensor de huella. Usa tu PIN (o conecta el lector cuando esté la integración).')
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[var(--bg)] flex flex-col items-center justify-center p-4 overflow-auto" style={{ fontFamily: 'Arial, sans-serif' }}>
      <Link href="/pos" className="absolute top-4 left-4 inline-flex items-center gap-1.5 text-sm text-[var(--text-3)] hover:text-[var(--text-1)]"><ArrowLeft size={16} /> POS</Link>

      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 text-[var(--text-3)] text-sm mb-1"><Clock size={15} /> {now ? now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''}</div>
        <div className="text-4xl font-bold text-[var(--text-1)] tabular-nums">{now ? now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--'}</div>
        <h1 className="text-lg font-semibold text-[var(--text-2)] mt-2">Registro de entrada y salida</h1>
      </div>

      {result ? (
        <div className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center">
          <div className={`w-16 h-16 rounded-full grid place-items-center mx-auto mb-3 ${result.type === 'entrada' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
            {result.type === 'entrada' ? <LogIn size={30} /> : <LogOut size={30} />}
          </div>
          <p className="text-xl font-bold text-[var(--text-1)]">{result.staff_name}</p>
          <p className={`text-sm font-semibold mt-1 ${result.type === 'entrada' ? 'text-emerald-400' : 'text-amber-400'}`}>
            <Check size={14} className="inline -mt-0.5" /> {result.type === 'entrada' ? 'Entrada' : 'Salida'} registrada · {result.ts ? new Date(result.ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''}
          </p>
          {result.recientes.length > 0 && (
            <div className="mt-4 text-left text-xs text-[var(--text-3)] space-y-1 border-t border-[var(--line)] pt-3">
              {result.recientes.slice(0, 5).map((r, i) => (
                <div key={i} className="flex justify-between"><span className={r.type === 'entrada' ? 'text-emerald-400' : 'text-amber-400'}>{r.type}</span><span className="tabular-nums">{fmtTime(r.ts)}</span></div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="w-full max-w-xs">
          <div className="flex justify-center gap-2.5 mb-5 h-4">
            {Array.from({ length: Math.max(pin.length, 0) }).map((_, i) => <span key={i} className="w-3 h-3 rounded-full bg-[var(--accent)]" />)}
            {pin.length === 0 && <span className="text-sm text-[var(--text-4)]">Ingresa tu PIN</span>}
          </div>
          {error && <p className="text-center text-sm text-red-400 mb-3">{error}</p>}
          <div className="grid grid-cols-3 gap-2.5">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <button key={d} onClick={() => press(d)} disabled={busy} className="h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] text-2xl font-semibold text-[var(--text-1)] active:bg-[var(--surface)] tabular-nums">{d}</button>
            ))}
            <button onClick={() => press('del')} disabled={busy} className="h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] grid place-items-center text-[var(--text-2)] active:bg-[var(--surface)]"><Delete size={22} /></button>
            <button onClick={() => press('0')} disabled={busy} className="h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] text-2xl font-semibold text-[var(--text-1)] active:bg-[var(--surface)] tabular-nums">0</button>
            <button onClick={() => press('ok')} disabled={busy || pin.length < 3} className="h-16 rounded-2xl bg-[var(--accent)] grid place-items-center text-[#04130d] disabled:opacity-40"><Check size={26} /></button>
          </div>
          <button onClick={huella} disabled={busy} className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] py-3 text-sm font-medium text-[var(--text-2)] hover:text-[var(--text-1)]">
            <Fingerprint size={18} /> Registrar con huella
          </button>
        </div>
      )}
    </div>
  )
}
