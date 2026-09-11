// Cada campo que el Corte Z escribe tiene que existir en `pos_cierres`.
//
// P0 del barrido 2026-09-10: el wizard escribía `cola_pendiente_al_cerrar`, una
// columna que existía en AMALAY (agregada por MCP) y en ningún otro entorno.
// PostgREST respondía 400 PGRST204, el wizard lo tragaba como «queued», la cola
// lo marcaba terminal y el turno quedaba cerrado SIN cierre. Esta prueba
// confronta la fila real contra el esquema real: baseline + `alter table ...
// add column` de todas las migraciones aplicadas (no las PENDIENTE_).
//
// A/B: sin `20260910090000_pos_cierres_cola_pendiente.sql` esta prueba falla.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { armarFilaDeCierre, fechaDelCierre, rechazoDefinitivo } from '@/lib/pos-cierre-fila'
import { withEscalationPayload } from '@/lib/pos-cierre-guard'

const MIGRACIONES = path.join(process.cwd(), '..', 'supabase', 'migrations')

function columnasDePosCierres(): Set<string> {
  const columnas = new Set<string>()
  const archivos = fs.readdirSync(MIGRACIONES).filter(f => f.endsWith('.sql') && !f.startsWith('PENDIENTE_')).sort()
  for (const archivo of archivos) {
    const sql = fs.readFileSync(path.join(MIGRACIONES, archivo), 'utf8')
    const create = sql.match(/CREATE TABLE IF NOT EXISTS "public"\."pos_cierres" \(([\s\S]*?)\n\);/)
    if (create) for (const linea of create[1].split('\n')) { const m = linea.match(/^\s*"([a-z_]+)"\s/); if (m) columnas.add(m[1]) }
    for (const m of sql.matchAll(/alter\s+table\s+(?:only\s+)?(?:"?public"?\.)?"?pos_cierres"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_]+)"?/gi)) columnas.add(m[1])
  }
  return columnas
}

const datos = {
  id: 'cierre-1', clientId: 'amalay', turnoId: 't-1', ahora: new Date('2026-09-03T03:27:00.000Z'),
  fondoInicial: 500, totalContado: 1200, efectivoEsperado: 1180, tarjeta: 300, transferencias: 0, otros: 50,
  diferencia: 20, totalVentas: 1530, ticketsCount: 12, cancelaciones: 1, descuentos: 0, propinas: 80,
  colaPendiente: 2, notas: null, closedBy: 'Gerente',
}

describe('la fila del cierre cabe en pos_cierres', () => {
  it('REGRESION: cada campo escrito existe como columna en el esquema del repositorio', () => {
    const columnas = columnasDePosCierres()
    expect(columnas.size).toBeGreaterThan(20)
    const fila = withEscalationPayload(armarFilaDeCierre(datos), [{ id: 'o1', mesa: 3, mesero: 'Ana', status: 'enviada', total: 10 }], 'Dueño', 'se fueron sin pagar')
    const faltan = Object.keys(fila).filter(k => !columnas.has(k))
    expect(faltan, `columnas sin migración: ${faltan.join(', ')}`).toEqual([])
  })

  it('la que costó el P0 está en el esquema y en la fila', () => {
    expect(columnasDePosCierres().has('cola_pendiente_al_cerrar')).toBe(true)
    expect(armarFilaDeCierre(datos).cola_pendiente_al_cerrar).toBe(2)
    expect(armarFilaDeCierre(datos).otros_sistema).toBe(50)
  })
})

describe('la fecha del cierre es el día de venta, no el reloj UTC', () => {
  it('REGRESION: un Z a las 21:27 de Monterrey del 2 de septiembre se fecha el 2, no el 3', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    // 2026-09-03T03:27Z = 2026-09-02 21:27 America/Monterrey
    expect(fechaDelCierre(new Date('2026-09-03T03:27:00.000Z'))).toBe('2026-09-02')
    expect(armarFilaDeCierre(datos).fecha).toBe('2026-09-02')
  })
  it('un Z a las 02:00 cae en el día de venta anterior (inicio 05:00)', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    // 2026-09-03T08:00Z = 2026-09-03 02:00 Monterrey → día de venta 2026-09-02
    expect(fechaDelCierre(new Date('2026-09-03T08:00:00.000Z'))).toBe('2026-09-02')
  })
})

describe('un rechazo definitivo no se disfraza de «queued»', () => {
  it('400/404/409/422 son definitivos; 401/403/408/429 y 5xx no', () => {
    for (const s of [400, 404, 409, 422]) expect(rechazoDefinitivo(s), String(s)).toBe(true)
    for (const s of [401, 403, 408, 429, 500, 502, 503, 200]) expect(rechazoDefinitivo(s), String(s)).toBe(false)
  })
})

describe('el wizard no cierra el turno sobre un rechazo definitivo', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/pos/CierreCajaWizard.tsx'), 'utf8')
  it('REGRESION (fuente): el preflight del POST va ANTES de closeCachedTurno y aborta con rechazoDefinitivo', () => {
    const preflight = src.indexOf('rechazoDefinitivo(pre.status)')
    const cierraLocal = src.indexOf('await closeCachedTurno(')
    expect(preflight).toBeGreaterThan(0)
    expect(preflight).toBeLessThan(cierraLocal)
    const bloque = src.slice(preflight, cierraLocal)
    expect(bloque).toMatch(/setPinError\(/)
    expect(bloque).toMatch(/closingRef\.current = false[\s\S]*return/)
    expect(src).not.toMatch(/\/\* queued — will sync later \*\//)
  })
  it('la fila sale de armarFilaDeCierre y la fecha ya no es el reloj UTC', () => {
    expect(src).toMatch(/armarFilaDeCierre\(\{/)
    expect(src).not.toMatch(/fecha: now\.split\('T'\)\[0\]/)
  })
  it('la guardia de cuentas abiertas pregunta a Pedro bajo Caja', () => {
    expect(src).toMatch(/if \(requiereCaja\(\)\) \{\s*const salon = await leerSalon\(\)/)
  })
})

describe('movimientos de caja: nube + cola local, una sola vez cada uno', () => {
  it('REGRESION: un retiro que sigue en la cola cuenta aunque la nube ya tenga un depósito', async () => {
    const { fusionarMovimientos } = await import('@/components/pos/CierreCajaWizard')
    const nube = [{ id: 'a', type: 'deposito', amount: 500 }]
    const locales = [{ id: 'a', type: 'deposito', amount: 500 }, { id: 'b', type: 'retiro', amount: 200 }]
    expect(fusionarMovimientos(nube, locales)).toEqual([{ type: 'deposito', amount: 500 }, { type: 'retiro', amount: 200 }])
    expect(fusionarMovimientos([], locales)).toHaveLength(2)
    expect(fusionarMovimientos(nube, [])).toHaveLength(1)
  })
})
