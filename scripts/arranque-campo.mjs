#!/usr/bin/env node
// Arranque de trabajo de campo — lo que hay que saber ANTES de tocar nada.
//
// ── POR QUÉ EXISTE ───────────────────────────────────────────────────────────
//
// La noche del 2026-09-13 al 14 se hicieron unas treinta búsquedas en el repo y
// se leyó UN documento completo. Se le hicieron a Daniel tres preguntas que ya
// estaban contestadas por escrito, y se certificó el KDS de cocina como si fuera
// un POS secundario, inventando dos fallas.
//
// La causa raíz no fue el olvido: fue que nada obliga. Hay 429 documentos y un
// índice que no se abrió. Un aviso que salta en cada búsqueda deja de avisar.
//
// Esto no es un documento más. Es un comando que produce lo que de todas formas
// hace falta al empezar —topología, preguntas ya contestadas, estado real de las
// máquinas—, y por eso se corre. Ver CLAUDE.md §17, «La regla de la lectura».
//
// ── USO ──────────────────────────────────────────────────────────────────────
//
//   node scripts/arranque-campo.mjs                        # sólo el mapa
//   node scripts/arranque-campo.mjs --certificar \
//        --secreto ~/ruta/lan-secret --sha 1dfd213492d7     # además certifica
//
// El archivo scripts/terminales.json es la fuente de la topología. Si una
// terminal cambia de rol, se cambia AHÍ, no en la memoria de nadie.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const AQUI = dirname(fileURLToPath(import.meta.url))
const registro = JSON.parse(readFileSync(join(AQUI, 'terminales.json'), 'utf8'))

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (!a.startsWith('--')) continue
  const sig = process.argv[i + 1]
  args[a.slice(2)] = (sig && !sig.startsWith('--')) ? sig : true
}
const RESTAURANTE = typeof args.restaurante === 'string' ? args.restaurante : 'amalay'
const r = registro.restaurantes[RESTAURANTE]
if (!r) { console.error(`No conozco «${RESTAURANTE}». Están: ${Object.keys(registro.restaurantes).join(', ')}`); process.exit(2) }

const COLOR = process.stdout.isTTY
const c = (n, t) => COLOR ? `[${n}m${t}[0m` : t
const titulo = t => console.log('\n' + c(1, t) + '\n' + '─'.repeat(t.length))

// ── 1. Quién es quién ────────────────────────────────────────────────────────
titulo(`TERMINALES DE ${r.nombre.toUpperCase()}`)
console.log('  máquina   es            rol          LAN            Tailscale        impr.  huella')
for (const t of r.terminales) {
  const ts = t.tailscale || c(31, 'FALTA         ')
  console.log(
    `  ${(t.nombre || '').padEnd(9)} ${(t.alias || '').padEnd(13)} ${(t.rol || '').padEnd(12)} ` +
    `${(t.lan || '—').padEnd(14)} ${String(ts).padEnd(16)} ` +
    `${t.tiene_impresoras ? ' sí  ' : ' no  '} ${t.tiene_huella ? ' sí' : ' no'}`
  )
}
for (const t of r.terminales) if (t.notas) console.log(c(90, `    · ${t.nombre}: ${t.notas}`))

// ── 2. Lo que el restaurante es ──────────────────────────────────────────────
titulo('EL RESTAURANTE')
console.log(`  ${r.mesas} mesas en ${r.zonas.length} zonas: ${r.zonas.join(', ')}`)
console.log(`  ${r.personal_activo} personas activas: ` +
  Object.entries(r.personal_por_rol).map(([k, v]) => `${v} ${k}`).join(' · '))
console.log(`  modo de autoridad: ${r.modo}`)
console.log(c(90, `    · ${r.modo_nota}`))

titulo('IMPRESIÓN')
for (const p of r.impresoras) {
  const donde = p.host ? `${p.conexion} ${p.host}` : `${p.conexion} ${(p.nombres_windows || []).join(', ')}`
  console.log(`  ${p.estacion.padEnd(8)} ${p.nombre.padEnd(9)} ${donde}`)
  if (p.nota) console.log(c(90, `           · ${p.nota}`))
  if (p.etiqueta_fisica) console.log(c(90, `           · etiqueta física: ${p.etiqueta_fisica}`))
}
console.log(`  sin pantalla de cocina: ${r.sin_kds.join(', ')}`)

