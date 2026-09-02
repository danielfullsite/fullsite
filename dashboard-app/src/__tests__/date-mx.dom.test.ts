import { describe, it, expect, beforeEach } from 'vitest'
import { getActiveTimezone, setActiveTimezone } from '@/lib/date-mx'

// Corre en jsdom (vitest.config.dom.ts, patrón *.dom.test.ts): hay window + localStorage.
// Prueba la resolución de zona en el cliente.

describe('getActiveTimezone (cliente)', () => {
  beforeEach(() => {
    try { localStorage.removeItem('fullsite_timezone') } catch { /* — */ }
  })

  it('prioriza la zona guardada en localStorage', () => {
    setActiveTimezone('America/Tijuana')
    expect(getActiveTimezone()).toBe('America/Tijuana')
    expect(localStorage.getItem('fullsite_timezone')).toBe('America/Tijuana')
  })

  it('trim de la zona guardada', () => {
    setActiveTimezone('  America/Cancun  ')
    expect(getActiveTimezone()).toBe('America/Cancun')
  })

  it('setActiveTimezone ignora vacío/nulo (no sobreescribe con basura)', () => {
    setActiveTimezone('America/Tijuana')
    setActiveTimezone('')
    setActiveTimezone(null)
    setActiveTimezone(undefined)
    expect(getActiveTimezone()).toBe('America/Tijuana')
  })

  it('sin zona guardada cae a la zona de la máquina (Intl) — el "adapta a la compu"', () => {
    const dev = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(getActiveTimezone()).toBe(dev)
  })
})
