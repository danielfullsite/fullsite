import type { RestaurantSeed } from '../_lib/types.ts'

export const config: RestaurantSeed = {
  org: {
    id: 'demo',
    display_name: 'Café Central',
    city: 'San Pedro Garza García, NL',
    timezone: 'America/Mexico_City',
    type: 'Café & Brunch',
    iva_rate: 0,
    receipt_footer: 'Gracias por visitarnos 🙌',
    plan: 'fullsite_completo',
    data_source: 'fullsite',
    accent_color: 'emerald',
    address: 'Valle Oriente, San Pedro Garza García, NL',
    phone: '8180000000',
  },

  location: {
    id: 'demo-spgg',
    name: 'San Pedro',
    address: 'Valle Oriente 400, San Pedro Garza García, NL 66260',
    mesas: 15,
  },

  menu: [
    {
      id: 'cafe', name: 'Café', color: 'amber', sort_order: 1,
      items: [
        { id: 'cafe-americano',  name: 'Americano',      price: 45,  sort_order: 1 },
        { id: 'cafe-capuchino',  name: 'Cappuccino',     price: 55,  sort_order: 2 },
        { id: 'cafe-latte',      name: 'Latte',          price: 60,  sort_order: 3 },
        { id: 'cafe-cortado',    name: 'Cortado',        price: 50,  sort_order: 4 },
        { id: 'cafe-cold-brew',  name: 'Cold Brew',      price: 65,  sort_order: 5 },
        { id: 'cafe-mocca',      name: 'Mocca',          price: 65,  sort_order: 6 },
        { id: 'cafe-matcha',     name: 'Matcha Latte',   price: 70,  sort_order: 7 },
        { id: 'cafe-espresso',   name: 'Espresso',       price: 35,  sort_order: 8 },
      ],
    },
    {
      id: 'desayunos', name: 'Desayunos', color: 'yellow', sort_order: 2,
      items: [
        { id: 'des-divorciados',  name: 'Huevos Divorciados', price: 85,  sort_order: 1 },
        { id: 'des-benedictinos', name: 'Huevos Benedictinos', price: 120, sort_order: 2 },
        { id: 'des-avocado',      name: 'Avocado Toast',       price: 95,  sort_order: 3 },
        { id: 'des-granola',      name: 'Granola Bowl',        price: 75,  sort_order: 4 },
        { id: 'des-hotcakes',     name: 'Hotcakes',            price: 80,  sort_order: 5 },
        { id: 'des-french-toast', name: 'French Toast',        price: 90,  sort_order: 6 },
      ],
    },
    {
      id: 'almuerzo', name: 'Almuerzo', color: 'green', sort_order: 3,
      items: [
        { id: 'alm-cesar',    name: 'Ensalada César',   price: 95,  sort_order: 1 },
        { id: 'alm-club',     name: 'Club Sandwich',    price: 110, sort_order: 2 },
        { id: 'alm-pasta',    name: 'Pasta Pomodoro',   price: 120, sort_order: 3 },
        { id: 'alm-sopa',     name: 'Sopa del Día',     price: 75,  sort_order: 4 },
        { id: 'alm-wrap',     name: 'Wrap de Pollo',    price: 105, sort_order: 5 },
      ],
    },
    {
      id: 'postres', name: 'Postres', color: 'pink', sort_order: 4,
      items: [
        { id: 'pos-cheesecake', name: 'Cheesecake',      price: 65, sort_order: 1 },
        { id: 'pos-brownie',    name: 'Brownie',          price: 55, sort_order: 2 },
        { id: 'pos-flan',       name: 'Flan Napolitano',  price: 50, sort_order: 3 },
        { id: 'pos-waffle',     name: 'Waffle de Fresa',  price: 70, sort_order: 4 },
      ],
    },
    {
      id: 'bebidas', name: 'Bebidas', color: 'blue', sort_order: 5,
      items: [
        { id: 'beb-jamaica',   name: 'Agua de Jamaica',  price: 35, sort_order: 1 },
        { id: 'beb-limonada',  name: 'Limonada',         price: 40, sort_order: 2 },
        { id: 'beb-mineral',   name: 'Agua Mineral',     price: 30, sort_order: 3 },
        { id: 'beb-naranja',   name: 'Jugo de Naranja',  price: 50, sort_order: 4 },
        { id: 'beb-te',        name: 'Té de la Casa',    price: 40, sort_order: 5 },
      ],
    },
  ],

  staff: [
    { name: 'Ana García',      pin: '1001', role: 'admin'   },
    { name: 'Luis Martínez',   pin: '2002', role: 'cajero'  },
    { name: 'María López',     pin: '3003', role: 'mesero'  },
    { name: 'Carlos Ruiz',     pin: '4004', role: 'mesero'  },
    { name: 'Sofía Hernández', pin: '5005', role: 'mesero'  },
  ],

  paymentMethods: [
    { name: 'Efectivo',           type: 'cash',     commission_pct: 0,   fiscal_code: '01' },
    { name: 'Tarjeta de crédito', type: 'card',     commission_pct: 2.5, fiscal_code: '04' },
    { name: 'Tarjeta de débito',  type: 'card',     commission_pct: 1.5, fiscal_code: '28' },
    { name: 'Transferencia',      type: 'transfer', commission_pct: 0,   fiscal_code: '03' },
  ],

  historicalDays: 60,
}
