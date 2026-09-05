'use strict'
// Laboratorio multi-Electron: Caja + POS 2 + POS 3 + KDS, procesos de verdad.
//
// ── QUÉ PRUEBA, Y POR QUÉ NO BASTABA LO ANTERIOR ─────────────────────────────
//
// Las pruebas de `local-server/tests/` levantan varios Pedro DENTRO de un mismo
// proceso de Node. Eso demuestra el protocolo, y esconde tres cosas que sólo
// aparecen con procesos separados:
//
//   · que dos terminales NO comparten `userData` (config, identidad, event store)
//   · que cinco Pedros no chocan en el mismo puerto
//   · que el arranque real de Electron enciende lo que debe, según el rol
//
// Aquí cada terminal es un `electron` distinto, con su carpeta, su puerto y su
// papel. Se hablan sólo por HTTP y WebSocket, como las máquinas del restaurante.
//
// ── LO QUE ESTE LABORATORIO NO CUBRE ─────────────────────────────────────────
//
// NO ejercita la interfaz. Las ventanas cargan una página local mínima, no el
// POS de verdad: apuntarlas a `https://app.fullsite.mx` escribiría en los datos
// de un restaurante real, y levantar la app local completa es otro trabajo.
//
// Entonces esto NO prueba: login, PIN, huella, transferencia de mesa, corte X,
// retiro/depósito, ni nada que se toque en pantalla. Prueba la TOPOLOGÍA: cinco
// procesos aislados, su servidor local, el tráfico entre ellos y la credencial.
//
// Impresoras, lector de huella y Windows siguen exigiendo terminales físicas.

const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
// El BINARIO real, no `node_modules/.bin/electron`: ese es un shim de Node que
// lanza Electron como HIJO suyo. Matar el shim deja vivo al proceso de verdad —
// la caja seguia contestando despues de un SIGKILL y el laboratorio reportaba
// «no se apago». Costo dos corridas.
const ELECTRON = require(path.join(RAIZ, 'node_modules', 'electron'))
const credLan = require(path.join(RAIZ, 'local-server', 'core', 'credencial-lan'))
const { CURRENT_CONFIG_VERSION } = require(path.join(RAIZ, 'local-server', 'config-schema'))
let terminales_creadas = 1

const R = 'lab-tenant'
const SECRETO = credLan.generarSecreto()
const CRED = credLan.cabecerasDeCredencial({ secreto: SECRETO, restaurantId: R })

const CAJA = 7931, POS2 = 7932, POS3 = 7933, KDS = 7934

const fallos = []
const ok = (cond, msg) => { if (!cond) fallos.push(msg); console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`) }
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function hasta(cond, ms = 20000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    try { if (await cond()) return true } catch {}
    await esperar(250)
  }
  return false
}

/**
 * Una terminal: proceso Electron propio, carpeta propia, puerto propio.
 *
 * FULLSITE_DEV=1 abre en ventana en vez de kiosco — si no, el laboratorio se
 * apodera de la pantalla y no hay forma de salir.
 */
function arrancarTerminal({ nombre, puerto, rol, cajaIp, dirBase, paginaUrl }) {
  const userData = path.join(dirBase, nombre)
  fs.mkdirSync(userData, { recursive: true })

  // El config que Electron leería de una instalación real. Cada terminal el suyo.
  // Los campos obligatorios salen de `local-server/config-schema.js`: si falta
  // uno, main.js abre la ventana de aprovisionamiento y Pedro NO arranca — que
  // es lo correcto, y fue lo primero que dijo este laboratorio al correrlo.
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    config_version: CURRENT_CONFIG_VERSION,
    restaurant_id: R,
    terminal_id: `a1b2c3d4-0000-0000-0000-00000000000${terminales_creadas++}`,
    terminal_role: rol,
    terminal_name: `Lab ${nombre}`,
    local_server_host: '127.0.0.1',
    local_server_port: puerto,
    protocol_version: '1.0',
    provisioned_at: '2026-09-04T00:00:00.000Z',
    pos_server_ip: cajaIp || null,
    pos_server_port: cajaIp ? CAJA : null,
    lan_secret: SECRETO,
    instance_name: `Lab ${nombre}`,
  }, null, 2))

  const hijo = spawn(ELECTRON, [path.join(RAIZ, 'main.js')], {
    env: {
      ...process.env,
      FULLSITE_DEV: '1',
      FULLSITE_USER_DATA_DIR: userData,
      FULLSITE_LOCAL_SERVER_PORT: String(puerto),
      FULLSITE_POS_URL: paginaUrl,
      FULLSITE_KDS_URL: paginaUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = []
  hijo.stdout.on('data', (d) => log.push(d.toString()))
  hijo.stderr.on('data', (d) => log.push(d.toString()))
  return { nombre, puerto, rol, hijo, log, userData }
}

// SIEMPRE con limite de espera. Sin el, un socket que acepta la conexion y no
// contesta —un Electron colgado de una corrida anterior, por ejemplo— deja al
// laboratorio esperando para siempre y parece que no arranco. Paso.
const pedir = (puerto, ruta, init = {}) =>
  fetch(`http://127.0.0.1:${puerto}${ruta}`, {
    ...init,
    headers: { ...CRED, ...(init.headers || {}) },
    signal: AbortSignal.timeout(2500),
  })

