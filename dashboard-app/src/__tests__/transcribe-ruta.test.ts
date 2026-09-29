// POST /api/transcribe — nota de voz → texto con Groq Whisper (gratis).
//
// Lo que no puede pasar: transcribir sin sesión (quema la cuota de Groq de todos),
// que un error de Groq se muestre como "error genérico" cuando es el límite gratuito,
// o que el audio / la transcripción terminen en los logs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let sesion: false | { staffId: string } = { staffId: 's-0' }
let contador = 0

vi.mock('@/lib/api-auth', () => ({
  requireTenant: async () => sesion
    ? { clientId: 'demo', staffId: sesion.staffId, staffName: 'x', role: 'dueno', authType: 'supabase_session' }
    : Response.json({ error: 'Se requiere sesión' }, { status: 401 }),
}))

import { POST } from '@/app/api/transcribe/route'
import { MAX_BYTES_AUDIO } from '@/lib/voz/audio'
import { MENSAJE_LIMITE_GROQ } from '@/lib/voz/transcripcion'

type Llamada = { url: string; init: RequestInit }
let llamadas: Llamada[] = []

function groqResponde(status: number, cuerpo: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    llamadas.push({ url: String(url), init })
    return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } })
  }))
}

function peticion(audio?: Blob | string, nombre = 'nota.webm', url = 'http://localhost/api/transcribe') {
  const form = new FormData()
  if (typeof audio === 'string') form.append('audio', audio)
  else if (audio) form.append('audio', audio, nombre)
  return new Request(url, { method: 'POST', body: form }) as unknown as import('next/server').NextRequest
}

const audioWebm = () => new Blob([new Uint8Array(2048).fill(7)], { type: 'audio/webm;codecs=opus' })

