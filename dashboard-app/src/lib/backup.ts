// Automatic data backup system for POS
// Exports orders, menu, inventory, staff to JSON/CSV
// Stores backups in IndexedDB, provides download capability

const BACKUP_DB = 'fullsite_backups'
const BACKUP_VERSION = 1
const BACKUP_INTERVAL_MS = 4 * 60 * 60 * 1000 // Every 4 hours
const MAX_BACKUPS = 30 // Keep last 30 backups
const BACKUP_KEY = 'last_backup_time'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export interface BackupMetadata {
  id: string
  timestamp: string
  tables: string[]
  sizeBytes: number
  ordersCount: number
  type: 'auto' | 'manual'
}

interface BackupRecord {
  id: string
  metadata: BackupMetadata
  data: Record<string, unknown[]>
}

// ─── IndexedDB for backup storage ──────────────────────────────────────────

function openBackupDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB, BACKUP_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('backups')) {
        const store = db.createObjectStore('backups', { keyPath: 'id' })
        store.createIndex('timestamp', 'metadata.timestamp', { unique: false })
      }
    }
  })
}

// ─── Fetch data from Supabase ──────────────────────────────────────────────

async function fetchTable(table: string, limit = 10000): Promise<unknown[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?limit=${limit}&order=created_at.desc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    )
    if (res.ok) return await res.json()
    return []
  } catch {
    return []
  }
}

// ─── Create backup ─────────────────────────────────────────────────────────

export async function createBackup(type: 'auto' | 'manual' = 'manual'): Promise<BackupMetadata> {
  const tables = ['pos_orders', 'pos_staff', 'pos_ingredients', 'pos_recipes', 'pos_inventory', 'pos_purchase_orders', 'pos_facturas', 'pos_audit_log']

  const data: Record<string, unknown[]> = {}
  let ordersCount = 0

  // Fetch all tables in parallel
  const results = await Promise.allSettled(
    tables.map(async (table) => {
      const rows = await fetchTable(table)
      data[table] = rows
      if (table === 'pos_orders') ordersCount = rows.length
    })
  )

  // Filter to tables that actually returned data
  const tablesWithData = tables.filter((t) => (data[t]?.length ?? 0) > 0)

  const id = `backup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const jsonStr = JSON.stringify(data)
  const sizeBytes = new Blob([jsonStr]).size

  const metadata: BackupMetadata = {
    id,
    timestamp: new Date().toISOString(),
    tables: tablesWithData,
    sizeBytes,
    ordersCount,
    type,
  }

  // Store in IndexedDB
  const db = await openBackupDB()
  const record: BackupRecord = { id, metadata, data }
  const tx = db.transaction('backups', 'readwrite')
  tx.objectStore('backups').put(record)

  // Update last backup time
  localStorage.setItem(BACKUP_KEY, Date.now().toString())

  // Prune old backups
  await pruneOldBackups()

  console.log(`[backup] Created ${type} backup: ${id} (${formatBytes(sizeBytes)}, ${ordersCount} orders)`)
  return metadata
}

// ─── List/Get/Delete backups ───────────────────────────────────────────────

export async function listBackups(): Promise<BackupMetadata[]> {
  const db = await openBackupDB()
  return new Promise((resolve) => {
    const tx = db.transaction('backups', 'readonly')
    const request = tx.objectStore('backups').getAll()
    request.onsuccess = () => {
      const records = (request.result as BackupRecord[]) || []
      const metas = records
        .map((r) => r.metadata)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      resolve(metas)
    }
    request.onerror = () => resolve([])
  })
}

export async function getBackupData(id: string): Promise<Record<string, unknown[]> | null> {
  const db = await openBackupDB()
  return new Promise((resolve) => {
    const tx = db.transaction('backups', 'readonly')
    const request = tx.objectStore('backups').get(id)
    request.onsuccess = () => resolve(request.result?.data ?? null)
    request.onerror = () => resolve(null)
  })
}

export async function deleteBackup(id: string): Promise<void> {
  const db = await openBackupDB()
  const tx = db.transaction('backups', 'readwrite')
  tx.objectStore('backups').delete(id)
}

async function pruneOldBackups() {
  const backups = await listBackups()
  if (backups.length <= MAX_BACKUPS) return

  const toDelete = backups.slice(MAX_BACKUPS)
  for (const b of toDelete) {
    await deleteBackup(b.id)
  }
  console.log(`[backup] Pruned ${toDelete.length} old backups`)
}

// ─── Download backup ───────────────────────────────────────────────────────

export async function downloadBackupJSON(id: string): Promise<void> {
  const data = await getBackupData(id)
  if (!data) throw new Error('Backup no encontrado')

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `fullsite-backup-${id}.json`)
}

export async function downloadBackupCSV(id: string, table: string): Promise<void> {
  const data = await getBackupData(id)
  if (!data || !data[table]) throw new Error('Tabla no encontrada en backup')

  const rows = data[table] as Record<string, unknown>[]
  if (rows.length === 0) throw new Error('Sin datos')

  const headers = Object.keys(rows[0])
  const csvRows = [
    headers.join(','),
    ...rows.map((row) =>
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

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, `fullsite-${table}-${new Date().toISOString().slice(0, 10)}.csv`)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Auto-backup scheduler ────────────────────────────────────────────────

let autoBackupInterval: ReturnType<typeof setInterval> | null = null

export function startAutoBackup() {
  if (typeof window === 'undefined') return
  if (autoBackupInterval) return // Already running

  // Check if we need an immediate backup
  const lastBackup = localStorage.getItem(BACKUP_KEY)
  const elapsed = lastBackup ? Date.now() - parseInt(lastBackup) : Infinity
  if (elapsed >= BACKUP_INTERVAL_MS) {
    // Run first backup after a short delay (don't block startup)
    setTimeout(() => createBackup('auto').catch(console.error), 10000)
  }

  // Schedule recurring backups
  autoBackupInterval = setInterval(async () => {
    try {
      await createBackup('auto')
    } catch (e) {
      console.error('[backup] Auto-backup failed:', e)
    }
  }, BACKUP_INTERVAL_MS)

  console.log('[backup] Auto-backup enabled (every 4 hours)')
}

export function stopAutoBackup() {
  if (autoBackupInterval) {
    clearInterval(autoBackupInterval)
    autoBackupInterval = null
    console.log('[backup] Auto-backup disabled')
  }
}

// ─── Utilities ─────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getLastBackupTime(): Date | null {
  const ts = localStorage.getItem(BACKUP_KEY)
  return ts ? new Date(parseInt(ts)) : null
}
