// WhatsApp CRM — generates messages and tracks recovery

export interface RecoveryMessage {
  clientName: string
  phone: string
  incentive: string
  restaurantName: string
  validDays: string // "lunes a viernes"
}

export function generateRecoveryMessage(msg: RecoveryMessage): string {
  return `Hola ${msg.clientName}, te habla el conserje digital de ${msg.restaurantName}. Hace tiempo que no te vemos y nos encantaria regalarte ${msg.incentive} en tu proxima visita. Yo te puedo ayudar con tu reservacion, si te interesa visitarnos, contestame aqui y yo me encargo del resto. Promocion valida de ${msg.validDays}.`
}

export function generateWhatsAppLink(phone: string, message: string): string {
  // Normalizar a internacional MX (52 + 10 díg) por LONGITUD, no por prefijo:
  // un número MX de 10 díg que casualmente empieza en "52" (ej. lada 520) NO trae
  // código de país — el `startsWith('52')` viejo lo dejaba sin lada → wa.me roto.
  let clean = phone.replace(/\D/g, '')
  if (clean.length === 10) clean = `52${clean}`
  else if (clean.length === 13 && clean.startsWith('521')) clean = `52${clean.slice(3)}` // WhatsApp viejo (521) → 52
  // 12 díg con 52 ya está en formato; otras longitudes se dejan tal cual (mejor esfuerzo).
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`
}

/** ¿El teléfono es marcable por WhatsApp MX? (10 díg, o 12/13 con lada 52/521). */
export function isWhatsAppablePhone(phone: string): boolean {
  const clean = (phone || '').replace(/\D/g, '')
  return clean.length === 10 ||
    (clean.length === 12 && clean.startsWith('52')) ||
    (clean.length === 13 && clean.startsWith('521'))
}

// For bulk sending via WhatsApp Business API (future)
export function generateBulkMessages(
  clients: Array<{ name: string; phone: string }>,
  template: string,
  incentive: string,
  restaurantName: string,
  validDays: string
): Array<{ phone: string; message: string; waLink: string }> {
  return clients.map(client => {
    const message = template
      .replace('{name}', client.name)
      .replace('{incentive}', incentive)
      .replace('{restaurant}', restaurantName)
      .replace('{valid_days}', validDays)
    return {
      phone: client.phone,
      message,
      waLink: generateWhatsAppLink(client.phone, message),
    }
  })
}
