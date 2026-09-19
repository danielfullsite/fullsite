export interface ImportedContact {
  name: string
  phone: string
  email?: string
  lastVisit?: string
  totalVisits?: number
  birthday?: string
  source?: 'vcard' | 'csv' | 'xlsx'
}

export function normalizeMexicanPhone(value: string): string {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  // Mexico removed the legacy mobile "1" from E.164 numbers in 2019.
  if (digits.startsWith('521') && digits.length === 13) digits = `52${digits.slice(3)}`
  if (digits.length === 10) digits = `52${digits}`
  return digits.length >= 10 && digits.length <= 15 ? digits : ''
}

export function normalizePhoneWithCountry(value: string, countryCode: string): string {
  const rawDigits = value.replace(/\D/g, '')
  const code = countryCode.replace(/\.0+$/, '').replace(/\D/g, '')
  if (!code || code === '52') {
    if (code === '52' && rawDigits.length === 11 && rawDigits.startsWith('1')) return ''
    return normalizeMexicanPhone(value)
  }
  if (code === '1') {
    const digits = rawDigits.length === 10 ? `1${rawDigits}` : rawDigits
    return digits.length === 11 && digits.startsWith('1') && /^[2-9]/.test(digits[1]) && /^[2-9]/.test(digits[4]) ? digits : ''
  }
  const digits = rawDigits.startsWith(code) ? rawDigits : `${code}${rawDigits}`
  return digits.length >= 8 && digits.length <= 15 ? digits : ''
}

function unfoldVCard(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

export function parseVCardContacts(text: string): ImportedContact[] {
  const cards = text.split(/END:VCARD/i)
  const contacts: ImportedContact[] = []
  for (const card of cards) {
    const lines = unfoldVCard(card)
    const fullName = lines.find(line => /^FN(?:;[^:]*)?:/i.test(line))?.split(':').slice(1).join(':').trim()
    const structured = lines.find(line => /^N(?:;[^:]*)?:/i.test(line))?.split(':').slice(1).join(':').split(';')
    const fallbackName = structured ? [structured[1], structured[0]].filter(Boolean).join(' ').trim() : ''
    const name = (fullName || fallbackName || 'Contacto sin nombre').replace(/\\([,;])/g, '$1')
    for (const line of lines.filter(value => /^TEL(?:;[^:]*)?:/i.test(value))) {
      const phone = normalizeMexicanPhone(line.split(':').slice(1).join(':'))
      if (phone.length >= 10) contacts.push({ name, phone, source: 'vcard' })
    }
  }
  return dedupeContacts(contacts)
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { values.push(value.trim()); value = '' }
    else value += char
  }
  values.push(value.trim())
  return values
}

export function parseCsvContacts(text: string): ImportedContact[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map(value => value.toLowerCase())
  const phoneIndex = headers.findIndex(value => /phone|tel[eé]fono|mobile|celular/.test(value))
  const nameIndex = headers.findIndex(value => /^(name|nombre|full name|display name)$/.test(value))
  const firstIndex = headers.findIndex(value => /first name|nombre propio/.test(value))
  const lastIndex = headers.findIndex(value => /last name|apellido/.test(value))
  if (phoneIndex < 0) return []
  return dedupeContacts(lines.slice(1).map(parseCsvLine).map(values => ({
    name: values[nameIndex] || [values[firstIndex], values[lastIndex]].filter(Boolean).join(' ') || 'Contacto sin nombre',
    phone: normalizeMexicanPhone(values[phoneIndex] || ''),
    source: 'csv' as const,
  })).filter(contact => contact.phone.length >= 10))
}

export function parseContactFile(text: string, filename: string): ImportedContact[] {
  return filename.toLowerCase().endsWith('.vcf') || /BEGIN:VCARD/i.test(text)
    ? parseVCardContacts(text)
    : parseCsvContacts(text)
}

function cellText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

function excelDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const text = cellText(value)
  if (!text) return undefined
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10)
}

/** Parse vCard, CSV or the native Amalay customer export without uploading the file. */
export async function parseContactUpload(file: File): Promise<ImportedContact[]> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return parseContactFile(await file.text(), file.name)

  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const rows = await readXlsxFile(file) as unknown as unknown[][]
  return parseXlsxContactRows(rows)
}

export function parseXlsxContactRows(rows: unknown[][]): ImportedContact[] {
  if (rows.length < 2) return []
  const headers = rows[0].map(value => cellText(value).toLowerCase())
  const column = (pattern: RegExp) => headers.findIndex(value => pattern.test(value))
  const first = column(/^nombre$/)
  const last = column(/^apellido$/)
  const phone = column(/tel[eé]fono|phone|mobile|celular/)
  const country = column(/cod\.?\s*pa[ií]s|country code/)
  const email = column(/correo electr[oó]nico|e-?mail/)
  const visits = column(/^visitas$|total visits/)
  const lastVisit = column(/[uú]ltima visita|last visit/)
  const birthday = column(/cumplea[nñ]os|birthday/)
  if (phone < 0) return []

  return dedupeContacts(rows.slice(1).map(row => {
    const local = cellText(row[phone])
    const countryCode = country >= 0 ? cellText(row[country]) : ''
    const normalized = normalizePhoneWithCountry(local, countryCode)
    const totalVisits = visits >= 0 ? Number(row[visits]) : 0
    return {
      name: [cellText(row[first]), cellText(row[last])].filter(Boolean).join(' ') || 'Contacto sin nombre',
      phone: normalized,
      email: email >= 0 ? cellText(row[email]).toLowerCase() || undefined : undefined,
      lastVisit: lastVisit >= 0 ? excelDate(row[lastVisit]) : undefined,
      totalVisits: Number.isFinite(totalVisits) ? Math.max(0, totalVisits) : 0,
      birthday: birthday >= 0 ? excelDate(row[birthday]) : undefined,
      source: 'xlsx' as const,
    }
  }).filter(contact => contact.phone.length >= 10))
}

export function dedupeContacts(contacts: ImportedContact[]): ImportedContact[] {
  const unique = new Map<string, ImportedContact>()
  contacts.forEach(contact => {
    const phone = normalizeMexicanPhone(contact.phone)
    if (phone.length >= 10 && !unique.has(phone)) unique.set(phone, { ...contact, phone })
  })
  return [...unique.values()]
}
