// Plática continua del modo voz con el hook REAL y una voz falsa inyectada:
// interrumpir hablando (barge-in), eco que no interrumpe, respaldo e iOS sin barge-in,
// acuse cuando la respuesta tarda, y pausa por 60 s de silencio.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useEffect } from 'react'

let nivel = 0
vi.mock('@/lib/voz/microfono', async (orig) => ({
  ...(await orig<typeof import('@/lib/voz/microfono')>()),
  audioContextCompartido: () => null,
  crearMedidor: () => ({ leer: () => nivel, cerrar: () => {} }),
}))

import { useModoVoz } from '@/hooks/useModoVoz'
import type { OpcionesHablar, ProveedoresVoz, ProveedorVoz } from '@/lib/voz/proveedores'
import { ACUSES } from '@/lib/voz/voz-natural'

const pista = { stop: vi.fn() }
const stream = { getTracks: () => [pista] } as unknown as MediaStream

/** Fase visible al momento de crear cada grabador (se lee del DOM, como la vería el dueño). */
const faseEnPantalla = () => document.querySelector('[data-testid="fase"]')?.textContent ?? ''
class GrabadorFalso {
  static creados: { fase: string }[] = []
  static isTypeSupported = (t: string) => t.startsWith('audio/webm')
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor() { GrabadorFalso.creados.push({ fase: faseEnPantalla() }) }
  start() { this.state = 'recording' }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(900)], { type: this.mimeType }) })
    setTimeout(() => this.onstop?.(), 0)
  }
}

function vozFalsa(opciones: { barge?: boolean; salida?: number; duracionMs?: number } = {}) {
  const dichos: string[] = []
  let cortar: (() => void) | null = null
  const voz: ProveedorVoz & { hablar: ReturnType<typeof vi.fn>; callar: ReturnType<typeof vi.fn> } = {
    nombre: 'falsa',
    disponible: () => true,
    preparar: () => {},
    cargar: vi.fn(async (cb?: (e: { estado: 'listo'; motor: string }) => void) => { cb?.({ estado: 'listo', motor: 'piper:falso' }) }),
    nivelSalida: () => opciones.salida ?? 0.1,
    permiteInterrupcionPorVoz: () => opciones.barge ?? true,
    hablar: vi.fn((texto: string, signal?: AbortSignal, o?: OpcionesHablar) => new Promise<void>(resolve => {
      dichos.push(texto)
      o?.alFrase?.(0)
      const t = setTimeout(resolve, ACUSES.includes(texto as never) ? 150 : (opciones.duracionMs ?? 4000))
      cortar = () => { clearTimeout(t); resolve() }
      signal?.addEventListener('abort', () => cortar?.(), { once: true })
    })),
    callar: vi.fn(() => { cortar?.() }),
  }
  return { voz, dichos }
}

let transcripciones: string[] = []
function proveedores(voz: ProveedorVoz): ProveedoresVoz {
  return { transcripcion: { nombre: 'falsa', transcribir: vi.fn(async () => transcripciones.shift() ?? '') }, voz }
}

function Prueba(props: { p: ProveedoresVoz; preguntar: (t: string, s: AbortSignal) => Promise<string>; pausaMs?: number; acuseMs?: number }) {
  const v = useModoVoz({ preguntar: props.preguntar, proveedores: props.p, silencioPausaMs: props.pausaMs, acuseDespuesMs: props.acuseMs })
  const { abrir } = v
  useEffect(() => { void abrir() }, [abrir])
  return (
    <div>
      <p data-testid="fase">{v.fase}</p>
      <p data-testid="carga">{v.cargaVoz.estado}</p>
      <p data-testid="por-voz">{String(v.interrumpePorVoz)}</p>
      <button type="button" onClick={v.reintentar}>Seguir</button>
    </div>
  )
}

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))
const fase = () => screen.getByTestId('fase').textContent

