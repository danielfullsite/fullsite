// Routing de estaciones por sucursal: determinista, aísla dos sucursales del mismo tenant, y
// sin config se comporta EXACTAMENTE como el routing legacy. Autocontenido.
import { describe, it, expect } from 'vitest'
import { getStationForItem } from '../lib/pos-constants'
import {
  resolveStationForLocation, buildLocationStationConfig, type LocationStationConfig,
} from '../lib/station-routing-location'

// Categorías con estación de sistema conocida (STATION_CATEGORIES):
//   cerveza,coffee → barra · chilaquiles,postres → cocina · icecream → caja
const ITEMS = [
  { categoryId: 'cerveza', itemName: 'Heineken', sistema: 'barra' },
  { categoryId: 'coffee', itemName: 'Latte', sistema: 'barra' },
  { categoryId: 'chilaquiles', itemName: 'Chilaquiles verdes', sistema: 'cocina' },
  { categoryId: 'icecream', itemName: 'Helado', sistema: 'caja' },
] as const

describe('compat legacy — sin config = getStationForItem exacto', () => {
  it.each(ITEMS)('$categoryId → estación de sistema', ({ categoryId, itemName }) => {
    const legacy = getStationForItem(categoryId, itemName)
    expect(resolveStationForLocation({ categoryId, itemName })).toBe(legacy)
    expect(resolveStationForLocation({ categoryId, itemName }, null)).toBe(legacy)
  })
})

describe('determinismo', () => {
  it('misma entrada → misma salida (config con override y plegado)', () => {
    const cfg: LocationStationConfig = { enabledStations: ['cocina'], overrides: { cerveza: 'barra' } }
    const a = resolveStationForLocation({ categoryId: 'cerveza', itemName: 'Heineken' }, cfg)
    const b = resolveStationForLocation({ categoryId: 'cerveza', itemName: 'Heineken' }, cfg)
    expect(a).toBe(b)
  })
})

describe('aislamiento de dos sucursales del mismo tenant', () => {
  // Sucursal A: tiene barra; enruta chilaquiles a barra por override.
  const sucursalA: LocationStationConfig = {
    enabledStations: ['cocina', 'barra', 'caja'],
    overrides: { chilaquiles: 'barra' },
  }
  // Sucursal B: NO tiene barra; sin overrides.
  const sucursalB: LocationStationConfig = { enabledStations: ['cocina'], overrides: {} }

  it('el MISMO item cae en estaciones distintas según la sucursal', () => {
    const item = { categoryId: 'cerveza', itemName: 'Heineken' } // sistema: barra
    expect(resolveStationForLocation(item, sucursalA)).toBe('barra')   // A tiene barra
    expect(resolveStationForLocation(item, sucursalB)).toBe('cocina')  // B pliega barra→cocina
  })

  it('un override de A no afecta a B (config por sucursal, no compartida)', () => {
    const item = { categoryId: 'chilaquiles', itemName: 'Chilaquiles' } // sistema: cocina
    expect(resolveStationForLocation(item, sucursalA)).toBe('barra')   // override de A
    expect(resolveStationForLocation(item, sucursalB)).toBe('cocina')  // B sin override
  })
})

describe('plegado determinista cuando la estación no existe en la sucursal', () => {
  it('barra→cocina antes que caja', () => {
    const cfg: LocationStationConfig = { enabledStations: ['caja', 'cocina'], overrides: {} }
    expect(resolveStationForLocation({ categoryId: 'cerveza', itemName: 'x' }, cfg)).toBe('cocina')
  })
  it('caja→cocina cuando sólo hay cocina', () => {
    const cfg: LocationStationConfig = { enabledStations: ['cocina'], overrides: {} }
    expect(resolveStationForLocation({ categoryId: 'icecream', itemName: 'Helado' }, cfg)).toBe('cocina')
  })
})

describe('buildLocationStationConfig', () => {
  it('filas vacías → null (legacy)', () => {
    expect(buildLocationStationConfig([])).toBeNull()
  })
  it('proyecta estaciones habilitadas y overrides, ignorando basura', () => {
    const cfg = buildLocationStationConfig([
      { station: 'cocina', category_overrides: { chilaquiles: 'barra', malo: 'inexistente' } },
      { station: 'barra' },
      { station: 'estacion-invalida' as unknown as string },
    ])
    expect(cfg?.enabledStations.sort()).toEqual(['barra', 'cocina'])
    expect(cfg?.overrides).toEqual({ chilaquiles: 'barra' }) // 'malo' descartado
  })
})
