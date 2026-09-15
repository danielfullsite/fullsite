#!/usr/bin/env node
/**
 * TI-07 — `ocm_daily` no entrega el restaurante de nadie más.
 *
 * ALCANCE: sólo `ocm_daily`. Nada más. El guardián general de vistas y el caso de
 * `agent_runs` viven en sus propios cambios; mezclarlos aquí volvería este archivo
 * imposible de revisar durante un incidente.
 *
 * POR QUÉ EXISTE, SI YA HABÍA CHECKS DE AISLAMIENTO
 * `ti_checks.sql`, en esta misma carpeta, cubre TABLAS: pos_orders,
 * pos_menu_categories, pos_staff. Y su encabezado ya advierte lo único que importa
 * aquí: "Con service_role, RLS se bypassa y los checks no son confiables".
 *
 * Lo que no cubría era ninguna VISTA — y la fuga del 2026-09-09 fue exactamente
 * eso. `pos_orders` conservó su RLS intacto todo el tiempo. Quien perdió el candado
 * fue la vista, que al recrearse dejó de correr con `security_invoker` y pasó a
 * correr como su dueño `postgres` (rolbypassrls = true). El RLS de la tabla base
 * seguía ahí, perfecto, y no servía de nada.
 *
 * De ahí la regla que este archivo fija: el aislamiento se comprueba en la
 * SUPERFICIE que el cliente consulta, no en la tabla donde uno cree que vive.
 *
 * CREDENCIALES: SÓLO TOKENS, NUNCA CONTRASEÑAS
 * Este script no inicia sesión y no acepta contraseñas — a propósito. Recibe dos
 * access tokens ya emitidos, de vida corta, por variable de entorno. Así no hay
 * ninguna ruta por la que una contraseña real acabe en un archivo, en un log, en el
 * historial del shell o en una conversación.
 *
 *   export SUPABASE_URL=...
 *   export SUPABASE_ANON_KEY=...        # llave publicable: es la que usa el dashboard
 *   export TI_JWT_A='eyJ...'            # token de un usuario del inquilino A
 *   export TI_JWT_B='eyJ...'            # token de un usuario del inquilino B
 *   node scripts/tenant-isolation/ti07_ocm_daily.mjs
 *
 * QUÉ COMPRUEBA
 *   1. `anon` NO puede leer la vista.           (corre siempre, sin credenciales)
 *   2. Ninguna sesión ve un client_id ajeno.    (necesita TI_JWT_A y TI_JWT_B)
 *   3. `service_role` conserva su acceso.       (opcional, si hay SUPABASE_SERVICE_KEY)
 *
 * CONTRA EL VERDE EN VACÍO
 * Un test de aislamiento pasa trivialmente si no hay datos o si no hay sesiones.
 * Por eso lo no concluyente sale como código 2 y NUNCA como éxito: "no pude mirar"
 * jamás debe leerse igual que "está bien".
 *
 * SALIDAS  0 = aprobado · 1 = fuga · 2 = no concluyente
 */

const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const ANON = process.env.SUPABASE_ANON_KEY || ''
const JWT_A = process.env.TI_JWT_A || ''
const JWT_B = process.env.TI_JWT_B || ''
const SERVICE = process.env.SUPABASE_SERVICE_KEY || ''

if (!URL || !ANON) {
  console.error('FALLO: faltan SUPABASE_URL y/o SUPABASE_ANON_KEY.')
  process.exit(2)
}

const unicos = (filas, col) => [...new Set(filas.map((f) => f[col]))].sort()

