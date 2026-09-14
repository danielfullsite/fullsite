#!/usr/bin/env node
// Certificación de terminal — interroga a una máquina VIVA y responde PASA o FALLA.
//
// ── POR QUÉ EXISTE ───────────────────────────────────────────────────────────
//
// El 2026-09-13, en AMALAY, cuatro cosas estaban rotas en campo mientras 3,803
// pruebas seguían en verde: el binario de huella era de julio, el paquete de
// interfaz estaba congelado en una versión sin el arreglo del cobro, el almacén
// de eventos arrastraba órdenes sin platillos que volvían incobrable toda cuenta,
// y 39 de 40 personas no podían entrar sin internet.
//
// Ninguna era detectable leyendo código. Las suites leen el REPOSITORIO; esto
// interroga a la MÁQUINA. Son preguntas distintas y hacen falta las dos.
//
// ── QUÉ COMPRUEBA ────────────────────────────────────────────────────────────
//
// Las reglas duras de docs/offline/OFFLINE-LAN-FIELD-PROVEN-AND-CLONE.md §4 —las
// que están marcadas 🔒 «no romper»— más lo que costó caro en campo. Cada
// comprobación cita su origen para que nadie la borre sin saber qué protegía.
//
// ── LO QUE NO PUEDE VER DESDE FUERA ──────────────────────────────────────────
//
// La huella y el espacio en disco NO son verificables en remoto: la ruta
// /auth/fingerprint/status exige que la petición venga de loopback
// (local-server/index.js:784), y el disco no viaja en /health. Esas dos se
// certifican corriendo este mismo programa EN la terminal. Se reportan como
// PENDIENTE, nunca como PASA.
//
// ── USO ──────────────────────────────────────────────────────────────────────
//
//   node scripts/certificar-terminal.mjs --host 100.108.165.48 --rol caja \
//        --sha 1dfd213492d7 --personal 40 --secreto ~/ruta/lan-secret
//
//   --host      IP o nombre de la terminal (LAN, Tailscale o 127.0.0.1)
//   --rol       caja | secundaria | kds
//   --sha       los primeros caracteres del commit que DEBE estar instalado
//   --personal  cuántas personas activas tiene el restaurante
//   --secreto   archivo con la credencial de red local (opcional; sin ella sólo
//               se corren las comprobaciones abiertas)
//   --caja      IP de la caja, cuando se certifica una secundaria
//
// Sale con código 0 si todo pasa, 1 si algo falla. Apto para un cron matutino.

import { readFileSync } from 'node:fs'
import http from 'node:http'

// ── Argumentos ───────────────────────────────────────────────────────────────
const args = {}
for (let i = 2; i < process.argv.length; i += 2) {
  const clave = process.argv[i]
  if (!clave?.startsWith('--')) continue
  args[clave.slice(2)] = process.argv[i + 1]
}
const HOST = args.host || '127.0.0.1'
const PUERTO = Number(args.puerto || 7717)

// El rol se declara y NO se adivina.
//
// Pedro no expone `terminal_role` en `/health`, así que este programa no puede
// corroborarlo. El 2026-09-14 se certificó PDV2 —que es el KDS de cocina
// (deployment-state, DECISION-BRAIN:97, DEBRIEF-JUL12:269)— como si fuera un POS
// secundario, y eso inventó dos fallas: un KDS no tiene impresoras ni login.
// Hasta que `/health` reporte el rol, equivocarse aquí es equivocarse en todo.
const ROLES = ['caja', 'secundaria', 'kds']
const ROL = (args.rol || '').toLowerCase()
if (!ROLES.includes(ROL)) {
  console.error(`Indica --rol (${ROLES.join(' | ')}). No se adivina: el rol cambia qué es correcto.`)
  process.exit(2)
}
const SHA = args.sha || null
const PERSONAL = args.personal ? Number(args.personal) : null
const CAJA = args.caja || null
const COLA_MAX = Number(args['cola-max'] || 500)

let SECRETO = null
if (args.secreto) {
  try { SECRETO = readFileSync(args.secreto.replace(/^~/, process.env.HOME), 'utf8').trim() }
  catch (e) { console.error(`No pude leer la credencial: ${e.message}`); process.exit(2) }
}

