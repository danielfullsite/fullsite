'use strict'
// Una nube que no contesta bien no es un veredicto sobre el PIN.
//
// La nube limita intentos por IP pública. En un restaurante esa IP la comparten
// las tres terminales y cualquier navegador del local, así que ocho errores de
// cualquiera bastan para que empiece a contestar 429. Cuando ese 429 se trataba
// como rechazo, un empleado preparado, con su PIN correcto, leía "PIN rechazado
// por la autoridad" —y encima era peor que estar sin internet, porque con la nube
// caída ese mismo empleado sí entraba con su credencial preparada.
//
// Correr: node --test electron-app/local-server/tests/nube-lenta-no-es-pin-incorrecto.test.js
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ActorAuthority } = require('../core/actor-authority')

const RESTAURANTE = 'lab-nube'
const TERMINAL = 'POS-CAJA'
const PERSONA = { id: '00000000-0000-4000-8000-000000000002', name: 'Cajera', role: 'gerente' }
const ACCESO = { pin: '4321', deviceId: TERMINAL, restaurantId: RESTAURANTE }

function montar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-nube-'))
  const estado = { modo: 'ok', plazos: [] }
  const crear = (opciones = {}) => new ActorAuthority({
    directory: dir, restaurantId: RESTAURANTE, ...opciones,
    fetchImpl: async (url, init) => {
      // El plazo real que el código le da a la nube, leído de la señal de aborto.
      estado.plazos.push(init?.signal)
      if (estado.modo === 'saturada') return Response.json({ error: 'rate limited' }, { status: 429 })
      if (estado.modo === 'caida') throw new TypeError('fetch failed')
      if (estado.modo === 'rota') return Response.json({ error: 'boom' }, { status: 500 })
      if (estado.modo === 'revocado') return Response.json({ error: 'PIN incorrecto' }, { status: 401 })
      return Response.json({ staff: PERSONA })
    },
  })
  return { crear, estado, limpiar: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

const codigo = p => p.then(() => null, e => e.code)

describe('la nube saturada no rechaza PINs correctos', () => {
  test('con la nube saturada, un empleado preparado entra por su credencial local', async () => {
    const { crear, estado, limpiar } = montar()
    try {
      const caja = crear()
      await caja.login(ACCESO) // se prepara con la nube sana

      estado.modo = 'saturada'
      const sesion = await caja.login(ACCESO)
      assert.equal(sesion.staff.id, PERSONA.id, 'la nube saturada rechazó un PIN correcto')
      assert.equal(sesion.offline, true, 'debe resolverse con la credencial local, como si no hubiera internet')
    } finally { limpiar() }
  })

  test('la nube saturada no borra la credencial preparada', async () => {
    const { crear, estado, limpiar } = montar()
    try {
      const caja = crear()
      await caja.login(ACCESO)

      estado.modo = 'saturada'
      await caja.login(ACCESO)

      // Si el 429 se hubiera tomado como revocación, la credencial habría
      // desaparecido y la terminal quedaría inservible hasta volver a tener nube.
      estado.modo = 'caida'
      assert.equal((await caja.login(ACCESO)).staff.id, PERSONA.id)
    } finally { limpiar() }
  })

  test('un PIN de verdad inválido sí se rechaza y revoca su credencial', async () => {
    const { crear, estado, limpiar } = montar()
    try {
      const caja = crear()
      await caja.login(ACCESO)

      estado.modo = 'revocado'
      assert.equal(await codigo(caja.login(ACCESO)), 'PIN_REJECTED')

      estado.modo = 'caida'
      assert.equal(await codigo(caja.login(ACCESO)), 'OFFLINE_USER_NOT_PREPARED',
        'un rechazo firme debe invalidar la credencial guardada')
    } finally { limpiar() }
  })

  test('un error del servidor tampoco es un veredicto sobre el PIN', async () => {
    const { crear, estado, limpiar } = montar()
    try {
      const caja = crear()
      await caja.login(ACCESO)
      estado.modo = 'rota'
      assert.equal((await caja.login(ACCESO)).offline, true)
    } finally { limpiar() }
  })
})

describe('plazo de la autoridad', () => {
  test('el plazo por omisión da margen a una conexión lenta', () => {
    const { crear, limpiar } = montar()
    try {
      // 1.8 s no alcanzaban: la ruta encadena varias consultas y puede arrancar
      // en frío, así que una conexión lenta se declaraba caída.
      assert.ok(crear().cloudTimeoutMs >= 5000, 'el plazo por omisión es demasiado corto para una WAN lenta')
    } finally { limpiar() }
  })

  test('el plazo es configurable y se valida', () => {
    const { crear, limpiar } = montar()
    try {
      assert.equal(crear({ cloudTimeoutMs: 3000 }).cloudTimeoutMs, 3000)
      assert.throws(() => crear({ cloudTimeoutMs: 0 }), /Plazo de la autoridad inválido/)
      // Un plazo largo dejaría la pantalla congelada y rebasaría el reenvío de
      // las terminales secundarias.
      assert.throws(() => crear({ cloudTimeoutMs: 60000 }), /Plazo de la autoridad inválido/)
    } finally { limpiar() }
  })
})