async function pedir(token, recurso) {
  return fetch(`${URL}/rest/v1/${recurso}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
}

async function leer(token, recurso) {
  const r = await pedir(token, recurso)
  if (!r.ok) throw new Error(`GET ${recurso} → ${r.status} ${await r.text()}`)
  return r.json()
}

const fallos = []
const notas = []

/** 1 · La llave pública no abre la vista. */
async function anonNoLee() {
  const r = await pedir(ANON, 'ocm_daily?select=client_id&limit=1')
  if (r.ok) {
    fallos.push(`anon leyó ocm_daily (HTTP ${r.status}) — la llave pública NO debe abrir esta vista`)
  } else {
    notas.push(`anon rechazado con HTTP ${r.status} — correcto`)
  }
}

/**
 * 2 · Aislamiento entre dos sesiones reales.
 *
 * Lo esperado NO se codifica aquí: cada sesión pregunta por `client_users`, cuyo
 * RLS le devuelve exactamente los restaurantes a los que pertenece. Importa porque
 * el modelo SÍ admite usuarios multi-restaurante — "ver dos client_id" no es de por
 * sí una fuga; ver uno que no está en tu lista, sí.
 */
async function radiografia(etiqueta, token) {
  const suyos = unicos(await leer(token, 'client_users?select=client_id'), 'client_id')
  const vistos = unicos(await leer(token, 'ocm_daily?select=client_id'), 'client_id')
  console.log(`  ${etiqueta}: pertenece a [${suyos.join(', ') || '—'}] · ocm_daily devuelve [${vistos.join(', ') || '—'}]`)
  return { etiqueta, suyos, vistos }
}

function evaluarAislamiento(a, b) {
  for (const s of [a, b]) {
    if (s.suyos.length === 0) {
      fallos.push(`${s.etiqueta}: no pertenece a ningún restaurante — no concluyente`)
    } else if (s.vistos.length === 0) {
      fallos.push(`${s.etiqueta}: ocm_daily devolvió 0 filas. Usar un token de un restaurante CON ventas, o la prueba pasa en vacío`)
    }
  }
  if (a.suyos.join() === b.suyos.join()) {
    fallos.push('A y B pertenecen al mismo conjunto de restaurantes: no pueden probarse mutuamente')
  }
  for (const s of [a, b]) {
    const ajenos = s.vistos.filter((c) => !s.suyos.includes(c))
    if (ajenos.length) fallos.push(`TI-07 ${s.etiqueta}: ocm_daily expuso restaurantes ajenos → ${ajenos.join(', ')}`)
  }
  const aVeDeB = a.vistos.filter((c) => b.suyos.includes(c) && !a.suyos.includes(c))
  const bVeDeA = b.vistos.filter((c) => a.suyos.includes(c) && !b.suyos.includes(c))
  if (aVeDeB.length) fallos.push(`TI-07 A vio client_id de B: ${aVeDeB.join(', ')}`)
  if (bVeDeA.length) fallos.push(`TI-07 B vio client_id de A: ${bVeDeA.join(', ')}`)
}

/** 3 · El arreglo no debe cerrarle la puerta a los agentes. */
async function servicioConserva() {
  const vistos = unicos(await leer(SERVICE, 'ocm_daily?select=client_id'), 'client_id')
  if (vistos.length < 2) {
    fallos.push(`service_role sólo ve ${vistos.length} restaurante(s) en ocm_daily; se esperaba el conjunto completo`)
  } else {
    notas.push(`service_role conserva acceso — ve ${vistos.length} restaurantes`)
  }
}

async function main() {
  console.log('TI-07 · aislamiento de ocm_daily\n')
  await anonNoLee()

  let concluyente = false
  if (JWT_A && JWT_B) {
    evaluarAislamiento(await radiografia('A', JWT_A), await radiografia('B', JWT_B))
    concluyente = true
  } else {
    notas.push('TI_JWT_A / TI_JWT_B ausentes: NO se comprobó el aislamiento entre inquilinos')
  }

  if (SERVICE) await servicioConserva()
  else notas.push('SUPABASE_SERVICE_KEY ausente: no se comprobó que service_role conserve acceso')

  console.log('')
  for (const n of notas) console.log(`  · ${n}`)
  console.log('')

  if (fallos.length) {
    console.error('FALLO:')
    for (const f of fallos) console.error(`  · ${f}`)
    return 1
  }
  if (!concluyente) {
    console.error('NO CONCLUYENTE — `anon` está cerrado, pero sin dos tokens no se')
    console.error('comprobó lo que importa: que una sesión no vea al vecino.')
    console.error('Esto NO es un aprobado.')
    return 2
  }
  console.log('OK — TI-07 aprobado. Ninguna sesión vio datos de otro inquilino.')
  return 0
}

main().then(
  (c) => process.exit(c),
  (e) => { console.error(`FALLO: ${e.message}`); process.exit(1) },
)
