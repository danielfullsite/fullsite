// Voz de salida del modo voz: Piper (voz neuronal es-MX, gratis, corre en el
// navegador) con respaldo AUTOMÁTICO a `speechSynthesis`.
//
//   cargar()  → decide motor (./motor-voz), importa ./piper-cliente DINÁMICAMENTE,
//               baja el modelo la primera vez (~63 MB, queda en OPFS), lo calienta
//               y pre-sintetiza los acuses ("Mmm, déjame ver…").
//   hablar()  → frase por frase en tubería (./tuberia): suena la 1 mientras se
//               sintetiza la 2. Mientras la voz natural no esté lista, habla el
//               respaldo (nunca se espera a la descarga).
//
// Respaldo para TODA la sesión (la página) si:
//   - no hay WebAssembly / Worker / AudioContext, o poca memoria
//   - el modelo no se pudo bajar/iniciar (se prueba el siguiente de MODELOS_PIPER)
//   - la primera frase tardó > 2.5 s en sintetizarse (el modelo queda marcado
//     "lento" en este equipo: la próxima vez se prueba el siguiente)
//   - la síntesis truena a media respuesta (se sigue con el respaldo desde ESA frase)

import { audioContextCompartido } from './microfono'
import {
  almacenLocal, convienePrecargar, elegirMotor, entornoDelNavegador, LIMITE_PRIMERA_FRASE_MS, marcarModelo,
  MODELOS_PIPER, type EntornoVoz, type HistorialMotor,
} from './motor-voz'
import type { MotorPiper, Reproductor, RutasMotor } from './piper-cliente'
import type { EstadoCargaVoz, OpcionesHablar, ProveedorVoz } from './proveedores'
import { frasesParaHablar } from './texto-hablado'
import { hablarEnTuberia } from './tuberia'
import { crearVozNavegador } from './voz-navegador'

/** Acuses cortos mientras piensa (> 1.5 s). Se rotan; con Piper quedan en caché. */
export const ACUSES = ['Mmm, déjame ver…', 'Va, reviso…', 'A ver, dame un segundo…', 'Déjame checar…'] as const

export function siguienteAcuse(ultimo: number): { texto: string; indice: number } {
  const indice = (Math.max(-1, ultimo) + 1) % ACUSES.length
  return { texto: ACUSES[indice], indice }
}

/** Tope de cualquier frase que no sea la primera (un motor colgado no deja la voz muda). */
const LIMITE_FRASE_MS = 10_000
/** El calentamiento incluye compilar el WASM y el primer run de ONNX. */
const LIMITE_CALENTAR_MS = 30_000

type ModuloPiper = typeof import('./piper-cliente')

export interface DepsVozNatural {
  navegador?: ProveedorVoz
  entorno?: () => EntornoVoz
  historial?: { leer(): HistorialMotor; guardar(h: HistorialMotor): void }
  importar?: () => Promise<ModuloPiper>
  contexto?: () => AudioContext | null
  rutas?: () => Promise<RutasMotor>
  limitePrimeraMs?: number
  ahora?: () => number
}

type Motor =
  | { tipo: 'navegador'; razon: string }
  | { tipo: 'cargando' }
  | { tipo: 'piper'; motor: MotorPiper; reproductor: Reproductor; modelo: string }

function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tiempo agotado')), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

