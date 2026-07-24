import type { RestaurantSeed } from '../_lib/types.ts'

export const config: RestaurantSeed = {
  org: {
    id: 'coffee-shop',
    display_name: 'Espresso Lab',
    city: 'Monterrey, NL',
    timezone: 'America/Mexico_City',
    type: 'Specialty Coffee',
    iva_rate: 0,
    receipt_footer: 'Cada taza, una experiencia.',
    plan: 'fullsite_software',
    data_source: 'fullsite',
    accent_color: 'orange',
    address: 'Centro, Monterrey, NL',
    phone: '8100000001',
  },

  location: {
    id: 'coffee-shop-centro',
    name: 'Centro',
    address: 'Padre Mier 100, Centro, Monterrey, NL 64000',
    mesas: 10,
  },

  menu: [
    {
      id: 'cs-espresso', name: 'Espresso Bar', color: 'amber', sort_order: 1,
      items: [
        { id: 'cs-esp-single',    name: 'Single Origin',    price: 55,  sort_order: 1 },
        { id: 'cs-esp-doppio',    name: 'Doppio',           price: 60,  sort_order: 2 },
        { id: 'cs-esp-flat',      name: 'Flat White',       price: 65,  sort_order: 3 },
        { id: 'cs-esp-pour',      name: 'Pour Over',        price: 75,  sort_order: 4 },
        { id: 'cs-esp-chemex',    name: 'Chemex',           price: 80,  sort_order: 5 },
        { id: 'cs-esp-aeropress', name: 'AeroPress',        price: 70,  sort_order: 6 },
      ],
    },
    {
      id: 'cs-milk', name: 'Leche', color: 'blue', sort_order: 2,
      items: [
        { id: 'cs-milk-latte',    name: 'Latte',        price: 65, sort_order: 1 },
        { id: 'cs-milk-cap',      name: 'Cappuccino',   price: 60, sort_order: 2 },
        { id: 'cs-milk-matcha',   name: 'Matcha Latte', price: 75, sort_order: 3 },
        { id: 'cs-milk-oat',      name: 'Oat Latte',    price: 70, sort_order: 4 },
      ],
    },
    {
      id: 'cs-food', name: 'Para comer', color: 'green', sort_order: 3,
      items: [
        { id: 'cs-food-croissant', name: 'Croissant de Mantequilla', price: 45, sort_order: 1 },
        { id: 'cs-food-bagel',     name: 'Bagel con Cream Cheese',   price: 65, sort_order: 2 },
        { id: 'cs-food-banana',    name: 'Banana Bread',             price: 50, sort_order: 3 },
        { id: 'cs-food-cookie',    name: 'Cookie de Chocolate',      price: 35, sort_order: 4 },
      ],
    },
  ],

  staff: [
    { name: 'Diego Soto',      pin: '1111', role: 'admin'  },
    { name: 'Valeria Moreno',  pin: '2222', role: 'cajero' },
    { name: 'Emilio Castro',   pin: '3333', role: 'mesero' },
  ],

  paymentMethods: [
    { name: 'Efectivo',           type: 'cash',    commission_pct: 0,   fiscal_code: '01' },
    { name: 'Tarjeta',            type: 'card',    commission_pct: 2.0, fiscal_code: '04' },
    { name: 'Transferencia',      type: 'transfer', commission_pct: 0,  fiscal_code: '03' },
  ],

  historicalDays: 30,
}
