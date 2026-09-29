// Voz natural (Piper) con respaldo automático a speechSynthesis: qué motor se elige,
// y que el dueño SIEMPRE oiga la respuesta aunque la voz natural falle o sea lenta.
import { describe, it, expect, vi } from 'vitest'
import {
  convienePrecargar, elegirMotor, leerHistorial, marcarModelo, MODELOS_PIPER, type EntornoVoz, type HistorialMotor,
} from '@/lib/voz/motor-voz'
import { ACUSES, crearVozNatural, siguienteAcuse } from '@/lib/voz/voz-natural'
import type { EstadoCargaVoz, ProveedorVoz } from '@/lib/voz/proveedores'
import { frasesParaHablar } from '@/lib/voz/texto-hablado'

const OK: EntornoVoz = { tieneWasm: true, tieneWorker: true, tieneAudioContext: true, memoriaGb: 8 }
const DIA = 86_400_000

describe('elegirMotor', () => {
  it('con todo disponible: Piper, es_MX-claude-high primero y es_MX-ald-medium de respaldo', () => {
    const d = elegirMotor(OK)
    expect(d.motor).toBe('piper')
    if (d.motor === 'piper') expect(d.modelos.map(m => m.id)).toEqual(['es_MX-claude-high', 'es_MX-ald-medium'])
  })

  it('sin WebAssembly, Worker o AudioContext → navegador', () => {
    for (const falta of ['tieneWasm', 'tieneWorker', 'tieneAudioContext'] as const) {
      expect(elegirMotor({ ...OK, [falta]: false })).toEqual({ motor: 'navegador', razon: 'sin-wasm' })
    }
  })

  it('poca memoria (< 4 GB) → navegador; sin dato de memoria (Safari) se intenta', () => {
    expect(elegirMotor({ ...OK, memoriaGb: 2 })).toEqual({ motor: 'navegador', razon: 'poca-memoria' })
    expect(elegirMotor({ ...OK, memoriaGb: undefined }).motor).toBe('piper')
  })

  it('NEXT_PUBLIC_VOZ_MOTOR=navegador lo apaga sin tocar código', () => {
    expect(elegirMotor({ ...OK, forzado: ' Navegador ' })).toEqual({ motor: 'navegador', razon: 'forzado' })
  })

  it('un modelo "lento" en este equipo se salta 30 días; si todos son lentos → navegador sin descargar', () => {
    const ahora = 100 * DIA
    let h: HistorialMotor = marcarModelo({}, 'es_MX-claude-high', 'lento', ahora - DIA)
    const d = elegirMotor(OK, h, ahora)
    expect(d.motor === 'piper' && d.modelos.map(m => m.id)).toEqual(['es_MX-ald-medium'])
    h = marcarModelo(h, 'es_MX-ald-medium', 'lento', ahora - DIA)
    expect(elegirMotor(OK, h, ahora)).toEqual({ motor: 'navegador', razon: 'lento' })
    // Pasados 30 días se vuelve a intentar.
    expect(elegirMotor(OK, h, ahora + 31 * DIA).motor).toBe('piper')
  })

  it('un modelo que falló se salta 1 día', () => {
    const ahora = 10 * DIA
    const h = marcarModelo(marcarModelo({}, 'es_MX-claude-high', 'fallo', ahora), 'es_MX-ald-medium', 'fallo', ahora)
    expect(elegirMotor(OK, h, ahora + 1000)).toEqual({ motor: 'navegador', razon: 'fallo' })
    expect(elegirMotor(OK, h, ahora + 2 * DIA).motor).toBe('piper')
  })

  it('historial basura en localStorage = vacío', () => {
    expect(leerHistorial('{no json')).toEqual({})
    expect(leerHistorial('[1,2]')).toEqual({})
    expect(leerHistorial(JSON.stringify({ a: { lento: 'x', fallo: 5 } }))).toEqual({ a: { fallo: 5 } })
  })

  it('los modelos declaran su tamaño real (~63 MB) para validar la descarga', () => {
    for (const m of MODELOS_PIPER) {
      expect(m.bytesOnnx).toBeGreaterThan(60_000_000)
      expect(m.ruta.endsWith(`${m.id}.onnx`)).toBe(true)
    }
  })
})

describe('convienePrecargar (al abrir el chat)', () => {
  it('escritorio o Wi-Fi sí; celular, ahorro de datos o red lenta no', () => {
    expect(convienePrecargar({ esMovil: false })).toBe(true)
    expect(convienePrecargar({ esMovil: true, tipoConexion: 'wifi' })).toBe(true)
    expect(convienePrecargar({ esMovil: true })).toBe(false)
    expect(convienePrecargar({ esMovil: false, tipoConexion: 'cellular' })).toBe(false)
    expect(convienePrecargar({ esMovil: false, saveData: true })).toBe(false)
    expect(convienePrecargar({ esMovil: false, conexionEfectiva: '3g' })).toBe(false)
  })
})

