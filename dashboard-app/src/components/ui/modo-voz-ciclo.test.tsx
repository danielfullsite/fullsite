// Ciclo completo del modo voz, con el nivel del micrófono guionado:
//   silencio → habla → silencio ⇒ transcribe ⇒ /api/chat {modo:'voz'} ⇒ habla ⇒ escucha
// y lo dicho queda como texto en el historial del chat.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ clientId: 'demo' }) }))
vi.mock('@/lib/data', () => ({ getActiveClientSlug: () => 'demo' }))

// El único cambio al micrófono real: el nivel (RMS) lo decide la prueba.
let nivel = 0
vi.mock('@/lib/voz/microfono', async (orig) => ({
  ...(await orig<typeof import('@/lib/voz/microfono')>()),
  audioContextCompartido: () => null,
  crearMedidor: () => ({ leer: () => nivel, cerrar: () => {} }),
}))

import ChatWidget from '@/components/ChatWidget'

const pista = { stop: vi.fn() }
const stream = { getTracks: () => [pista] } as unknown as MediaStream

class GrabadorFalso {
  /** Simula un navegador que entrega un trozo TARDE, después de onstop. */
  static tardio = false
  static isTypeSupported = (t: string) => t.startsWith('audio/webm')
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(900)], { type: this.mimeType }) })
    setTimeout(() => this.onstop?.(), 0)
    if (GrabadorFalso.tardio) setTimeout(() => this.ondataavailable?.({ data: new Blob([new Uint8Array(7777)], { type: this.mimeType }) }), 400)
  }
}

// speechSynthesis falso: "habla" `duracionHabla` ms por trozo.
const dichos: string[] = []
let duracionHabla = 30
class Enunciado {
  text: string; lang = ''; voice: unknown = null; rate = 1; pitch = 1; volume = 1
  onend: (() => void) | null = null; onerror: (() => void) | null = null
  constructor(t: string) { this.text = t }
}
const sintesis = {
  paused: false,
  speak: vi.fn((u: Enunciado) => { if (u.text.trim()) dichos.push(u.text); setTimeout(() => u.onend?.(), duracionHabla) }),
  cancel: vi.fn(),
  resume: vi.fn(),
  getVoices: () => [{ name: 'Paulina', lang: 'es-MX', localService: true }],
  addEventListener: vi.fn(),
}

let transcripciones: string[] = []
const tamanosAudio: number[] = []
let respuestaTexto = ''
const urlsTranscribe: string[] = []
let cuerposChat: Record<string, unknown>[] = []