// ── Transporte ───────────────────────────────────────────────────────────────
function pedir(host, ruta, { conCredencial = false, timeout = 8000 } = {}) {
  return new Promise(resolve => {
    const headers = {}
    if (conCredencial && SECRETO) headers['x-fullsite-lan'] = SECRETO
    const req = http.request({ hostname: host, port: PUERTO, path: ruta, method: 'GET', timeout, headers }, res => {
      const trozos = []
      res.on('data', t => trozos.push(t))
      res.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8')
        let json = null
        try { json = JSON.parse(texto) } catch { /* no todas las rutas son JSON */ }
        resolve({ ok: true, status: res.statusCode, json, texto, headers: res.headers })
      })
    })
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }) })
    req.on('error', e => resolve({ ok: false, error: e.code || e.message }))
    req.end()
  })
}

// ── Registro de resultados ───────────────────────────────────────────────────
const resultados = []
const anotar = (estado, id, titulo, detalle, origen) =>
  resultados.push({ estado, id, titulo, detalle, origen })
const pasa = (...a) => anotar('PASA', ...a)
const falla = (...a) => anotar('FALLA', ...a)
const pendiente = (...a) => anotar('PENDIENTE', ...a)

// ── Comprobaciones ───────────────────────────────────────────────────────────
async function certificar() {
  // C1 — la terminal contesta
  const salud = await pedir(HOST, '/health')
  if (!salud.ok || salud.status !== 200 || !salud.json?.ok) {
    falla('C1', 'La terminal responde',
      salud.error ? `sin respuesta (${salud.error})` : `HTTP ${salud.status}`,
      'Pedro escucha en 7717 — field-proven §2')
    return   // sin esto, nada más tiene sentido
  }
  const h = salud.json
  pasa('C1', 'La terminal responde', `${h.hostname} · ${h.restaurant_id} · v${h.version}`, 'field-proven §2')

  // C2 — el build instalado es el esperado
  const shaReal = h.build?.sha || '(sin sello)'
  if (!SHA) pendiente('C2', 'Build esperado', `instalado ${shaReal}; no se indicó --sha`, 'HALLAZGOS §2')
  else if (shaReal.startsWith(SHA)) pasa('C2', 'Build esperado', shaReal, 'HALLAZGOS §2')
  else falla('C2', 'Build esperado', `esperaba ${SHA}, encontré ${shaReal}`,
    'El POS sirve la interfaz del instalador, no de Vercel — HALLAZGOS §2')

  // C3 — versión de protocolo
  if (h.protocol_version === '1.0') pasa('C3', 'Versión de protocolo', h.protocol_version, 'config-schema.js:9')
  else falla('C3', 'Versión de protocolo', `${h.protocol_version} (se esperaba 1.0)`, 'config-schema.js:9')

  // C4 — emparejada con la red local
  if (h.emparejada === true) pasa('C4', 'Credencial de red local', 'configurada', 'credencial-lan.js')
  else falla('C4', 'Credencial de red local', 'sin emparejar: la operación queda bloqueada', 'credencial-lan.js:91')

  // C5 — estaciones de impresión EFECTIVAS
  //
  // Una secundaria no tiene impresoras propias: su Pedro reenvía /print a la caja
  // (field-proven §5.5, marcado 🔒). Pero el navegador consulta las estaciones de
  // SU propio Pedro antes de intentar imprimir (print-queue.ts:264) y, si vienen
  // vacías, detiene TODAS las comandas en silencio. Por eso aquí se pregunta por
  // las efectivas, no por las propias.
  const propias = Array.isArray(h.stations) ? h.stations : []
  if (ROL === 'caja') {
    if (propias.length > 0) pasa('C5', 'Estaciones de impresión', propias.join(', '), 'field-proven §4.2')
    else falla('C5', 'Estaciones de impresión', 'la caja no tiene ninguna configurada', 'field-proven §4.2')
  } else if (ROL === 'secundaria') {
    if (propias.length > 0) {
      pasa('C5', 'Estaciones de impresión', `propias: ${propias.join(', ')}`, 'field-proven §4.2')
    } else if (CAJA) {
      const saludCaja = await pedir(CAJA, '/health')
      const deLaCaja = saludCaja.json?.stations || []
      if (deLaCaja.length > 0) {
        falla('C5', 'Estaciones de impresión',
          `esta terminal reporta cero y el navegador detiene las comandas en silencio, ` +
          `aunque la caja sí tiene (${deLaCaja.join(', ')}) y su Pedro reenviaría`,
          'print-queue.ts:264 contra field-proven §5.5 🔒')
      } else {
        falla('C5', 'Estaciones de impresión', 'ni esta terminal ni la caja tienen impresoras', 'field-proven §4.2')
      }
    } else {
      pendiente('C5', 'Estaciones de impresión', 'cero propias; indica --caja para comprobar el reenvío', 'field-proven §5.5')
    }
  } else {
    pasa('C5', 'Estaciones de impresión', 'no aplica al KDS', 'field-proven §2')
  }

  // C6 — impresiones fallidas acumuladas
  if ((h.print_jobs_failed ?? 0) === 0) pasa('C6', 'Impresiones fallidas', '0', 'HALLAZGOS §6')
  else falla('C6', 'Impresiones fallidas', String(h.print_jobs_failed), 'HALLAZGOS §6')

  // C7 — cola de sincronización dentro de rango
  const cola = h.sync_queue_size ?? 0
  if (cola <= COLA_MAX) pasa('C7', 'Cola de sincronización', String(cola), 'HALLAZGOS §7')
  else falla('C7', 'Cola de sincronización', `${cola} operaciones sin subir (tope ${COLA_MAX})`, 'HALLAZGOS §7')

  // C8 — el KDS se sirve por HTTP desde Pedro (regla 🔒 #1)
  // `/kds` está entre las rutas protegidas (credencial-lan.js:41), así que va firmada.
  const kds = await pedir(HOST, '/kds', { conCredencial: true })
  if (kds.ok && kds.status === 401) {
    pendiente('C8', 'KDS servido por HTTP local', 'requiere credencial; indica --secreto', 'credencial-lan.js:41')
  } else if (kds.ok && kds.status === 200 && /<html/i.test(kds.texto || '')) {
    pasa('C8', 'KDS servido por HTTP local', 'GET /kds responde', 'field-proven §4.1 🔒')
  } else {
    falla('C8', 'KDS servido por HTTP local',
      kds.ok ? `HTTP ${kds.status}` : `sin respuesta (${kds.error})`,
      'Si el KDS vuelve a https, el offline se rompe por mixed-content — field-proven §4.1 🔒')
  }

  // ── Con credencial ─────────────────────────────────────────────────────────
  if (!SECRETO) {
    pendiente('C9-C14', 'Comprobaciones de estado', 'sin --secreto no se pueden consultar', 'credencial-lan.js:56')
  } else {
    // C9 — personal preparado para operar sin internet
    //
    // No aplica al KDS: es una pantalla sin login (DEBRIEF-JUL12 §KDS). Pedirle
    // usuarios preparados produce una falla inventada — pasó el 2026-09-14 por
    // certificar PDV2 con el rol equivocado.
    const auth = await pedir(HOST, '/auth/status', { conCredencial: true })
    const preparados = auth.json?.prepared_users ?? 0
    if (ROL === 'kds') {
      pasa('C9', 'Personal preparado para offline', 'no aplica: el KDS no tiene login', 'DEBRIEF-JUL12')
    } else if (PERSONAL == null) {
      pendiente('C9', 'Personal preparado para offline', `${preparados} preparados; no se indicó --personal`, 'HALLAZGOS §4')
    } else if (preparados >= PERSONAL) {
      pasa('C9', 'Personal preparado para offline', `${preparados}/${PERSONAL}`, 'HALLAZGOS §4')
    } else {
      falla('C9', 'Personal preparado para offline',
        `${preparados} de ${PERSONAL}: si se cae el internet, ${PERSONAL - preparados} personas no pueden entrar`,
        'requiereCaja() es true en todo Electron — pedro-cliente.ts:26')
    }

    const estado = await pedir(HOST, '/state', { conCredencial: true })
    const s = estado.json
    if (!s) {
      falla('C10-C14', 'Estado del salón', `no se pudo leer /state (HTTP ${estado.status ?? estado.error})`, 'HALLAZGOS §3')
    } else {
      // C10 — el salón se declara completo
      if (s.order_snapshot_complete === true) {
        pasa('C10', 'Salón completo', 'true', 'state.js:747')
      } else {
        falla('C10', 'Salón completo',
          'false: con esta bandera en falso toda cuenta queda «incierta» y no se puede abrir ni cobrar',
          'pedro-cliente.ts:112 — HALLAZGOS §3')
      }

      // C11 — ninguna orden sin platillos
      const ordenes = Array.isArray(s.salon_orders) ? s.salon_orders : []
      const sinItems = ordenes.filter(o => {
        const it = o.items
        if (Array.isArray(it)) return false
        if (typeof it === 'string') { try { return !Array.isArray(JSON.parse(it)) } catch { return true } }
        return true
      })
      if (sinItems.length === 0) pasa('C11', 'Órdenes con platillos', `${ordenes.length} abiertas, todas completas`, 'HALLAZGOS §3')
      else falla('C11', 'Órdenes con platillos',
        `${sinItems.length} sin platillos (mesas ${sinItems.map(o => o.mesa).join(', ')})`, 'HALLAZGOS §3')

      // C12 — ninguna mesa con dos cuentas
      const porMesa = new Map()
      for (const o of ordenes) {
        const m = String(o.mesa ?? '')
        if (!m) continue
        porMesa.set(m, (porMesa.get(m) || 0) + 1)
      }
      const duplicadas = [...porMesa].filter(([, n]) => n > 1)
      if (duplicadas.length === 0) pasa('C12', 'Una cuenta por mesa', 'sin duplicados', 'pedro-cliente.ts:108')
      else falla('C12', 'Una cuenta por mesa',
        `mesas con más de una cuenta: ${duplicadas.map(([m, n]) => `${m}(${n})`).join(', ')}`,
        'corta con «La caja reporta varias cuentas» — pedro-cliente.ts:108')

      // C13 — autoridad de escritura declarada
      if (s.write_authority === 'caja' || s.write_authority === 'legacy') {
        pasa('C13', 'Autoridad de escritura', s.write_authority, 'ADR-005')
      } else {
        falla('C13', 'Autoridad de escritura', `desconocida (${s.write_authority})`, 'ADR-005')
      }
    }

    // C14 — impresiones en estado incierto
    const inciertas = await pedir(HOST, '/print/uncertain', { conCredencial: true })
    const trabajos = inciertas.json?.jobs
    if (Array.isArray(trabajos) && trabajos.length === 0) pasa('C14', 'Impresiones inciertas', '0', 'CANONICAL-PRINT')
    else if (Array.isArray(trabajos)) falla('C14', 'Impresiones inciertas', `${trabajos.length} sin resolver`, 'CANONICAL-PRINT')
    else pendiente('C14', 'Impresiones inciertas', 'no se pudo leer', 'CANONICAL-PRINT')
  }

  // ── Lo que exige estar en la máquina ───────────────────────────────────────
  const enLaMaquina = HOST === '127.0.0.1' || HOST === 'localhost'
  if (ROL === 'caja') {
    if (enLaMaquina) {
      const huella = await pedir(HOST, '/auth/fingerprint/status', { conCredencial: true })
      const d = huella.json
      if (d?.available === true) pasa('C15', 'Lector de huella', 'disponible y firmado', 'index.js:793')
      else falla('C15', 'Lector de huella', d?.reason || `HTTP ${huella.status ?? huella.error}`, 'HALLAZGOS §1')
    } else {
      pendiente('C15', 'Lector de huella',
        'sólo se puede comprobar desde la propia terminal: la ruta exige loopback',
        'local-server/index.js:784')
    }
  }
  if (!enLaMaquina) {
    pendiente('C16', 'Espacio en disco',
      'no viaja en /health; correr este programa en la terminal. La noche del 13 quedaban 70 MB y el POS se cayó',
      'HALLAZGOS §2')
  }
}

