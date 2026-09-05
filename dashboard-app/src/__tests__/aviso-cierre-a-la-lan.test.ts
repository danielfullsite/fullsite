// El cierre de mesa tiene que viajar por la LAN.
//
// CAMPO, 2026-09-02 — Eduardo Esquivel, AMALAY, tres cajas, internet caido:
//   «siguen apareciendo platillos en ordenes que estan ya cerradas»
//
// Cocina, barra y plano YA escuchaban `ORDER_CLOSED`. Nadie lo emitia. Estas
// pruebas cubren el emisor que faltaba y, sobre todo, la regla que lo hace seguro:
// un aviso que falla NO puede frenar un cobro.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/bridge-url', () => ({ getBridgeUrl: () => 'http://127.0.0.1:7717' }))

const enviados: { url: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  enviados.length = 0
  vi.resetModules()
})

/** Captura lo que sale hacia Pedro. */
function espiar(resultado: { ok: boolean; status?: number } | Error) {
  vi.doMock('@/lib/local-network-fetch', () => ({
    localNetworkFetch: async (url: string, init: RequestInit) => {
      enviados.push({ url, body: JSON.parse(String(init.body)) })
      if (resultado instanceof Error) throw resultado
      return { ok: resultado.ok, status: resultado.status ?? (resultado.ok ? 200 : 500) } as Response
    },
  }))
}

async function cargar() {
  return await import('@/lib/aviso-lan')
}

describe('El cierre viaja por la red local', () => {
  it('REGRESION: cobrar emite ORDER_CLOSED al puente', async () => {
    espiar({ ok: true })
    const { avisarCierreDeOrden: avisar } = await cargar()

    const ok = await avisar({ opId: 'op-1', orderId: 'ord-9', clientId: 'amalay', mesa: 8, turnoId: 't1' })

    expect(ok).toBe(true)
    expect(enviados).toHaveLength(1)
    expect(enviados[0].url).toBe('http://127.0.0.1:7717/events')
    expect(enviados[0].body.command_type).toBe('ORDER_CLOSED')
    expect(enviados[0].body.order_id).toBe('ord-9')
    expect(enviados[0].body.mesa).toBe(8)
  })

  it('el aviso lleva client_id — un tablero no debe borrar la orden de otro restaurante', async () => {
    espiar({ ok: true })
    const { avisarCierreDeOrden: avisar } = await cargar()
    await avisar({ opId: 'op-1', orderId: 'ord-9', clientId: 'amalay' })
    expect(enviados[0].body.client_id).toBe('amalay')
  })

  it('cancelar emite ORDER_CANCELLED, no ORDER_CLOSED', async () => {
    espiar({ ok: true })
    const { avisarCierreDeOrden: avisar } = await cargar()
    await avisar({ opId: 'op-2', orderId: 'ord-3', clientId: 'amalay', cancelada: true })
    expect(enviados[0].body.command_type).toBe('ORDER_CANCELLED')
    expect(enviados[0].body.status).toBe('cancelada')
  })

  it('el aviso hereda la idempotencia del cobro: dos taps, un solo command_id', async () => {
    // Pedro deduplica por command_id. Si este id fuera aleatorio, un doble tap
    // dejaria dos eventos identicos en el event store para siempre.
    espiar({ ok: true })
    const { avisarCierreDeOrden: avisar } = await cargar()
    await avisar({ opId: 'op-mismo', orderId: 'ord-1', clientId: 'amalay' })
    await avisar({ opId: 'op-mismo', orderId: 'ord-1', clientId: 'amalay' })
    expect(enviados[0].body.command_id).toBe(enviados[1].body.command_id)
  })
})

describe('Un aviso que falla NUNCA frena un cobro', () => {
  it('REGRESION: sin LAN devuelve false y no lanza', async () => {
    // Es la regla entera. Si esto lanzara, el cajero se quedaria con el cliente
    // enfrente y el cobro a medias por un aviso a un tablero.
    espiar(new Error('Failed to fetch'))
    const { avisarCierreDeOrden: avisar } = await cargar()

    let lanzo = false
    let r: boolean | undefined
    try { r = await avisar({ opId: 'op-1', orderId: 'ord-9', clientId: 'amalay' }) } catch { lanzo = true }

    expect(lanzo, 'un aviso jamas debe lanzar').toBe(false)
    expect(r).toBe(false)
  })

  it('REGRESION: Pedro contesta 500 y tampoco lanza', async () => {
    espiar({ ok: false, status: 500 })
    const { avisarCierreDeOrden: avisar } = await cargar()
    await expect(avisar({ opId: 'op-1', orderId: 'ord-9', clientId: 'amalay' })).resolves.toBe(false)
  })

  it('un timeout se traga igual que un error de red', async () => {
    espiar(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }))
    const { avisarCierreDeOrden: avisar } = await cargar()
    await expect(avisar({ opId: 'op-1', orderId: 'ord-9', clientId: 'amalay' })).resolves.toBe(false)
  })
})

describe('No se manda basura al event store', () => {
  it('REGRESION: sin order_id no se manda nada', async () => {
    // Los receptores hacen ordersMap.delete(orderId). Un id vacio no borra nada
    // pero queda en el historial de Pedro para siempre.
    espiar({ ok: true })
    const { avisarALaLan: avisar } = await cargar()

    const r = await avisar({
      command_id: 'x', command_type: 'ORDER_CLOSED', order_id: '', client_id: 'amalay',
    })

    expect(r).toBe(false)
    expect(enviados, 'no debe salir del navegador').toHaveLength(0)
  })

  it('sin command_id tampoco — Pedro no podria deduplicarlo', async () => {
    espiar({ ok: true })
    const { avisarALaLan: avisar } = await cargar()
    const r = await avisar({
      command_id: '', command_type: 'ORDER_CLOSED', order_id: 'ord-1', client_id: 'amalay',
    })
    expect(r).toBe(false)
    expect(enviados).toHaveLength(0)
  })
})

describe('Los receptores que ya existian siguen esperando este evento', () => {
  // Si alguien renombra el evento en el emisor y no en los tres receptores, el
  // arreglo desaparece en silencio — exactamente el bug original, al reves.
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const leer = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

  it('REGRESION: cocina, barra y plano siguen escuchando ORDER_CLOSED', () => {
    for (const archivo of [
      'src/app/pos/cocina/page.tsx',
      'src/app/pos/barra/page.tsx',
      'src/app/pos/plano/page.tsx',
    ]) {
      expect(leer(archivo), `${archivo} dejo de escuchar ORDER_CLOSED`).toContain('ORDER_CLOSED')
    }
  })

  it('REGRESION: el POS emite el cierre en las DOS salidas del cobro', () => {
    // La salida offline es la que MAS importa: es cuando la nube no le va a
    // contar a nadie. Si sólo se cablea la salida feliz, el bug sigue vivo
    // exactamente en el escenario que Eduardo probo.
    //
    // OJO CON ESTA PRUEBA: la primera version contaba la cadena en el archivo
    // crudo y pasaba con el cableado COMENTADO — porque el import y los propios
    // comentarios ya la contenian. Se verifico A/B y se corrigio: aqui se cuentan
    // LLAMADAS reales, con comentarios e imports fuera.
    const pos = leer('src/app/pos/page.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^\s*import[\s\S]*?from\s+'[^']*'\s*$/gm, '')
    const llamadas = pos.split(/\bavisarCierreDeOrden\s*\(/).length - 1
    expect(llamadas, 'debe emitirse en la salida OFFLINE_QUEUED y en la salida ok').toBeGreaterThanOrEqual(2)
  })
})
