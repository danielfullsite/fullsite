#!/usr/bin/env node
/**
 * validate_manifest.mjs — Validador estricto de manifests de cliente (gate R2-G03 / CLON-MANIFEST).
 *
 * Valida scripts/manifests/*.json contra manifest.schema.json sin dependencias
 * externas: implementa exactamente el subconjunto de JSON Schema draft 2020-12
 * que usa el schema, y lanza error ante cualquier keyword no soportado, de modo
 * que el schema no puede evolucionar más rápido que el validador sin romper CI.
 *
 * Uso:
 *   node scripts/manifests/validate_manifest.mjs                 # todos los manifests del directorio
 *   node scripts/manifests/validate_manifest.mjs ruta/a/x.json   # archivos específicos
 *
 * Exit codes: 0 = todos válidos · 1 = al menos un manifest inválido o error de I/O
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SCHEMA_PATH = join(HERE, 'manifest.schema.json')

// Keywords de validación implementados. Cualquier otro keyword en el schema
// (excepto anotaciones) aborta la validación en vez de ignorarse en silencio.
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description'])
const SUPPORTED = new Set([
  'type', 'enum', 'pattern', 'minLength', 'maxLength',
  'minimum', 'maximum', 'required', 'properties', 'patternProperties',
  'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems',
])

export function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
}

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function matchesType(value, expected) {
  const actual = typeOf(value)
  const wanted = Array.isArray(expected) ? expected : [expected]
  return wanted.some((t) => actual === t || (t === 'number' && actual === 'integer'))
}

function validateNode(value, schema, path, errors) {
  for (const kw of Object.keys(schema)) {
    if (!SUPPORTED.has(kw) && !ANNOTATIONS.has(kw)) {
      throw new Error(`Schema keyword no soportado por este validador: "${kw}" en ${path || '<root>'}`)
    }
  }

  if ('type' in schema && !matchesType(value, schema.type)) {
    errors.push(`${path || '<root>'}: se esperaba tipo ${JSON.stringify(schema.type)}, llegó ${typeOf(value)}`)
    return // sin el tipo correcto, el resto de checks no aplica
  }

  if ('enum' in schema && !schema.enum.some((v) => v === value)) {
    errors.push(`${path || '<root>'}: valor ${JSON.stringify(value)} no está en ${JSON.stringify(schema.enum)}`)
  }

  if (typeof value === 'string') {
    if ('pattern' in schema && !new RegExp(schema.pattern, 'u').test(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} no cumple el patrón ${schema.pattern}`)
    }
    if ('minLength' in schema && value.length < schema.minLength) {
      errors.push(`${path}: longitud ${value.length} < minLength ${schema.minLength}`)
    }
    if ('maxLength' in schema && value.length > schema.maxLength) {
      errors.push(`${path}: longitud ${value.length} > maxLength ${schema.maxLength}`)
    }
  }

  if (typeof value === 'number') {
    if ('minimum' in schema && value < schema.minimum) {
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`)
    }
    if ('maximum' in schema && value > schema.maximum) {
      errors.push(`${path}: ${value} > maximum ${schema.maximum}`)
    }
  }

  if (Array.isArray(value)) {
    if ('minItems' in schema && value.length < schema.minItems) {
      errors.push(`${path}: ${value.length} items < minItems ${schema.minItems}`)
    }
    if ('maxItems' in schema && value.length > schema.maxItems) {
      errors.push(`${path}: ${value.length} items > maxItems ${schema.maxItems}`)
    }
    if (schema.uniqueItems) {
      const seen = new Set(value.map((v) => JSON.stringify(v)))
      if (seen.size !== value.length) errors.push(`${path}: items duplicados (uniqueItems)`)
    }
    if ('items' in schema) {
      value.forEach((item, i) => validateNode(item, schema.items, `${path}[${i}]`, errors))
    }
  }

  if (typeOf(value) === 'object') {
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(`${path || '<root>'}: falta campo requerido "${req}"`)
    }
    const props = schema.properties ?? {}
    const patterns = Object.entries(schema.patternProperties ?? {})
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key
      let matched = false
      if (key in props) {
        matched = true
        validateNode(child, props[key], childPath, errors)
      }
      for (const [pat, patSchema] of patterns) {
        if (new RegExp(pat, 'u').test(key)) {
          matched = true
          validateNode(child, patSchema, childPath, errors)
        }
      }
      if (!matched) {
        const ap = schema.additionalProperties
        if (ap === false) {
          errors.push(`${childPath}: clave desconocida (additionalProperties: false)`)
        } else if (typeof ap === 'object' && ap !== null) {
          validateNode(child, ap, childPath, errors)
        }
      }
    }
  }
}

/** Valida un manifest (objeto ya parseado). Devuelve { valid, errors }. */
export function validateManifest(manifest, schema = loadSchema()) {
  const errors = []
  validateNode(manifest, schema, '', errors)
  return { valid: errors.length === 0, errors }
}

function main(argv) {
  const files = argv.length > 0
    ? argv.map((f) => resolve(f))
    : readdirSync(HERE)
        .filter((f) => f.endsWith('.json') && f !== 'manifest.schema.json')
        .map((f) => join(HERE, f))

  if (files.length === 0) {
    console.error('No hay manifests que validar')
    return 1
  }

  const schema = loadSchema()
  let failures = 0
  for (const file of files) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      console.error(`✗ ${file}: JSON inválido — ${e.message}`)
      failures++
      continue
    }
    const { valid, errors } = validateManifest(manifest, schema)
    if (valid) {
      console.log(`✓ ${file}`)
    } else {
      failures++
      console.error(`✗ ${file}:`)
      for (const err of errors) console.error(`    ${err}`)
    }
  }
  console.log(`${files.length - failures}/${files.length} manifests válidos`)
  return failures === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
