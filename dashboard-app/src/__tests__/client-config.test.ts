import { describe, it, expect } from 'vitest'
import { getClientIdFromEmail, getClientConfig } from '@/lib/client-config'

// ─── getClientIdFromEmail ────────────────────────────────────────────────

describe('getClientIdFromEmail', () => {
  it('returns empty string for ramonfaur.daniel@gmail.com (owner email not hardcoded)', () => {
    expect(getClientIdFromEmail('ramonfaur.daniel@gmail.com')).toBe('')
  })

  it('maps demo@fullsite.mx to demo', () => {
    expect(getClientIdFromEmail('demo@fullsite.mx')).toBe('demo')
  })

  it('returns empty string for unknown email (new client gets no hardcoded tenant)', () => {
    expect(getClientIdFromEmail('unknown@example.com')).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(getClientIdFromEmail('')).toBe('')
  })

  it('is case sensitive (uppercase returns empty string)', () => {
    expect(getClientIdFromEmail('RAMONFAUR.DANIEL@GMAIL.COM')).toBe('')
  })

  it('returns empty string for email with extra spaces', () => {
    expect(getClientIdFromEmail(' ramonfaur.daniel@gmail.com ')).toBe('')
  })

  it('returns empty string for partial match', () => {
    expect(getClientIdFromEmail('ramonfaur.daniel')).toBe('')
  })

  it('returns empty string for random string', () => {
    expect(getClientIdFromEmail('not-an-email')).toBe('')
  })
})

// ─── getClientConfig ─────────────────────────────────────────────────────

describe('getClientConfig', () => {
  describe('amalay config', () => {
    const config = getClientConfig('amalay')

    it('returns id as amalay', () => {
      expect(config.id).toBe('amalay')
    })

    it('has display_name falling back to id when no DB', () => {
      expect(config.display_name).toBe('amalay')
    })

    it('has empty city when no DB (no hardcoded fallback)', () => {
      expect(config.city).toBe('')
    })

    it('has timezone', () => {
      expect(config.timezone).toBe('America/Mexico_City')
    })

    it('has empty type when no DB (no hardcoded fallback)', () => {
      expect(config.type).toBe('')
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

    it('has empty meseros array when no DB (staff not hardcoded)', () => {
      expect(Array.isArray(config.meseros)).toBe(true)
      expect(config.meseros.length).toBe(0)
    })

    it('meseros does not contain AMALAY-specific staff', () => {
      expect(config.meseros).not.toContain('Omar Aguilera')
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

    it('has display_name Café Central', () => {
      expect(config.display_name).toBe('Café Central')
    })

    it('has 15 mesas', () => {
      expect(config.mesas).toBe(15)
    })

    it('has data_source demo', () => {
      expect(config.data_source).toBe('demo')
    })

    it('has nomina feature disabled', () => {
      expect(config.features.nomina).toBe(false)
    })

    it('has delivery feature disabled', () => {
      expect(config.features.delivery).toBe(false)
    })

    it('has ecommerce feature disabled', () => {
      expect(config.features.ecommerce).toBe(false)
    })

    it('has resenas feature disabled', () => {
      expect(config.features.resenas).toBe(false)
    })

    it('has giftCards feature disabled', () => {
      expect(config.features.giftCards).toBe(false)
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