// ── Salida ───────────────────────────────────────────────────────────────────
const COLOR = process.stdout.isTTY
const c = (codigo, txt) => COLOR ? `[${codigo}m${txt}[0m` : txt
const marca = e => e === 'PASA' ? c(32, '  PASA    ') : e === 'FALLA' ? c(31, '  FALLA   ') : c(33, ' PENDIENTE')

await certificar()

console.log(`\n  CERTIFICACIÓN DE TERMINAL — ${HOST}:${PUERTO}  ·  rol ${ROL}\n`)
for (const r of resultados) {
  console.log(`${marca(r.estado)}  ${r.id.padEnd(7)} ${r.titulo}`)
  console.log(`              ${r.detalle}`)
  if (r.estado !== 'PASA') console.log(c(90, `              origen: ${r.origen}`))
}

const fallas = resultados.filter(r => r.estado === 'FALLA').length
const pendientes = resultados.filter(r => r.estado === 'PENDIENTE').length
const pasadas = resultados.filter(r => r.estado === 'PASA').length
console.log(`\n  ${pasadas} pasan · ${fallas} fallan · ${pendientes} pendientes\n`)
if (fallas > 0) console.log(c(31, '  NO CERTIFICADA — hay fallas que corregir antes de operar.\n'))
else if (pendientes > 0) console.log(c(33, '  PARCIAL — corre este programa EN la terminal para cerrar lo pendiente.\n'))
else console.log(c(32, '  CERTIFICADA.\n'))

process.exit(fallas > 0 ? 1 : 0)