// ── 3. Preguntas que NO hay que hacerle a Daniel ─────────────────────────────
titulo('YA ESTÁ CONTESTADO — no preguntar')
const contestadas = [
  ['¿Qué es PDV2?', 'el KDS de cocina (kds_only). Sin impresoras y sin login, por diseño.',
   'project_amalay_deployment_state.md:24 · DECISION-BRAIN.md:97'],
  ['¿El ticket de caja sale en la panadería?', 'no. La panadería no tiene impresora; se comunican de voz.',
   'DEBRIEF-JUL12.md:269'],
  ['¿Los productos de Market imprimen comanda?', 'no. Market y caja sacan ticket USB, sin KDS.',
   'DEBRIEF-JUL12.md:269'],
  ['¿Cómo imprime una terminal secundaria?', 'postea a SU propio Pedro (127.0.0.1) y ése reenvía a la Caja.',
   'OFFLINE-LAN-FIELD-PROVEN §5.5 🔒'],
  ['¿Por qué el KDS va por HTTP y no HTTPS?', 'una página https no puede hablarle a una IP de LAN: mixed-content.',
   'OFFLINE-LAN-FIELD-PROVEN §4.1 🔒'],
  ['¿Los arreglos de pantalla llegan por Vercel?', 'NO al POS de Electron: sirve el ui-bundle del instalador.',
   'HALLAZGOS-CAMPO-2026-09-13 §2 · offline-ui/protocol.js:19'],
]
for (const [p, resp, fuente] of contestadas) {
  console.log(`  ${c(33, p)}`)
  console.log(`    ${resp}`)
  console.log(c(90, `    ${fuente}`))
}

// ── 4. Lectura obligatoria ───────────────────────────────────────────────────
titulo('LEER ANTES DE TOCAR (completo, no con grep)')
for (const [doc, zanja] of [
  ['docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md', 'la arquitectura que SÍ jaló y las 6 reglas 🔒 de no romper'],
  ['docs/pos/HALLAZGOS-CAMPO-2026-09-13.md', 'lo que estaba roto en campo y por qué las pruebas no lo veían'],
  ['docs/pos/PLAN-CIERRE-SISTEMA.md', 'qué significa «cerrado» y en qué orden se llega'],
  ['docs/DECISION-BRAIN.md', 'el índice: qué documento zanja qué pregunta'],
]) console.log(`  ${doc}\n${c(90, `    → ${zanja}`)}`)

// ── 5. Estado real de las máquinas ───────────────────────────────────────────
if (!args.certificar) {
  console.log('\n' + c(90, '  (agrega --certificar --secreto <archivo> para interrogar las máquinas vivas)\n'))
  process.exit(0)
}

titulo('CERTIFICACIÓN DE LAS MÁQUINAS VIVAS')
let fallas = 0
for (const t of r.terminales) {
  if (!t.tailscale) { console.log(`\n  ${t.nombre} (${t.alias}): ${c(33, 'sin Tailscale — no alcanzable desde aquí')}`); continue }
  const argv = ['scripts/certificar-terminal.mjs', '--host', t.tailscale, '--rol', t.rol]
  if (typeof args.secreto === 'string') argv.push('--secreto', args.secreto)
  if (typeof args.sha === 'string') argv.push('--sha', args.sha)
  if (t.rol !== 'kds') argv.push('--personal', String(r.personal_activo))
  if (t.rol === 'secundaria') {
    const caja = r.terminales.find(x => x.rol === 'caja')
    if (caja?.tailscale) argv.push('--caja', caja.tailscale)
  }
  console.log(`\n  ── ${t.nombre} (${t.alias}) ──`)
  try {
    const salida = execFileSync('node', argv, { cwd: join(AQUI, '..'), encoding: 'utf8' })
    console.log(salida.split('\n').filter(l => /FALLA|PENDIENTE|pasan|CERTIF/.test(l)).join('\n'))
  } catch (e) {
    fallas++
    const salida = (e.stdout || '') + (e.stderr || '')
    console.log(salida.split('\n').filter(l => /FALLA|PENDIENTE|pasan|CERTIF/.test(l)).join('\n'))
  }
}
console.log()
process.exit(fallas > 0 ? 1 : 0)
