import { describe, it, expect } from 'vitest'
import {
  generateRecoveryMessage,
  generateWhatsAppLink,
  generateBulkMessages,
  type RecoveryMessage,
} from '@/lib/whatsapp-crm'

// ─── generateRecoveryMessage ─────────────────────────────────────────────

describe('generateRecoveryMessage', () => {
  const base: RecoveryMessage = {
    clientName: 'María',
    phone: '8112345678',
    incentive: 'un postre gratis',
    restaurantName: 'AMALAY',
    validDays: 'lunes a viernes',
  }

  it('returns a string containing the client name', () => {
    const msg = generateRecoveryMessage(base)
    expect(msg).toContain('María')
  })

  it('includes the restaurant name', () => {
    expect(generateRecoveryMessage(base)).toContain('AMALAY')
  })

  it('includes the incentive', () => {
    expect(generateRecoveryMessage(base)).toContain('un postre gratis')
  })

  it('includes the valid days', () => {
    expect(generateRecoveryMessage(base)).toContain('lunes a viernes')
  })

  it('starts with Hola and client name', () => {
    expect(generateRecoveryMessage(base)).toMatch(/^Hola María/)
  })

  it('handles empty client name', () => {
    const msg = generateRecoveryMessage({ ...base, clientName: '' })
    expect(msg).toContain('Hola ,')
  })

  it('handles special characters in name', () => {
    const msg = generateRecoveryMessage({ ...base, clientName: 'José "El Chef" García' })
    expect(msg).toContain('José "El Chef" García')
  })

  it('handles accented characters', () => {
    const msg = generateRecoveryMessage({ ...base, clientName: 'Ñoño Señor Peña' })
    expect(msg).toContain('Ñoño Señor Peña')
  })

  it('handles very long names', () => {
    const longName = 'A'.repeat(200)
    const msg = generateRecoveryMessage({ ...base, clientName: longName })
    expect(msg).toContain(longName)
  })

  it('handles empty incentive', () => {
    const msg = generateRecoveryMessage({ ...base, incentive: '' })
    expect(msg).toContain('regalarte  en tu')
  })

  it('handles multiline incentive', () => {
    const msg = generateRecoveryMessage({ ...base, incentive: 'un 2x1\nen platillos' })
    expect(msg).toContain('un 2x1\nen platillos')
  })

  it('handles emoji in restaurant name', () => {
    const msg = generateRecoveryMessage({ ...base, restaurantName: 'AMALAY ☕' })
    expect(msg).toContain('AMALAY ☕')
  })

  it('includes the recovery pitch', () => {
    const msg = generateRecoveryMessage(base)
    expect(msg).toContain('Hace tiempo que no te vemos')
  })

  it('includes the call to action', () => {
    const msg = generateRecoveryMessage(base)
    expect(msg).toContain('contestame aqui')
  })

  it('includes Promocion valida', () => {
    const msg = generateRecoveryMessage(base)
    expect(msg).toContain('Promocion valida de lunes a viernes')
  })

  it('returns consistent output for same input', () => {
    const a = generateRecoveryMessage(base)
    const b = generateRecoveryMessage(base)
    expect(a).toBe(b)
  })

  it('different clients produce different messages', () => {
    const a = generateRecoveryMessage(base)
    const b = generateRecoveryMessage({ ...base, clientName: 'Pedro' })
    expect(a).not.toBe(b)
  })

  it('different restaurants produce different messages', () => {
    const a = generateRecoveryMessage(base)
    const b = generateRecoveryMessage({ ...base, restaurantName: 'La Nonna' })
    expect(a).not.toBe(b)
  })
})

// ─── generateWhatsAppLink ────────────────────────────────────────────────

