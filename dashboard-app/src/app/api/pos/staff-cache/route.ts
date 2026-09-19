import { NextRequest } from 'next/server'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

// The old endpoint distributed fast, enumerable hashes of every employee PIN.
// Prepared offline access is now verified inside Caja, via /auth/pin.
export async function GET(request: NextRequest) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  return Response.json({ code: 'OFFLINE_ACCESS_REQUIRES_CAJA', error: 'Prepara el acceso sin internet desde la Caja; no se distribuyen credenciales del personal.' }, { status: 410 })
}
