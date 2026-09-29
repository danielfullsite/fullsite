// WAV PCM16 (lo que devuelve Piper) → muestras Float32 para Web Audio.
//
// Se lee el WAV a mano en vez de `decodeAudioData`: es síncrono, no depende de
// que el AudioContext esté "running" (iOS lo suspende) y no re-muestrea.

export interface Pcm {
  muestras: Float32Array
  sampleRate: number
}

/** Lanza Error si no es un WAV PCM de 16 bits. Mezcla a mono si trae más canales. */
export function wavAPcm(datos: ArrayBuffer): Pcm {
  const v = new DataView(datos)
  const txt = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
  if (datos.byteLength < 44 || txt(0) !== 'RIFF' || txt(8) !== 'WAVE') throw new Error('No es WAV')

  let o = 12
  let canales = 1
  let sampleRate = 0
  let bits = 16
  let formato = 1
  while (o + 8 <= datos.byteLength) {
    const id = txt(o)
    const tam = v.getUint32(o + 4, true)
    const cuerpo = o + 8
    if (id === 'fmt ') {
      formato = v.getUint16(cuerpo, true)
      canales = v.getUint16(cuerpo + 2, true)
      sampleRate = v.getUint32(cuerpo + 4, true)
      bits = v.getUint16(cuerpo + 14, true)
    } else if (id === 'data') {
      if (formato !== 1 || bits !== 16 || !sampleRate || !canales) throw new Error('WAV no soportado')
      const fin = Math.min(datos.byteLength, cuerpo + tam)
      const cuadros = Math.floor((fin - cuerpo) / (2 * canales))
      const muestras = new Float32Array(cuadros)
      for (let i = 0; i < cuadros; i++) {
        let suma = 0
        for (let c = 0; c < canales; c++) suma += v.getInt16(cuerpo + (i * canales + c) * 2, true)
        muestras[i] = suma / canales / 32768
      }
      return { muestras, sampleRate }
    }
    o = cuerpo + tam + (tam % 2)
  }
  throw new Error('WAV sin datos')
}

/** RMS (0‥1) de muestras Float32 (para medir la salida). */
export function rmsDeFloat(muestras: ArrayLike<number>): number {
  const n = muestras.length
  if (!n) return 0
  let s = 0
  for (let i = 0; i < n; i++) s += muestras[i] * muestras[i]
  return Math.sqrt(s / n)
}
