/**
 * Cómo se guarda un PIN del POS en la base.
 *
 * Fase 0 de `docs/security/PLAN-PIN-HASH.md`. Este módulo **no lo usa nadie todavía**: la
 * doble escritura es F2 y el corte de lectura es F4. Aquí sólo vive la regla, con sus
 * pruebas, para que las fases siguientes la importen en vez de inventarla cada una.
 *
 * ── Por qué HMAC y no bcrypt ──────────────────────────────────────────────────────────
 *
 * `/api/pos/pin` **no compara** un PIN: lo **busca** (`pos_staff?pin=eq.<pin>`). No hay
 * usuario — el mesero teclea 4 dígitos y el PIN *es* la identidad, respaldada por el índice
 * `unique_pin_per_client`. Eso descarta una sal por fila: sin fila que buscar habría que
 * traer las 40 personas del restaurante y correr el KDF contra cada una, ~4 s por login,
 * dentro de un timeout de Pedro de 5 s (`actor-authority.js:68`).
 *
 * Un HMAC con una pimienta del servidor es determinista, así que la búsqueda sigue siendo
 * un índice y un solo round-trip. El `client_id` va **dentro** del mensaje para que el mismo
 * PIN en dos restaurantes dé dos hashes distintos: sin eso, un dump permitiría correlacionar
 * "esta persona de AMALAY usa el mismo PIN que aquélla de Boruca".
 *
 * ── Lo que esto compra, y lo que no ───────────────────────────────────────────────────
 *
 * COMPRA: una lectura de la base —el token del MCP, un respaldo, el JWT de un gerente, una
 * fuga de RLS— deja de entregar credenciales usables.
 *
 * NO COMPRA:
 *  · Si se fugan la base **y** la pimienta juntas, 10^4 combinaciones se revientan al
 *    instante. La pimienta es toda la seguridad del esquema, y su radio de explosión es el
 *    mismo que el de `SUPABASE_SERVICE_KEY`.
 *  · No protege contra adivinar en línea. Eso es `pin-throttle.ts`, y no cambia.
 *  · No arregla el espacio de 4 dígitos. Eso es `docs/security/MIGRACION-PINS.md`.
 *
 * ── Falla CERRADO ─────────────────────────────────────────────────────────────────────
 *
 * Sin pimienta esto **lanza**. Nunca hay un camino de regreso a comparar texto plano: un
 * fallback así convertiría un despliegue mal configurado en una fuga silenciosa, que es
 * exactamente lo que la migración viene a cerrar.
 *
 * Quien lo llame desde una ruta HTTP debe traducir esa falla a **503 `authority_unavailable`**
 * — nunca a 500 y mucho menos a 401. El motivo no es cosmético: Pedro clasifica `{400,401,403}`
 * como "PIN rechazado" y todo lo demás como "autoridad caída" (`actor-authority.js:165-173`),
 * y ante un 401 **borra la credencial preparada** de esa persona (`:170`). Un 401 espurio por
 * una variable de entorno faltante dejaría sin entrar, y sin respaldo offline, a quien sí
 * tenía con qué. Por eso el contrato viaja aquí, en `HTTP_AUTORIDAD_NO_DISPONIBLE`, en vez de
 * quedar a criterio de cada ruta.
 */

/** Versión de pimienta que se escribe hoy. Va a la columna `pin_hash_v`. */
export const VERSION_DE_PIMIENTA = 1

/**
 * Qué responde una ruta HTTP cuando esto falla.
 *
 * `503` y `authority_unavailable`, para que Pedro lo lea como "la nube no juzgó este PIN" y
 * caiga a su verificador acotado, en vez de leerlo como un rechazo. Ver el bloque de arriba.
 */
export const HTTP_AUTORIDAD_NO_DISPONIBLE = { status: 503, code: 'authority_unavailable' } as const

/** La instalación no tiene pimienta configurada. No es culpa de quien tecleó el PIN. */
export class PimientaNoConfigurada extends Error {
  readonly code = 'authority_unavailable'
  constructor(variable: string, detalle: string) {
    super(
      `${variable} ${detalle}. Sin pimienta no se puede hashear ni verificar un PIN. ` +
      'Generar con `openssl rand -hex 32` y ponerla en el entorno — nunca en el repo ni en la base.',
    )
    this.name = 'PimientaNoConfigurada'
  }
}

export function esPimientaNoConfigurada(e: unknown): e is PimientaNoConfigurada {
  return e instanceof PimientaNoConfigurada
}

