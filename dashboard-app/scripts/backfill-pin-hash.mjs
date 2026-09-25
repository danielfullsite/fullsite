#!/usr/bin/env node
/**
 * F3 de docs/security/PLAN-PIN-HASH.md — llenar `pos_staff.pin_hash` en las filas que no lo tienen.
 *
 * Una sola vez, corrido por Daniel en su máquina (NO por el MCP, que es read-only, ni en CI):
 *
 *   node dashboard-app/scripts/backfill-pin-hash.mjs                     # simulación: sólo cuenta
 *   node dashboard-app/scripts/backfill-pin-hash.mjs --verificar         # re-deriva y compara (lectura)
 *   node dashboard-app/scripts/backfill-pin-hash.mjs --aplicar --confirmo-doble-escritura-activa
 *   … --cliente <client_id>                                             # acota a un restaurante
 *
 * Entorno: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY, POS_PIN_PEPPER (la MISMA que Vercel
 * prod y preview; si difiere, F4 no encuentra a nadie).
 *
 * Reglas, y por qué:
 *  · NUNCA imprime un PIN ni un hash. Sólo conteos e ids de fila (los ids no son credenciales).
 *  · Simulación por omisión. Escribir exige --aplicar Y --confirmo-doble-escritura-activa: si F2
 *    (POS_PIN_DUAL_WRITE=on) no está desplegado, un PIN cambiado después del backfill dejaría un
 *    hash viejo y F4 dejaría fuera a esa persona. El script no puede leer Vercel; lo afirma quien
 *    lo corre.
 *  · Escritura CONDICIONAL: PATCH …&pin_hash=is.null. Si entre la lectura y la escritura alguien
 *    restableció el PIN (con F2 activo ya trae su hash), la fila no se toca. El PIN no viaja en la
 *    URL — las URLs quedan en los logs de PostgREST.
 *  · Falla cerrado: sin pimienta válida no lee ni escribe nada.
 *  · El HMAC es el mismo de src/lib/pos-pin-hash.ts (HMAC-SHA256(pimienta, `${client_id}:${pin}`),
 *    hex minúsculas). La prueba backfill-pin-hash.test.ts ata los dos: si divergen, falla.
 */
import { createHmac } from 'node:crypto'

const PIMIENTA_VALIDA = /^[0-9a-fA-F]{64}$/
const PIN_VALIDO = /^\d{4,10}$/
const CLIENT_ID_VALIDO = /^[a-z0-9_-]{1,40}$/i
export const VERSION_DE_PIMIENTA = 1
const PAGINA = 500

export function hashPin(pimienta, clientId, pin) {
  if (!PIMIENTA_VALIDA.test(pimienta || '')) throw new Error('POS_PIN_PEPPER ausente o no son 64 hex')
  if (!CLIENT_ID_VALIDO.test(clientId || '')) throw new Error('client_id inválido')
  if (!PIN_VALIDO.test(pin || '')) throw new Error('PIN con formato inválido')
  return createHmac('sha256', Buffer.from(pimienta, 'hex')).update(`${clientId}:${pin}`).digest('hex')
}

export function leerArgs(argv) {
  const a = { aplicar: false, verificar: false, confirmo: false, cliente: null }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x === '--aplicar') a.aplicar = true
    else if (x === '--verificar') a.verificar = true
    else if (x === '--confirmo-doble-escritura-activa') a.confirmo = true
    else if (x === '--cliente') a.cliente = argv[++i] ?? null
    else throw new Error(`argumento desconocido: ${x}`)
  }
  if (a.aplicar && a.verificar) throw new Error('--aplicar y --verificar son excluyentes')
  if (a.aplicar && !a.confirmo) throw new Error('--aplicar exige --confirmo-doble-escritura-activa (F2 desplegado)')
  if (a.cliente !== null && !CLIENT_ID_VALIDO.test(a.cliente)) throw new Error('--cliente inválido')
  return a
}

/**
 * Corre el backfill o la verificación. `fetchImpl` y `log` se inyectan para las pruebas.
 * Devuelve un resumen SIN valores secretos.
 */
export async function correr({ url, llave, pimienta, args, fetchImpl = fetch, log = console.log }) {
  if (!url || !llave) throw new Error('faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_KEY')
  if (!PIMIENTA_VALIDA.test(pimienta || '')) throw new Error('POS_PIN_PEPPER ausente o no son 64 hex')
  const H = { apikey: llave, Authorization: `Bearer ${llave}`, 'Content-Type': 'application/json' }
  const filtroCliente = args.cliente ? `&client_id=eq.${encodeURIComponent(args.cliente)}` : ''
  const soloFaltantes = args.verificar ? '&pin_hash=not.is.null' : '&pin_hash=is.null'
  const r = { modo: args.aplicar ? 'aplicar' : args.verificar ? 'verificar' : 'simulacion',
    leidas: 0, pendientes: 0, escritas: 0, omitidas_por_carrera: 0, invalidas: [], no_coinciden: [], errores: [] }

  for (let offset = 0; ; offset += PAGINA) {
    const res = await fetchImpl(
      `${url}/rest/v1/pos_staff?select=id,client_id,pin,pin_hash,pin_hash_v${soloFaltantes}${filtroCliente}&order=id.asc&limit=${PAGINA}&offset=${offset}`,
      { headers: H },
    )
    if (!res.ok) throw new Error(`lectura falló (${res.status})`)
    const filas = await res.json()
    if (!Array.isArray(filas)) throw new Error('lectura: respuesta no es una lista')
    for (const f of filas) {
      r.leidas++
      let h
      try { h = hashPin(pimienta, f.client_id, f.pin) } catch { r.invalidas.push(f.id); continue }
      if (args.verificar) {
        if (f.pin_hash !== h || f.pin_hash_v !== VERSION_DE_PIMIENTA) r.no_coinciden.push(f.id)
        continue
      }
      r.pendientes++
      if (!args.aplicar) continue
      const w = await fetchImpl(
        `${url}/rest/v1/pos_staff?id=eq.${encodeURIComponent(f.id)}&client_id=eq.${encodeURIComponent(f.client_id)}&pin_hash=is.null`,
        { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
          body: JSON.stringify({ pin_hash: h, pin_hash_v: VERSION_DE_PIMIENTA }) },
      )
      if (!w.ok) { r.errores.push(`${f.id}:${w.status}`); continue }
      const cuerpo = await w.json().catch(() => [])
      if (Array.isArray(cuerpo) && cuerpo.length === 1) r.escritas++
      else r.omitidas_por_carrera++
    }
    if (filas.length < PAGINA) break
  }
  log(JSON.stringify(r))
  return r
}

const esPrincipal = import.meta.url === `file://${process.argv[1]}`
if (esPrincipal) {
  try {
    const args = leerArgs(process.argv.slice(2))
    const r = await correr({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL, llave: process.env.SUPABASE_SERVICE_KEY,
      pimienta: (process.env.POS_PIN_PEPPER || '').trim(), args,
    })
    const mal = r.invalidas.length + r.no_coinciden.length + r.errores.length
    process.exit(mal ? 1 : 0)
  } catch (e) {
    // Sólo el mensaje: ninguno de los mensajes de arriba incluye un valor secreto.
    console.error(`[backfill-pin-hash] ${e instanceof Error ? e.message : 'error'}`)
    process.exit(2)
  }
}
