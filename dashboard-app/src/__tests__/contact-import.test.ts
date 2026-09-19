import { describe, expect, it } from 'vitest'
import { normalizeMexicanPhone, normalizePhoneWithCountry, parseCsvContacts, parseVCardContacts, parseXlsxContactRows } from '@/lib/contact-import'

describe('contact import', () => {
  it('normalizes ten digit Mexican numbers', () => {
    expect(normalizeMexicanPhone('(81) 1234-5678')).toBe('528112345678')
    expect(normalizeMexicanPhone('+52 1 81 1234 5678')).toBe('528112345678')
  })

  it('honors the explicit country code before applying Mexican defaults', () => {
    expect(normalizePhoneWithCountry('212 555 0123', '1')).toBe('12125550123')
    expect(normalizePhoneWithCountry('81 1234 5678', '52')).toBe('528112345678')
    expect(normalizePhoneWithCountry('1 81 1234 5678', '52')).toBe('')
  })

  it('reads and deduplicates vCard contacts', () => {
    const vcf = `BEGIN:VCARD\nVERSION:3.0\nFN:Ana Pérez\nTEL;TYPE=CELL:8112345678\nTEL;TYPE=HOME:81 1234 5678\nEND:VCARD`
    expect(parseVCardContacts(vcf)).toEqual([{ name: 'Ana Pérez', phone: '528112345678', source: 'vcard' }])
  })

  it('reads a Contacts CSV export', () => {
    const csv = 'First Name,Last Name,Phone\nAna,Pérez,"(81) 1234-5678"'
    expect(parseCsvContacts(csv)).toEqual([{ name: 'Ana Pérez', phone: '528112345678', source: 'csv' }])
  })

  it('reads the native Amalay Excel columns', () => {
    const rows = [
      ['Nombre', 'Apellido', 'Cod. País', 'Teléfono', 'Correo Electrónico', 'Visitas', 'Última Visita'],
      ['Ana', 'Pérez', 52, '81 1234 5678', 'ANA@example.com', 3, new Date('2026-08-01T12:00:00Z')],
    ]
    expect(parseXlsxContactRows(rows)).toEqual([{
      name: 'Ana Pérez', phone: '528112345678', email: 'ana@example.com', totalVisits: 3,
      lastVisit: '2026-08-01', birthday: undefined, source: 'xlsx',
    }])
  })
})
