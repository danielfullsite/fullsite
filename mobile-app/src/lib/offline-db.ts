// SQLite offline database for React Native
// Uses expo-sqlite for true offline-first operation
import * as SQLite from 'expo-sqlite'

let db: SQLite.SQLiteDatabase | null = null

export async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('fullsite_pos')
    await initTables()
  }
  return db
}

async function initTables() {
  if (!db) return

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS menu (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      mesa TEXT,
      mesero TEXT,
      status TEXT DEFAULT 'open',
      data TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      method TEXT NOT NULL,
      data TEXT NOT NULL,
      retries INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_synced ON orders(synced);
  `)
}

// ─── Menu Cache ────────────────────────────────────────────────────────────

export async function cacheMenu(categories: unknown[]) {
  const database = await getDB()
  await database.runAsync('DELETE FROM menu')
  for (const cat of categories) {
    const data = JSON.stringify(cat)
    await database.runAsync('INSERT INTO menu (id, data) VALUES (?, ?)', [(cat as { id: string }).id, data])
  }
}

export async function getCachedMenu(): Promise<unknown[]> {
  const database = await getDB()
  const rows = await database.getAllAsync('SELECT data FROM menu')
  return rows.map((r: unknown) => JSON.parse((r as { data: string }).data))
}

// ─── Orders ────────────────────────────────────────────────────────────────

export async function saveOrder(order: { id: string; mesa: string; mesero: string; status: string }) {
  const database = await getDB()
  const data = JSON.stringify(order)
  await database.runAsync(
    `INSERT OR REPLACE INTO orders (id, mesa, mesero, status, data, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [order.id, order.mesa, order.mesero, order.status, data]
  )
}

export async function getOrders(status?: string): Promise<unknown[]> {
  const database = await getDB()
  const query = status
    ? 'SELECT data FROM orders WHERE status = ? ORDER BY created_at DESC'
    : 'SELECT data FROM orders ORDER BY created_at DESC'
  const rows = await database.getAllAsync(query, status ? [status] : [])
  return rows.map((r: unknown) => JSON.parse((r as { data: string }).data))
}

// ─── Sync Queue ────────────────────────────────────────────────────────────

export async function queueForSync(table: string, method: string, data: unknown) {
  const database = await getDB()
  await database.runAsync(
    'INSERT INTO sync_queue (table_name, method, data) VALUES (?, ?, ?)',
    [table, method, JSON.stringify(data)]
  )
}

export async function getPendingSync(): Promise<{ id: number; table_name: string; method: string; data: string }[]> {
  const database = await getDB()
  const rows = await database.getAllAsync('SELECT * FROM sync_queue WHERE retries < 5 ORDER BY created_at ASC')
  return rows as { id: number; table_name: string; method: string; data: string }[]
}

export async function removeSynced(id: number) {
  const database = await getDB()
  await database.runAsync('DELETE FROM sync_queue WHERE id = ?', [id])
}

export async function incrementRetry(id: number) {
  const database = await getDB()
  await database.runAsync('UPDATE sync_queue SET retries = retries + 1 WHERE id = ?', [id])
}
