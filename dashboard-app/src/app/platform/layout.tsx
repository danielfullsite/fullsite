'use client'

import { useEffect, useState, useCallback } from 'react'
import { ShieldCheck, Mail, KeyRound, Loader2, AlertTriangle, Copy, Check } from 'lucide-react'

// ── Control Plane · gate de segundo factor (email 2FA) ───────────────────────
// Envuelve TODAS las páginas /platform/*. Mientras PLATFORM_2FA_ENFORCED esté
// apagado, /api/platform/2fa/status responde enforced:false y este gate deja pasar
// sin pedir nada (cero fricción / cero riesgo de lockout). Con enforcement ON:
//   no inscrito → genera recovery codes → reto por correo → acceso (cookie 12h).

type Phase = 'loading' | 'pass' | 'enroll' | 'codes' | 'challenge' | 'error'

interface Status {
  enforced: boolean
  enrolled: boolean
  verified: boolean
  emailConfigured: boolean
  email: string
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [status, setStatus] = useState<Status | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [otp, setOtp] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [copied, setCopied] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/platform/2fa/status', { credentials: 'include' })
      if (!res.ok) { setPhase('pass'); return } // 401/403 lo maneja la página (acceso denegado)
      const s: Status = await res.json()
      setStatus(s)
      if (!s.enforced || s.verified) setPhase('pass')
      else if (!s.enrolled) setPhase('enroll')
      else setPhase('challenge')
    } catch {
      setPhase('error')
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  // Auto-envía el código al entrar al reto (si hay correo configurado).
  const sendCode = useCallback(async () => {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/platform/2fa/send', { method: 'POST', credentials: 'include' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg(j.error || 'No se pudo enviar el código'); return }
      setSentTo(j.to || '')
    } finally { setBusy(false) }
  }, [])

  useEffect(() => {
    if (phase === 'challenge' && status?.emailConfigured && !useRecovery && !sentTo) sendCode()
  }, [phase, status, useRecovery, sentTo, sendCode])

  async function doEnroll() {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/platform/2fa/enroll', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg(j.error || 'No se pudo generar los códigos'); return }
      setCodes(j.recovery_codes || [])
      setPhase('codes')
    } finally { setBusy(false) }
  }

  async function doVerify() {
    setBusy(true); setMsg('')
    try {
      const res = await fetch('/api/platform/2fa/verify', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: otp }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg(j.error || 'Código incorrecto'); return }
      setPhase('pass')
    } finally { setBusy(false) }
  }

  if (phase === 'pass') return <>{children}</>

  const shell = (inner: React.ReactNode) => (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border,#232838)] bg-[var(--surface-1,#12151d)] p-8">
        {inner}
      </div>
    </div>
  )

  if (phase === 'loading') {
    return shell(
      <div className="flex flex-col items-center gap-3 py-8 text-[var(--text-2,#8b93a7)]">
        <Loader2 className="animate-spin" size={22} />
        <p className="text-sm">Verificando acceso…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return shell(
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="text-amber-400" size={26} />
        <p className="font-semibold text-[var(--text-1,#f4f6fb)]">No se pudo verificar el segundo factor</p>
        <button onClick={loadStatus} className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">Reintentar</button>
      </div>
    )
  }

  if (phase === 'enroll') {
    return shell(
      <div className="flex flex-col items-center gap-4 text-center">
        <ShieldCheck className="text-blue-400" size={28} />
        <div>
          <h2 className="text-lg font-bold text-[var(--text-1,#f4f6fb)]">Protege el panel de administración</h2>
          <p className="mt-2 text-sm text-[var(--text-2,#8b93a7)]">Antes de continuar, genera tus <b>códigos de recuperación</b>. Te dejarán entrar si el correo no llega. Se muestran una sola vez.</p>
        </div>
        {msg && <p className="text-sm text-red-400">{msg}</p>}
        <button onClick={doEnroll} disabled={busy}
          className="mt-2 flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? <Loader2 className="animate-spin" size={16} /> : <KeyRound size={16} />} Generar códigos de recuperación
        </button>
      </div>
    )
  }

  if (phase === 'codes') {
    return shell(
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <KeyRound className="mx-auto text-blue-400" size={26} />
          <h2 className="mt-2 text-lg font-bold text-[var(--text-1,#f4f6fb)]">Guarda estos códigos</h2>
          <p className="mt-1 text-sm text-[var(--text-2,#8b93a7)]">Cada uno sirve <b>una vez</b>. Guárdalos fuera de este equipo. No se volverán a mostrar.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--border,#232838)] bg-black/20 p-4 font-mono text-sm text-[var(--text-1,#f4f6fb)]">
          {codes.map(c => <span key={c} className="tracking-widest">{c}</span>)}
        </div>
        <button
          onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border,#232838)] px-4 py-2 text-sm text-[var(--text-2,#8b93a7)]">
          {copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar todos</>}
        </button>
        <button onClick={() => { setSentTo(''); setPhase('challenge') }}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">
          Ya los guardé, continuar
        </button>
      </div>
    )
  }

  // challenge
  return shell(
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <Mail className="mx-auto text-blue-400" size={26} />
        <h2 className="mt-2 text-lg font-bold text-[var(--text-1,#f4f6fb)]">Verificación en dos pasos</h2>
        <p className="mt-1 text-sm text-[var(--text-2,#8b93a7)]">
          {useRecovery
            ? 'Ingresa uno de tus códigos de recuperación.'
            : sentTo
              ? <>Enviamos un código a <b>{sentTo}</b>.</>
              : status?.emailConfigured ? 'Enviando código…' : 'Envío de correo no configurado. Usa un recovery code.'}
        </p>
      </div>

      <input
        value={otp}
        onChange={e => setOtp(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && otp) doVerify() }}
        placeholder={useRecovery ? 'xxxx-xxxx' : '••••••'}
        inputMode={useRecovery ? 'text' : 'numeric'}
        maxLength={useRecovery ? 9 : 6}
        autoFocus
        className="w-full rounded-lg border border-[var(--border,#232838)] bg-black/20 px-4 py-3 text-center text-2xl tracking-[0.4em] font-mono text-[var(--text-1,#f4f6fb)] outline-none focus:border-blue-500"
      />

      {msg && <p className="text-center text-sm text-red-400">{msg}</p>}

      <button onClick={doVerify} disabled={busy || !otp}
        className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />} Verificar y entrar
      </button>

      <div className="flex items-center justify-between text-xs text-[var(--text-2,#8b93a7)]">
        {!useRecovery && status?.emailConfigured
          ? <button onClick={() => { setSentTo(''); sendCode() }} disabled={busy} className="hover:text-blue-400">Reenviar código</button>
          : <span />}
        <button onClick={() => { setUseRecovery(v => !v); setOtp(''); setMsg('') }} className="hover:text-blue-400">
          {useRecovery ? 'Usar código por correo' : 'Usar código de recuperación'}
        </button>
      </div>
    </div>
  )
}
