// Pedro inalcanzable — el mapa de mesas NO se queda en blanco porque no haya caja.
//
// ── POR QUE ESTA PRUEBA VIVE SOLA EN SU ARCHIVO ──────────────────────────────
//
// Estaba al final de `pos-consume-a-pedro.test.ts`, con un comentario que decia
// "AL FINAL A PROPOSITO: este bloque llama vi.resetModules() y re-mockea bridge-url a
// un puerto muerto. Todo lo que se importe DESPUES hereda ese mock — en medio del
// archivo dejaba a las pruebas del cursor apuntando a un puerto donde nadie escucha.
// Costo una corrida; queda anotado para que nadie lo suba de lugar."
//
// El comentario era correcto y aun asi no alcanzaba: convertia el ORDEN DE ESCRITURA en
// parte del contrato. Medido el 2026-09-09 con `npx vitest run --sequence.shuffle`,
// entre 5 y 9 de las 20 pruebas de ese archivo fallaban por rondas, todas con el mismo
// sintoma: `expected 'fetch failed' to match /503/` y la lista de peticiones vacia. El
// servidor de mentiras estaba vivo; lo que apuntaba a un puerto muerto era el mock.
//
// Ninguna de esas fallas era del producto. Pero ese archivo guarda el P0 que Eduardo
// reporto el 2026-09-02 --"una mesa entregada SIN pagar sigue ocupada"-- y una guarda
// cuya validez depende de que nadie mueva un bloque de sitio es una guarda que deja de
// guardar sin avisar. Vitest aisla POR ARCHIVO: mudarla aqui elimina la dependencia de
// orden en vez de documentarla.

import { describe, it, expect, vi } from 'vitest'

describe('Pedro inalcanzable', () => {
  it('REGRESION: leerSalon NUNCA lanza aunque la conexión se rechace', async () => {
    // El mapa de mesas no puede quedarse en blanco porque el servidor local no
    // esté. `vi.resetModules()` + `doMock` ANTES del import: mockear después no
    // afecta a un módulo ya cargado — la primera versión de esta prueba fallaba
    // por eso, no por el producto.
    vi.resetModules()
    vi.doMock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:1' }))
    vi.doMock('@/lib/local-network-fetch', () => ({
      localNetworkFetch: (u: string, init?: RequestInit) => fetch(u, init),
    }))
    const { leerSalon: leerSinPedro } = await import('@/lib/pedro-cliente')

    let lanzo = false
    let r
    try { r = await leerSinPedro() } catch { lanzo = true }

    expect(lanzo, 'leerSalon jamás debe lanzar').toBe(false)
    expect(r?.procedencia).toBe('sin-pedro')
    expect(r?.autoritativa).toBe(false)
  })
})
