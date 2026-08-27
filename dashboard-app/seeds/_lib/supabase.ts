import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolve } from 'path'

/**
 * Carga .env.local si existe. NO truena cuando falta: en CI las credenciales
 * llegan como variables de entorno y no hay archivo que leer.
 *
 * Antes esto lanzaba siempre que faltara el archivo, así que el framework de
 * semillas sólo podía correr en una máquina con .env.local — o sea, nunca en
 * GitHub Actions, que es justo donde vive SUPABASE_SERVICE_KEY. Por eso las
 * demos se venían sembrando con scripts de Python aparte en vez de con esto.
 *
 * El archivo NO pisa lo que ya esté en el entorno (`!process.env[key]`), así que
 * en CI las variables del workflow siempre ganan.
 */
function loadEnvLocal(): string | null {
  const paths = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '../.env.local'),
  ]
  for (const p of paths) {
    try {
      const content = readFileSync(p, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (key && !process.env[key]) process.env[key] = val
      }
      return p
    } catch { /* try next path */ }
  }
  return null
}

let _client: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  if (_client) return _client
  const archivo = loadEnvLocal()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    // Se dice DÓNDE se buscó: "falta la llave" sin decir si había archivo manda a
    // revisar el lugar equivocado. Nunca se imprime el valor de nada.
    const donde = archivo
      ? `se leyó ${archivo} pero no trae ${!url ? 'NEXT_PUBLIC_SUPABASE_URL' : 'SUPABASE_SERVICE_KEY'}`
      : 'no se encontró .env.local y tampoco venían en el entorno'
    throw new Error(`Faltan credenciales de Supabase: ${donde}.`)
  }
  _client = createClient(url, key, { auth: { persistSession: false } })
  return _client
}
