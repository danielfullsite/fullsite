// Chat del dashboard con voz: el botón de micrófono (nota de voz / dictado) y el de
// modo voz ("Habla con tu restaurante"), como en el composer de ChatGPT.
//
// La nota de voz NO se envía sola: el texto transcrito cae en el input para que el
// dueño lo revise y lo mande. Se simulan getUserMedia, MediaRecorder y fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ clientId: 'demo' }) }))
vi.mock('@/lib/data', () => ({ getActiveClientSlug: () => 'demo' }))

import ChatWidget from '@/components/ChatWidget'

// ── Micrófono falso ─────────────────────────────────────────────────────────────
const pista = { stop: vi.fn() }
const stream = { getTracks: () => [pista] } as unknown as MediaStream
const getUserMedia = vi.fn(async () => stream)

class GrabadorFalso {
  static isTypeSupported = (t: string) => t.startsWith('audio/webm')
  static creados: GrabadorFalso[] = []
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(_s: MediaStream, opciones?: { mimeType?: string }) {
    this.mimeType = opciones?.mimeType || 'audio/webm'
    GrabadorFalso.creados.push(this)
  }
  start() { this.state = 'recording' }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(1500).fill(3)], { type: this.mimeType }) })
    this.onstop?.()
  }
}

type Llamada = { url: string; init?: RequestInit }
let llamadas: Llamada[] = []
let textoTranscrito = '¿Cuánto vendimos hoy?'

beforeEach(() => {
  llamadas = []
  textoTranscrito = '¿Cuánto vendimos hoy?'
  pista.stop.mockClear()
  getUserMedia.mockReset()
  getUserMedia.mockImplementation(async () => stream)
  GrabadorFalso.creados = []
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  vi.stubGlobal('MediaRecorder', GrabadorFalso)
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ url: String(url), init })
    if (String(url) === '/api/transcribe') return new Response(JSON.stringify({ text: textoTranscrito }), { status: 200 })
    return new Response(JSON.stringify({ response: 'ok' }), { status: 200 })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function abrirChat() {
  render(<ChatWidget />)
  fireEvent.click(screen.getByRole('button', { name: 'Abrir chat con fullsite IA' }))
  return screen.getByRole('textbox', { name: 'Escribe tu pregunta' }) as HTMLInputElement
}

async function dictar() {
  fireEvent.click(screen.getByRole('button', { name: 'Dictar nota de voz' }))
  const terminar = await screen.findByRole('button', { name: 'Terminar y transcribir nota de voz' })
  await waitFor(() => expect((terminar as HTMLButtonElement).disabled).toBe(false))
  return terminar
}

describe('ChatWidget — botones de voz', () => {
  it('muestra el micrófono y el modo voz con etiquetas en español', () => {
    abrirChat()
    expect(screen.getByRole('button', { name: 'Dictar nota de voz' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Habla con tu restaurante (modo voz)' })).toBeTruthy()
  })

  it('con texto escrito, el botón redondo es Enviar (como ChatGPT)', () => {
    const input = abrirChat()
    fireEvent.change(input, { target: { value: 'hola' } })
    expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Habla con tu restaurante (modo voz)' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Dictar nota de voz' })).toBeTruthy()
  })
})

describe('ChatWidget — nota de voz', () => {
  it('grabar → terminar → el texto transcrito queda en el input (sin enviarse) y con foco', async () => {
    const input = abrirChat()
    const terminar = await dictar()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Descartar nota de voz' })).toBeTruthy()

    fireEvent.click(terminar)
    const campo = await screen.findByRole('textbox', { name: 'Escribe tu pregunta' }) as HTMLInputElement
    await waitFor(() => expect(campo.value).toBe('¿Cuánto vendimos hoy?'))

    // Se subió a /api/transcribe como webm, y NO se llamó al chat: el usuario revisa y envía.
    const subida = llamadas.find(l => l.url === '/api/transcribe')!
    expect(subida.init?.method).toBe('POST')
    expect(((subida.init?.body as FormData).get('audio') as File).name).toBe('nota.webm')
    expect(llamadas.some(l => l.url === '/api/chat')).toBe(false)
    // El micrófono se suelta al terminar.
    expect(pista.stop).toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(campo))
    void input
  })

  it('se agrega a lo que ya estaba escrito', async () => {
    const input = abrirChat()
    fireEvent.change(input, { target: { value: 'Oye  ' } })
    fireEvent.click(await dictar())
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Escribe tu pregunta' }) as HTMLInputElement).value)
      .toBe('Oye ¿Cuánto vendimos hoy?'))
  })

  it('descartar no transcribe nada y suelta el micrófono', async () => {
    const input = abrirChat()
    await dictar()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar nota de voz' }))
    await screen.findByRole('button', { name: 'Dictar nota de voz' })
    expect(llamadas.some(l => l.url === '/api/transcribe')).toBe(false)
    expect(pista.stop).toHaveBeenCalled()
    expect((screen.getByRole('textbox', { name: 'Escribe tu pregunta' }) as HTMLInputElement).value).toBe('')
    void input
  })

  it('permiso de micrófono negado → aviso amable en español', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    abrirChat()
    fireEvent.click(screen.getByRole('button', { name: 'Dictar nota de voz' }))
    const aviso = await screen.findByRole('alert')
    expect(aviso.textContent).toMatch(/permiso para usar el micrófono/)
  })

  it('el servidor sin transcripción configurada (503) → se muestra su mensaje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'El dictado por voz no está disponible: falta configurar la transcripción en el servidor.' }), { status: 503 })))
    abrirChat()
    fireEvent.click(await dictar())
    const aviso = await screen.findByRole('alert')
    expect(aviso.textContent).toMatch(/no está disponible/)
  })

  it('no se escuchó nada → aviso, input intacto', async () => {
    textoTranscrito = ''
    abrirChat()
    fireEvent.click(await dictar())
    const aviso = await screen.findByRole('alert')
    expect(aviso.textContent).toMatch(/No alcancé a escuchar/)
    expect((screen.getByRole('textbox', { name: 'Escribe tu pregunta' }) as HTMLInputElement).value).toBe('')
  })
})

describe('ChatWidget — modo voz', () => {
  it('abre "Habla con tu restaurante", pide el micrófono y al terminar lo suelta', async () => {
    abrirChat()
    fireEvent.click(screen.getByRole('button', { name: 'Habla con tu restaurante (modo voz)' }))
    const panel = await screen.findByRole('dialog', { name: 'Habla con tu restaurante' })
    expect(panel).toBeTruthy()
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
    await act(async () => { await new Promise(r => setTimeout(r, 400)) }) // calibración
    await waitFor(() => expect(screen.getByText('Escuchando')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button', { name: /Terminar conversación de voz/ })[0])
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Habla con tu restaurante' })).toBeNull())
    expect(pista.stop).toHaveBeenCalled()
  })
})
