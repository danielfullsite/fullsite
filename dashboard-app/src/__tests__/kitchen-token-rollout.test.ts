// Rollout del token de cocina: off → grace → strict.
//
// El agujero (medido en producción el 2026-08-26):
//
//   GET https://app.fullsite.mx/api/pos/kitchen?client_id=lab-resto  → 200 · 8 órdenes
//
// Sin credenciales de ningún tipo. `KITCHEN_TOKEN_SECRET` no está configurada, y
// `verifyKitchenToken` devuelve `true` cuando no hay secreto — falla ABIERTO.
//
// Por qué no se arregla nada más volteándolo: el token vive en el localStorage de cada
// pantalla (`pos_kitchen_token`, pos-data.ts:1606). En cuanto exista el secreto, toda
// pantalla sin provisionar recibe 401 y se queda sin comandas. En una cocina eso no es
// un error de log: dejan de salir los platillos.
//
// De ahí el modo `grace`, el mismo patrón del enforcement antifraude: verificar,
// permitir, y reportar quién no trae token — para ver qué pantallas faltan SIN dejar
// la cocina a ciegas.
//
// Las propiedades que fija este archivo:
//   1. Sin secreto no cambia nada (`off`). Es el default y es el estado de hoy.
//   2. Con secreto y sin modo, sigue siendo `strict` — encender el secreto no vuelve
//      permisivo el endpoint por accidente.
//   3. `grace` sirve la respuesta Y marca el caso para reportarlo.
//   4. `strict` bloquea.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const SECRETO = 'un-secreto-de-cocina-suficientemente-largo'

async function mod() {
  return await import('@/lib/kitchen-token')
}

beforeEach(() => { vi.resetModules() })

afterEach(() => {
  delete process.env.KITCHEN_TOKEN_SECRET
  delete process.env.KITCHEN_TOKEN_MODE
})

describe('modo del token de cocina', () => {
  it('sin secreto → off, aunque se pida strict', async () => {
    process.env.KITCHEN_TOKEN_MODE = 'strict'
    const { modoTokenCocina } = await mod()

    expect(modoTokenCocina()).toBe('off')
  })

  it('un secreto corto no cuenta como secreto', async () => {
    process.env.KITCHEN_TOKEN_SECRET = 'corto'
    const { modoTokenCocina } = await mod()

    expect(modoTokenCocina()).toBe('off')
  })

  it('con secreto y sin modo → strict, que es lo que hace hoy el endpoint', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    const { modoTokenCocina } = await mod()

    expect(modoTokenCocina()).toBe('strict')
  })

  it('grace hay que pedirlo explícitamente', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    process.env.KITCHEN_TOKEN_MODE = 'grace'
    const { modoTokenCocina } = await mod()

    expect(modoTokenCocina()).toBe('grace')
  })

  it('un valor basura en el modo cae a strict, no a permisivo', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    process.env.KITCHEN_TOKEN_MODE = 'lo-que-sea'
    const { modoTokenCocina } = await mod()

    expect(modoTokenCocina()).toBe('strict')
  })
})

describe('evaluarTokenCocina', () => {
  it('EL ESTADO DE HOY: sin secreto sirve a cualquiera y no reporta nada', async () => {
    const { evaluarTokenCocina } = await mod()

    const v = evaluarTokenCocina('lab-resto', null)

    expect(v.permitir).toBe(true)
    expect(v.modo).toBe('off')
    expect(v.reportar).toBe(false)
  })

  it('strict: sin token → NO se sirve', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    const { evaluarTokenCocina } = await mod()

    const v = evaluarTokenCocina('lab-resto', null)

    expect(v.permitir).toBe(false)
    expect(v.modo).toBe('strict')
  })

  it('strict: token de OTRO tenant → NO se sirve', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    const { evaluarTokenCocina, signKitchenToken } = await mod()

    const ajeno = signKitchenToken('amalay')!
    const v = evaluarTokenCocina('lab-resto', ajeno)

    expect(v.permitir).toBe(false)
  })

  it('strict: token propio → se sirve', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    const { evaluarTokenCocina, signKitchenToken } = await mod()

    const propio = signKitchenToken('lab-resto')!
    const v = evaluarTokenCocina('lab-resto', propio)

    expect(v.permitir).toBe(true)
    expect(v.tokenValido).toBe(true)
    expect(v.reportar).toBe(false)
  })

  it('grace: sin token SÍ se sirve, pero se marca para reportar', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    process.env.KITCHEN_TOKEN_MODE = 'grace'
    const { evaluarTokenCocina } = await mod()

    const v = evaluarTokenCocina('lab-resto', null)

    expect(v.permitir).toBe(true)   // la cocina no se queda sin comandas
    expect(v.reportar).toBe(true)   // pero queda rastro de que falta provisionar
    expect(v.tokenValido).toBe(false)
  })

  it('grace: token ajeno también se sirve y también se reporta', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    process.env.KITCHEN_TOKEN_MODE = 'grace'
    const { evaluarTokenCocina, signKitchenToken } = await mod()

    const v = evaluarTokenCocina('lab-resto', signKitchenToken('amalay')!)

    expect(v.permitir).toBe(true)
    expect(v.reportar).toBe(true)
  })

  it('grace: con token válido no se reporta nada', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    process.env.KITCHEN_TOKEN_MODE = 'grace'
    const { evaluarTokenCocina, signKitchenToken } = await mod()

    const v = evaluarTokenCocina('lab-resto', signKitchenToken('lab-resto')!)

    expect(v.permitir).toBe(true)
    expect(v.reportar).toBe(false)
  })

  it('el token de un tenant no sirve para otro — es lo que cierra la enumeración', async () => {
    process.env.KITCHEN_TOKEN_SECRET = SECRETO
    const { signKitchenToken } = await mod()

    expect(signKitchenToken('amalay')).not.toBe(signKitchenToken('lab-resto'))
  })
})
