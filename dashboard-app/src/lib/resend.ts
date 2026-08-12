// ── Control Plane · envío de correo transaccional (Resend REST) ──────────────
// Se usa el REST API de Resend directo (sin SDK, cero dependencias nuevas).
// Config por env:
//   RESEND_API_KEY   — API key de Resend (requerida; sin ella send() falla suave)
//   PLATFORM_2FA_FROM — remitente verificado (default: Fullsite <security@fullsite.mx>)

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

interface SendArgs {
  to: string
  subject: string
  html: string
  text?: string
}

/** Envía un correo vía Resend. Devuelve {ok} y, en error, {status,detail}. */
export async function sendEmail({ to, subject, html, text }: SendArgs): Promise<
  { ok: true } | { ok: false; status: number; detail: string }
> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, status: 503, detail: 'RESEND_API_KEY no configurada' }
  const from = process.env.PLATFORM_2FA_FROM || 'Fullsite <security@fullsite.mx>'
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, ...(text ? { text } : {}) }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, status: res.status, detail }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, status: 500, detail: err instanceof Error ? err.message : String(err) }
  }
}

/** Plantilla del correo con el código de verificación de /platform. */
export function otpEmailHtml(code: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0b0d12;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:440px;margin:0 auto;padding:40px 24px">
    <div style="background:#12151d;border:1px solid #232838;border-radius:16px;padding:32px;text-align:center">
      <p style="color:#8b93a7;font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px">Fullsite · Control Plane</p>
      <h1 style="color:#f4f6fb;font-size:18px;margin:0 0 24px">Código de verificación</h1>
      <div style="font-size:34px;font-weight:700;letter-spacing:.25em;color:#5b8cff;font-variant-numeric:tabular-nums;padding:16px 0">${code}</div>
      <p style="color:#8b93a7;font-size:13px;line-height:1.5;margin:24px 0 0">Este código expira en 10 minutos. Si no intentabas entrar al panel de administración, ignora este correo y avisa al equipo.</p>
    </div>
  </div></body></html>`
}
