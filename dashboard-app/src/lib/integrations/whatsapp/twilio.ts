import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

const TWILIO_API = 'https://api.twilio.com/2010-04-01'

function credentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || ''
  const authToken = process.env.TWILIO_AUTH_TOKEN || ''
  const from = process.env.TWILIO_WHATSAPP_FROM || ''
  const contentSid = process.env.TWILIO_AMALAY_CONTENT_SID || ''
  return { accountSid, authToken, from, contentSid }
}

export function twilioWhatsAppStatus() {
  const config = credentials()
  return {
    enabled: process.env.WHATSAPP_SENDING_ENABLED === 'true',
    configured: Boolean(config.accountSid && config.authToken && config.from && config.contentSid),
    provider: 'twilio' as const,
  }
}

export async function sendAmalayTemplate(input: { to: string; firstName: string }) {
  const config = credentials()
  const status = twilioWhatsAppStatus()
  if (!status.configured || !status.enabled) throw new Error('twilio_sending_disabled')
  const form = new URLSearchParams({
    To: `whatsapp:+${input.to.replace(/\D/g, '')}`,
    From: config.from.startsWith('whatsapp:') ? config.from : `whatsapp:${config.from}`,
    ContentSid: config.contentSid,
    ContentVariables: JSON.stringify({ 1: input.firstName || 'cliente' }),
  })
  const response = await fetch(`${TWILIO_API}/Accounts/${config.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    cache: 'no-store',
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`twilio_${response.status}_${payload?.code || 'error'}`)
  return { sid: String(payload.sid), status: String(payload.status || 'queued') }
}

export async function sendWhatsAppText(input: { to: string; body: string }) {
  const config = credentials()
  const status = twilioWhatsAppStatus()
  if (!status.configured || !status.enabled) throw new Error('twilio_sending_disabled')
  const form = new URLSearchParams({
    To: `whatsapp:+${input.to.replace(/\D/g, '')}`,
    From: config.from.startsWith('whatsapp:') ? config.from : `whatsapp:${config.from}`,
    Body: input.body,
  })
  const response = await fetch(`${TWILIO_API}/Accounts/${config.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    cache: 'no-store',
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`twilio_${response.status}_${payload?.code || 'error'}`)
  return { sid: String(payload.sid), status: String(payload.status || 'queued') }
}

export function verifyTwilioSignature(url: string, params: URLSearchParams, signature: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN || ''
  if (!token || !signature) return false
  const canonical = [...params.keys()].sort().reduce((value, key) => {
    const values = params.getAll(key).sort()
    return value + values.map(item => `${key}${item}`).join('')
  }, url)
  const expected = createHmac('sha1', token).update(canonical).digest('base64')
  const left = Buffer.from(expected)
  const right = Buffer.from(signature)
  return left.length === right.length && timingSafeEqual(left, right)
}