// ── Proveedor híbrido ────────────────────────────────────────────────────────

function navegadorFalso() {
  const dichos: { texto: string; desde?: number }[] = []
  const nav: ProveedorVoz = {
    nombre: 'navegador-falso',
    disponible: () => true,
    preparar: vi.fn(),
    hablar: vi.fn(async (texto: string, _s?: AbortSignal, o?: { desdeFrase?: number }) => { dichos.push({ texto, desde: o?.desdeFrase }) }),
    callar: vi.fn(),
  }
  return { nav, dichos }
}

type AudioFalso = { texto: string }

function moduloPiperFalso(opciones: {
  cargar?: () => Promise<string>
  sintetizar?: (texto: string) => Promise<AudioFalso>
} = {}) {
  const sonados: string[] = []
  const sintetizados: string[] = []
  const motor = {
    cargar: vi.fn(async (_m: unknown, alProgreso?: (p: { fase: 'descargando' | 'iniciando'; cargado?: number; total?: number }) => void) => {
      alProgreso?.({ fase: 'descargando', cargado: 30, total: 100 })
      alProgreso?.({ fase: 'iniciando' })
      return opciones.cargar ? opciones.cargar() : 'es_MX-claude-high'
    }),
    sintetizar: vi.fn(async (texto: string) => {
      sintetizados.push(texto)
      return opciones.sintetizar ? opciones.sintetizar(texto) : { texto }
    }),
    cancelarPendientes: vi.fn(),
    cerrar: vi.fn(),
  }
  const reproductor = {
    reproducir: vi.fn(async (b: AudioFalso) => { sonados.push(b.texto) }),
    detener: vi.fn(),
    nivel: vi.fn(() => 0.12),
  }
  const mod = {
    leerRutasMotor: vi.fn(async () => ({ piper: '/voz/a.js', ortPrefijo: '/voz/o/', piperWasm: '/voz/p.wasm', piperData: '/voz/p.data', worker: '/voz/w.js' })),
    crearMotorPiper: vi.fn(() => motor),
    crearReproductor: vi.fn(() => reproductor),
  }
  return { mod, motor, reproductor, sonados, sintetizados }
}

function armar(opciones: { mod?: ReturnType<typeof moduloPiperFalso>; entorno?: EntornoVoz; limitePrimeraMs?: number } = {}) {
  const { nav, dichos } = navegadorFalso()
  const pf = opciones.mod ?? moduloPiperFalso()
  let historial: HistorialMotor = {}
  const estados: EstadoCargaVoz[] = []
  const voz = crearVozNatural({
    navegador: nav,
    entorno: () => opciones.entorno ?? OK,
    historial: { leer: () => historial, guardar: h => { historial = h } },
    importar: async () => pf.mod as never,
    contexto: () => ({}) as AudioContext,
    limitePrimeraMs: opciones.limitePrimeraMs,
  })
  return { voz, nav, dichos, pf, estados, historial: () => historial, cargar: () => voz.cargar!(e => estados.push(e)) }
}

const RESPUESTA = 'Hoy llevas $12,533. Vas 8% arriba del lunes pasado. ¿Quieres verlo por mesero?'

describe('crearVozNatural — Piper', () => {
  it('carga: descargando → iniciando → listo; calienta el modelo y pre-sintetiza los acuses', async () => {
    const a = armar()
    await a.cargar()
    expect(a.estados.map(e => e.estado)).toEqual(['descargando', 'descargando', 'iniciando', 'listo'])
    expect(a.voz.motorActivo()).toBe('piper:es_MX-claude-high')
    expect(a.voz.permiteInterrupcionPorVoz!()).toBe(true)
    expect(a.voz.nivelSalida!()).toBe(0.12)
    await Promise.resolve()
    expect(a.pf.sintetizados[0]).toBe('Listo.')
    expect(a.pf.sintetizados.length).toBe(1 + ACUSES.length)
  })

  it('habla por frases con los números dichos, reporta cada frase y NO usa la voz del navegador', async () => {
    const a = armar()
    await a.cargar()
    const frases: number[] = []
    await a.voz.hablar(RESPUESTA, undefined, { alFrase: i => frases.push(i) })
    const esperadas = frasesParaHablar(RESPUESTA).map(f => f.hablar)
    expect(a.pf.sonados).toEqual(esperadas)
    expect(a.pf.sonados[0]).toContain('doce mil quinientos treinta y tres pesos')
    expect(frases).toEqual(esperadas.map((_, i) => i))
    expect(a.dichos).toEqual([])
  })

  it('mientras la voz natural se descarga, contesta el respaldo (nunca se espera)', async () => {
    let terminar!: (m: string) => void
    const a = armar({ mod: moduloPiperFalso({ cargar: () => new Promise(r => { terminar = r }) }) })
    const carga = a.cargar()
    await a.voz.hablar('Hola.')
    expect(a.dichos.map(d => d.texto)).toEqual(['Hola.'])
    expect(a.voz.motorActivo()).toBe('cargando')
    terminar('es_MX-claude-high')
    await carga
    expect(a.voz.motorActivo()).toBe('piper:es_MX-claude-high')
  })

  it('los acuses se sintetizan una vez y se reusan (cachear)', async () => {
    const a = armar()
    await a.cargar()
    await new Promise(r => setTimeout(r, 0))
    const antes = a.pf.motor.sintetizar.mock.calls.length
    await a.voz.hablar(siguienteAcuse(-1).texto, undefined, { cachear: true })
    await a.voz.hablar(siguienteAcuse(-1).texto, undefined, { cachear: true })
    expect(a.pf.motor.sintetizar.mock.calls.length).toBe(antes)
    expect(a.pf.sonados).toHaveLength(2)
  })
})

