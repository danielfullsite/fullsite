// Gate R2-G04 / CLON-TERMINALS — POS, KDS e impresora provisionables desde
// manifest sin edición de código. Los artefactos generados deben pasar los
// validadores REALES de las apps Electron (config-schema.js y
// printer-config-schema.js), no una copia.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  generateTerminalConfigs,
  serialize,
} from '../../scripts/manifests/generate_terminal_config.mjs'
import { SCHEMA_PATH } from '../../scripts/manifests/validate_manifest.mjs'

const require = createRequire(import.meta.url)
const configSchema = require('../../electron-app/local-server/config-schema.js')
const printerConfigSchema = require('../../electron-app/local-server/adapters/printer-config-schema.js')

const MANIFESTS_DIR = join(SCHEMA_PATH, '..')
const PROVISIONED_AT = '2026-08-08T12:00:00.000Z'

function nomada() {
  return JSON.parse(readFileSync(join(MANIFESTS_DIR, 'nomada-mini.json'), 'utf8'))
}

function generate(manifest = nomada()) {
  return generateTerminalConfigs(manifest, { provisionedAt: PROVISIONED_AT })
}

describe('manifest real nomada-mini.json → artefactos de terminal', () => {
  const result = generate()

  it('genera sin errores', () => {
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('emite un artefacto por terminal del manifest', () => {
    expect(result.artifacts.map((a) => a.terminal_id)).toEqual([
      'nomada-caja',
      'nomada-kds-cocina',
    ])
  })

  it('cada config.json pasa el validador real de electron-app', () => {
    for (const { files } of result.artifacts) {
      const { valid, errors } = configSchema.validate(files['config.json'])
      expect(errors).toEqual([])
      expect(valid).toBe(true)
    }
  })

  it('printers.json pasa el validador real (schema v2) y loadAndValidate sin migración', () => {
    const caja = result.artifacts.find((a) => a.terminal_id === 'nomada-caja')
    const printersJson = caja.files['printers.json']
    expect(printerConfigSchema.validate(printersJson).errors).toEqual([])
    const loaded = printerConfigSchema.loadAndValidate(printersJson)
    expect(loaded.valid).toBe(true)
    expect(loaded.migrated).toBe(false)
  })

  it('la terminal server_pos apunta a localhost y no es kds_only', () => {
    const caja = result.artifacts.find((a) => a.terminal_id === 'nomada-caja')
    const cfg = caja.files['config.json']
    expect(cfg.terminal_role).toBe('server_pos')
    expect(cfg.local_server_host).toBe('127.0.0.1')
    expect(cfg.local_server_port).toBe(7717)
    expect(cfg.kds_only).toBe(false)
    expect(cfg.restaurant_id).toBe('nomada')
  })

  it('la terminal kds deriva kds_only=true y apunta al server_pos', () => {
    const kds = result.artifacts.find((a) => a.terminal_id === 'nomada-kds-cocina')
    const cfg = kds.files['config.json']
    expect(cfg.terminal_role).toBe('kds')
    expect(cfg.kds_only).toBe(true)
    expect(cfg.local_server_host).toBe('192.168.1.71')
    expect(cfg.pos_server_ip).toBe('192.168.1.71')
    expect(kds.files['printers.json']).toBeUndefined()
  })

  it('las estaciones ruteadas por printers.json resuelven con resolveStation()', () => {
    const caja = result.artifacts.find((a) => a.terminal_id === 'nomada-caja')
    const { printers } = caja.files['printers.json']
    for (const [station, docType] of [
      ['cocina', 'kitchen_ticket'],
      ['barra', 'bar_ticket'],
      ['caja', 'receipt'],
    ]) {
      const resolved = printerConfigSchema.resolveStation(printers, station, docType)
      expect(resolved.diagnostic).toBe(null)
      expect(resolved.printers.length).toBeGreaterThan(0)
    }
  })
})

describe('determinismo — provisioning config-only, reproducible', () => {
  it('mismo manifest + mismo provisioned_at ⇒ bytes idénticos', () => {
    const a = generate()
    const b = generate()
    expect(serialize(a.artifacts)).toBe(serialize(b.artifacts))
  })

  it('no inventa UUIDs ni timestamps fuera del provisioned_at inyectado', () => {
    const flat = JSON.stringify(generate().artifacts)
    const dates = flat.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g) ?? []
    expect(dates.every((d) => d === PROVISIONED_AT)).toBe(true)
  })
})

describe('validaciones cruzadas — el generador rechaza manifests incoherentes', () => {
  it('exige provisionedAt válido', () => {
    const r = generateTerminalConfigs(nomada(), { provisionedAt: 'ayer' })
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/provisionedAt/)
  })

  it('rechaza manifest que no pasa el schema estricto', () => {
    const m = nomada()
    m.terminals[0].role = 'cajero'
    const r = generate(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/role/)
  })

  it('rechaza kds sin pos_server_ip', () => {
    const m = nomada()
    delete m.terminals[1].pos_server_ip
    const r = generate(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/pos_server_ip/)
  })

  it('rechaza terminal_id duplicado', () => {
    const m = nomada()
    m.terminals.push({ ...m.terminals[0] })
    const r = generate(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/duplicado/)
  })

  it('rechaza printer_ids que no existen en manifest.printers', () => {
    const m = nomada()
    m.terminals[0].printer_ids = ['fantasma']
    const r = generate(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/fantasma/)
  })

  it('rechaza terminal pos sin sección printers', () => {
    const m = nomada()
    delete m.printers
    const r = generate(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/printers/)
  })

  it('rechaza manifest sin sección terminals', () => {
    const m = nomada()
    delete m.terminals
    const r = generate(m)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/terminals/)
  })
})

describe('asignación de impresoras por terminal', () => {
  it('printer_ids filtra el printers.json emitido', () => {
    const m = nomada()
    m.terminals[0].printer_ids = ['caja-tickets']
    const r = generate(m)
    expect(r.ok).toBe(true)
    const caja = r.artifacts.find((a) => a.terminal_id === 'nomada-caja')
    expect(caja.files['printers.json'].printers.map((p) => p.printer_id)).toEqual([
      'caja-tickets',
    ])
  })

  it('sin printer_ids, la terminal recibe todas las impresoras del manifest', () => {
    const r = generate()
    const caja = r.artifacts.find((a) => a.terminal_id === 'nomada-caja')
    expect(caja.files['printers.json'].printers).toHaveLength(3)
  })
})
