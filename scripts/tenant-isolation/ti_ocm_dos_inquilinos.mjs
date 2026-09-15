#!/usr/bin/env node
/**
 * TI-07/TI-08 — Aislamiento de `ocm_daily` y `agent_runs`, con DOS sesiones reales.
 *
 * POR QUE ESTE ARCHIVO Y NO UN SELECT MAS
 * `ti_checks.sql` (junto a este archivo) ya cubre las TABLAS base — pos_orders,
 * pos_menu_categories, pos_staff — y su propio encabezado advierte lo unico que
 * importa aqui: "Con service_role, RLS se bypassa y los checks no son confiables".
 *
 * Lo que NO cubria era ninguna VISTA. Y la fuga de 2026-09-09 fue exactamente eso:
 * `pos_orders` tenia su RLS intacto todo el tiempo — quien lo perdio fue la vista
 * `ocm_daily`, que al recrearse dejo de correr con `security_invoker` y paso a
 * correr como su dueno `postgres` (rolbypassrls = true). El RLS de la tabla base
 * seguia ahi, perfecto, y no servia de nada.
 *
 * De ahi la regla que este archivo fija: el aislamiento se comprueba en la
 * SUPERFICIE que el cliente consulta, no en la tabla donde uno cree que vive.
 *
 * POR QUE DOS USUARIOS Y NO UNO
 * Un solo usuario no puede distinguir "el RLS funciona" de "este usuario resulta
 * tener acceso a todo". Con dos de restaurantes distintos, la afirmacion es
 * simetrica y falsable en ambas direcciones.
 *
 * COMO SE DERIVA LO ESPERADO
 * No se codifican los slugs. Cada sesion pregunta por `client_users`, cuyo RLS
 * (`private.user_has_client_access(client_id)`) le devuelve exactamente los
 * restaurantes a los que pertenece. Eso importa porque el modelo SI admite usuarios
 * multi-restaurante: hoy hay uno que pertenece a 6. "Ver dos client_id" no es de por
 * si una fuga; ver uno que no esta en tu lista, si.
 *
 * CONTRA EL VERDE EN VACIO
 * Un test de aislamiento pasa trivialmente si no hay datos. Por eso aborta con FALLO
 * —no con exito— si la lista de restaurantes de una sesion viene vacia o si su
 * propio restaurante no tiene ni una fila en `ocm_daily`. Elegir dos usuarios cuyo
 * tenant SI tenga datos es parte del contrato de esta prueba.
 *
 * USO
 *   export SUPABASE_URL=...            # mismo proyecto que se quiere certificar
 *   export SUPABASE_ANON_KEY=...       # llave publica: es la que usa el dashboard
 *   export TI_USER_A=correo-del-inquilino-A
 *   export TI_PASS_A=...
 *   export TI_USER_B=correo-del-inquilino-B
 *   export TI_PASS_B=...
 *   node scripts/tenant-isolation/ti_ocm_dos_inquilinos.mjs
 *
 * Salida 0 = aislado. Salida 1 = fuga (o prueba no concluyente, que se reporta como
 * fallo a proposito: no concluyente nunca debe leerse como aprobado).
 */

const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const ANON = process.env.SUPABASE_ANON_KEY || ''

const FALTANTES = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TI_USER_A', 'TI_PASS_A', 'TI_USER_B', 'TI_PASS_B']
  .filter((k) => !process.env[k])
if (FALTANTES.length) {
  console.error(`FALLO: faltan variables de entorno: ${FALTANTES.join(', ')}`)
  console.error('Sin dos sesiones reales esta prueba no puede afirmar nada. Ver el encabezado.')
  process.exit(1)
}

/** Inicia sesion y devuelve el access_token del usuario (no service_role). */
async function entrar(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!r.ok) throw new Error(`login fallido para ${email}: ${r.status} ${await r.text()}`)
  const j = await r.json()
  if (!j.access_token) throw new Error(`login sin access_token para ${email}`)
  return j.access_token
}

