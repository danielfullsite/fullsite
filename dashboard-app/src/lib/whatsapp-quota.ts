import 'server-only'
import { clampOperationalLimits } from '@/lib/whatsapp-agent-policy'

export async function claimWhatsAppQuota(input: {
  clientId: string
  requested: number
  minuteLimit?: number
  dailyLimit?: number
  monthlyLimit?: number
  timezone?: string
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!url || !serviceKey) return 0
  const limits = clampOperationalLimits({ minute: input.minuteLimit, daily: input.dailyLimit, monthly: input.monthlyLimit })
  const response = await fetch(`${url}/rest/v1/rpc/claim_whatsapp_quota`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_client_id: input.clientId,
      p_requested: Math.max(0, Math.floor(input.requested)),
      p_minute_limit: limits.minute,
      p_daily_limit: limits.daily,
      p_monthly_limit: limits.monthly,
      p_timezone: input.timezone || 'America/Monterrey',
    }),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`quota_${response.status}`)
  return Number(await response.json()) || 0
}
