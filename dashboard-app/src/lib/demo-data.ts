// Demo data for a fictional restaurant "La Terraza MX"
// Used in /demo/dashboard and /demo/pos for sales demos

export const DEMO_RESTAURANT = {
  name: 'La Terraza MX',
  location: 'San Pedro Garza García, NL',
  type: 'Brunch & Café',
  mesas: 20,
  meseros: ['Carlos Mendoza', 'Ana Rodríguez', 'Luis Garza', 'María Fernández', 'Roberto Silva'],
}

// Today's KPIs
export const DEMO_KPIS = {
  ventas_dia: 47320,
  ventas_brutas: 49850,
  descuentos: 2530,
  tickets_count: 98,
  personas_restaurant: 187,
  ticket_promedio: 483,
  mesas_atendidas: 16,
  ordenes_llevar: 12,
  efectivo: 18928,
  tarjeta: 24160,
  transferencia: 4232,
  propinas_total: 7098,
  hora_pico: '12:00 - 13:00',
  ultima_venta: '15:42',
  chilaquiles_total: 8450,
  half_half_total: 3200,
}

// Yesterday
export const DEMO_YESTERDAY = {
  ventas_dia: 52180,
  tickets_count: 112,
  ticket_promedio: 466,
}

// Last week same day
export const DEMO_LAST_WEEK = {
  ventas_dia: 44900,
  tickets_count: 89,
}

// DOW average
export const DEMO_DOW_AVG = {
  ventas_dia: 46200,
}

// Historical data (last 14 days)
export const DEMO_HISTORY = [
  { fecha: '2026-05-12', ventas_dia: 38200, tickets_count: 78 },
  { fecha: '2026-05-13', ventas_dia: 41500, tickets_count: 85 },
  { fecha: '2026-05-14', ventas_dia: 44100, tickets_count: 92 },
  { fecha: '2026-05-15', ventas_dia: 39800, tickets_count: 81 },
  { fecha: '2026-05-16', ventas_dia: 51200, tickets_count: 108 },
  { fecha: '2026-05-17', ventas_dia: 58900, tickets_count: 125 },
  { fecha: '2026-05-18', ventas_dia: 62100, tickets_count: 132 },
  { fecha: '2026-05-19', ventas_dia: 42300, tickets_count: 88 },
  { fecha: '2026-05-20', ventas_dia: 43700, tickets_count: 90 },
  { fecha: '2026-05-21', ventas_dia: 45600, tickets_count: 95 },
  { fecha: '2026-05-22', ventas_dia: 40200, tickets_count: 83 },
  { fecha: '2026-05-23', ventas_dia: 53400, tickets_count: 114 },
  { fecha: '2026-05-24', ventas_dia: 61800, tickets_count: 128 },
  { fecha: '2026-05-25', ventas_dia: 52180, tickets_count: 112 },
]

// Mesero ranking
export const DEMO_MESEROS = [
  { nombre: 'Carlos Mendoza', total: 14200, tickets: 28, propinas: 2840 },
  { nombre: 'Ana Rodríguez', total: 12100, tickets: 24, propinas: 2178 },
  { nombre: 'Luis Garza', total: 9800, tickets: 20, propinas: 1470 },
  { nombre: 'María Fernández', total: 7420, tickets: 16, propinas: 1113 },
  { nombre: 'Roberto Silva', total: 3800, tickets: 10, propinas: 497 },
]

// Top platillos
export const DEMO_PLATILLOS = [
  { nombre: 'Chilaquiles Rojos', cantidad: 32, total: 5088 },
  { nombre: 'Avocado Toast', cantidad: 18, total: 2502 },
  { nombre: 'Café Americano', cantidad: 45, total: 2475 },
  { nombre: 'Eggs Benedict', cantidad: 15, total: 2835 },
  { nombre: 'Smoothie Verde', cantidad: 22, total: 1958 },
  { nombre: 'Pancakes Buttermilk', cantidad: 14, total: 2030 },
  { nombre: 'Capuchino', cantidad: 28, total: 2240 },
  { nombre: 'Salmon Bagel', cantidad: 11, total: 1859 },
  { nombre: 'Bowl Acai', cantidad: 12, total: 1668 },
  { nombre: 'Latte', cantidad: 25, total: 1625 },
]

