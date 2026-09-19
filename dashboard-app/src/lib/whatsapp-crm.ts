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

/** Campaign copy approved for turning AMALAY brunch guests into dinner guests. */
export function generateDinnerCampaignMessage(msg: RecoveryMessage): string {
  return `Hola ${msg.clientName} 👋 Soy el Concierge Digital de ${msg.restaurantName} y queremos regalarte ${msg.incentive} en tu próxima cena.\n\n🍷✨ Hay noches que merecen una mesa especial.\n\nVen a descubrir las cenas de ${msg.restaurantName} y disfruta nuestro nuevo menú de focaccias y baguettes, además de pizzas, ensaladas y mucho más. ✨\n\nUna linda mesa, nuevos sabores y una noche para disfrutar sin prisa.\n\n📍 ${msg.validDays}.\n\n¿Te reservamos una mesa?`
}

export function generateWhatsAppLink(phone: string, message: string): string {
  // Clean phone number
  const clean = phone.replace(/[^0-9]/g, '')
  const formatted = clean.startsWith('52') ? clean : `52${clean}`
  return `https://wa.me/${formatted}?text=${encodeURIComponent(message)}`
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
