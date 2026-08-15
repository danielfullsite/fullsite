import { createHmac, timingSafeEqual } from 'node:crypto'

// Verificación HMAC-SHA256 del webhook de Rappi.
// Contrato confirmado en el Integrations Manager (pestaña HMAC):
//   Header:  Rappi-Signature: t=<timestamp>,sign=<hex>
//   Regla:   la firma se calcula sobre el body EXACTAMENTE como se recibe
//            (raw bytes, sin reformatear). Por eso el caller debe pasar request.text()
//            crudo, nunca un JSON re-serializado.
//
// El string firmado exacto (¿"<t>.<body>" o "<body>"?) y qué secret usa Rappi
// (webhook secret dedicado vs client_secret) no vienen documentados palabra por
// palabra, así que probamos los candidatos plausibles y devolvemos cuál casó.
// Con eso el primer evento de prueba fija el contrato de forma determinística;
// después se puede bloquear a la combinación ganadora.

export interface RappiSigResult {
  ok: boolean
  matchedSecret?: string
  matchedFormat?: string
  reason?: string
}

function parseHeader(header: string): { t: string; sign: string } | null {
  // t=<timestamp>,sign=<hex>  (tolerante a espacios y a alias del campo de firma)
  let t = ''
  let sign = ''
  for (const part of header.split(',')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim().toLowerCase()
    const v = part.slice(idx + 1).trim()
    if (k === 't' || k === 'ts' || k === 'timestamp') t = v
    else if (k === 'sign' || k === 'signature' || k === 'v1' || k === 'hash') sign = v
  }
  return sign ? { t, sign } : null
}

function hexEq(a: string, b: string): boolean {
  let ab: Buffer
  let bb: Buffer
  try {
    ab = Buffer.from(a, 'hex')
    bb = Buffer.from(b, 'hex')
  } catch {
    return false
  }
  if (ab.length === 0 || ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function rappiSecretCandidates(): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  const push = (name: string, value: string | undefined) => {
    if (value && !out.some(s => s.value === value)) out.push({ name, value })
  }
  push('RAPPI_WEBHOOK_SECRET', process.env.RAPPI_WEBHOOK_SECRET)
  push('RAPPI_CLIENT_SECRET', process.env.RAPPI_CLIENT_SECRET)
  return out
}

export function verifyRappiSignature(rawBody: string, header: string | null): RappiSigResult {
  // Misconfig del servidor tiene prioridad (fail-closed 503) sobre input del cliente.
  const secrets = rappiSecretCandidates()
  if (secrets.length === 0) return { ok: false, reason: 'NO_SECRET_CONFIGURED' }

  if (!header) return { ok: false, reason: 'MISSING_SIGNATURE' }
  const parsed = parseHeader(header)
  if (!parsed) return { ok: false, reason: 'BAD_SIGNATURE_HEADER' }
  const { t, sign } = parsed

  const formats: Array<{ name: string; msg: string }> = [
    { name: 't.body', msg: `${t}.${rawBody}` },
    { name: 'body', msg: rawBody },
    { name: 't+body', msg: `${t}${rawBody}` },
  ]

  for (const s of secrets) {
    for (const f of formats) {
      const computed = createHmac('sha256', s.value).update(f.msg, 'utf8').digest('hex')
      if (hexEq(computed, sign)) {
        return { ok: true, matchedSecret: s.name, matchedFormat: f.name }
      }
    }
  }
  return { ok: false, reason: 'SIGNATURE_MISMATCH' }
}
