// Qué motor de voz usar: Piper (voz neuronal, en el navegador) o el respaldo
// `speechSynthesis`. Todo PURO salvo `entornoDelNavegador` / `almacenLocal`.
//
// Reglas (IA-DEL-DUENO §5):
//   - Sin WebAssembly, sin Worker o sin AudioContext → respaldo.
//   - Poca memoria (`navigator.deviceMemory` < 4 GB, sólo Chrome lo reporta) → respaldo.
//   - Un modelo cuya primera frase tardó > 2.5 s en sintetizarse queda marcado "lento"
//     en este equipo por 30 días: la próxima vez se prueba el siguiente modelo; si
//     todos son lentos, respaldo directo (sin volver a descargar nada).
//   - Un modelo que no se pudo descargar/iniciar queda marcado "falló" por 1 día.
//   - `NEXT_PUBLIC_VOZ_MOTOR=navegador` apaga Piper sin tocar código.

/** Voces Piper es-MX en orden de preferencia (ids del paquete @mintplex-labs/piper-tts-web). */
export const MODELOS_PIPER = [
  // es-MX, calidad "high", 22 kHz, ~63 MB. Dataset: HirCoir/Piper-TTS-Spanish, Apache-2.0 (MODEL_CARD).
  { id: 'es_MX-claude-high', ruta: 'es/es_MX/claude/high/es_MX-claude-high.onnx', bytesOnnx: 63_122_309, bytesJson: 4_963 },
  // es-MX, calidad "medium", 22 kHz, ~63 MB. Dataset: Ald_Mexican_Spanish_speech_dataset, Unlicense.
  { id: 'es_MX-ald-medium', ruta: 'es/es_MX/ald/medium/es_MX-ald-medium.onnx', bytesOnnx: 63_201_294, bytesJson: 4_889 },
] as const

export type ModeloPiper = (typeof MODELOS_PIPER)[number]
export type IdModeloPiper = ModeloPiper['id']

/** Tope de la PRIMERA frase: más que esto se siente muerto → respaldo por la sesión. */
export const LIMITE_PRIMERA_FRASE_MS = 2500
export const DIAS_LENTO = 30
export const DIAS_FALLO = 1
export const MEMORIA_MINIMA_GB = 4
export const CLAVE_HISTORIAL = 'fullsite.voz.motor.v1'

export interface EntornoVoz {
  tieneWasm: boolean
  tieneWorker: boolean
  tieneAudioContext: boolean
  /** `navigator.deviceMemory` (GB, redondeado por el navegador); `undefined` si no lo expone. */
  memoriaGb?: number
  /** Valor de NEXT_PUBLIC_VOZ_MOTOR. */
  forzado?: string | null
}

export type HistorialMotor = Partial<Record<string, { lento?: number; fallo?: number }>>

export type DecisionMotor =
  | { motor: 'piper'; modelos: ModeloPiper[] }
  | { motor: 'navegador'; razon: 'forzado' | 'sin-wasm' | 'poca-memoria' | 'lento' | 'fallo' }

const DIA_MS = 86_400_000

export function elegirMotor(entorno: EntornoVoz, historial: HistorialMotor = {}, ahora = Date.now()): DecisionMotor {
  if ((entorno.forzado || '').trim().toLowerCase() === 'navegador') return { motor: 'navegador', razon: 'forzado' }
  if (!entorno.tieneWasm || !entorno.tieneWorker || !entorno.tieneAudioContext) return { motor: 'navegador', razon: 'sin-wasm' }
  if (typeof entorno.memoriaGb === 'number' && entorno.memoriaGb > 0 && entorno.memoriaGb < MEMORIA_MINIMA_GB) {
    return { motor: 'navegador', razon: 'poca-memoria' }
  }
  let porLento = 0
  const modelos = MODELOS_PIPER.filter(m => {
    const h = historial[m.id]
    if (h?.lento && ahora - h.lento < DIAS_LENTO * DIA_MS) { porLento++; return false }
    if (h?.fallo && ahora - h.fallo < DIAS_FALLO * DIA_MS) return false
    return true
  })
  if (!modelos.length) return { motor: 'navegador', razon: porLento ? 'lento' : 'fallo' }
  return { motor: 'piper', modelos }
}

export function marcarModelo(historial: HistorialMotor, id: string, marca: 'lento' | 'fallo', ahora = Date.now()): HistorialMotor {
  return { ...historial, [id]: { ...(historial[id] || {}), [marca]: ahora } }
}

/** Lectura tolerante: basura en localStorage = historial vacío. */
export function leerHistorial(crudo: string | null | undefined): HistorialMotor {
  if (!crudo) return {}
  try {
    const v = JSON.parse(crudo) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: HistorialMotor = {}
    for (const [k, h] of Object.entries(v as Record<string, unknown>)) {
      if (!h || typeof h !== 'object') continue
      const { lento, fallo } = h as { lento?: unknown; fallo?: unknown }
      out[k] = {
        ...(typeof lento === 'number' && Number.isFinite(lento) ? { lento } : {}),
        ...(typeof fallo === 'number' && Number.isFinite(fallo) ? { fallo } : {}),
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * ¿Vale la pena bajar el modelo en segundo plano al abrir el chat? Sólo en
 * escritorio o Wi-Fi/Ethernet, nunca con "ahorro de datos" ni en red celular.
 */
export function convienePrecargar(info: {
  saveData?: boolean
  tipoConexion?: string
  conexionEfectiva?: string
  esMovil: boolean
}): boolean {
  if (info.saveData) return false
  const tipo = (info.tipoConexion || '').toLowerCase()
  if (tipo === 'cellular') return false
  const efectiva = (info.conexionEfectiva || '').toLowerCase()
  if (efectiva && efectiva !== '4g') return false
  if (tipo === 'wifi' || tipo === 'ethernet') return true
  return !info.esMovil
}

// ── Navegador ───────────────────────────────────────────────────────────────

export function entornoDelNavegador(): EntornoVoz {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {}
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as { deviceMemory?: number }) : {}
  return {
    tieneWasm: typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function',
    tieneWorker: typeof Worker === 'function',
    tieneAudioContext: typeof w.AudioContext === 'function' || typeof w.webkitAudioContext === 'function',
    memoriaGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    forzado: process.env.NEXT_PUBLIC_VOZ_MOTOR ?? null,
  }
}

/** localStorage envuelto: en modo privado / bloqueado cualquier acceso puede lanzar. */
export const almacenLocal = {
  leer(): HistorialMotor {
    try { return leerHistorial(globalThis.localStorage?.getItem(CLAVE_HISTORIAL)) } catch { return {} }
  },
  guardar(h: HistorialMotor): void {
    try { globalThis.localStorage?.setItem(CLAVE_HISTORIAL, JSON.stringify(h)) } catch { /* sin almacenamiento */ }
  },
}
