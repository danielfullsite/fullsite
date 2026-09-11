'use strict'

/**
 * La pareja URL + llave anon de Supabase que Next inlinea en el paquete offline.
 *
 * ── POR QUE EXISTE (2026-09-10, antes del instalador) ─────────────────────────
 *
 * La variable de repositorio NEXT_PUBLIC_SUPABASE_ANON_KEY traia la llave anon del
 * proyecto de STAGING (ref jkcnxfbbuyyfhwfjizgw) mientras NEXT_PUBLIC_SUPABASE_URL
 * apuntaba a PROD (qjiomlvudfmzuvqvhwpk). Cuatro builds de CI salieron en verde asi:
 * un paquete offline cuyo `apikey` PostgREST rechaza con 401 "Invalid API key" en
 * cada consulta directa, y nada lo detectaba antes de llevarlo a una caja. No se
 * puede reparar despues de instalar: Next lo inlinea en el JavaScript.
 *
 * La llave anon es un JWT publico cuyo `ref` es el proyecto. Se compara con el host
 * de la URL. Y se exige `role: anon`: una service key aqui seria peor que un 401,
 * viajaria dentro del ejecutable a cada terminal del restaurante.
 */

const FORMA_DE_HOST = /^([a-z0-9]{20})\.supabase\.co$/

function refDeLaUrl(url) {
  let host
  try { host = new URL(url).hostname } catch { throw new Error(`NEXT_PUBLIC_SUPABASE_URL no es una URL: ${String(url)}`) }
  const m = FORMA_DE_HOST.exec(host)
  if (!m) throw new Error(`NEXT_PUBLIC_SUPABASE_URL no es un host de Supabase (<ref>.supabase.co): ${host}`)
  return m[1]
}

function claimsDeLaLlave(llave) {
  if (typeof llave !== 'string' || !llave) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY vacia')
  if (llave.startsWith('sb_')) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY es una llave "publishable" (sb_...). El POS la manda como Bearer JWT; usa la llave anon legacy (JWT) del mismo proyecto.')
  }
  const partes = llave.split('.')
  if (partes.length !== 3) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY no es un JWT (se esperaban tres partes)')
  let claims
  try { claims = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8')) }
  catch { throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY no trae claims legibles') }
  if (!claims || typeof claims !== 'object') throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY no trae claims legibles')
  return claims
}

/**
 * Verifica que URL y llave sean del MISMO proyecto y que la llave sea `anon`.
 * Devuelve el ref comun. Lanza con un mensaje que dice exactamente que esta mal
 * y como arreglarlo; nunca imprime la llave.
 */
function verificarParejaSupabase({ url, anonKey }) {
  const refUrl = refDeLaUrl(url)
  const claims = claimsDeLaLlave(anonKey)
  if (claims.role !== 'anon') {
    throw new Error(`NEXT_PUBLIC_SUPABASE_ANON_KEY tiene role=${String(claims.role)}; el paquete solo puede llevar la llave anon. NUNCA la service key: viaja a cada terminal.`)
  }
  if (typeof claims.ref !== 'string' || !claims.ref) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY no trae el ref del proyecto')
  if (claims.ref !== refUrl) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL es del proyecto ${refUrl} pero NEXT_PUBLIC_SUPABASE_ANON_KEY es del proyecto ${claims.ref}. ` +
      'Un paquete asi responde 401 a toda consulta directa. Corrige la variable con la llave anon del proyecto de la URL: ' +
      "gh variable set NEXT_PUBLIC_SUPABASE_ANON_KEY --body '<anon key de " + refUrl + ">'")
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY esta vencida (exp en el pasado)')
  }
  return refUrl
}

module.exports = { verificarParejaSupabase, refDeLaUrl, claimsDeLaLlave }

if (require.main === module) {
  try {
    const ref = verificarParejaSupabase({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY })
    console.log(`Configuracion publica coherente: proyecto ${ref}`)
  } catch (e) {
    console.error(`::error::${e.message}`)
    process.exit(1)
  }
}
