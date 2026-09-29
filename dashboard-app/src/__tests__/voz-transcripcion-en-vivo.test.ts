// Subtítulo en vivo (sólo pantalla): Chrome/Edge sí; Safari/iOS no; se reanuda solo
// cuando Chrome lo corta por silencio; sin permiso se apaga.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { crearTranscripcionEnVivo, ctorReconocedor, textoDeResultados } from '@/lib/voz/transcripcion-en-vivo'

afterEach(() => { vi.useRealTimers() })

class RecFalso {
  static creados: RecFalso[] = []
  lang = ''; continuous = false; interimResults = false
  onresult: ((ev: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((ev: { error?: string }) => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
  constructor() { RecFalso.creados.push(this) }
}

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140 Mobile/15E148 Safari/604.1'

describe('ctorReconocedor', () => {
  it('Chrome con webkitSpeechRecognition: sí; Safari e iOS: no; sin API: no', () => {
    expect(ctorReconocedor({ webkitSpeechRecognition: RecFalso }, CHROME)).toBe(RecFalso)
    expect(ctorReconocedor({ webkitSpeechRecognition: RecFalso }, SAFARI)).toBeNull()
    expect(ctorReconocedor({ webkitSpeechRecognition: RecFalso }, IPHONE)).toBeNull()
    expect(ctorReconocedor({}, CHROME)).toBeNull()
    expect(ctorReconocedor(undefined, CHROME)).toBeNull()
  })
})

describe('crearTranscripcionEnVivo', () => {
  it('es-MX, continuo, con intermedios; junta los resultados en un texto', () => {
    RecFalso.creados = []
    const textos: string[] = []
    const vivo = crearTranscripcionEnVivo(t => textos.push(t), RecFalso as never)
    expect(vivo.soportada).toBe(true)
    vivo.iniciar()
    const r = RecFalso.creados[0]
    expect([r.lang, r.continuous, r.interimResults]).toEqual(['es-MX', true, true])
    r.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: '¿cuánto ' }], { isFinal: true }), Object.assign([{ transcript: 'vendimos' }], { isFinal: false })] })
    expect(textos.at(-1)).toBe('¿cuánto vendimos')
    vivo.detener()
    expect(r.abort).toHaveBeenCalled()
  })

  it('si Chrome lo corta solo, se reanuda (máx. 1 por segundo); al detener, ya no', () => {
    vi.useFakeTimers()
    RecFalso.creados = []
    const vivo = crearTranscripcionEnVivo(() => {}, RecFalso as never)
    vivo.iniciar()
    RecFalso.creados[0].onend?.()
    vi.advanceTimersByTime(1000)
    expect(RecFalso.creados).toHaveLength(2)
    vivo.detener()
    vi.advanceTimersByTime(5000)
    expect(RecFalso.creados).toHaveLength(2)
  })

  it('sin permiso: se apaga para la sesión', () => {
    vi.useFakeTimers()
    RecFalso.creados = []
    const vivo = crearTranscripcionEnVivo(() => {}, RecFalso as never)
    vivo.iniciar()
    RecFalso.creados[0].onerror?.({ error: 'not-allowed' })
    RecFalso.creados[0].onend?.()
    vi.advanceTimersByTime(3000)
    expect(RecFalso.creados).toHaveLength(1)
    expect(vivo.soportada).toBe(false)
  })

  it('sin API: no-op', () => {
    const vivo = crearTranscripcionEnVivo(() => {}, null)
    expect(vivo.soportada).toBe(false)
    expect(() => { vivo.iniciar(); vivo.detener() }).not.toThrow()
  })

  it('textoDeResultados tolera huecos', () => {
    expect(textoDeResultados([[{ transcript: ' hola ' }], [] as never, [{ transcript: 'mundo' }]])).toBe('hola mundo')
  })
})
