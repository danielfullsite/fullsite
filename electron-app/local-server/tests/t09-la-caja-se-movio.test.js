'use strict'
// T-09 — el router le cambió la IP a la caja y las terminales la encuentran solas.
//
// ── EL HUECO ─────────────────────────────────────────────────────────────────
//
// `enlace-con-caja.js` recibía `cajaUrl` UNA VEZ, construida en `index.js` desde
// `config.pos_server_ip`, y su propia documentación lo decía: "Reconecta solo,
// con espera creciente, PARA SIEMPRE". Siempre a la misma IP.
//
// Cuando el router renueva la concesión DHCP, cada terminal secundaria golpea una
// dirección muerta cada diez segundos hasta que alguien la reinstala. La operación
// local aguanta —el enlace es aditivo— pero las terminales dejan de verse entre
// ellas: el reporte de campo del 2026-09-02, con otra causa.
//
// ── DÓNDE NO ESTABA EL PROBLEMA ──────────────────────────────────────────────
//
// La matriz decía que el arreglo iba en el navegador (`useBridgeClient` +
// `ServerDiscovery`), y ese análisis es de julio. La arquitectura posterior puso a
// cada terminal a hablar con SU PROPIO Pedro en 127.0.0.1
// (OFFLINE-LAN-FIELD-PROVEN, "REGLA (corrige §5.1)"): el navegador nunca ve la IP
// de la caja. El único que la ve es este proceso. Arreglar el navegador habría
// sido construir la cosa correcta en el lugar equivocado.

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')

const { buscarLaCaja, subredesDe, hostsDe, MAX_HOSTS } = require('../core/buscar-la-caja')
const { conectarConLaCaja, INTENTOS_ANTES_DE_BUSCAR, RECONEXION_MS } = require('../core/enlace-con-caja')
const { PROTOCOL_VERSION } = require('../protocol')

// ── El buscador ─────────────────────────────────────────────────────────────

/** Una red de mentira: sólo las IPs listadas contestan `/identity`. */
function redConIdentidades(mapa) {
  const pedidas = []
  const fetchImpl = async (url) => {
    const m = /^http:\/\/([\d.]+):\d+\/identity$/.exec(url)
    if (!m) return { ok: false }
    pedidas.push(m[1])
    const id = mapa[m[1]]
    if (!id) throw new Error('ECONNREFUSED')
    return { ok: true, json: async () => id }
  }
  return { fetchImpl, pedidas }
}

const identidadBuena = (extra = {}) => ({
  ok: true, restaurant_id: 'amalay', protocol_version: PROTOCOL_VERSION, ...extra,
})

describe('buscarLaCaja', () => {
  test('encuentra la caja en su nueva IP', async () => {
    const { fetchImpl } = redConIdentidades({ '192.168.1.150': identidadBuena() })
    const r = await buscarLaCaja({
      restaurantId: 'amalay', puerto: 7717,
      ipsLocales: ['192.168.1.40'], yaProbadas: ['192.168.1.71'], fetchImpl,
    })
    assert.equal(r.ip, '192.168.1.150')
  })

  test('NO se conecta a la caja de otro restaurante en la misma red', async () => {
    // El caso de una plaza comercial: dos Fullsite en el mismo WiFi. Conectarse
    // al de al lado mezclaría dos restaurantes.
    const { fetchImpl } = redConIdentidades({
      '192.168.1.150': identidadBuena({ restaurant_id: 'otro-resto' }),
    })
    assert.equal(await buscarLaCaja({
      restaurantId: 'amalay', puerto: 7717, ipsLocales: ['192.168.1.40'], fetchImpl,
    }), null)
  })

  test('NI a una version de protocolo incompatible', async () => {
    const { fetchImpl } = redConIdentidades({
      '192.168.1.150': identidadBuena({ protocol_version: PROTOCOL_VERSION + 99 }),
    })
    assert.equal(await buscarLaCaja({
      restaurantId: 'amalay', puerto: 7717, ipsLocales: ['192.168.1.40'], fetchImpl,
    }), null)
  })

  test('DOS cajas del mismo restaurante: no elige ninguna', async () => {
    // Elegir al azar parte el restaurante en dos historias que después no se
    // pueden juntar. Esto lo resuelve una persona.
    const { fetchImpl } = redConIdentidades({
      '192.168.1.100': identidadBuena(),
      '192.168.1.150': identidadBuena(),
    })
    assert.equal(await buscarLaCaja({
      restaurantId: 'amalay', puerto: 7717, ipsLocales: ['192.168.1.40'], fetchImpl,
    }), null)
  })

  test('una red muda devuelve null, no lanza', async () => {
    const { fetchImpl } = redConIdentidades({})
    assert.equal(await buscarLaCaja({
      restaurantId: 'amalay', puerto: 7717, ipsLocales: ['192.168.1.40'], fetchImpl,
    }), null)
  })

  test('no se sondea a si mismo ni a lo ya probado', async () => {
    const { fetchImpl, pedidas } = redConIdentidades({ '192.168.1.150': identidadBuena() })
    await buscarLaCaja({
      restaurantId: 'amalay', puerto: 7717,
      ipsLocales: ['192.168.1.71'],       // esta maquina ES la .71
      yaProbadas: ['192.168.1.50'], fetchImpl,
    })
    assert.ok(!pedidas.includes('192.168.1.71'), 'no debe sondearse a si mismo')
    assert.ok(!pedidas.includes('192.168.1.50'), 'no debe repetir lo ya probado')
  })

  test('sin restaurantId no busca: fallar cerrado', async () => {
    const { fetchImpl, pedidas } = redConIdentidades({ '192.168.1.150': identidadBuena() })
    assert.equal(await buscarLaCaja({
      restaurantId: '', puerto: 7717, ipsLocales: ['192.168.1.40'], fetchImpl,
    }), null)
    assert.equal(pedidas.length, 0, 'no debe tocar la red sin saber que busca')
  })

  test('respeta el tope de hosts: no barre los 254', async () => {
    const { fetchImpl, pedidas } = redConIdentidades({})
    await buscarLaCaja({
      restaurantId: 'amalay', puerto: 7717, ipsLocales: ['192.168.1.40'], fetchImpl,
    })
    assert.ok(pedidas.length <= MAX_HOSTS, `sondeo ${pedidas.length} > tope ${MAX_HOSTS}`)
  })

  test('prueba primero las direcciones probables', async () => {
    const { fetchImpl, pedidas } = redConIdentidades({})
    await buscarLaCaja({
      restaurantId: 'amalay', puerto: 7717, ipsLocales: ['192.168.1.40'], fetchImpl,
    })
    // `.71` es la caja de AMALAY: tiene que ir en el primer puñado, no en el 200.
    assert.ok(pedidas.slice(0, 12).includes('192.168.1.71'))
  })
})

