/**
 * La rama de falla del login — un 429 o un 5xx no son "PIN incorrecto".
 *
 * El defecto, leído en `pos/layout.tsx` el 2026-09-14: el camino directo a la nube ramificaba
 * sobre `403`, `400` y `res.ok`, y nada más. Un `429` del throttle o un `5xx` de Vercel no es
 * ninguno de los tres, así que se caía del `try` **sin lanzar** — y el `catch` que contiene el
 * respaldo offline sólo corre ante algo lanzado. La ejecución aterrizaba directo en el contador
 * de intentos: *"PIN incorrecto"* con el PIN correcto, y bloqueo al 5º intento, **sin haber
 * mirado nunca el almacén local de credenciales**.
 *
 * Es la tercera vez que este mismo patrón muerde en este archivo:
 *   · el 400 (terminal sin tenant) — ya arreglado, comentario en `layout.tsx:104-112`
 *   · el 429 en Pedro — ya arreglado, comentario en `actor-authority.js:159-164`
 *   · el 429/5xx en el navegador — esto
 *
 * Por eso la clasificación sale a su propio módulo: para que la cuarta superficie la importe
 * en vez de re-descubrirla en campo.
 *
 * Las pruebas de abajo son de DOS tipos y conviene no confundirlos:
 *   1. Comportamiento real de `clasificarRespuestaDePin` / `cuentaComoIntentoFallido`.
 *   2. Un candado de cableado sobre `layout.tsx` — sólo comprueba que el archivo USE el módulo.
 *      Vale poco por sí solo; vale porque el punto 1 ya probó la decisión.
 */

import { describe, it, expect } from 'vitest'
import { clasificarRespuestaDePin, cuentaComoIntentoFallido } from '@/lib/veredicto-de-la-autoridad'

describe('clasificar la respuesta de la autoridad', () => {
  it('200 es aceptación', () => {
    expect(clasificarRespuestaDePin(200)).toBe('aceptado')
  })

  it('401 es el ÚNICO veredicto sobre el PIN', () => {
    expect(clasificarRespuestaDePin(401)).toBe('pin-rechazado')
  })

  it('400 es la terminal sin restaurante asignado, no el PIN', () => {
    expect(clasificarRespuestaDePin(400)).toBe('sin-tenant')
  })

  it('403 con terminal_not_enrolled es la terminal, no el PIN', () => {
    expect(clasificarRespuestaDePin(403, 'terminal_not_enrolled')).toBe('terminal-no-enrolada')
  })

  it('EL BUG — 429 no es veredicto: el throttle va por (restaurante, IP) y las tres terminales la comparten', () => {
    expect(clasificarRespuestaDePin(429)).toBe('autoridad-no-disponible')
    expect(cuentaComoIntentoFallido(clasificarRespuestaDePin(429))).toBe(false)
  })

  it('EL BUG — 503 authority_unavailable no es veredicto', () => {
    expect(clasificarRespuestaDePin(503, 'authority_unavailable')).toBe('autoridad-no-disponible')
    expect(cuentaComoIntentoFallido(clasificarRespuestaDePin(503))).toBe(false)
  })

  it('cualquier 5xx cae del lado seguro', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(clasificarRespuestaDePin(status), `status ${status}`).toBe('autoridad-no-disponible')
    }
  })

  it('un 403 sin código no lo emite /api/pos/pin — sale de un proxy, y no se acusa al PIN', () => {
    expect(clasificarRespuestaDePin(403)).toBe('autoridad-no-disponible')
    expect(cuentaComoIntentoFallido(clasificarRespuestaDePin(403))).toBe(false)
  })

  it('lo que no entendemos tampoco acusa al PIN', () => {
    for (const status of [302, 418, 0]) {
      expect(cuentaComoIntentoFallido(clasificarRespuestaDePin(status)), `status ${status}`).toBe(false)
    }
  })
})

describe('qué cuenta como intento fallido', () => {
  it('sólo el rechazo real cuenta', () => {
    expect(cuentaComoIntentoFallido('pin-rechazado')).toBe(true)
  })

  it('ninguno de los demás cuenta — contar de más bloquea la terminal el peor día', () => {
    for (const v of ['aceptado', 'sin-tenant', 'terminal-no-enrolada', 'autoridad-no-disponible'] as const) {
      expect(cuentaComoIntentoFallido(v), v).toBe(false)
    }
  })
})