describe('crearVozNatural — respaldo automático', () => {
  it('sin WebAssembly: ni siquiera importa el motor', async () => {
    const a = armar({ entorno: { ...OK, tieneWasm: false } })
    await a.cargar()
    expect(a.pf.mod.crearMotorPiper).not.toHaveBeenCalled()
    expect(a.estados.at(-1)).toEqual({ estado: 'respaldo', razon: 'sin-wasm' })
    await a.voz.hablar(RESPUESTA)
    expect(a.dichos.map(d => d.texto)).toEqual([RESPUESTA])
    expect(a.voz.permiteInterrupcionPorVoz!()).toBe(false)
    expect(a.voz.nivelSalida!()).toBeNull()
  })

  it('descarga fallida (ningún modelo) → respaldo "fallo" y el dueño oye la respuesta', async () => {
    const a = armar({ mod: moduloPiperFalso({ cargar: () => Promise.reject(new Error('descarga 403')) }) })
    await a.cargar()
    expect(a.estados.at(-1)).toEqual({ estado: 'respaldo', razon: 'fallo' })
    expect(a.pf.motor.cerrar).toHaveBeenCalled()
    await a.voz.hablar(RESPUESTA)
    expect(a.dichos).toHaveLength(1)
  })

  it('primera frase lenta (> tope) → respaldo por la sesión, repite DESDE la frase 0 y marca el modelo "lento"', async () => {
    const a = armar({
      limitePrimeraMs: 30,
      mod: moduloPiperFalso({ sintetizar: t => (t === 'Listo.' || ACUSES.some(x => t.startsWith(x.slice(0, 5))) ? Promise.resolve({ texto: t }) : new Promise(r => setTimeout(() => r({ texto: t }), 200))) }),
    })
    await a.cargar()
    await a.voz.hablar(RESPUESTA)
    expect(a.pf.sonados.filter(t => !t.startsWith('Listo'))).toEqual([])
    expect(a.dichos).toEqual([{ texto: RESPUESTA, desde: 0 }])
    expect(a.voz.motorActivo()).toBe('navegador')
    expect(a.estados.at(-1)).toEqual({ estado: 'respaldo', razon: 'lento' })
    expect(a.historial()['es_MX-claude-high']?.lento).toBeTypeOf('number')
    // La siguiente respuesta ya va directo al respaldo.
    await a.voz.hablar('Otra.')
    expect(a.dichos.at(-1)?.texto).toBe('Otra.')
  })

  it('síntesis que truena a media respuesta → el respaldo sigue DESDE esa frase', async () => {
    let n = 0
    const a = armar({
      mod: moduloPiperFalso({ sintetizar: t => (t === 'Listo.' || !t.includes('lunes') ? Promise.resolve({ texto: t }) : (n++, Promise.reject(new Error('wasm')))) }),
    })
    await a.cargar()
    await a.voz.hablar(RESPUESTA)
    expect(n).toBe(1)
    expect(a.pf.sonados.some(t => t.includes('doce mil'))).toBe(true)
    expect(a.dichos).toEqual([{ texto: RESPUESTA, desde: 1 }])
    expect(a.voz.motorActivo()).toBe('navegador')
  })

  it('callar detiene la bocina, tira la cola del worker y calla al respaldo', async () => {
    const a = armar()
    await a.cargar()
    a.voz.callar()
    expect(a.pf.reproductor.detener).toHaveBeenCalled()
    expect(a.pf.motor.cancelarPendientes).toHaveBeenCalled()
    expect(a.nav.callar).toHaveBeenCalled()
  })
})

describe('acuses', () => {
  it('rotan y son cortos', () => {
    const vistos = new Set<string>()
    let i = -1
    for (let k = 0; k < ACUSES.length; k++) { const a = siguienteAcuse(i); i = a.indice; vistos.add(a.texto) }
    expect(vistos.size).toBe(ACUSES.length)
    expect(siguienteAcuse(ACUSES.length - 1).indice).toBe(0)
    for (const a of ACUSES) expect(a.length).toBeLessThan(30)
  })
})
