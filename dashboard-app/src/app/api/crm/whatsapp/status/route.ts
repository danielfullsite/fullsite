import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'
import { twilioWhatsAppStatus } from '@/lib/integrations/whatsapp/twilio'

export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  const status = twilioWhatsAppStatus()
  return Response.json({ ...status, tenant: auth.clientId })
}
