// ─── PIN del POS — generación de 10 dígitos del sistema ──────────────────────
// La huella (DigitalPersona/HID) es el acceso diario; este PIN de 10 dígitos es el
// respaldo, GENERADO ALEATORIO POR EL SISTEMA — nadie lo elige, nadie lo memoriza,
// nadie lo comparte. Ver docs/product/DESIGN-HUELLAS-PIN.md (P0-A).
//
// Criptográficamente aleatorio (crypto.getRandomValues, disponible en navegador y Node 18+),
// con rechazo para uniformidad perfecta 0–9. La generación debe correr SERVER-SIDE
// (en la ruta admin de alta de staff), no exponerse al cliente.

const PIN_LENGTH = 10

/** Un dígito 0–9 uniforme usando CSPRNG (rechazo del sesgo del módulo). */
function secureDigit(): number {
  const buf = new Uint8Array(1)
  // 250 = 25*10 → rechazamos 250–255 para que el mod 10 quede uniforme
  do { crypto.getRandomValues(buf) } while (buf[0] >= 250)
  return buf[0] % 10
}

/** Genera un PIN de 10 dígitos (string, puede iniciar con 0). */
function makePin(): string {
  let s = ''
  for (let i = 0; i < PIN_LENGTH; i++) s += secureDigit().toString()
  return s
}

/**
 * Genera un PIN de 10 dígitos del sistema, evitando colisiones con `exclude`
 * (los PINs ya usados por el cliente — la BD tiene UNIQUE(pin, client_id)).
 * @param exclude Set de PINs existentes del tenant a evitar.
 */
export function generatePin10(exclude?: ReadonlySet<string>): string {
  let pin = makePin()
  if (exclude && exclude.size) {
    let guard = 0
    while (exclude.has(pin) && guard++ < 100) pin = makePin()
  }
  return pin
}

/** Valida el formato de PIN del POS: 4–10 dígitos (10 para los generados por el sistema). */
export const POS_PIN_RE = /^\d{4,10}$/
export function isValidPin(pin: string): boolean {
  return typeof pin === 'string' && POS_PIN_RE.test(pin)
}