describe('subredesDe / hostsDe', () => {
  test('saca la /24 de cada IP local, sin repetir', () => {
    assert.deepEqual(
      subredesDe(['192.168.1.40', '192.168.1.41', '10.0.0.5', 'no-es-una-ip']),
      ['192.168.1', '10.0.0'],
    )
  })

  test('sin IPs locales no hay subred que barrer', () => {
    // Una maquina sin red no debe inventarse una: se devuelve vacio y el enlace
    // sigue reintentando donde estaba.
    assert.deepEqual(subredesDe([]), [])
    assert.deepEqual(subredesDe(undefined), [])
  })

  test('hostsDe no repite lo excluido', () => {
    const h = hostsDe('192.168.1', ['192.168.1.71', '192.168.1.1'])
    assert.ok(!h.includes('192.168.1.71'))
    assert.ok(!h.includes('192.168.1.1'))
  })
})

// ── El enlace: cuándo pregunta y qué hace con la respuesta ──────────────────

/** Un WebSocket de mentira que nunca conecta: simula una IP muerta. */
function wsQueNuncaConecta(registro) {
  return class extends EventEmitter {
    constructor(url) {
      super()
      registro.push(url)
      setImmediate(() => this.emit('error', new Error('ECONNREFUSED')))
      setImmediate(() => this.emit('close'))
    }
    send() {}
    close() {}
  }
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms))

