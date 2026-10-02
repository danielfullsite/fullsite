import { MARCA_SIN_VERIFICAR } from '@/lib/verificador-numeros'

/**
 * `[sin verificar]` is an internal verifier marker. Never show partial or
 * contaminated reasoning to a restaurant owner; omit its whole response block.
 */
export function quitarBloquesNoVerificados(texto: string): { texto: string; omitidos: number } {
  if (!texto.includes(MARCA_SIN_VERIFICAR)) return { texto, omitidos: 0 }

  const bloques = texto.split(/\n{2,}/)
  const patronesDependientes = /\b(ranking|top\s+\d+|cambio:|sube a #|entra en top|mejor mesero|peor mesero)\b/i
  const seguros = bloques.filter(bloque =>
    !bloque.includes(MARCA_SIN_VERIFICAR) && !patronesDependientes.test(bloque),
  )

  const salida = seguros.length > 0
    ? seguros.join('\n\n').trim()
    : texto.split('\n').filter(linea => !linea.includes(MARCA_SIN_VERIFICAR)).join('\n').trim()
  const aviso = 'Omití detalles que no pude verificar contra los datos disponibles.'

  return {
    texto: salida ? `${salida}\n\n${aviso}` : aviso,
    omitidos: bloques.length - seguros.length,
  }
}
