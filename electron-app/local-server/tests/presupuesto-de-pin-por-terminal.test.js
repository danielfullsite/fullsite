'use strict'
// El presupuesto de intentos de PIN es por TERMINAL, no por restaurante.
//
// Las tres terminales de AMALAY (Caja, Entrada, Escondite) autorizan contra la
// misma instancia de ActorAuthority en la Caja. Cuando el presupuesto era una
// sola lista, diez errores en la Entrada dejaban sin poder entrar a la Caja y al
// Escondite durante diez minutos, con "Demasiados intentos". En hora pico, con
// varios meseros tecleando, es cuestión de minutos; sin internet es casi seguro,
// porque cada persona no preparada en esa terminal también gastaba del bote común.
//
// Correr: node --test electron-app/local-server/tests/presupuesto-de-pin-por-terminal.test.js
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ActorAuthority } = require('../core/actor-authority')

const RESTAURANTE = 'lab-presupuesto'
const CAJA = 'POS-CAJA', ENTRADA = 'POS-ENTRADA', ESCONDITE = 'POS-ESCONDITE'
const PERSONA = { id: '00000000-0000-4000-8000-000000000001', name: 'Cajera', role: 'gerente' }

// La nube: 'ok' acepta cualquier PIN, 'rechaza' contesta 401 como un PIN inválido,
// 'caida' falla la conexión (fuerza el camino sin internet).
function montar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-presupuesto-'))
  const estado = { modo: 'ok', llamadas: 0 }
  let reloj = 1_700_000_000_000
  const crear = () => new ActorAuthority({
    directory: dir, restaurantId: RESTAURANTE, now: () => reloj,
    fetchImpl: async () => {
      estado.llamadas++
      if (estado.modo === 'caida') throw new TypeError('fetch failed')
      if (estado.modo === 'rechaza') return Response.json({ error: 'Empleado no encontrado' }, { status: 401 })
      return Response.json({ staff: PERSONA })
    },
  })
  return { crear, estado, avanzar: ms => { reloj += ms }, limpiar: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

const codigo = p => p.then(() => null, e => e.code)

describe('presupuesto de intentos de PIN', () => {
  test('agotar los intentos en una terminal no bloquea a las otras dos', async () => {
    const { crear, estado, limpiar } = montar()
    try {
      const caja = crear()
      estado.modo = 'rechaza'
      // Diez errores en la Entrada: alguien tecleando mal, o meseros no preparados.
      for (let i = 0; i < 10; i++) {
        assert.equal(await codigo(caja.login({ pin: String(2000 + i), deviceId: ENTRADA, restaurantId: RESTAURANTE })), 'PIN_REJECTED')
      }
      // La Entrada sí queda frenada: la protección contra adivinación se conserva.
      assert.equal(await codigo(caja.login({ pin: '1111', deviceId: ENTRADA, restaurantId: RESTAURANTE })), 'PIN_RATE_LIMITED')

      // Y las otras dos siguen trabajando. Esto es lo que fallaba.
      estado.modo = 'ok'
      assert.equal((await caja.login({ pin: '4321', deviceId: CAJA, restaurantId: RESTAURANTE })).staff.id, PERSONA.id,
        'la Caja quedó bloqueada por errores de otra terminal')
      assert.equal((await caja.login({ pin: '4321', deviceId: ESCONDITE, restaurantId: RESTAURANTE })).staff.id, PERSONA.id,
        'el Escondite quedó bloqueado por errores de otra terminal')
    } finally { limpiar() }
  })

  test('entrar bien limpia el presupuesto de esa terminal', async () => {
    const { crear, estado, limpiar } = montar()
    try {
      const caja = crear()
      estado.modo = 'rechaza'
      for (let i = 0; i < 9; i++) await codigo(caja.login({ pin: String(3000 + i), deviceId: CAJA, restaurantId: RESTAURANTE }))

      estado.modo = 'ok'
      await caja.login({ pin: '4321', deviceId: CAJA, restaurantId: RESTAURANTE })

      // Tras entrar bien, la terminal vuelve a tener sus diez intentos: los
      // errores de quien tecleó mal antes ya no cuentan contra quien se identificó.
      estado.modo = 'rechaza'
      for (let i = 0; i < 9; i++) {
        assert.equal(await codigo(caja.login({ pin: String(5000 + i), deviceId: CAJA, restaurantId: RESTAURANTE })), 'PIN_REJECTED',
          `intento ${i + 1} tras un acceso correcto no debería estar frenado`)
      }
    } finally { limpiar() }
  })

  test('rotar el identificador de terminal no da intentos sin fin', async () => {
    const { crear, estado, limpiar } = montar()
    try {
      const caja = crear()
      estado.modo = 'rechaza'
      // La cabecera que identifica la terminal la declara el cliente, así que
      // alguien en la red podría inventar una distinta en cada intento.
      const codigos = []
      for (let i = 0; i < 40; i++) {
        codigos.push(await codigo(caja.login({ pin: String(6000 + i), deviceId: `INVENTADA-${i}`, restaurantId: RESTAURANTE })))
      }
      assert.ok(codigos.includes('PIN_RATE_LIMITED'), 'el tope de la instalación debe cortar la rotación')
      assert.ok(codigos.filter(c => c === 'PIN_REJECTED').length <= 30,
        `llegaron ${codigos.filter(c => c === 'PIN_REJECTED').length} intentos a la nube; el tope de instalación son 30`)
    } finally { limpiar() }
  })

  test('el presupuesto sobrevive al reinicio y vence a los diez minutos', async () => {
    const { crear, estado, avanzar, limpiar } = montar()
    try {
      estado.modo = 'rechaza'
      const antes = crear()
      for (let i = 0; i < 10; i++) await codigo(antes.login({ pin: String(7000 + i), deviceId: ENTRADA, restaurantId: RESTAURANTE }))

      // Reiniciar Caja no debe regalar intentos.
      assert.equal(await codigo(crear().login({ pin: '1111', deviceId: ENTRADA, restaurantId: RESTAURANTE })), 'PIN_RATE_LIMITED')

      avanzar(600001)
      estado.modo = 'ok'
      assert.equal((await crear().login({ pin: '4321', deviceId: ENTRADA, restaurantId: RESTAURANTE })).staff.id, PERSONA.id)
    } finally { limpiar() }
  })

  test('un archivo escrito por la versión anterior se sigue leyendo', async () => {
    const { crear, estado, limpiar } = montar()
    try {
      const caja = crear()
      estado.modo = 'ok'
      await caja.login({ pin: '4321', deviceId: CAJA, restaurantId: RESTAURANTE })

      // Formato anterior: lista plana de marcas de tiempo, sin terminal.
      const archivo = caja.file
      const guardado = JSON.parse(fs.readFileSync(archivo, 'utf8'))
      guardado.failures = [Date.now(), Date.now()]
      fs.writeFileSync(archivo, JSON.stringify(guardado))

      const despues = crear()
      assert.equal((await despues.login({ pin: '4321', deviceId: CAJA, restaurantId: RESTAURANTE })).staff.id, PERSONA.id,
        'actualizar la versión no debe dejar la autoridad inservible')
    } finally { limpiar() }
  })
})