export function crearVozNatural(deps: DepsVozNatural = {}): ProveedorVoz & { motorActivo(): string } {
  const navegador = deps.navegador ?? crearVozNavegador()
  const entorno = deps.entorno ?? entornoDelNavegador
  const historial = deps.historial ?? almacenLocal
  const importar = deps.importar ?? (() => import('./piper-cliente'))
  const contexto = deps.contexto ?? audioContextCompartido
  const limitePrimeraMs = deps.limitePrimeraMs ?? LIMITE_PRIMERA_FRASE_MS
  const ahora = deps.ahora ?? (() => Date.now())

  let motor: Motor = { tipo: 'navegador', razon: 'sin-cargar' }
  let carga: Promise<void> | null = null
  let ultimoEstado: EstadoCargaVoz = { estado: 'inactivo' }
  const oyentes = new Set<(e: EstadoCargaVoz) => void>()
  const cacheAudio = new Map<string, AudioBuffer>()
  let turno = 0
  let control: AbortController | null = null

  const avisar = (e: EstadoCargaVoz) => {
    ultimoEstado = e
    for (const f of oyentes) { try { f(e) } catch { /* la UI no rompe la voz */ } }
  }

  const aRespaldo = (razon: string) => {
    if (motor.tipo === 'piper') { try { motor.reproductor.detener(); motor.motor.cerrar() } catch { /* */ } }
    motor = { tipo: 'navegador', razon }
    cacheAudio.clear()
    avisar({ estado: 'respaldo', razon })
  }

  const marcar = (id: string, marca: 'lento' | 'fallo') => {
    try { historial.guardar(marcarModelo(historial.leer(), id, marca, ahora())) } catch { /* */ }
  }

  async function iniciar(): Promise<void> {
    const decision = elegirMotor(entorno(), historial.leer(), ahora())
    if (decision.motor === 'navegador') { aRespaldo(decision.razon); return }
    const ctx = contexto()
    if (!ctx) { aRespaldo('sin-wasm'); return }
    motor = { tipo: 'cargando' }
    let mp: MotorPiper | null = null
    try {
      const mod = await importar()
      const rutas = await (deps.rutas ?? (() => mod.leerRutasMotor()))()
      mp = mod.crearMotorPiper({ ctx, rutas })
      avisar({ estado: 'descargando', cargado: 0, total: decision.modelos[0].bytesOnnx })
      const modelo = await mp.cargar(
        decision.modelos,
        p => avisar(p.fase === 'descargando' ? { estado: 'descargando', cargado: p.cargado ?? 0, total: p.total ?? 0 } : { estado: 'iniciando' }),
        id => marcar(id, 'fallo'),
      )
      // Calentar: el primer run compila y reserva memoria; si no, la primera frase
      // real del dueño pagaría eso y caería en "lento".
      await conTope(mp.sintetizar('Listo.', 'alta'), LIMITE_CALENTAR_MS)
      if (motor.tipo !== 'cargando') { mp.cerrar(); return } // se cerró mientras cargaba
      motor = { tipo: 'piper', motor: mp, reproductor: mod.crearReproductor(ctx), modelo }
      avisar({ estado: 'listo', motor: `piper:${modelo}` })
      // Acuses en segundo plano (prioridad baja: lo que pida el dueño va primero).
      for (const a of ACUSES) {
        const texto = frasesParaHablar(a)[0]?.hablar
        if (!texto || cacheAudio.has(texto)) continue
        mp.sintetizar(texto, 'baja').then(b => { if (motor.tipo === 'piper') cacheAudio.set(texto, b) }, () => {})
      }
    } catch {
      try { mp?.cerrar() } catch { /* */ }
      if (motor.tipo === 'cargando') aRespaldo('fallo')
    }
  }

  const proveedor = {
    nombre: 'piper+navegador',
    disponible: () => navegador.disponible() || elegirMotor(entorno(), {}, ahora()).motor === 'piper',
    preparar() {
      navegador.preparar()
      contexto()
    },
    cargar(alEstado?: (e: EstadoCargaVoz) => void) {
      if (alEstado) {
        oyentes.add(alEstado)
        if (ultimoEstado.estado !== 'inactivo') alEstado(ultimoEstado)
      }
      if (!carga) carga = iniciar()
      return carga
    },
    nivelSalida(): number | null {
      return motor.tipo === 'piper' ? motor.reproductor.nivel() : null
    },
    permiteInterrupcionPorVoz: () => motor.tipo === 'piper',
    motorActivo: () => (motor.tipo === 'piper' ? `piper:${motor.modelo}` : motor.tipo === 'cargando' ? 'cargando' : 'navegador'),
    async hablar(texto: string, signal?: AbortSignal, opciones?: OpcionesHablar) {
      const mio = ++turno
      control?.abort()
      const ctrl = new AbortController()
      control = ctrl
      const alAbortar = () => ctrl.abort()
      signal?.addEventListener('abort', alAbortar, { once: true })
      try {
        if (signal?.aborted) return
        const m = motor
        if (m.tipo !== 'piper') { await navegador.hablar(texto, ctrl.signal, opciones); return }
        navegador.callar()
        const frases = frasesParaHablar(texto, { anioActual: new Date(ahora()).getFullYear() }).map(f => f.hablar)
        const r = await hablarEnTuberia(frases, {
          sintetizar: (t) => {
            const c = cacheAudio.get(t)
            if (c) return Promise.resolve(c)
            return m.motor.sintetizar(t, 'alta').then(b => { if (opciones?.cachear) cacheAudio.set(t, b); return b })
          },
          reproducir: (b, _i, s) => m.reproductor.reproducir(b, s),
          alFrase: opciones?.alFrase,
          signal: ctrl.signal,
          desde: opciones?.desdeFrase,
          limitePrimeraMs,
          limiteFraseMs: LIMITE_FRASE_MS,
          ahora,
        })
        if (r.fin === 'completo' || r.fin === 'abortado' || mio !== turno) return
        // Lento o error: respaldo para la sesión, y se sigue hablando desde esa frase.
        if (r.fin === 'lento') marcar(m.modelo, 'lento')
        m.motor.cancelarPendientes()
        aRespaldo(r.fin === 'lento' ? 'lento' : 'fallo')
        if (!ctrl.signal.aborted) await navegador.hablar(texto, ctrl.signal, { ...opciones, desdeFrase: r.indice })
      } finally {
        signal?.removeEventListener('abort', alAbortar)
        if (control === ctrl) control = null
      }
    },
    callar() {
      turno++
      control?.abort()
      control = null
      if (motor.tipo === 'piper') {
        motor.reproductor.detener()
        motor.motor.cancelarPendientes()
      }
      navegador.callar()
    },
  }
  return proveedor
}

// ── Precarga al abrir el chat ────────────────────────────────────────────────

let precargaHecha = false

/**
 * Al abrir el widget del chat: si es escritorio o Wi-Fi (y sin ahorro de datos),
 * baja el modelo en segundo plano cuando el navegador esté ocioso. Una vez por
 * página; si ya está en OPFS no baja nada. Nunca lanza.
 */
export function precargarVozNatural(): void {
  if (precargaHecha || typeof window === 'undefined') return
  precargaHecha = true
  try {
    const decision = elegirMotor(entornoDelNavegador(), almacenLocal.leer())
    if (decision.motor !== 'piper') return
    const nav = navigator as unknown as { connection?: { saveData?: boolean; type?: string; effectiveType?: string }; maxTouchPoints?: number; userAgent?: string }
    const esMovil = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '') || (/Macintosh/.test(nav.userAgent || '') && (nav.maxTouchPoints ?? 0) > 1)
    if (!convienePrecargar({ saveData: nav.connection?.saveData, tipoConexion: nav.connection?.type, conexionEfectiva: nav.connection?.effectiveType, esMovil })) return
    const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }
    const correr = () => { void import('./piper-cliente').then(m => m.precargarModelo(decision.modelos[0])).catch(() => {}) }
    if (w.requestIdleCallback) w.requestIdleCallback(correr, { timeout: 10_000 })
    else setTimeout(correr, 3000)
  } catch { /* opcional */ }
}

export { MODELOS_PIPER }