describe('generateWhatsAppLink', () => {
  it('returns a wa.me URL', () => {
    const link = generateWhatsAppLink('8112345678', 'Hola')
    expect(link).toMatch(/^https:\/\/wa\.me\//)
  })

  it('prepends 52 country code if missing', () => {
    const link = generateWhatsAppLink('8112345678', 'Hi')
    expect(link).toContain('wa.me/528112345678')
  })

  it('does not double-prepend 52 if already present', () => {
    const link = generateWhatsAppLink('528112345678', 'Hi')
    expect(link).toContain('wa.me/528112345678')
    expect(link).not.toContain('5252')
  })

  it('strips non-numeric characters from phone', () => {
    const link = generateWhatsAppLink('+52 (81) 1234-5678', 'Hi')
    expect(link).toContain('wa.me/528112345678')
  })

  it('strips spaces', () => {
    const link = generateWhatsAppLink('81 1234 5678', 'Hi')
    expect(link).toContain('wa.me/528112345678')
  })

  it('strips parentheses and dashes', () => {
    const link = generateWhatsAppLink('(81)1234-5678', 'test')
    expect(link).toContain('wa.me/528112345678')
  })

  it('encodes message text in URL', () => {
    const link = generateWhatsAppLink('8112345678', 'Hola María')
    expect(link).toContain('text=Hola%20Mar%C3%ADa')
  })

  it('encodes special characters', () => {
    const link = generateWhatsAppLink('8112345678', 'Precio: $100 (50% off)')
    expect(link).toContain('text=')
    expect(link).toContain(encodeURIComponent('Precio: $100 (50% off)'))
  })

  it('handles empty phone', () => {
    const link = generateWhatsAppLink('', 'Hi')
    expect(link).toContain('wa.me/52')
  })

  it('handles empty message', () => {
    const link = generateWhatsAppLink('8112345678', '')
    expect(link).toContain('text=')
  })

  it('handles phone with dots', () => {
    const link = generateWhatsAppLink('81.1234.5678', 'Hi')
    expect(link).toContain('wa.me/528112345678')
  })

  it('handles phone with plus sign only', () => {
    const link = generateWhatsAppLink('+', 'Hi')
    expect(link).toContain('wa.me/52')
  })

  it('handles newlines in message', () => {
    const link = generateWhatsAppLink('8112345678', 'Hola\nMundo')
    expect(link).toContain(encodeURIComponent('Hola\nMundo'))
  })

  it('handles very long messages', () => {
    const longMsg = 'A'.repeat(5000)
    const link = generateWhatsAppLink('8112345678', longMsg)
    expect(link).toContain('wa.me/528112345678')
  })

  it('returns valid URL format', () => {
    const link = generateWhatsAppLink('8112345678', 'test')
    expect(() => new URL(link)).not.toThrow()
  })
})

// ─── generateBulkMessages ────────────────────────────────────────────────

describe('generateBulkMessages', () => {
  const clients = [
    { name: 'María', phone: '8112345678' },
    { name: 'Pedro', phone: '528198765432' },
    { name: 'Ana', phone: '(81) 5555-1234' },
  ]
  const template = 'Hola {name}, te invita {restaurant}. {incentive} valido {valid_days}.'
  const incentive = '2x1 en cafés'
  const restaurant = 'AMALAY'
  const validDays = 'lunes a viernes'

  it('returns an array with one entry per client', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    expect(result).toHaveLength(3)
  })

  it('each entry has phone, message, and waLink', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    for (const entry of result) {
      expect(entry).toHaveProperty('phone')
      expect(entry).toHaveProperty('message')
      expect(entry).toHaveProperty('waLink')
    }
  })

  it('substitutes {name} correctly', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    expect(result[0].message).toContain('Hola María')
    expect(result[1].message).toContain('Hola Pedro')
    expect(result[2].message).toContain('Hola Ana')
  })

  it('substitutes {restaurant} correctly', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    expect(result[0].message).toContain('AMALAY')
  })

  it('substitutes {incentive} correctly', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    expect(result[0].message).toContain('2x1 en cafés')
  })

  it('substitutes {valid_days} correctly', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    expect(result[0].message).toContain('lunes a viernes')
  })

  it('preserves original phone in entry', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    expect(result[0].phone).toBe('8112345678')
    expect(result[1].phone).toBe('528198765432')
    expect(result[2].phone).toBe('(81) 5555-1234')
  })

  it('waLink points to wa.me', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    for (const entry of result) {
      expect(entry.waLink).toMatch(/^https:\/\/wa\.me\//)
    }
  })

  it('waLink contains encoded message', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    for (const entry of result) {
      expect(entry.waLink).toContain('text=')
    }
  })

  it('handles empty clients array', () => {
    const result = generateBulkMessages([], template, incentive, restaurant, validDays)
    expect(result).toHaveLength(0)
  })

  it('handles single client', () => {
    const result = generateBulkMessages([clients[0]], template, incentive, restaurant, validDays)
    expect(result).toHaveLength(1)
  })

  it('handles template without placeholders', () => {
    const result = generateBulkMessages(clients, 'Static message', incentive, restaurant, validDays)
    expect(result[0].message).toBe('Static message')
    expect(result[1].message).toBe('Static message')
  })

  it('handles empty name in client', () => {
    const result = generateBulkMessages(
      [{ name: '', phone: '8112345678' }],
      template, incentive, restaurant, validDays
    )
    expect(result[0].message).toContain('Hola ,')
  })

  it('handles special characters in names', () => {
    const result = generateBulkMessages(
      [{ name: 'José & María', phone: '8112345678' }],
      template, incentive, restaurant, validDays
    )
    expect(result[0].message).toContain('José & María')
  })

  it('each client gets a unique waLink', () => {
    const result = generateBulkMessages(clients, template, incentive, restaurant, validDays)
    const links = result.map(r => r.waLink)
    const unique = new Set(links)
    expect(unique.size).toBe(links.length)
  })

  it('handles large batch (100 clients)', () => {
    const bigBatch = Array.from({ length: 100 }, (_, i) => ({
      name: `Client ${i}`,
      phone: `811234${String(i).padStart(4, '0')}`,
    }))
    const result = generateBulkMessages(bigBatch, template, incentive, restaurant, validDays)
    expect(result).toHaveLength(100)
    expect(result[50].message).toContain('Client 50')
  })

  it('only replaces first occurrence of each placeholder', () => {
    const tmpl = '{name} called {name} at {restaurant}'
    const result = generateBulkMessages(
      [{ name: 'Ana', phone: '8112345678' }],
      tmpl, incentive, restaurant, validDays
    )
    // String.replace only replaces first match
    expect(result[0].message).toBe('Ana called {name} at AMALAY')
  })
})