describe('cableado — que layout.tsx use la clasificación', () => {
  const leerLayout = async () => {
    const fs = await import('fs')
    const path = await import('path')
    return fs.readFileSync(path.resolve(__dirname, '../app/pos/layout.tsx'), 'utf-8')
  }

  it('importa el módulo en vez de ramificar a mano sobre status sueltos', async () => {
    const src = await leerLayout()
    expect(src, 'sin este import la clasificación vuelve a estar dispersa en ifs')
      .toContain("from '@/lib/veredicto-de-la-autoridad'")
  })

  it('un veredicto de autoridad-no-disponible LANZA, que es lo único que despierta el respaldo offline', async () => {
    const src = await leerLayout()
    // El `catch` con `estadoCredencialesOffline()` sólo corre ante algo lanzado. Si esta rama
    // volviera a `return` o a caer de largo, el respaldo local deja de consultarse y regresa
    // exactamente el bug: "PIN incorrecto" y bloqueo con el servidor caído.
    const i = src.indexOf("'autoridad-no-disponible'")
    expect(i, 'debe existir la rama').toBeGreaterThan(-1)
    expect(src.slice(i, i + 400), 'la rama tiene que lanzar para alcanzar el catch')
      .toMatch(/throw new Error\(/)
  })

  it('el PIN realmente rechazado SIGUE contando — el arreglo no aflojó el candado', async () => {
    const src = await leerLayout()
    // `pin-rechazado` se maneja cayendo de largo hasta el contador de intentos del final.
    // Si alguien le agrega una rama propia con `return`, el 401 dejaría de contar y el
    // bloqueo por fuerza bruta se desactivaría en silencio. Que tenga que borrar esta
    // prueba para hacerlo.
    expect(src, 'un 401 no debe atajarse: tiene que llegar al contador del final')
      .not.toContain("veredicto === 'pin-rechazado'")
  })

  // B-2 (bloque POS, 2026-09-24): el respaldo offline del NAVEGADOR se retiró — guardaba
  // verificadores de PIN en localStorage. Al caer, el navegador sin Caja ya no juzga el PIN
  // con nada local (las terminales Electron entran por la Caja, con su almacén sellado). Lo
  // que esta prueba cuidaba —que caer no cuente como PIN incorrecto— sigue abajo.
  it('al caer, el navegador sin Caja NO consulta ningún verificador local', async () => {
    const src = await leerLayout()
    expect(src.indexOf("throw new Error('autoridad-no-disponible')"), 'debe lanzar con ese motivo exacto').toBeGreaterThan(-1)
    expect(src).not.toMatch(/estadoCredencialesOffline\(|verifyPinOffline\(|provisionManagerCredential\(/)
    expect(src).not.toMatch(/localStorage\.(getItem|setItem)\('pos_staff_cache'/)
  })

  it('con la autoridad caída el mensaje NO dice "sin conexión" — la terminal sí tiene red', async () => {
    const src = await leerLayout()
    expect(src, 'el operador necesita saber que no es su PIN ni su cable')
      .toMatch(/servidor no pudo confirmar tu PIN/i)
    // Y ese mensaje debe ganarle al de «sin conexión»: llegamos aquí porque la NUBE contestó
    // mal, no porque falte red.
    const i = src.indexOf('if (autoridadNoDisponible) {')
    const sinRed = src.indexOf('Sin conexión.', i)
    expect(i, 'la causa real debe evaluarse primero').toBeGreaterThan(-1)
    expect(sinRed, 'y la falta de red después').toBeGreaterThan(i)
  })

  it('un intento nuevo borra el aviso del anterior — no dos diagnósticos a la vez', async () => {
    const src = await leerLayout()
    const submit = src.indexOf('const handleSubmit = async () => {')
    const limpia = src.indexOf("setSessionError('')", submit)
    const fetchPin = src.indexOf("apiUrl('/api/pos/pin')", submit)
    expect(submit).toBeGreaterThan(-1)
    expect(limpia, 'debe limpiarse al entrar a handleSubmit').toBeGreaterThan(submit)
    expect(limpia, 'y antes de volver a preguntarle al servidor').toBeLessThan(fetchPin)
  })
})
