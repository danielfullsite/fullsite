import { describe, it, expect } from 'vitest'
import { getClientIdFromEmail, getClientConfig } from '@/lib/client-config'

// ─── getClientIdFromEmail ────────────────────────────────────────────────

describe('getClientIdFromEmail', () => {
  it('maps ramonfaur.daniel@gmail.com to amalay', () => {
    expect(getClientIdFromEmail('ramonfaur.daniel@gmail.com')).toBe('amalay')
  })

  it('maps monica@fullsite.mx to amalay', () => {
    expect(getClientIdFromEmail('monica@fullsite.mx')).toBe('amalay')
  })

  it('maps demo@fullsite.mx to demo', () => {
    expect(getClientIdFromEmail('demo@fullsite.mx')).toBe('demo')
  })

  it('returns demo for unknown email', () => {
    expect(getClientIdFromEmail('unknown@example.com')).toBe('demo')
  })

  it('returns demo for empty string', () => {
    expect(getClientIdFromEmail('')).toBe('demo')
  })

  it('is case sensitive (uppercase returns demo)', () => {
    expect(getClientIdFromEmail('RAMONFAUR.DANIEL@GMAIL.COM')).toBe('demo')
  })

  it('returns demo for email with extra spaces', () => {
    expect(getClientIdFromEmail(' ramonfaur.daniel@gmail.com ')).toBe('demo')
  })

  it('returns demo for partial match', () => {
    expect(getClientIdFromEmail('ramonfaur.daniel')).toBe('demo')
  })

  it('returns demo for random string', () => {
    expect(getClientIdFromEmail('not-an-email')).toBe('demo')
  })

  it('returns demo for null-ish values (empty)', () => {
    expect(getClientIdFromEmail('')).toBe('demo')
  })
})

// ─── getClientConfig ─────────────────────────────────────────────────────

describe('getClientConfig', () => {
  describe('amalay config', () => {
    const config = getClientConfig('amalay')

    it('returns id as amalay', () => {
      expect(config.id).toBe('amalay')
    })

    it('has display_name', () => {
      expect(config.display_name).toBe('AMALAY Coffee & Market')
    })

    it('has city', () => {
      expect(config.city).toBe('Monterrey, NL')
    })

    it('has timezone', () => {
      expect(config.timezone).toBe('America/Mexico_City')
    })

    it('has type', () => {
      expect(config.type).toBe('Brunch & Café')
    })

    it('has default_theme light', () => {
      expect(config.default_theme).toBe('light')
    })

    it('has accent_color emerald', () => {
      expect(config.accent_color).toBe('emerald')
    })

    it('has 16 mesas', () => {
      expect(config.mesas).toBe(16)
    })

    it('has meseros array', () => {
      expect(Array.isArray(config.meseros)).toBe(true)
      expect(config.meseros.length).toBeGreaterThan(0)
    })

    it('meseros includes Omar Aguilera', () => {
      expect(config.meseros).toContain('Omar Aguilera')
    })

    it('has IVA rate 0.16', () => {
      expect(config.iva_rate).toBe(0.16)
    })

    it('has data_source supabase', () => {
      expect(config.data_source).toBe('supabase')
    })

    it('has features object', () => {
      expect(config.features).toBeDefined()
      expect(typeof config.features).toBe('object')
    })

    it('features.pos is true', () => {
      expect(config.features.pos).toBe(true)
    })

    it('features.posRestaurant is true', () => {
      expect(config.features.posRestaurant).toBe(true)
    })

    it('features.inventory is true', () => {
      expect(config.features.inventory).toBe(true)
    })

    it('features.foodCost is true', () => {
      expect(config.features.foodCost).toBe(true)
    })

    it('features.facturacion is true', () => {
      expect(config.features.facturacion).toBe(true)
    })

    it('features.agentesIA is true', () => {
      expect(config.features.agentesIA).toBe(true)
    })

    it('features.coach is true', () => {
      expect(config.features.coach).toBe(true)
    })

    it('features.chatIA is true', () => {
      expect(config.features.chatIA).toBe(true)
    })
  })

  describe('demo config', () => {
    const config = getClientConfig('demo')

    it('returns id as demo', () => {
      expect(config.id).toBe('demo')
    })

    it('has display_name Casa Montaña', () => {
      expect(config.display_name).toBe('Casa Montaña')
    })

    it('has 28 mesas', () => {
      expect(config.mesas).toBe(28)
    })

    it('has data_source demo', () => {
      expect(config.data_source).toBe('demo')
    })

    it('has nomina feature enabled', () => {
      expect(config.features.nomina).toBe(true)
    })

    it('has delivery feature enabled', () => {
      expect(config.features.delivery).toBe(true)
    })

    it('has ecommerce feature enabled', () => {
      expect(config.features.ecommerce).toBe(true)
    })

    it('has resenas feature enabled', () => {
      expect(config.features.resenas).toBe(true)
    })

    it('has giftCards feature enabled', () => {
      expect(config.features.giftCards).toBe(true)
    })

    it('has meseros array', () => {
      expect(config.meseros.length).toBeGreaterThan(0)
    })
  })

  describe('unknown client config', () => {
    const config = getClientConfig('unknown-restaurant')

    it('returns the id as given', () => {
      expect(config.id).toBe('unknown-restaurant')
    })

    it('uses the id as display_name', () => {
      expect(config.display_name).toBe('unknown-restaurant')
    })

    it('has empty city', () => {
      expect(config.city).toBe('')
    })

    it('has default timezone', () => {
      expect(config.timezone).toBe('America/Mexico_City')
    })

    it('has default theme light', () => {
      expect(config.default_theme).toBe('light')
    })

    it('has default accent_color emerald', () => {
      expect(config.accent_color).toBe('emerald')
    })

    it('has 16 mesas by default', () => {
      expect(config.mesas).toBe(16)
    })

    it('has empty meseros array', () => {
      expect(config.meseros).toEqual([])
    })

    it('has default IVA rate', () => {
      expect(config.iva_rate).toBe(0.16)
    })

    it('has default data_source supabase', () => {
      expect(config.data_source).toBe('supabase')
    })

    it('has default features', () => {
      expect(config.features.pos).toBe(true)
      expect(config.features.posRestaurant).toBe(true)
    })
  })

  describe('empty string client', () => {
    const config = getClientConfig('')

    it('returns empty id', () => {
      expect(config.id).toBe('')
    })

    it('uses default values', () => {
      expect(config.timezone).toBe('America/Mexico_City')
      expect(config.iva_rate).toBe(0.16)
    })
  })
})
