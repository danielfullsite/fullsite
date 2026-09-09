'use strict'
// Una terminal secundaria sin secreto de red no queda a medias: queda muerta.
// Todo responde 401 salvo /health e /identity (core/credencial-lan.js). El
// técnico que la instala necesita poder distinguir "sin emparejar" de "Pedro no
// arrancó" y de "la Caja está apagada", y hasta ahora /health no decía ninguna
// de las tres cosas: `estado()` del enlace existía con el comentario "para
// /health" y /health nunca lo publicaba.
//
// Sin esto, el paso de emparejamiento del procedimiento de instalación no se
// puede verificar en sitio, y el que instala se entera de que falló cuando un
// mesero no puede levantar una mesa.
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const { buildHttpRouter } = require('../index.js')

function servidorFalso(extra = {}) {
  const base = {
    state: { toSnapshot: () => ({ salon_orders: [], kds_orders: [], mesas: {} }), getFinancialOrders: () => [] },
    eventStore: { getLastSequence: () => 7, unsyncedCount: async () => 0, readAfter: async () => [] },
    wsHub: { clientCount: () => 0, getClientList: () => [], broadcast: () => {} },
    cmdHandler: { handle: async () => ({}) },
    printer: { getPrintJobsFailed: () => 0, getStations: () => ({}) },
    version: '1.5.0',
    serverId: 'srv-prueba',
    restaurantId: 'restaurante-prueba',
    instanceName: 'Prueba',
  }
  return buildHttpRouter({ ...base, ...extra })
}

async function pedirSalud(router) {
  const servidor = http.createServer(router)
  await new Promise(r => servidor.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${servidor.address().port}/health`)
    return { status: res.status, cuerpo: await res.json() }
  } finally {
    servidor.closeAllConnections()
    await new Promise(r => servidor.close(r))
  }
}

test('la Caja se reporta emparejada: ella misma genera el secreto', async () => {
  const { status, cuerpo } = await pedirSalud(servidorFalso({
    config: { lanSecret: 'a'.repeat(64), terminalRole: 'server_pos' },
  }))
  assert.equal(status, 200)
  assert.equal(cuerpo.emparejada, true)
})

test('una secundaria SIN secreto se reporta sin emparejar — es la primera pregunta al instalarla', async () => {
  // Éste es el caso que hoy deja a Entrada y Escondite sin punto de venta.
  const { cuerpo } = await pedirSalud(servidorFalso({
    config: { terminalRole: 'pos', posServerIp: '192.168.1.71' },
  }))
  assert.equal(cuerpo.emparejada, false)
})

test('una secundaria CON el secreto copiado de la Caja se reporta emparejada', async () => {
  const { cuerpo } = await pedirSalud(servidorFalso({
    config: { lanSecret: 'b'.repeat(64), terminalRole: 'pos', posServerIp: '192.168.1.71' },
  }))
  assert.equal(cuerpo.emparejada, true)
})

test('el secreto NUNCA se publica: sólo si existe', async () => {
  // /health no pide credencial, así que cualquiera en la red puede leerla.
  // Publicar el secreto ahí sería entregar la llave del cajón de dinero.
  const secreto = 'c'.repeat(64)
  const { cuerpo } = await pedirSalud(servidorFalso({ config: { lanSecret: secreto, terminalRole: 'server_pos' } }))
  const texto = JSON.stringify(cuerpo)
  assert.equal(texto.includes(secreto), false, 'el secreto no puede viajar en /health')
  assert.equal(texto.includes('lanSecret'), false)
  assert.equal(texto.includes('lan_secret'), false)
})

test('una secundaria enganchada a la Caja lo dice, con desde cuándo y cuántos eventos', async () => {
  const { cuerpo } = await pedirSalud(servidorFalso({
    config: { lanSecret: 'd'.repeat(64), terminalRole: 'pos', posServerIp: '192.168.1.71' },
    getEnlaceStatus: () => ({
      conectado: true, caja: 'ws://192.168.1.71:7717/ws', cursor: 42,
      eventos_recibidos: 130, reintentos: 0, ultimo_motivo: null, conectado_desde: 1_700_000_000_000,
    }),
  }))
  assert.equal(cuerpo.enlace.conectado, true)
  assert.equal(cuerpo.enlace.caja, 'ws://192.168.1.71:7717/ws')
  assert.equal(cuerpo.enlace.cursor, 42)
})

test('una secundaria que NO alcanza la Caja dice por qué y cuántas veces lo intentó', async () => {
  // La diferencia entre "no la instalaron bien" y "la Caja está apagada".
  const { cuerpo } = await pedirSalud(servidorFalso({
    config: { lanSecret: 'e'.repeat(64), terminalRole: 'pos', posServerIp: '192.168.1.71' },
    getEnlaceStatus: () => ({
      conectado: false, caja: 'ws://192.168.1.71:7717/ws', cursor: 42,
      eventos_recibidos: 130, reintentos: 6, ultimo_motivo: 'connect ECONNREFUSED 192.168.1.71:7717',
      conectado_desde: null,
    }),
  }))
  assert.equal(cuerpo.enlace.conectado, false)
  assert.equal(cuerpo.enlace.reintentos, 6)
  assert.match(cuerpo.enlace.ultimo_motivo, /ECONNREFUSED/)
})

test('la Caja no tiene enlace hacia arriba, y eso no es un fallo', async () => {
  // La Caja no le pregunta a nadie: es la autoridad. `enlace` en null es
  // correcto ahí, y no debe leerse como "desconectada".
  const { cuerpo } = await pedirSalud(servidorFalso({
    config: { lanSecret: 'f'.repeat(64), terminalRole: 'server_pos' },
  }))
  assert.equal(cuerpo.enlace, null)
  assert.equal(cuerpo.emparejada, true)
})

test('/health dice qué ejecutable es, no sólo el número de versión', async () => {
  // `version` sola no distingue producción de un candidato: ambas dicen 1.4.0.
  const { cuerpo } = await pedirSalud(servidorFalso({ config: { lanSecret: 'g'.repeat(64), terminalRole: 'server_pos' } }))
  assert.equal(cuerpo.build.version, '1.5.0')
  assert.equal(typeof cuerpo.build.etiqueta, 'string')
  // La etiqueta siempre empieza por la versión; el commit se añade sólo si el
  // ejecutable fue sellado. Sin sello dice "(sin sellar)" en vez de inventarlo.
  assert.match(cuerpo.build.etiqueta, /^1\.5\.0( · [0-9a-f]{7,12}(\+cambios)?| \(sin sellar\))$/)
})
