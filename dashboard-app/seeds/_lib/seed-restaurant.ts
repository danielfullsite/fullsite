import type { SupabaseClient } from '@supabase/supabase-js'
import type { RestaurantSeed } from './types.ts'
import { uuid, randInt, randItem, daysAgo, isoDate, log, logSection, upsertRows } from './utils.ts'

export async function seedRestaurant(sb: SupabaseClient, def: RestaurantSeed) {
  const { org, location, menu, staff, paymentMethods, historicalDays } = def

  // ── 1. Organization ────────────────────────────────────────────────────────
  logSection('Organization')
  await upsertRows(sb, 'clients', [{
    id: org.id,
    display_name: org.display_name,
    city: org.city,
    timezone: org.timezone,
    type: org.type,
    iva_rate: org.iva_rate,
    rfc: org.rfc || null,
    razon_social: org.razon_social || null,
    address: org.address || null,
    phone: org.phone || null,
    receipt_footer: org.receipt_footer || 'Gracias por tu visita!',
    plan: org.plan,
    data_source: org.data_source,
    accent_color: org.accent_color,
    active: true,
    features: JSON.stringify({
      pos: true, posRestaurant: true, posTienda: false, delivery: false,
      ecommerce: false, inventory: true, foodCost: true, facturacion: true,
      nomina: false, agentesIA: true, coach: true, chatIA: true,
      resenas: false, giftCards: false,
    }),
    mesas: location.mesas,
    meseros: JSON.stringify(staff.map(s => s.name)),
  }], 'id')

  // ── 2. Location ────────────────────────────────────────────────────────────
  logSection('Location')
  await upsertRows(sb, 'client_locations', [{
    id: location.id,
    client_id: org.id,
    name: location.name,
    address: location.address || org.address || '',
    active: true,
  }], 'id')

  // ── 3. Menu categories ─────────────────────────────────────────────────────
  logSection('Menu')
  const catRows = menu.map(cat => ({
    id: cat.id,
    client_id: org.id,
    name: cat.name,
    color: cat.color,
    sort_order: cat.sort_order,
    active: true,
  }))
  await upsertRows(sb, 'pos_menu_categories', catRows, 'id')

  const itemRows = menu.flatMap(cat =>
    cat.items.map(item => ({
      id: item.id,
      client_id: org.id,
      category_id: cat.id,
      name: item.name,
      price: item.price,
      sort_order: item.sort_order,
      active: true,
    }))
  )
  await upsertRows(sb, 'pos_menu_items', itemRows, 'id')

  // ── 4. Staff ───────────────────────────────────────────────────────────────
  logSection('Staff')
  const staffRows = staff.map(s => ({
    id: `${org.id}-${s.pin}`,
    client_id: org.id,
    name: s.name,
    pin: s.pin,
    role: s.role,
    role_display: s.role,
    active: true,
    hourly_rate: 0,
    weekly_salary: 0,
  }))
  // upsert on (pin, client_id) unique constraint — use id as conflict target
  await upsertRows(sb, 'pos_staff', staffRows, 'id')

  // ── 5. Payment methods ─────────────────────────────────────────────────────
  logSection('Payment methods')
  const pmRows = paymentMethods.map((pm, i) => ({
    id: `${org.id}-pm-${i}`,
    client_id: org.id,
    name: pm.name,
    type: pm.type,
    commission_pct: pm.commission_pct,
    fiscal_code: pm.fiscal_code || '',
    active: true,
  }))
  await upsertRows(sb, 'pos_payment_methods', pmRows, 'id')

  // ── 6. Historical orders ───────────────────────────────────────────────────
  logSection(`Historical orders (${historicalDays} days)`)

  const allItems = menu.flatMap(cat => cat.items)
  const meseroNames = staff.filter(s => ['mesero', 'cajero'].includes(s.role)).map(s => s.name)
  const pmNames = paymentMethods.map(pm => pm.name)

  const orderRows = []
  for (let day = historicalDays; day >= 1; day--) {
    const isWeekend = [0, 6].includes(new Date(Date.now() - day * 86400000).getDay())
    const ordersThisDay = isWeekend ? randInt(22, 38) : randInt(12, 22)

    for (let o = 0; o < ordersThisDay; o++) {
      const created = daysAgo(day)
      const closed = new Date(created.getTime() + randInt(15, 65) * 60_000)
      const numItems = randInt(1, 5)
      const items = Array.from({ length: numItems }, () => {
        const item = randItem(allItems)
        const qty = randInt(1, 3)
        return { nombre: item.name, precio: item.price, cantidad: qty, subtotal: item.price * qty }
      })
      const subtotal = items.reduce((s, i) => s + i.subtotal, 0)
      const propina = randInt(0, 1) ? Math.round(subtotal * randInt(10, 20) / 100) : 0

      orderRows.push({
        id: uuid(),
        client_id: org.id,
        location_id: location.id,
        mesa: randInt(1, location.mesas),
        mesero: randItem(meseroNames),
        personas: randInt(1, 4),
        status: 'cerrada',
        subtotal,
        iva: 0,
        total: subtotal,
        descuento: 0,
        propina,
        metodo_pago: randItem(pmNames),
        items: JSON.stringify(items),
        created_at: isoDate(created),
        closed_at: isoDate(closed),
      })
    }
  }

  // Insert in batches to avoid payload limits
  const BATCH = 200
  for (let i = 0; i < orderRows.length; i += BATCH) {
    const batch = orderRows.slice(i, i + BATCH)
    const { error } = await sb.from('pos_orders').insert(batch)
    if (error) throw new Error(`[pos_orders batch ${i}] ${error.message}`)
  }
  log(`pos_orders: ${orderRows.length} historical orders inserted`)

  logSection('Done')
  log(`Org: ${org.id} (${org.display_name})`)
  log(`Location: ${location.id} (${location.name}, ${location.mesas} mesas)`)
  log(`Menu: ${menu.length} categories, ${allItems.length} items`)
  log(`Staff: ${staff.length} employees`)
  log(`Orders: ${orderRows.length} historical (${historicalDays} days)`)
}