beforeEach(() => {
  nivel = 0
  duracionHabla = 30
  GrabadorFalso.tardio = false
  tamanosAudio.length = 0
  urlsTranscribe.length = 0
  respuestaTexto = ''
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (X11; Linux x86_64) jsdom' })
  dichos.length = 0
  cuerposChat = []
  pista.stop.mockClear()
  sintesis.speak.mockClear()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } })
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: sintesis })
  vi.stubGlobal('SpeechSynthesisUtterance', Enunciado)
  vi.stubGlobal('MediaRecorder', GrabadorFalso)
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/transcribe')) {
      urlsTranscribe.push(String(url))
      const a = (init?.body as FormData | undefined)?.get?.('audio')
      if (a && typeof a !== 'string') tamanosAudio.push(a.size)
      return new Response(JSON.stringify({ text: transcripciones.shift() ?? '' }), { status: 200 }) }
    if (String(url) === '/api/chat') {
      const cuerpo = JSON.parse(String(init?.body))
      cuerposChat.push(cuerpo)
      if (cuerpo.modo !== 'voz' && respuestaTexto) return new Response(JSON.stringify({ response: respuestaTexto }), { status: 200 })
      return new Response(JSON.stringify({ response: 'Hoy llevas **$12,533** 🚀. [Ver ventas →](/ventas)' }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Silencio para calibrar, voz 900 ms (el mínimo son 600 ms CON voz), silencio hasta que el VAD cierre. */
async function decirAlgo() {
  nivel = 0.005
  await esperar(450)
  nivel = 0.3
  await esperar(900)
  nivel = 0.005
}

function abrirModoVoz() {
  render(<ChatWidget />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir chat con fullsite IA' }))
  fireEvent.click(screen.getByRole('button', { name: 'Habla con tu restaurante (modo voz)' }))
}

describe('modo voz — un turno completo', () => {
  it('escucha → transcribe → pregunta al MISMO chat con modo voz → lo dice limpio → vuelve a escuchar', async () => {
    transcripciones = ['¿Cuánto vendimos hoy?']
    abrirModoVoz()
    // iOS: se "preparó" la voz dentro del toque (enunciado vacío).
    expect(sintesis.speak).toHaveBeenCalled()

    await decirAlgo()
    await waitFor(() => expect(cuerposChat).toHaveLength(1), { timeout: 3000 })
    expect(cuerposChat[0]).toMatchObject({ message: '¿Cuánto vendimos hoy?', modo: 'voz', client_id: 'demo' })

    await waitFor(() => expect(dichos.join(' ')).toContain('doce mil quinientos treinta y tres pesos'), { timeout: 2000 })
    expect(dichos.join(' ')).not.toMatch(/[*🚀→]|Ver ventas|\/ventas/)
    await waitFor(() => expect(screen.getByText('Escuchando')).toBeTruthy(), { timeout: 2000 })

    // Al cerrar, la conversación queda en el chat como texto.
    fireEvent.click(screen.getAllByRole('button', { name: /Terminar conversación de voz/ })[0])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('¿Cuánto vendimos hoy?')).toBeTruthy()
    expect(screen.getByText(/Hoy llevas/)).toBeTruthy()
    expect(pista.stop).toHaveBeenCalled()
  }, 10_000)

  it('si la transcripción sale vacía (ruido), vuelve a escuchar SIN llamar al chat', async () => {
    transcripciones = ['']
    abrirModoVoz()
    await decirAlgo()
    await esperar(1600)
    await waitFor(() => expect(screen.getByText('Escuchando')).toBeTruthy())
    expect(cuerposChat).toHaveLength(0)
  }, 10_000)

  it('tocar mientras habla la interrumpe y vuelve a escuchar', async () => {
    transcripciones = ['¿Quién es mi mejor mesero?']
    duracionHabla = 5000
    abrirModoVoz()
    await decirAlgo()
    const circulo = await screen.findByRole('button', { name: 'Interrumpir respuesta' }, { timeout: 3000 })
    expect(screen.getByText('Hablando')).toBeTruthy()
    sintesis.cancel.mockClear()
    fireEvent.click(circulo)
    expect(sintesis.cancel).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Escuchando')).toBeTruthy())
  }, 10_000)
})

describe('modo voz — plática continua', () => {
  it('cada pregunta de voz manda el historial de la plática (usuario/asistente) para que "¿y ayer?" se entienda', async () => {
    transcripciones = ['¿Cuánto vendimos hoy?', '¿Y ayer?']
    abrirModoVoz()
    await decirAlgo()
    await waitFor(() => expect(cuerposChat).toHaveLength(1), { timeout: 3000 })
    expect(cuerposChat[0].history).toEqual([])
    await waitFor(() => expect(screen.getByText('Escuchando')).toBeTruthy(), { timeout: 3000 })
    await decirAlgo()
    await waitFor(() => expect(cuerposChat).toHaveLength(2), { timeout: 4000 })
    expect(cuerposChat[1]).toMatchObject({ message: '¿Y ayer?', modo: 'voz' })
    expect(cuerposChat[1].history).toEqual([
      { role: 'user', content: '¿Cuánto vendimos hoy?' },
      { role: 'assistant', content: 'Hoy llevas **$12,533** 🚀. [Ver ventas →](/ventas)' },
    ])
  }, 15_000)
})

describe('modo voz — robustez', () => {
  it('la transcripción del modo voz va con ?modo=voz (límite propio en el servidor)', async () => {
    transcripciones = ['¿Cuánto vendimos hoy?']
    abrirModoVoz()
    await decirAlgo()
    await waitFor(() => expect(cuerposChat).toHaveLength(1), { timeout: 3000 })
    expect(urlsTranscribe[0]).toBe('/api/transcribe?modo=voz')
  }, 10_000)

  it('un trozo TARDÍO del grabador anterior no se cuela en el siguiente enunciado', async () => {
    GrabadorFalso.tardio = true
    transcripciones = ['primera', 'segunda']
    abrirModoVoz()
    await decirAlgo()
    await waitFor(() => expect(cuerposChat).toHaveLength(1), { timeout: 3000 })
    await waitFor(() => expect(screen.getByText('Escuchando')).toBeTruthy(), { timeout: 3000 })
    await decirAlgo()
    await waitFor(() => expect(tamanosAudio).toHaveLength(2), { timeout: 4000 })
    expect(tamanosAudio).toEqual([900, 900])
  }, 15_000)

  it('iOS: suelta el micrófono mientras habla (la voz sale por la bocina) y lo vuelve a abrir al escuchar', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' })
    transcripciones = ['¿Cuánto vendimos hoy?']
    duracionHabla = 400
    abrirModoVoz()
    const gum = navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>
    await decirAlgo()
    await screen.findByText('Hablando', undefined, { timeout: 3000 })
    expect(pista.stop).toHaveBeenCalled() // micrófono suelto durante la respuesta
    expect(gum).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText('Escuchando')).toBeTruthy(), { timeout: 3000 })
    expect(gum).toHaveBeenCalledTimes(2) // se volvió a abrir para escuchar
  }, 10_000)

  it('iOS: tocar mientras habla interrumpe y vuelve a abrir el micrófono', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' })
    transcripciones = ['¿Quién es mi mejor mesero?']
    duracionHabla = 5000
    abrirModoVoz()
    await decirAlgo()
    const circulo = await screen.findByRole('button', { name: 'Interrumpir respuesta' }, { timeout: 3000 })
    fireEvent.click(circulo)
    await waitFor(() => expect(screen.getByText('Escuchando')).toBeTruthy())
    expect((navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('la máquina de escribir del chat escrito no pisa una respuesta de voz que llegó mientras tanto', async () => {
    respuestaTexto = `Respuesta larga del chat escrito. ${'Detalle de ventas. '.repeat(70)}FIN-DEL-TEXTO`
    transcripciones = ['¿Cuánto vendimos hoy?']
    render(<ChatWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat con fullsite IA' }))
    const input = screen.getByRole('textbox', { name: 'Escribe tu pregunta' })
    fireEvent.change(input, { target: { value: 'dame el resumen' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(cuerposChat).toHaveLength(1))
    await esperar(50) // ya está escribiendo
    fireEvent.click(screen.getByRole('button', { name: 'Habla con tu restaurante (modo voz)' }))
    await decirAlgo()
    await waitFor(() => expect(cuerposChat).toHaveLength(2), { timeout: 3000 })
    await waitFor(() => expect(screen.getByText('Escuchando')).toBeTruthy(), { timeout: 3000 })
    fireEvent.click(screen.getAllByRole('button', { name: /Terminar conversación de voz/ })[0])
    await waitFor(() => expect(screen.getByText(/FIN-DEL-TEXTO/)).toBeTruthy(), { timeout: 10_000 })
    // Las dos respuestas siguen ahí, cada una en su burbuja.
    expect(screen.getByText(/Hoy llevas/)).toBeTruthy()
    expect(screen.getAllByText(/FIN-DEL-TEXTO/)).toHaveLength(1)
    expect(screen.getByText('¿Cuánto vendimos hoy?')).toBeTruthy()
  }, 20_000)
})