/** Mismo formato que exige el CHECK de BD `pos_staff_pin_len_chk`. */
const PIN_VALIDO = /^\d{4,10}$/
/** Mismo formato que valida `/api/pos/pin` antes de tocar la base. */
const CLIENT_ID_VALIDO = /^[a-z0-9_-]{1,40}$/i
/** 32 bytes en hex. Estricto a propósito: una pimienta corta o de relleno debe tronar, no debilitar. */
const PIMIENTA_VALIDA = /^[0-9a-fA-F]{64}$/

/**
 * De qué variable de entorno sale cada versión de pimienta.
 *
 * La v1 usa el nombre pelado para no arrastrar un sufijo desde el día uno. Rotar significa
 * publicar `POS_PIN_PEPPER_V2` **sin quitar** la v1, re-hashear las filas y recién entonces
 * retirar la vieja: mientras haya una sola fila en v1, esa variable tiene que seguir ahí.
 */
function nombreDeVariable(version: number): string {
  return version === 1 ? 'POS_PIN_PEPPER' : `POS_PIN_PEPPER_V${version}`
}

/**
 * `importKey` cuesta poco, pero Vercel reutiliza la instancia entre invocaciones y el login
 * es la ruta más caliente del POS. Se memoiza por versión; el entorno no cambia en caliente.
 */
const llavesPorVersion = new Map<number, Promise<CryptoKey>>()

/**
 * El `ArrayBuffer` se reserva explícito y no con `new Uint8Array(n)`: desde TS 5.7 el tipo
 * lleva parámetro y el inferido (`Uint8Array<ArrayBufferLike>`) no satisface el `BufferSource`
 * que pide `importKey`, porque `ArrayBufferLike` admite `SharedArrayBuffer`.
 */
function bytesDesdeHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function llaveDe(version: number): Promise<CryptoKey> {
  const yaEsta = llavesPorVersion.get(version)
  if (yaEsta) return yaEsta

  const variable = nombreDeVariable(version)
  const crudo = (process.env[variable] ?? '').trim()
  if (!crudo) throw new PimientaNoConfigurada(variable, 'no está configurada')
  if (!PIMIENTA_VALIDA.test(crudo)) {
    throw new PimientaNoConfigurada(variable, 'no son 64 caracteres hexadecimales')
  }

  // La llave son los 32 BYTES, no los 64 caracteres. Usar el texto hex como llave
  // desperdiciaría la mitad de la entropía por un descuido de tipos.
  const llave = crypto.subtle.importKey(
    'raw', bytesDesdeHex(crudo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  llavesPorVersion.set(version, llave)
  return llave
}

/**
 * El hash que va a `pos_staff.pin_hash`.
 *
 *   pin_hash = hex( HMAC-SHA256( pimienta, client_id || ':' || pin ) )
 *
 * Devuelve 64 caracteres hex en minúsculas.
 *
 * **El `client_id` no se normaliza.** Tiene que entrar exactamente igual que en el filtro
 * `client_id=eq.` de la consulta que lo va a buscar; normalizar aquí haría que un PIN empatara
 * con una fila cuyo tenant se escribe distinto. Un desajuste de mayúsculas da cero filas — que
 * es justo lo que pasa hoy con el PIN en claro, así que no es comportamiento nuevo.
 *
 * @throws {PimientaNoConfigurada} si la instalación no tiene pimienta — traducir a 503.
 * @throws {Error} si el PIN o el client_id no cumplen el formato; eso es un error de quien
 *   llama, que debió validarlos antes (las rutas ya lo hacen y devuelven 400).
 */
export async function hashPinParaBD(
  clientId: string,
  pin: string,
  version: number = VERSION_DE_PIMIENTA,
): Promise<string> {
  if (typeof clientId !== 'string' || !CLIENT_ID_VALIDO.test(clientId)) {
    throw new Error('client_id inválido para hashear un PIN')
  }
  if (typeof pin !== 'string' || !PIN_VALIDO.test(pin)) {
    throw new Error('PIN inválido para hashear — deben ser 4 a 10 dígitos')
  }

  const llave = await llaveDe(version)
  const mensaje = new TextEncoder().encode(`${clientId}:${pin}`)
  const firma = await crypto.subtle.sign('HMAC', llave, mensaje)
  return Array.from(new Uint8Array(firma)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Sólo para las pruebas: tira la llave memoizada para poder cambiar el entorno entre casos. */
export function _olvidarLlavesMemoizadas(): void {
  llavesPorVersion.clear()
}
