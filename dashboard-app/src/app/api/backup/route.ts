import { NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Solo dueños reales pueden exportar backups (NO demo)
const BACKUP_ADMINS = new Set(['ramonfaur.daniel@gmail.com', 'monica@fullsite.mx'])

/** Valida el Bearer token contra Supabase Auth y exige email de admin */
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: authHeader },
    })
    if (!res.ok) return false
    const user = await res.json()
    return BACKUP_ADMINS.has(String(user?.email || '').toLowerCase())
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

async function fetchTable(table: string): Promise<unknown[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?limit=50000&order=created_at.desc`,
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
  if (!(await isAuthorized(request))) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'json'
  const table = searchParams.get('table')

  try {
    // Single table export
    if (table) {
      if (!BACKUP_TABLES.includes(table)) {
        return Response.json({ error: 'Tabla no valida' }, { status: 400 })
      }

      const data = await fetchTable(table)

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
        const rows = await fetchTable(t)
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
