import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeToPrinter } from '@/lib/printer'

// ── Cola global de impresión (writeToPrinter / printChain) ──────────────────
// ESC/POS es sensible al orden de bytes: estas pruebas verifican que escrituras
// concurrentes se serializan (nunca se intercalan chunks) y que un fallo en una
// impresión no bloquea la cola para las siguientes.

function makeChar(log: string[], label: string, opts: { failAt?: number } = {}) {
  let writes = 0
  return {
    properties: { writeWithoutResponse: true },
    writeValueWithoutResponse: vi.fn(async (chunk: Uint8Array) => {
      writes++
      if (opts.failAt && writes === opts.failAt) throw new Error('GATT error')
      log.push(`${label}:${chunk.length}`)
    }),
    writeValueWithResponse: vi.fn(),
  }
}

describe('writeToPrinter (cola serializada)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function flush(p: Promise<unknown>) {
    // Avanza timers (50ms entre chunks) hasta que la promesa resuelva
    await vi.runAllTimersAsync()
    return p
  }

  it('divide los datos en chunks de 128 bytes', async () => {
    const log: string[] = []
    const char = makeChar(log, 'A')
    const data = new Uint8Array(300) // 128 + 128 + 44
    const p = writeToPrinter(char, data)
    await flush(p)
    expect(log).toEqual(['A:128', 'A:128', 'A:44'])
  })

  it('serializa dos escrituras concurrentes sin intercalar chunks', async () => {
    const log: string[] = []
    const charA = makeChar(log, 'A')
    const charB = makeChar(log, 'B')
    // Disparadas "al mismo tiempo" (sin await entre ambas)
    const pA = writeToPrinter(charA, new Uint8Array(256)) // 2 chunks
    const pB = writeToPrinter(charB, new Uint8Array(256)) // 2 chunks
    await flush(Promise.all([pA, pB]))
    // Todos los chunks de A antes que cualquier chunk de B
    expect(log).toEqual(['A:128', 'A:128', 'B:128', 'B:128'])
  })

  it('serializa tres escrituras en orden de llegada', async () => {
    const log: string[] = []
    const ps = ['A', 'B', 'C'].map(label =>
      writeToPrinter(makeChar(log, label), new Uint8Array(10))
    )
    await flush(Promise.all(ps))
    expect(log).toEqual(['A:10', 'B:10', 'C:10'])
  })

  it('un fallo no bloquea la cola: la siguiente impresión procede', async () => {
    const log: string[] = []
    const failing = makeChar(log, 'F', { failAt: 1 })
    const ok = makeChar(log, 'OK')
    const pF = writeToPrinter(failing, new Uint8Array(10))
    const pOk = writeToPrinter(ok, new Uint8Array(10))
    const results = await flush(Promise.allSettled([pF, pOk]))
    expect((results as PromiseSettledResult<void>[])[0].status).toBe('rejected')
    expect((results as PromiseSettledResult<void>[])[1].status).toBe('fulfilled')
    expect(log).toEqual(['OK:10'])
  })

  it('usa writeValueWithResponse cuando writeWithoutResponse no está disponible', async () => {
    const log: string[] = []
    const char = {
      properties: { writeWithoutResponse: false },
      writeValueWithoutResponse: vi.fn(),
      writeValueWithResponse: vi.fn(async (chunk: Uint8Array) => {
        log.push(`R:${chunk.length}`)
      }),
    }
    const p = writeToPrinter(char, new Uint8Array(5))
    await flush(p)
    expect(log).toEqual(['R:5'])
    expect(char.writeValueWithoutResponse).not.toHaveBeenCalled()
  })
})
