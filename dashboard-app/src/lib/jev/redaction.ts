/**
 * Política de redacción de la capa Jev.
 *
 * La capa espera estados YA redactados. Esta política no intenta "limpiar":
 * RECHAZA. Un estado que trae algo prohibido no se recorta y se manda — se
 * devuelve al llamador con el motivo. Limpiar a medias es cómo se fuga un dato.
 *
 * Tres capas, todas deben pasar:
 *  1. Allowlist estructural por caso de uso (use-cases.ts): claves exactas,
 *     tipos exactos, strings sólo de enumeraciones cerradas.
 *  2. Denylist de nombres de clave (defensa en profundidad si el esquema crece).
 *  3. Detector de patrones en cada string (PII, PINs, secretos, pagos).
 */
import { createHash } from 'node:crypto'
import type { DecisionInput, EffectDomain, StateValue } from './contract'
import { JEV_CONTRACT_VERSION, USE_CASES } from './contract'
import type { FieldSpec, StateSchema } from './use-cases'
import { USE_CASE_SPECS } from './use-cases'

/** Límite de tamaño del estado serializado. Jev admite 32k tokens; aquí se queda muy por debajo a propósito. */
export const MAX_STATE_CHARS = 4_000

/** Fragmentos de nombre de clave que nunca pueden aparecer, a ninguna profundidad. */
export const FORBIDDEN_KEY_FRAGMENTS: readonly string[] = [
  'pin', 'password', 'passwd', 'contrasena', 'secret', 'token', 'apikey', 'api_key', 'credential', 'authorization', 'bearer',
  'email', 'correo', 'phone', 'telefono', 'celular', 'whatsapp',
  'name', 'nombre', 'apellido', 'address', 'direccion', 'domicilio',
  'rfc', 'curp', 'ssn', 'passport', 'ine',
  'card', 'tarjeta', 'pan', 'cvv', 'iban', 'clabe', 'account_number', 'cuenta',
  'payment', 'pago', 'amount', 'monto', 'total', 'propina', 'tip', 'price', 'precio', 'importe',
  'items', 'line_items', 'order_items', 'ticket', 'comanda', 'notes', 'notas', 'comment', 'comentario', 'customer', 'cliente',
  'ip', 'lat', 'lng', 'lon', 'geo',
]


interface PatternRule { id: string; re: RegExp; check?: (m: string) => boolean }

function luhn(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let x = digits.charCodeAt(i) - 48
    if (dbl) { x *= 2; if (x > 9) x -= 9 }
    sum += x
    dbl = !dbl
  }
  return sum % 10 === 0
}

export const FORBIDDEN_VALUE_PATTERNS: readonly PatternRule[] = [
  { id: 'email', re: /[^\s@]+@[^\s@]+\.[^\s@]+/ },
  { id: 'phone', re: /(?:\+?\d[\s-]?){10,}/ },
  { id: 'card_pan', re: /\b(?:\d[ -]?){13,19}\b/, check: (m) => luhn(m.replace(/\D/g, '')) },
  { id: 'jwt', re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { id: 'api_key', re: /\b(?:sk|pk|rk|vck|sb_secret|sb_publishable|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{8,}/i },
  { id: 'bearer', re: /bearer\s+\S+/i },
  { id: 'rfc', re: /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/i },
  { id: 'curp', re: /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i },
  { id: 'pin_like', re: /^\d{4,8}$/ },
  { id: 'url', re: /https?:\/\//i },
]

export interface RedactionResult {
  ok: boolean
  violations: string[]
}

function keyIsForbidden(key: string): string | null {
  // camelCase → snake_case antes de segmentar: 'userPin' debe verse como 'user_pin'.
  const k = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  // Coincidencia por segmento para evitar falsos positivos obvios ('pin' en 'shipping') y
  // por subcadena para fragmentos largos inequívocos.
  const segments = k.split(/[^a-z0-9]+/).filter(Boolean)
  for (const frag of FORBIDDEN_KEY_FRAGMENTS) {
    if (segments.includes(frag)) return frag
    if (frag.length >= 5 && k.includes(frag)) return frag
  }
  return null
}

export function scanString(value: string): string[] {
  const hits: string[] = []
  for (const p of FORBIDDEN_VALUE_PATTERNS) {
    const m = value.match(p.re)
    if (m && (!p.check || p.check(m[0]))) hits.push(p.id)
  }
  return hits
}

function checkField(path: string, spec: FieldSpec, value: StateValue | undefined, out: string[]): void {
  if (value === undefined) { out.push(`${path}: falta`); return }
  switch (spec.kind) {
    case 'enum':
      if (typeof value !== 'string' || !spec.values.includes(value)) out.push(`${path}: valor fuera de la enumeración`)
      return
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min || value > spec.max)
        out.push(`${path}: entero fuera de rango [${spec.min},${spec.max}]`)
      return
    case 'nullable_int':
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min || value > spec.max))
        out.push(`${path}: entero o null fuera de rango [${spec.min},${spec.max}]`)
      return
    case 'bool':
      if (typeof value !== 'boolean') out.push(`${path}: se esperaba booleano`)
      return
    case 'nullable_bool':
      if (value !== null && typeof value !== 'boolean') out.push(`${path}: se esperaba booleano o null`)
      return
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { out.push(`${path}: se esperaba objeto`); return }
      checkObject(path, spec.fields, value as Record<string, StateValue>, out)
      return
    }
  }
}

