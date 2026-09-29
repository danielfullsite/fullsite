// Límite de tasa en memoria por usuario, igual al que usan /api/chat y /api/voice
// (ventana fija de 1 min, limpieza cada 5 min). Es por instancia: en Vercel cada
// lambda lleva su cuenta, así que es un freno de abuso, no una cuota exacta.

export function crearLimitador(maxPorVentana: number, ventanaMs = 60_000) {
  const mapa = new Map<string, { count: number; resetTime: number }>()
  let ultimaLimpieza = Date.now()

  return function permitir(llave: string): boolean {
    const ahora = Date.now()
    if (ahora - ultimaLimpieza > 300_000) {
      for (const [k, e] of mapa) if (ahora > e.resetTime) mapa.delete(k)
      ultimaLimpieza = ahora
    }
    const e = mapa.get(llave)
    if (!e || ahora > e.resetTime) {
      mapa.set(llave, { count: 1, resetTime: ahora + ventanaMs })
      return true
    }
    if (e.count >= maxPorVentana) return false
    e.count++
    return true
  }
}