beforeEach(() => {
  nivel = 0
  GrabadorFalso.creados = []
  pista.stop.mockClear()
  transcripciones = []
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140 jsdom' })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } })
  vi.stubGlobal('MediaRecorder', GrabadorFalso)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** Calibra, habla 900 ms y se calla: el VAD cierra el enunciado. */
async function decirAlgo() {
  nivel = 0.005
  await esperar(450)
  nivel = 0.3
  await esperar(900)
  nivel = 0.005
}

describe('interrumpir HABLANDO (voz natural)', () => {
  it('voz sostenida del dueño mientras responde → se calla, lo ya grabado es su turno y se manda la nueva pregunta', async () => {
    const { voz } = vozFalsa({ duracionMs: 8000 })
    const preguntar = vi.fn<(t: string, s: AbortSignal) => Promise<string>>(async () => 'Hoy llevas $12,533. Vas arriba del lunes.')
    transcripciones = ['¿Cuánto vendimos hoy?', '¿Y ayer?']
    render(<Prueba p={proveedores(voz)} preguntar={preguntar} />)
    await decirAlgo()
    await waitFor(() => expect(fase()).toBe('hablando'), { timeout: 3000 })
    expect(screen.getByTestId('por-voz').textContent).toBe('true')
    await esperar(400) // fuera de la ventana sorda; aprende el eco (bajo)
    const antes = GrabadorFalso.creados.length
    nivel = 0.3 // el dueño habla encima
    await waitFor(() => expect(voz.callar).toHaveBeenCalled(), { timeout: 1500 })
    expect(fase()).toBe('escuchando')
    // El grabador que se usa para su pregunta nació MIENTRAS hablaba la voz (no se perdió el inicio).
    expect(GrabadorFalso.creados.slice(antes).map(g => g.fase)).toEqual(['hablando'])
    await esperar(400)
    nivel = 0.005
    await waitFor(() => expect(preguntar).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(preguntar.mock.calls[1][0]).toBe('¿Y ayer?')
    // Ningún grabador nuevo entre la interrupción y el fin de su pregunta.
    expect(GrabadorFalso.creados.slice(antes).filter(g => g.fase === 'escuchando')).toHaveLength(0)
  }, 15_000)

  it('el eco (nivel bajo que sigue a la voz) NO interrumpe: la respuesta termina y vuelve a escuchar', async () => {
    const { voz } = vozFalsa({ duracionMs: 1200, salida: 0.15 })
    transcripciones = ['¿Cuánto vendimos hoy?']
    render(<Prueba p={proveedores(voz)} preguntar={async () => 'Hoy llevas $12,533.'} />)
    await decirAlgo()
    await waitFor(() => expect(fase()).toBe('hablando'), { timeout: 3000 })
    nivel = 0.03 // eco residual
    await waitFor(() => expect(fase()).toBe('escuchando'), { timeout: 3000 })
    expect(voz.callar).not.toHaveBeenCalled()
  }, 10_000)

  it('con la voz del navegador (respaldo) sólo se interrumpe tocando: hablar fuerte no la calla', async () => {
    const { voz } = vozFalsa({ barge: false, duracionMs: 1500 })
    transcripciones = ['¿Cuánto vendimos hoy?']
    render(<Prueba p={proveedores(voz)} preguntar={async () => 'Hoy llevas $12,533.'} />)
    await decirAlgo()
    await waitFor(() => expect(fase()).toBe('hablando'), { timeout: 3000 })
    expect(screen.getByTestId('por-voz').textContent).toBe('false')
    const antes = GrabadorFalso.creados.length
    nivel = 0.3
    await esperar(800)
    expect(voz.callar).not.toHaveBeenCalled()
    expect(fase()).toBe('hablando')
    expect(GrabadorFalso.creados.length).toBe(antes) // ni siquiera graba mientras habla
  }, 10_000)

  it('iOS: suelta el micrófono al hablar y NO hay interrupción por voz', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    const { voz } = vozFalsa({ duracionMs: 1500 })
    transcripciones = ['¿Cuánto vendimos hoy?']
    render(<Prueba p={proveedores(voz)} preguntar={async () => 'Hoy llevas $12,533.'} />)
    await decirAlgo()
    await waitFor(() => expect(fase()).toBe('hablando'), { timeout: 3000 })
    expect(pista.stop).toHaveBeenCalled()
    nivel = 0.3
    await esperar(700)
    expect(voz.callar).not.toHaveBeenCalled()
  }, 10_000)
})

describe('plática que no se siente muerta', () => {
  it('si la respuesta tarda, dice un acuse corto ANTES de la respuesta (y no se enciman)', async () => {
    const { voz, dichos } = vozFalsa({ duracionMs: 200 })
    transcripciones = ['¿Cuánto vendimos hoy?']
    const preguntar = () => new Promise<string>(r => setTimeout(() => r('Hoy llevas $12,533.'), 900))
    render(<Prueba p={proveedores(voz)} preguntar={preguntar} acuseMs={300} />)
    await decirAlgo()
    await waitFor(() => expect(dichos).toContain('Hoy llevas $12,533.'), { timeout: 5000 })
    expect(ACUSES).toContain(dichos[0])
    expect(dichos[1]).toBe('Hoy llevas $12,533.')
    expect((voz.hablar.mock.calls[0] as unknown[])[2]).toMatchObject({ cachear: true })
  }, 10_000)

  it('si la respuesta llega rápido, NO hay acuse', async () => {
    const { dichos, voz } = vozFalsa({ duracionMs: 200 })
    transcripciones = ['¿Cuánto vendimos hoy?']
    render(<Prueba p={proveedores(voz)} preguntar={async () => 'Hoy llevas $12,533.'} acuseMs={1500} />)
    await decirAlgo()
    await waitFor(() => expect(dichos).toHaveLength(1), { timeout: 3000 })
    expect(dichos[0]).toBe('Hoy llevas $12,533.')
  }, 10_000)

  it('la voz natural se prepara al abrir, en paralelo (no bloquea escuchar)', async () => {
    const { voz } = vozFalsa()
    render(<Prueba p={proveedores(voz)} preguntar={async () => 'ok'} />)
    await waitFor(() => expect(screen.getByTestId('carga').textContent).toBe('listo'))
    expect(voz.cargar).toHaveBeenCalledTimes(1)
  })

  it('tras el silencio largo se pausa ("¿Seguimos?"), suelta el micrófono y tocar Seguir reanuda', async () => {
    const { voz } = vozFalsa()
    render(<Prueba p={proveedores(voz)} preguntar={async () => 'ok'} pausaMs={900} />)
    nivel = 0.005
    await waitFor(() => expect(fase()).toBe('pausado'), { timeout: 3000 })
    expect(pista.stop).toHaveBeenCalled()
    const gum = navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    expect(gum).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Seguir' }))
    await waitFor(() => expect(fase()).toBe('escuchando'), { timeout: 3000 })
    expect(gum).toHaveBeenCalledTimes(2)
  }, 10_000)
})