describe('el enlace pregunta cuando la direccion es sospechosa', () => {
  test('NO pregunta en los primeros fracasos: un parpadeo no es un cambio de IP', async () => {
    const urls = []
    let preguntas = 0
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://192.168.1.71:7717', serverId: 't1', restaurantId: 'amalay',
      wsInyectado: wsQueNuncaConecta(urls),
      resolverCaja: async () => { preguntas++; return null },
    })
    await esperar(120)   // ~2 reintentos con la escalera 500/1000
    enlace.detener()
    assert.equal(preguntas, 0, 'buscar en la red por cada tropiezo es ruido')
  })

  test('tras varios fracasos SEGUIDOS, pregunta', async () => {
    const urls = []
    let preguntas = 0
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://192.168.1.71:7717', serverId: 't1', restaurantId: 'amalay',
      wsInyectado: wsQueNuncaConecta(urls),
      resolverCaja: async () => { preguntas++; return null },
      // Umbral 0: pregunta al primer fracaso. La escalera real se comprueba por
      // calculo en la prueba de abajo; aqui interesa el comportamiento, no el reloj.
      intentosAntesDeBuscar: 0,
    })
    await esperar(200)
    enlace.detener()
    assert.ok(preguntas >= 1, `debio preguntar al menos una vez, pregunto ${preguntas}`)
  })

  test('el umbral por omision es 5, y con la escalera real eso son ~18 s', () => {
    // Se comprueba por calculo y no esperando: una prueba de 19 segundos es una
    // prueba que nadie corre, y con el jitter seria intermitente.
    assert.equal(INTENTOS_ANTES_DE_BUSCAR, 5)
    const hasta = RECONEXION_MS.slice(0, INTENTOS_ANTES_DE_BUSCAR).reduce((a, b) => a + b, 0)
    assert.equal(hasta, 18500)
    // Dentro del minuto que pide la matriz, y lejos de un parpadeo del AP.
    assert.ok(hasta > 10000 && hasta < 60000)
  })

  test('si la caja aparece en otra IP, el enlace se muda', async () => {
    const urls = []
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://192.168.1.71:7717', serverId: 't1', restaurantId: 'amalay',
      wsInyectado: wsQueNuncaConecta(urls),
      resolverCaja: async () => 'ws://192.168.1.150:7717',
      intentosAntesDeBuscar: 0,
    })
    await esperar(300)
    const estado = enlace.estado()
    enlace.detener()
    assert.match(estado.caja, /192\.168\.1\.150/, 'debe apuntar a la IP nueva')
    assert.equal(estado.cambios_de_direccion, 1)
    assert.ok(urls.some(u => /192\.168\.1\.150/.test(u)), 'debe INTENTAR la IP nueva')
  })

  test('la misma IP no cuenta como mudanza', async () => {
    // Un resolver que devuelve lo mismo no debe reiniciar la escalera de espera
    // ni ensuciar el contador: seria un bucle disfrazado de progreso.
    const urls = []
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://192.168.1.71:7717', serverId: 't1', restaurantId: 'amalay',
      wsInyectado: wsQueNuncaConecta(urls),
      resolverCaja: async () => 'ws://192.168.1.71:7717',
      intentosAntesDeBuscar: 0,
    })
    await esperar(300)
    const estado = enlace.estado()
    enlace.detener()
    assert.equal(estado.cambios_de_direccion, 0)
  })

  test('si la busqueda truena, el enlace sigue reintentando donde estaba', async () => {
    // REGLA 2 del modulo: no bloquear. No encontrar la caja no es un error.
    const urls = []
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://192.168.1.71:7717', serverId: 't1', restaurantId: 'amalay',
      wsInyectado: wsQueNuncaConecta(urls),
      resolverCaja: async () => { throw new Error('la red exploto') },
      intentosAntesDeBuscar: 0,
    })
    await esperar(1400)
    const estado = enlace.estado()
    enlace.detener()
    assert.match(estado.caja, /192\.168\.1\.71/)
    assert.ok(urls.length > 1, 'debe haber seguido reintentando')
  })

  test('sin resolverCaja se comporta como antes', async () => {
    // Compatibilidad: quien no lo pase no cambia de comportamiento.
    const urls = []
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://192.168.1.71:7717', serverId: 't1', restaurantId: 'amalay',
      wsInyectado: wsQueNuncaConecta(urls),
    })
    await esperar(1200)
    const estado = enlace.estado()
    enlace.detener()
    assert.match(estado.caja, /192\.168\.1\.71/)
    assert.equal(estado.cambios_de_direccion, 0)
  })

  test('detener() corta tambien la busqueda en vuelo', async () => {
    let mudanzas = 0
    const urls = []
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://192.168.1.71:7717', serverId: 't1', restaurantId: 'amalay',
      wsInyectado: wsQueNuncaConecta(urls),
      resolverCaja: async () => { await esperar(300); return 'ws://192.168.1.150:7717' },
      alCambiarDeCaja: () => { mudanzas++ },
      intentosAntesDeBuscar: 0,
    })
    await esperar(100)   // la busqueda ya arranco; tarda 300 ms en resolver
    enlace.detener()
    const antes = mudanzas
    await esperar(500)   // la busqueda en vuelo resuelve DESPUES de detener
    assert.equal(mudanzas, antes, 'un enlace detenido no debe mudarse')
  })
})

describe('el estado observable dice lo que paso', () => {
  test('/health expone los cambios de direccion', async () => {
    const urls = []
    const enlace = conectarConLaCaja({
      cajaUrl: 'ws://192.168.1.71:7717', serverId: 't1', restaurantId: 'amalay',
      wsInyectado: wsQueNuncaConecta(urls),
      resolverCaja: async () => null,
    })
    const estado = enlace.estado()
    enlace.detener()
    // Sin esto, "la caja se movio y la encontramos sola" es invisible desde fuera.
    assert.ok('cambios_de_direccion' in estado)
    assert.ok('buscando_caja' in estado)
  })
})