/** GET contra PostgREST con el token del USUARIO — la misma ruta que el dashboard. */
async function leer(token, recurso) {
  const r = await fetch(`${URL}/rest/v1/${recurso}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new Error(`GET ${recurso} → ${r.status} ${await r.text()}`)
  return r.json()
}

const unicos = (filas, col) => [...new Set(filas.map((f) => f[col]))].sort()

async function radiografia(etiqueta, email, password) {
  const token = await entrar(email, password)

  // Lo que ESTE usuario tiene derecho a ver, segun la base, no segun este archivo.
  const suyos = unicos(await leer(token, 'client_users?select=client_id'), 'client_id')
  // Lo que la vista le entrega de verdad.
  const vistos = unicos(await leer(token, 'ocm_daily?select=client_id'), 'client_id')
  // Telemetria global de la plataforma: un inquilino no debe ver ni una fila.
  const runs = await leer(token, 'agent_runs?select=id&limit=200')

  console.log(`  ${etiqueta}: pertenece a [${suyos.join(', ') || '—'}] · ocm_daily devuelve [${vistos.join(', ') || '—'}] · agent_runs ${runs.length} filas`)
  return { etiqueta, suyos, vistos, runs: runs.length }
}

function evaluar(a, b) {
  const fallos = []

  // ── Guardas anti-vacio. Un "0 filas" por falta de datos no es aislamiento.
  for (const s of [a, b]) {
    if (s.suyos.length === 0) {
      fallos.push(`${s.etiqueta}: no pertenece a ningun restaurante — prueba no concluyente`)
    } else if (s.vistos.length === 0) {
      fallos.push(`${s.etiqueta}: ocm_daily devolvio 0 filas; elegir un usuario cuyo restaurante tenga ventas, o la prueba pasa en vacio`)
    }
  }
  if (a.suyos.join() === b.suyos.join()) {
    fallos.push('A y B pertenecen al mismo conjunto de restaurantes: no pueden probarse mutuamente')
  }

  // ── TI-07 · la vista nunca entrega un restaurante ajeno.
  for (const s of [a, b]) {
    const ajenos = s.vistos.filter((c) => !s.suyos.includes(c))
    if (ajenos.length) {
      fallos.push(`TI-07 ${s.etiqueta}: ocm_daily expuso restaurantes ajenos → ${ajenos.join(', ')}`)
    }
  }
  // Simetrico y explicito: lo que pidio el encargo, en sus terminos.
  const aVeDeB = a.vistos.filter((c) => b.suyos.includes(c) && !a.suyos.includes(c))
  const bVeDeA = b.vistos.filter((c) => a.suyos.includes(c) && !b.suyos.includes(c))
  if (aVeDeB.length) fallos.push(`TI-07 A vio client_id de B: ${aVeDeB.join(', ')}`)
  if (bVeDeA.length) fallos.push(`TI-07 B vio client_id de A: ${bVeDeA.join(', ')}`)

  // ── TI-08 · agent_runs es telemetria de plataforma: 0 filas para un inquilino.
  for (const s of [a, b]) {
    if (s.runs > 0) {
      fallos.push(`TI-08 ${s.etiqueta}: leyo ${s.runs} filas de agent_runs (telemetria de plataforma; debe ser 0 salvo platform_admin)`)
    }
  }
  return fallos
}

async function main() {
  console.log('Aislamiento con dos sesiones reales (sin service_role):')
  const a = await radiografia('A', process.env.TI_USER_A, process.env.TI_PASS_A)
  const b = await radiografia('B', process.env.TI_USER_B, process.env.TI_PASS_B)

  const fallos = evaluar(a, b)
  console.log('')
  if (!fallos.length) {
    console.log('OK — TI-07 y TI-08 aprobados. Ninguna sesion vio datos del otro inquilino.')
    return 0
  }
  console.error('FALLO:')
  for (const f of fallos) console.error(`  · ${f}`)
  return 1
}

main().then(
  (c) => process.exit(c),
  (e) => { console.error(`FALLO: ${e.message}`); process.exit(1) },
)