async function puertoLibre(p) {
  return new Promise((r) => {
    const s = require('net').createServer()
    s.once('error', () => r(false))
    s.once('listening', () => s.close(() => r(true)))
    s.listen(p, '127.0.0.1')
  })
}

;(async () => {
  // Un puerto ocupado por una corrida anterior hace que Pedro NO arranque y el
  // laboratorio culpe al codigo. Se dice antes de empezar.
  for (const p of [CAJA, POS2, POS3, KDS]) {
    if (!await puertoLibre(p)) {
      console.error(`ERROR: el puerto ${p} esta ocupado. Cierra procesos previos: pkill -f wt-pedro/electron-app/main.js`)
      process.exit(3)
    }
  }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-multi-'))

  // Una página local mínima. NO es el POS: ver la nota de arriba.
  const pagina = path.join(base, 'terminal.html')
  fs.writeFileSync(pagina, '<!doctype html><title>Lab</title><h1>Terminal de laboratorio</h1>')
  const paginaUrl = `file://${pagina}`

  const terminales = [
    arrancarTerminal({ nombre: 'caja', puerto: CAJA, rol: 'server_pos', cajaIp: null, dirBase: base, paginaUrl }),
    arrancarTerminal({ nombre: 'pos2', puerto: POS2, rol: 'pos', cajaIp: '127.0.0.1', dirBase: base, paginaUrl }),
    arrancarTerminal({ nombre: 'pos3', puerto: POS3, rol: 'pos', cajaIp: '127.0.0.1', dirBase: base, paginaUrl }),
    arrancarTerminal({ nombre: 'kds',  puerto: KDS,  rol: 'kds', cajaIp: '127.0.0.1', dirBase: base, paginaUrl }),
  ]

  try {
    // ── 1. Los cuatro Pedros levantan, cada uno en SU puerto ────────────────
    for (const t of terminales) {
      const vivo = await hasta(async () => (await pedir(t.puerto, '/health')).ok)
      ok(vivo, `${t.nombre}: Pedro escucha en ${t.puerto}`)
    }

    // ── 2. Identidades DISTINTAS: no comparten userData ─────────────────────
    const ids = []
    for (const t of terminales) {
      const id = await (await pedir(t.puerto, '/identity')).json()
      ids.push(id.server_id)
    }
    ok(new Set(ids).size === terminales.length,
       `cuatro identidades distintas (${new Set(ids).size} de ${terminales.length})`)

    // ── 3. Cada terminal tiene su propio event store en disco ───────────────
    const propios = terminales.filter(t => fs.existsSync(path.join(t.userData, 'server-id')))
    ok(propios.length === terminales.length,
       `cada terminal guarda su estado aparte (${propios.length} de ${terminales.length})`)

    // ── 4. La comanda de POS 3 llega a los tableros de POS 2 ────────────────
    // Es el reporte de campo del 2026-09-02, con procesos reales de por medio.
    const r = await pedir(POS3, '/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command_id: 'lab-1', command_type: 'ORDER_SENT', order_id: 'lab-orden-1',
        mesa: 12, mesero: 'lab', status: 'enviada',
        items: [{ nombre: 'Prueba', station: 'cocina' }],
      }),
    })
    ok(r.status === 200, `POS 3 acepta la comanda y la reenvia (HTTP ${r.status})`)

    const enLaCaja = await hasta(async () => {
      const s = await (await pedir(CAJA, '/state')).json()
      return (s.kds_orders || []).some(o => o.id === 'lab-orden-1')
    })
    ok(enLaCaja, 'la comanda de POS 3 llego a la CAJA')

    const enPos2 = await hasta(async () => {
      const s = await (await pedir(POS2, '/state')).json()
      return (s.kds_orders || []).some(o => o.id === 'lab-orden-1')
    })
    ok(enPos2, 'POS 2 VE la comanda que nacio en POS 3 (el defecto de campo, cerrado)')

    // ── 5. El KDS también, y por el mismo camino ────────────────────────────
    const enKds = await hasta(async () => {
      const s = await (await pedir(KDS, '/state')).json()
      return (s.kds_orders || []).some(o => o.id === 'lab-orden-1')
    })
    ok(enKds, 'el KDS ve la comanda')

    // ── 6. El salón de un secundario es AUTORITATIVO: viene de la caja ──────
    const salonPos2 = await (await pedir(POS2, '/state')).json()
    ok(salonPos2.authoritative === true && salonPos2.source === 'caja',
       `POS 2 sirve el salon de la caja (authoritative=${salonPos2.authoritative}, source=${salonPos2.source})`)

    // ── 7. Seguridad, entre procesos reales ────────────────────────────────
    const sinCred = await fetch(`http://127.0.0.1:${CAJA}/state`)
    ok(sinCred.status === 401, `sin credencial la caja rechaza (HTTP ${sinCred.status})`)
    const cajonSinCred = await fetch(`http://127.0.0.1:${POS2}/drawer`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    ok(cajonSinCred.status === 401, `sin credencial no se abre el cajon (HTTP ${cajonSinCred.status})`)

    // ── 8. CAÍDA DE LA CAJA: el secundario sigue y lo DICE ──────────────────
    //
    // La política de si se puede COBRAR con la caja caída es una decisión de
    // negocio y NO se toma aquí. Lo que se prueba es lo previo: que la terminal
    // no se muere, y que no presenta su estado parcial como si fuera el salón.
    const caja = terminales[0]
    // SIGKILL, no SIGTERM. Electron atrapa SIGTERM y hace un cierre ordenado que
    // puede tardar o no completarse; con SIGTERM la caja SEGUIA contestando y el
    // laboratorio reportaba «no se apago». Un corte de luz es un SIGKILL, no una
    // peticion amable — y es el escenario que interesa.
    caja.hijo.kill('SIGKILL')
    ok(await hasta(async () => {
      try { await fetch(`http://127.0.0.1:${CAJA}/health`, { signal: AbortSignal.timeout(1200) }); return false }
      catch { return true }
    }, 20000), 'la caja se apago')

    const sigueViva = await hasta(async () => (await pedir(POS2, '/health')).ok)
    ok(sigueViva, 'POS 2 sigue operando sin la caja')

    const degradado = await hasta(async () => {
      const s = await (await pedir(POS2, '/state')).json()
      return s.authoritative === false && s.source === 'local-degradado'
    }, 15000)
    ok(degradado, 'POS 2 marca su salon como NO autoritativo — no lo presenta como la verdad')

  } finally {
    for (const t of terminales) { try { t.hijo.kill('SIGKILL') } catch {} }
    await esperar(600)
    // Los logs quedan: si algo falla en CI, es lo unico que explica por que.
    for (const t of terminales) {
      try { fs.writeFileSync(path.join(base, `${t.nombre}.log`), t.log.join('')) } catch {}
    }
    console.log(`logs en ${base}`)
  }

  console.log(fallos.length === 0 ? 'LABORATORIO VERDE' : `FALLARON ${fallos.length}: ${fallos.join(' | ')}`)
  process.exit(fallos.length === 0 ? 0 : 1)
})().catch((e) => { console.error('ERROR FATAL:', e); process.exit(2) })
