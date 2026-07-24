import { randomUUID } from 'crypto'

export const uuid = () => randomUUID()

export const randInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min

export const randItem = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

export function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(randInt(8, 21), randInt(0, 59), 0, 0)
  return d
}

export function isoDate(d: Date): string {
  return d.toISOString()
}

export function log(msg: string) {
  process.stdout.write(`  ${msg}\n`)
}

export function logSection(title: string) {
  process.stdout.write(`\n▸ ${title}\n`)
}

export async function upsertRows<T extends Record<string, unknown>>(
  client: import('@supabase/supabase-js').SupabaseClient,
  table: string,
  rows: T[],
  onConflict: string
): Promise<void> {
  if (rows.length === 0) return
  const { error } = await client.from(table).upsert(rows, { onConflict })
  if (error) throw new Error(`[${table}] ${error.message}`)
  log(`${table}: ${rows.length} rows upserted`)
}