// Ventas por grupo
export const DEMO_GRUPOS = [
  { nombre: 'CHILAQUILES & ENCHILADAS', total: 9800 },
  { nombre: 'COFFEE HOT/ICE', total: 7200 },
  { nombre: 'EGGS & KETO', total: 6500 },
  { nombre: 'TOAST & BAGELS', total: 5100 },
  { nombre: 'BOWLS', total: 3800 },
  { nombre: 'JUGOS', total: 3200 },
  { nombre: 'SMOOTHIES', total: 2800 },
  { nombre: 'PANCAKES & WAFFLES', total: 2400 },
  { nombre: 'FRESH DRINKS', total: 2100 },
  { nombre: 'FRAPPES', total: 1800 },
  { nombre: 'DESSERTS', total: 1620 },
]

// Propinas por mesero
export const DEMO_PROPINAS = [
  { nombre: 'Carlos Mendoza', total: 2840 },
  { nombre: 'Ana Rodríguez', total: 2178 },
  { nombre: 'Luis Garza', total: 1470 },
  { nombre: 'María Fernández', total: 1113 },
  { nombre: 'Roberto Silva', total: 497 },
]

// Pago metodos
export const DEMO_PAGOS = [
  { nombre: 'Tarjeta de crédito', total: 15200 },
  { nombre: 'Tarjeta de débito', total: 8960 },
  { nombre: 'Efectivo', total: 18928 },
  { nombre: 'Transferencia electrónica', total: 4232 },
]

// POS Menu for demo
export const DEMO_MENU = [
  {
    id: 'breakfast', name: 'Desayunos', color: 'bg-amber-600',
    items: [
      { id: 'd1', name: 'Chilaquiles Rojos', price: 159 },
      { id: 'd2', name: 'Chilaquiles Verdes', price: 159 },
      { id: 'd3', name: 'Eggs Benedict', price: 189 },
      { id: 'd4', name: 'Machacado con Huevo', price: 179 },
      { id: 'd5', name: 'Enchiladas Suizas', price: 175 },
      { id: 'd6', name: 'Garden Omelet', price: 169 },
      { id: 'd7', name: 'Half & Half Combo', price: 199 },
      { id: 'd8', name: 'Huevos Rancheros', price: 149 },
    ],
  },
  {
    id: 'toast', name: 'Toast & Bagels', color: 'bg-orange-600',
    items: [
      { id: 't1', name: 'Avocado Toast', price: 139 },
      { id: 't2', name: 'Salmon Bagel', price: 169 },
      { id: 't3', name: 'Toast de Atún', price: 155 },
      { id: 't4', name: 'Croissant Turkey Swiss', price: 159 },
    ],
  },
  {
    id: 'bowls', name: 'Bowls', color: 'bg-green-600',
    items: [
      { id: 'b1', name: 'Acai Bowl', price: 139 },
      { id: 'b2', name: 'Acai Love Bowl', price: 159 },
      { id: 'b3', name: 'Green Bowl', price: 145 },
    ],
  },
  {
    id: 'pancakes', name: 'Pancakes & Waffles', color: 'bg-yellow-600',
    items: [
      { id: 'p1', name: 'Pancakes Buttermilk', price: 145 },
      { id: 'p2', name: 'Paradise Blueberry Pancakes', price: 165 },
      { id: 'p3', name: 'Waffle Belga', price: 135 },
    ],
  },
  {
    id: 'coffee', name: 'Café', color: 'bg-brown-600',
    items: [
      { id: 'c1', name: 'Café Americano', price: 55 },
      { id: 'c2', name: 'Capuchino', price: 80 },
      { id: 'c3', name: 'Latte', price: 75 },
      { id: 'c4', name: 'Espresso', price: 45 },
      { id: 'c5', name: 'Matcha Latte', price: 95 },
      { id: 'c6', name: 'Chai Latte', price: 85 },
    ],
  },
  {
    id: 'drinks', name: 'Bebidas', color: 'bg-cyan-600',
    items: [
      { id: 'dr1', name: 'Jugo de Naranja', price: 75 },
      { id: 'dr2', name: 'Jugo Verde', price: 95 },
      { id: 'dr3', name: 'Smoothie Verde', price: 89 },
      { id: 'dr4', name: 'Smoothie Morning Blast', price: 99 },
      { id: 'dr5', name: 'Frapuccino', price: 110 },
      { id: 'dr6', name: 'Limonada', price: 65 },
    ],
  },
  {
    id: 'desserts', name: 'Postres', color: 'bg-pink-600',
    items: [
      { id: 'de1', name: 'Brownie con Helado', price: 125 },
      { id: 'de2', name: 'Cheesecake', price: 135 },
      { id: 'de3', name: 'Churros', price: 95 },
    ],
  },
]

export function formatDemoMXN(n: number): string {
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
