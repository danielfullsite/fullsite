// Exportado a propósito: el teclado del POS (pos/layout.tsx) tiene que aceptar
// exactamente esta longitud. Cuando eran dos números independientes se
// desincronizaron —generador 10, teclado 8— y nadie nuevo podía entrar.
export const PIN_LENGTH = 10

/** Generate an unpredictable 10-digit PIN. The first digit is non-zero. */
export function generateStaffPin(): string {
  const digits: number[] = []
  while (digits.length < PIN_LENGTH) {
    const bytes = new Uint8Array(PIN_LENGTH * 2)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      // Rejection sampling avoids modulo bias (250 is divisible by 10).
      if (byte >= 250) continue
      const digit = byte % 10
      if (digits.length === 0 && digit === 0) continue
      digits.push(digit)
      if (digits.length === PIN_LENGTH) break
    }
  }
  return digits.join('')
}
