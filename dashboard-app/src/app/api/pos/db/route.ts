/** Proxy PostgREST: identidad y permisos viven en la política compartida. */
import { NextRequest } from 'next/server'
import { runPOSDBProxy } from '@/lib/pos-db-proxy'
import { withPOSAuth, unauthorized } from '@/lib/api-auth'

async function handle(request: NextRequest, method: string) {
  const auth = await withPOSAuth(request)
  if (!auth) return unauthorized()
  return runPOSDBProxy(request, request.nextUrl.searchParams.get('path') || '', method, auth)
}
export async function GET(request: NextRequest) { return handle(request, 'GET') }
export async function POST(request: NextRequest) { return handle(request, 'POST') }
export async function PATCH(request: NextRequest) { return handle(request, 'PATCH') }
export async function DELETE(request: NextRequest) { return handle(request, 'DELETE') }