function checkObject(prefix: string, schema: StateSchema, value: Record<string, StateValue>, out: string[]): void {
  for (const key of Object.keys(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    const bad = keyIsForbidden(key)
    if (bad) out.push(`${path}: nombre de clave prohibido (${bad})`)
    // hasOwn, no `in`: `in` ve el prototipo y dejaba pasar 'constructor', '__proto__', 'toString'.
    if (!Object.hasOwn(schema, key)) out.push(`${path}: clave no permitida por el esquema`)
  }
  for (const [key, spec] of Object.entries(schema)) {
    checkField(prefix ? `${prefix}.${key}` : key, spec, value[key], out)
  }
}

function scanAllStrings(path: string, value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    for (const hit of scanString(value)) out.push(`${path}: patrón prohibido (${hit})`)
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => scanAllStrings(`${path}[${i}]`, v, out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) scanAllStrings(path ? `${path}.${k}` : k, v, out)
  }
}

export function isUseCase(x: unknown): x is DecisionInput['use_case'] {
  return typeof x === 'string' && USE_CASES.includes(x as never) && Object.hasOwn(USE_CASE_SPECS, x)
}

export const TENANT_REF_RE = /^t_[a-f0-9]{16,64}$/
const EFFECT_DOMAINS: readonly EffectDomain[] = [
  'none', 'commercial', 'operational', 'money', 'identity', 'security', 'deploy', 'migration', 'production',
]

/**
 * Copia profunda de datos planos. Todo lo que sigue (validación, reglas, hash y envío)
 * opera sobre esta copia, nunca sobre el objeto del llamador: así un getter o un
 * `toJSON` no pueden cambiar el estado entre la revisión y el envío (TOCTOU), y las
 * referencias circulares se convierten en rechazo en lugar de excepción.
 * Devuelve null si la entrada no es serializable.
 */
export function snapshotInput(raw: unknown): unknown | null {
  try {
    const text = JSON.stringify(raw)
    if (typeof text !== 'string' || text.length > MAX_STATE_CHARS * 4) return null
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Verifica la entrada completa. No muta. Falla cerrado ante cualquier duda. Espera una instantánea. */
export function checkInput(input: unknown): RedactionResult {
  try {
    return checkInputUnsafe(input)
  } catch (e) {
    return { ok: false, violations: [`entrada: no verificable (${e instanceof Error ? e.name : 'error'})`] }
  }
}

function checkInputUnsafe(input: unknown): RedactionResult {
  const v: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, violations: ['entrada: no es objeto'] }
  const i = input as Partial<DecisionInput> & Record<string, unknown>
  const allowedTop = new Set(['contract_version', 'use_case', 'tenant_ref', 'effect_domains', 'state'])
  for (const k of Object.keys(i)) if (!allowedTop.has(k)) v.push(`${k}: clave de nivel superior no permitida`)
  if (i.contract_version !== JEV_CONTRACT_VERSION) v.push(`contract_version: se esperaba ${JEV_CONTRACT_VERSION}`)
  if (!isUseCase(i.use_case)) v.push('use_case: desconocido')
  if (typeof i.tenant_ref !== 'string' || !TENANT_REF_RE.test(i.tenant_ref)) v.push('tenant_ref: debe ser opaco (t_<hex>)')
  if (!Array.isArray(i.effect_domains) || i.effect_domains.length === 0) v.push('effect_domains: vacío (falla cerrado)')
  else for (const dmn of i.effect_domains) if (!EFFECT_DOMAINS.includes(dmn as EffectDomain)) v.push(`effect_domains: '${String(dmn)}' desconocido`)
  if (!i.state || typeof i.state !== 'object' || Array.isArray(i.state)) {
    v.push('state: se esperaba objeto')
    return { ok: false, violations: v }
  }
  let serialized = ''
  try { serialized = JSON.stringify(i.state) } catch { v.push('state: no serializable') }
  if (serialized.length > MAX_STATE_CHARS) v.push(`state: ${serialized.length} caracteres > ${MAX_STATE_CHARS}`)
  if (isUseCase(i.use_case)) {
    checkObject('state', USE_CASE_SPECS[i.use_case].schema, i.state as Record<string, StateValue>, v)
  }
  scanAllStrings('state', i.state, v)
  return { ok: v.length === 0, violations: v }
}

/** JSON canónico: claves ordenadas, sin espacios. Base del hash de entrada y de la cadena de auditoría. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/** Hash del input redactado. Sólo se calcula sobre entradas que pasaron `checkInput`. */
export function hashInput(input: DecisionInput): string {
  return sha256Hex(
    canonicalJson({
      contract_version: input.contract_version,
      use_case: input.use_case,
      tenant_ref: input.tenant_ref,
      effect_domains: [...input.effect_domains].sort(),
      state: input.state,
    }),
  )
}
