import { NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
// BUG-019: el backup lee tablas tenant con RLS (pos_orders, pos_staff, pos_audit_log…).
// DEBE usar la service-role key canónica (SUPABASE_SERVICE_KEY); NUNCA anon (anon
// queda denegado por RLS y antes hacía fallback silencioso). Fail-closed abajo.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ''
// anon key SOLO para validar el Bearer del usuario contra /auth/v1/user (apikey no privilegiado).
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Solo dueños reales pueden exportar backups (NO demo).
// Configurable vía BACKUP_ADMIN_EMAILS (csv) — fail-closed si no está definida.
const BACKUP_ADMINS = new Set(
  (process.env.BACKUP_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
)

/** Valida el Bearer token contra Supabase Auth y exige email de admin.
 *  Devuelve el user id (para validar membresía del tenant) o null si no autorizado.
 *  (Guardián registrado como `isAuthorized` en lib/seguridad/guardianes-api.ts.) */
async function isAuthorized(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: authHeader },
    })
    if (!res.ok) return null
    const user = await res.json()
    if (!BACKUP_ADMINS.has(String(user?.email || '').toLowerCase())) return null
    return typeof user?.id === 'string' ? user.id : null
  } catch {
    return null
  }
}

/** El usuario debe tener membresía (client_users) en el tenant solicitado.
 *  Esto evita que un admin válido descargue el backup de un tenant al que NO
 *  pertenece (defensa en profundidad sobre el allowlist de correos). */
async function userHasClientAccess(userId: string, clientId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/client_users?user_id=eq.${encodeURIComponent(userId)}&client_id=eq.${encodeURIComponent(clientId)}&select=client_id&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    )
    if (!res.ok) return false
    const rows = await res.json()
    return Array.isArray(rows) && rows.length > 0
  } catch {
    return false
  }
}

const BACKUP_TABLES = [
  'pos_orders',
  'pos_staff',
  'pos_ingredients',
  'pos_recipes',
  'pos_inventory',
  'pos_inventory_movements',
  'pos_purchase_orders',
  'pos_facturas',
  'pos_audit_log',
]

async function fetchTable(table: string, clientId: string): Promise<unknown[]> {
  // Service key bypassa RLS → el filtro client_id es OBLIGATORIO para no volcar
  // todos los tenants. Todas las BACKUP_TABLES tienen columna client_id.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?client_id=eq.${encodeURIComponent(clientId)}&limit=50000&order=created_at.desc`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  )
  if (res.ok) return await res.json()
  return []
}

export async function GET(request: NextRequest) {
  const userId = await isAuthorized(request)
  if (!userId) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }
  // Fail-closed: sin service key no se hace backup (jamás con anon).
  if (!SUPABASE_SERVICE_KEY) {
    return Response.json({ error: 'Backup no disponible: SUPABASE_SERVICE_KEY no configurada' }, { status: 503 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'json'
  const table = searchParams.get('table')

  // Aislamiento de tenant OBLIGATORIO: el backup es por-restaurante. Exigir
  // client_id y validar que el admin tenga membresía en ese tenant (no basta
  // el allowlist de correos: un admin no debe bajar el backup de un tenant ajeno).
  const clientId = searchParams.get('client_id')
  if (!clientId) {
    return Response.json({ error: 'Falta client_id (el backup es por tenant)' }, { status: 400 })
  }
  if (!(await userHasClientAccess(userId, clientId))) {
    return Response.json({ error: 'Sin acceso a ese tenant' }, { status: 403 })
  }

  try {
    // Single table export
    if (table) {
      if (!BACKUP_TABLES.includes(table)) {
        return Response.json({ error: 'Tabla no valida' }, { status: 400 })
      }

      const data = await fetchTable(table, clientId)

      if (format === 'csv') {
        if (data.length === 0) {
          return new Response('', {
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': `attachment; filename="${table}.csv"`,
            },
          })
        }

        const headers = Object.keys(data[0] as Record<string, unknown>)
        const rows = [
          headers.join(','),
          ...(data as Record<string, unknown>[]).map((row) =>
            headers.map((h) => {
              const val = row[h]
              if (val === null || val === undefined) return ''
              const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
              return str.includes(',') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str
            }).join(',')
          ),
        ]

        return new Response(rows.join('\n'), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${table}-${new Date().toISOString().slice(0, 10)}.csv"`,
          },
        })
      }

      return Response.json({ table, count: data.length, data })
    }

    // Full backup — all tables
    const backup: Record<string, unknown[]> = {}
    const counts: Record<string, number> = {}

    await Promise.all(
      BACKUP_TABLES.map(async (t) => {
        const rows = await fetchTable(t, clientId)
        backup[t] = rows
        counts[t] = rows.length
      })
    )

    const timestamp = new Date().toISOString()

    return new Response(
      JSON.stringify({ timestamp, counts, data: backup }, null, 2),
      {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="fullsite-backup-${timestamp.slice(0, 10)}.json"`,
        },
      }
    )
  } catch (error) {
    console.error('Backup error:', error)
    return Response.json({ error: 'Error al crear backup' }, { status: 500 })
  }
}