const logs: string[] = []
beforeEach(() => {
  contador++
  sesion = { staffId: `s-${contador}` } // límite por usuario: cada prueba con uno limpio (shuffle-safe)
  llamadas = []
  logs.length = 0
  process.env.GROQ_API_KEY = 'gsk_prueba'
  delete process.env.GROQ
  delete process.env.STT_MODEL
  for (const m of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('POST /api/transcribe', () => {
  it('sin sesión → 401 y no llama a Groq', async () => {
    sesion = false
    groqResponde(200, { text: 'hola' })
    const res = await POST(peticion(audioWebm()))
    expect(res.status).toBe(401)
    expect(llamadas).toHaveLength(0)
  })

  it('sin llave de Groq → 503 con mensaje en español para la UI', async () => {
    delete process.env.GROQ_API_KEY
    groqResponde(200, { text: 'hola' })
    const res = await POST(peticion(audioWebm()))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/no está disponible/)
    expect(llamadas).toHaveLength(0)
  })

  it('acepta la llave con el nombre corto GROQ (convención de lib/groq)', async () => {
    delete process.env.GROQ_API_KEY
    process.env.GROQ = 'gsk_corta'
    groqResponde(200, { text: 'hola' })
    const res = await POST(peticion(audioWebm()))
    expect(res.status).toBe(200)
    expect(new Headers(llamadas[0].init.headers).get('authorization')).toBe('Bearer gsk_corta')
  })

  it('sin audio o audio vacío → 400', async () => {
    groqResponde(200, { text: 'hola' })
    expect((await POST(peticion())).status).toBe(400)
    expect((await POST(peticion('no-soy-archivo'))).status).toBe(400)
    const vacio = await POST(peticion(new Blob([], { type: 'audio/webm' })))
    expect(vacio.status).toBe(400)
    expect((await vacio.json()).error).toMatch(/vacía/)
    expect(llamadas).toHaveLength(0)
  })

  it('más de 4 MB (2 min) → 413 sin llamar a Groq', async () => {
    groqResponde(200, { text: 'hola' })
    const grande = new Blob([new Uint8Array(MAX_BYTES_AUDIO + 1)], { type: 'audio/webm' })
    const res = await POST(peticion(grande))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toMatch(/2 minutos/)
    expect(llamadas).toHaveLength(0)
  })

  it('manda modelo, idioma es, json y el nombre con la extensión correcta; devuelve { text }', async () => {
    groqResponde(200, { text: '  ¿Cuánto vendimos hoy?  ' })
    const res = await POST(peticion(audioWebm()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: '¿Cuánto vendimos hoy?' })

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(llamadas[0].init.method).toBe('POST')
    const cuerpo = llamadas[0].init.body as FormData
    expect(cuerpo.get('model')).toBe('whisper-large-v3-turbo')
    expect(cuerpo.get('language')).toBe('es')
    expect(cuerpo.get('response_format')).toBe('json')
    expect((cuerpo.get('file') as File).name).toBe('nota.webm')
  })

  it('STT_MODEL cambia el modelo; audio de Safari (mp4) viaja como .mp4', async () => {
    process.env.STT_MODEL = 'whisper-large-v3'
    groqResponde(200, { text: 'hola' })
    await POST(peticion(new Blob([new Uint8Array(100)], { type: 'audio/mp4' }), 'nota.mp4'))
    const cuerpo = llamadas[0].init.body as FormData
    expect(cuerpo.get('model')).toBe('whisper-large-v3')
    expect((cuerpo.get('file') as File).name).toBe('nota.mp4')
  })

  it('Groq 429 → 429 "límite gratuito alcanzado"', async () => {
    groqResponde(429, { error: { message: 'Rate limit reached' } })
    const res = await POST(peticion(audioWebm()))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe(MENSAJE_LIMITE_GROQ)
    expect(MENSAJE_LIMITE_GROQ).toMatch(/límite gratuito alcanzado, intenta en unos minutos/i)
  })

  it('Groq 401 (llave mala) → 503; Groq 500 → 502', async () => {
    groqResponde(401, {})
    expect((await POST(peticion(audioWebm()))).status).toBe(503)
    groqResponde(500, {})
    expect((await POST(peticion(audioWebm()))).status).toBe(502)
  })

  it('silencio que Whisper "oye" como subtítulos → text vacío', async () => {
    groqResponde(200, { text: 'Subtítulos realizados por la comunidad de Amara.org' })
    expect(await (await POST(peticion(audioWebm()))).json()).toEqual({ text: '' })
  })

  it('límite por usuario: la nota 21 del mismo minuto → 429 sin llamar a Groq', async () => {
    groqResponde(200, { text: 'hola' })
    for (let i = 0; i < 20; i++) expect((await POST(peticion(audioWebm()))).status).toBe(200)
    const n = llamadas.length
    const res = await POST(peticion(audioWebm()))
    expect(res.status).toBe(429)
    expect(llamadas).toHaveLength(n)
  })

  it('nunca loguea la transcripción', async () => {
    groqResponde(200, { text: 'la contraseña del wifi es tacos123' })
    await POST(peticion(audioWebm()))
    groqResponde(429, { error: { message: 'tacos123' } })
    await POST(peticion(audioWebm()))
    expect(logs.join('\n')).not.toMatch(/tacos123|contraseña/)
  })

  it('el tope es 4 MB (Vercel corta cuerpos de ~4.5 MB antes de llegar a la ruta)', () => {
    expect(MAX_BYTES_AUDIO).toBe(4 * 1024 * 1024)
  })

  it('SIN Content-Length (chunked): cuenta bytes del stream y corta con 413 al pasar el tope', async () => {
    groqResponde(200, { text: 'hola' })
    let enviados = 0
    const trozo = new Uint8Array(512 * 1024)
    const cuerpo = new ReadableStream<Uint8Array>({
      pull(c) { if (enviados > 40 * 1024 * 1024) { c.close(); return } enviados += trozo.byteLength; c.enqueue(trozo) },
    })
    const req = new Request('http://localhost/api/transcribe', {
      method: 'POST', body: cuerpo, headers: { 'content-type': 'multipart/form-data; boundary=x' }, duplex: 'half',
    } as RequestInit)
    expect(req.headers.get('content-length')).toBeNull()
    const res = await POST(req as unknown as import('next/server').NextRequest)
    expect(res.status).toBe(413)
    expect(enviados).toBeLessThan(MAX_BYTES_AUDIO + 2 * 1024 * 1024) // no leyó los 40 MB
    expect(llamadas).toHaveLength(0)
  })

  it('modo voz (?modo=voz): hasta 30 por minuto; el dictado sigue en 20 (contadores aparte)', async () => {
    groqResponde(200, { text: 'hola' })
    const voz = () => POST(peticion(audioWebm(), 'nota.webm', 'http://localhost/api/transcribe?modo=voz'))
    for (let i = 0; i < 30; i++) expect((await voz()).status).toBe(200)
    expect((await voz()).status).toBe(429)
    expect((await POST(peticion(audioWebm()))).status).toBe(200)
  })
})

describe('cliente: transcribirAudio', () => {
  it('rechaza ANTES de subir un audio de más de 4 MB, con mensaje en español', async () => {
    const { transcribirAudio } = await import('@/lib/voz/microfono')
    const { MENSAJE_AUDIO_GRANDE } = await import('@/lib/voz/audio')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(transcribirAudio(new Blob([new Uint8Array(MAX_BYTES_AUDIO + 1)]), 'audio/webm')).rejects.toThrow(MENSAJE_AUDIO_GRANDE)
    expect(f).not.toHaveBeenCalled()
    expect(MENSAJE_AUDIO_GRANDE).toMatch(/demasiado grande.*4 MB/)
  })

  it('modo voz → /api/transcribe?modo=voz', async () => {
    const { transcribirAudio } = await import('@/lib/voz/microfono')
    const f = vi.fn(async () => new Response(JSON.stringify({ text: 'hola' }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    expect(await transcribirAudio(audioWebm(), 'audio/webm', undefined, { modo: 'voz' })).toBe('hola')
    expect((f.mock.calls[0] as unknown[])[0]).toBe('/api/transcribe?modo=voz')
  })
})
