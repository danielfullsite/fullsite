import { describe, expect, it } from 'vitest'
import { shouldUsePersistedFloorCoordinates } from '@/lib/floorplan-coordinates'

describe('floor plan coordinate source', () => {
  it('keeps AMALAY on its traced mesas canvas', () => {
    expect(shouldUsePersistedFloorCoordinates('amalay')).toBe(false)
  })

  it('uses persisted editor coordinates for generic tenants', () => {
    expect(shouldUsePersistedFloorCoordinates('escondite')).toBe(true)
  })
})
