import { NextRequest } from 'next/server'
import { getClientId } from '@/lib/api-auth'

// Lista de empleados para asignaciones (repartidores estilo Wansoft: se eligen
// de la lista general de empleados, no hay rol "repartidor").
// Server-side con service key — NUNCA expone PINs (select solo id,name,role).

export async function GET(request: NextRequest) {
  try {
    const clientId = getClientId(request)

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const sbKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const res = await fetch(
      `${sbUrl}/rest/v1/pos_staff?active=eq.true&client_id=eq.${encodeURIComponent(clientId)}&select=id,name,role&order=name.asc`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }, cache: 'no-store' }
    )
    if (!res.ok) return Response.json({ staff: [] })
    const rows = await res.json()
    return Response.json({ staff: rows })
  } catch {
    return Response.json({ staff: [] })
  }
}
