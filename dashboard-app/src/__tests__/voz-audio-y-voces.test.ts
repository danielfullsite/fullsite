// Piezas puras del chat de voz: formato de grabación, nivel del micrófono, mensajes de
// error del micrófono, elección de la voz del navegador y selección de proveedor.
import { describe, it, expect } from 'vitest'
import {
  elegirMimeType, extensionDeMime, formatoDuracion, mensajeErrorMicrofono, nivelVisual, rmsDeBytes,
} from '@/lib/voz/audio'
import { elegirVoz, puntajeCalidad, rangoRegion, type VozDisponible } from '@/lib/voz/voces'
import { nombreProveedor, PROVEEDOR_POR_DEFECTO } from '@/lib/voz/proveedores'

describe('elegirMimeType', () => {
  it('Chrome: webm/opus', () => {
    expect(elegirMimeType(t => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
  })
  it('Safari iOS: no graba webm → audio/mp4', () => {
    expect(elegirMimeType(t => t === 'audio/mp4' || t === 'audio/aac')).toBe('audio/mp4')
  })
  it('nada soportado o sin isTypeSupported → "" (el navegador decide)', () => {
    expect(elegirMimeType(() => false)).toBe('')
    expect(elegirMimeType(undefined)).toBe('')
    expect(elegirMimeType(null)).toBe('')
  })
  it('un navegador que truena con un tipo raro no rompe la elección', () => {
    expect(elegirMimeType(t => { if (t.includes('webm')) throw new Error('x'); return t === 'audio/mp4' })).toBe('audio/mp4')
  })
})

describe('extensionDeMime (Groq decide el decodificador por la extensión)', () => {
  it.each([
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/mp4', 'mp4'],
    ['audio/aac', 'm4a'],
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/mpeg', 'mp3'],
    ['audio/wav', 'wav'],
    ['', 'webm'],
    [null, 'webm'],
  ])('%s → %s', (mime, ext) => {
    expect(extensionDeMime(mime)).toBe(ext)
  })
})

describe('nivel del micrófono', () => {
  it('silencio (todo 128) = 0; onda llena ≈ 1', () => {
    expect(rmsDeBytes(new Uint8Array(512).fill(128))).toBe(0)
    const cuadrada = Uint8Array.from({ length: 512 }, (_, i) => (i % 2 ? 0 : 255))
    expect(rmsDeBytes(cuadrada)).toBeGreaterThan(0.99)
    expect(rmsDeBytes([])).toBe(0)
  })
  it('nivelVisual acotado a 0‥1 y robusto', () => {
    expect(nivelVisual(0)).toBe(0)
    expect(nivelVisual(Number.NaN)).toBe(0)
    expect(nivelVisual(5)).toBe(1)
    expect(nivelVisual(0.05)).toBeGreaterThan(0.3)
  })
  it('formatoDuracion', () => {
    expect(formatoDuracion(7.9)).toBe('0:07')
    expect(formatoDuracion(102)).toBe('1:42')
    expect(formatoDuracion(-3)).toBe('0:00')
  })
})

describe('mensajeErrorMicrofono', () => {
  it('permiso negado → cómo activarlo, en español', () => {
    expect(mensajeErrorMicrofono({ name: 'NotAllowedError' })).toMatch(/permiso/i)
  })
  it('sin micrófono / ocupado / no soportado / desconocido', () => {
    expect(mensajeErrorMicrofono({ name: 'NotFoundError' })).toMatch(/No encontré un micrófono/)
    expect(mensajeErrorMicrofono({ name: 'NotReadableError' })).toMatch(/ocupado/)
    expect(mensajeErrorMicrofono({ name: 'NoSoportado' })).toMatch(/navegador/)
    expect(mensajeErrorMicrofono('x')).toMatch(/No pude usar el micrófono/)
  })
})

describe('elegirVoz', () => {
  const v = (name: string, lang: string, localService = true): VozDisponible => ({ name, lang, localService })

  it('prefiere es-MX sobre es-US, es-ES y otros', () => {
    const voces = [v('Monica', 'es-ES'), v('Paulina', 'es-MX'), v('Google español de Estados Unidos', 'es-US', false), v('Samantha', 'en-US')]
    expect(elegirVoz(voces)?.name).toBe('Paulina')
  })

  it('sin es-MX: es-US, luego es-ES, luego cualquier es-*', () => {
    expect(elegirVoz([v('Monica', 'es-ES'), v('X', 'es-US')])?.name).toBe('X')
    expect(elegirVoz([v('Monica', 'es-ES'), v('Y', 'es-AR')])?.name).toBe('Monica')
    expect(elegirVoz([v('Y', 'es-AR'), v('Samantha', 'en-US')])?.name).toBe('Y')
  })

  it('dentro de la región, la de mejor calidad (Premium/Enhanced/Natural/Google/en línea)', () => {
    const voces = [v('Paulina', 'es-MX'), v('Paulina (Mejorada)', 'es-MX'), v('Microsoft Dalia Online (Natural) - Spanish (Mexico)', 'es-MX', false)]
    expect(elegirVoz(voces)?.name).toBe('Microsoft Dalia Online (Natural) - Spanish (Mexico)')
    expect(elegirVoz([v('Paulina', 'es-MX'), v('Google español', 'es_MX', false)])?.name).toBe('Google español')
  })

  it('evita voces "de broma" de Apple aunque existan en es-MX', () => {
    expect(elegirVoz([v('Grandma (Spanish (Mexico))', 'es-MX'), v('Paulina', 'es-MX')])?.name).toBe('Paulina')
  })

  it('sin voces en español → null (el texto sigue en pantalla)', () => {
    expect(elegirVoz([v('Samantha', 'en-US')])).toBeNull()
    expect(elegirVoz([])).toBeNull()
    expect(elegirVoz(undefined)).toBeNull()
  })

  it('rangoRegion / puntajeCalidad', () => {
    expect(rangoRegion('es-419')).toBe(2)
    expect(rangoRegion('ES_mx')).toBe(3)
    expect(rangoRegion('en-US')).toBe(-1)
    expect(rangoRegion('eu-ES')).toBe(-1) // euskera no es español
    expect(puntajeCalidad(v('Paulina (Premium)', 'es-MX'))).toBeGreaterThan(puntajeCalidad(v('Paulina', 'es-MX')))
  })
})

describe('proveedores de voz', () => {
  it('sin variable o con un nombre desconocido: el gratis', () => {
    expect(nombreProveedor(undefined)).toBe(PROVEEDOR_POR_DEFECTO)
    expect(nombreProveedor('')).toBe('gratis')
    expect(nombreProveedor('openai-realtime')).toBe('gratis')
    expect(nombreProveedor(' GRATIS ')).toBe('gratis')
  })
})
