import type { RestaurantSeed } from '../_lib/types.ts'

// Demo comercial sintético. Ningún nombre, venta o costo proviene de Diezmex.
export const config: RestaurantSeed = {
  org: {
    id: 'diezmex-demo', display_name: 'Diezmex · Demo Ejecutivo',
    city: 'Monterrey, NL', timezone: 'America/Monterrey', type: 'Grupo restaurantero',
    iva_rate: 0.16, receipt_footer: 'Experiencia de demostración Fullsite',
    plan: 'fullsite_completo', data_source: 'fullsite', accent_color: 'emerald',
    address: 'Monterrey, Nuevo León', phone: '8100000000',
  },
  location: { id: 'diezmex-rosta', name: 'Rosta', address: 'Monterrey, NL', mesas: 20 },
  menu: [
    { id: 'diezmex-rosta', name: 'Rosta', color: 'rose', sort_order: 1, items: [
      { id: 'diezmex-rosta-tostada', name: 'Tostada de atún', price: 168, sort_order: 1 },
      { id: 'diezmex-rosta-bowl', name: 'Bowl mediterráneo', price: 198, sort_order: 2 },
      { id: 'diezmex-rosta-salmon', name: 'Salmón al grill', price: 328, sort_order: 3 },
    ]},
    { id: 'diezmex-macadam', name: 'Café Macadam', color: 'amber', sort_order: 2, items: [
      { id: 'diezmex-macadam-coldbrew', name: 'Cold Brew', price: 82, sort_order: 1 },
      { id: 'diezmex-macadam-frances', name: 'Pan francés', price: 145, sort_order: 2 },
      { id: 'diezmex-macadam-avocado', name: 'Avocado Toast', price: 158, sort_order: 3 },
    ]},
    { id: 'diezmex-manteca', name: 'Tacos Manteca', color: 'orange', sort_order: 3, items: [
      { id: 'diezmex-manteca-brisket', name: 'Taco de brisket', price: 78, sort_order: 1 },
      { id: 'diezmex-manteca-costra', name: 'Costra norteña', price: 92, sort_order: 2 },
      { id: 'diezmex-manteca-gringa', name: 'Gringa especial', price: 105, sort_order: 3 },
    ]},
    { id: 'diezmex-atletico', name: 'Atletico Cafe', color: 'teal', sort_order: 4, items: [
      { id: 'diezmex-atletico-latte', name: 'Latte de la casa', price: 75, sort_order: 1 },
      { id: 'diezmex-atletico-matcha', name: 'Matcha frío', price: 88, sort_order: 2 },
      { id: 'diezmex-atletico-bagel', name: 'Bagel de desayuno', price: 135, sort_order: 3 },
    ]},
    { id: 'diezmex-oso', name: 'Casa Oso', color: 'blue', sort_order: 5, items: [
      { id: 'diezmex-oso-burger', name: 'Burger de la casa', price: 245, sort_order: 1 },
      { id: 'diezmex-oso-mac', name: 'Mac & Cheese', price: 178, sort_order: 2 },
      { id: 'diezmex-oso-brownie', name: 'Brownie tibio', price: 125, sort_order: 3 },
    ]},
  ],
  staff: [
    { name: 'Gerencia Demo', pin: '9001', role: 'admin' },
    { name: 'Caja Norte', pin: '2001', role: 'cajero' },
    { name: 'Andrea', pin: '1001', role: 'mesero' },
    { name: 'Mateo', pin: '1002', role: 'mesero' },
    { name: 'Sofía', pin: '1003', role: 'mesero' },
    { name: 'Carlos', pin: '1004', role: 'mesero' },
  ],
  paymentMethods: [
    { name: 'Efectivo', type: 'cash', commission_pct: 0, fiscal_code: '01' },
    { name: 'Tarjeta de crédito', type: 'card', commission_pct: 2.5, fiscal_code: '04' },
    { name: 'Tarjeta de débito', type: 'card', commission_pct: 1.5, fiscal_code: '28' },
    { name: 'Transferencia', type: 'transfer', commission_pct: 0, fiscal_code: '03' },
  ],
  historicalDays: 90,
}
