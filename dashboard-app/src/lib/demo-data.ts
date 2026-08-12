// Demo data for a fictional restaurant "Casa Montaña"
// Premium casual dining in Monterrey — ~$2.5M MXN/month, high-volume flagship
// Used in /demo/dashboard and /demo/pos for sales demos

export const DEMO_RESTAURANT = {
  name: 'Casa Montaña',
  location: 'Valle Oriente, Monterrey, NL',
  type: 'Casual Dining · Brunch & Cena',
  mesas: 28,
  meseros: [
    'Alejandro Treviño', 'Sofía Garza', 'Diego Cantú', 'Valeria Lozano',
    'Emilio Salinas', 'Camila Ruiz', 'Santiago Herrera', 'Isabella Flores',
  ],
}

// ~$2.5M/month = ~$83,000/day avg (30 days), fines de semana mucho más altos.
// Hoy es un sábado fuerte: $87,400 a las 3pm, cierra ~$120K.

export const DEMO_KPIS = {
  ventas_dia: 87400,
  ventas_brutas: 91650,
  descuentos: 4250,
  tickets_count: 168,
  personas_restaurant: 352,
  ticket_promedio: 520,
  mesas_atendidas: 26,
  ordenes_llevar: 19,
  efectivo: 24480,
  tarjeta: 48320,
  transferencia: 14600,
  propinas_total: 13110,
  hora_pico: '13:00 - 14:00',
  ultima_venta: '15:12',
  chilaquiles_total: 9860,
  half_half_total: 4720,
}

export const DEMO_YESTERDAY = {
  ventas_dia: 79600,
  tickets_count: 154,
  ticket_promedio: 517,
}

export const DEMO_LAST_WEEK = {
  ventas_dia: 82300,
  tickets_count: 159,
}

export const DEMO_DOW_AVG = {
  ventas_dia: 84500,
}

// 90 days of history — realistic seasonality (restaurante de alto volumen)
// Weekdays ~$58-70K, Sat ~$105-118K, Sun ~$88-98K
function generateHistory(): { fecha: string; ventas_dia: number; tickets_count: number }[] {
  const data = []
  const today = new Date()
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dow = d.getDay() // 0=Sun, 6=Sat
    const dateStr = d.toISOString().split('T')[0]

    // Base by day of week
    let base: number
    if (dow === 6) base = 105000 + Math.random() * 13000      // Sat: $105-118K
    else if (dow === 0) base = 88000 + Math.random() * 10000   // Sun: $88-98K
    else if (dow === 5) base = 76000 + Math.random() * 10000   // Fri: $76-86K
    else base = 58000 + Math.random() * 12000                  // Mon-Thu: $58-70K

    // Trend: slight growth over 3 months (+8%)
    const trendMultiplier = 1 + (90 - i) * 0.0009
    base *= trendMultiplier

    // Random noise
    base += (Math.random() - 0.5) * 6000

    const ventas = Math.round(base)
    const tickets = Math.round(ventas / (500 + Math.random() * 60))

    data.push({ fecha: dateStr, ventas_dia: ventas, tickets_count: tickets })
  }
  return data
}

export const DEMO_HISTORY = generateHistory()

// Last 14 for the chart
export const DEMO_HISTORY_14 = DEMO_HISTORY.slice(-14)

// Monthly summaries from history
export const DEMO_MONTHLY = (() => {
  const months: Record<string, { ventas: number; dias: number; tickets: number }> = {}
  for (const d of DEMO_HISTORY) {
    const month = d.fecha.slice(0, 7)
    if (!months[month]) months[month] = { ventas: 0, dias: 0, tickets: 0 }
    months[month].ventas += d.ventas_dia
    months[month].dias += 1
    months[month].tickets += d.tickets_count
  }
  return Object.entries(months).map(([month, data]) => ({
    month,
    ventas: data.ventas,
    dias: data.dias,
    tickets: data.tickets,
    promedioDia: Math.round(data.ventas / data.dias),
    ticketPromedio: Math.round(data.ventas / data.tickets),
  }))
})()

// Mesero ranking — 8 meseros, top 3 carry the weight (suma ≈ ventas del día)
export const DEMO_MESEROS = [
  { nombre: 'Alejandro Treviño', total: 18600, tickets: 34, propinas: 3720, personas: 74 },
  { nombre: 'Sofía Garza', total: 15400, tickets: 29, propinas: 3080, personas: 62 },
  { nombre: 'Diego Cantú', total: 13200, tickets: 25, propinas: 2376, personas: 53 },
  { nombre: 'Valeria Lozano', total: 11800, tickets: 22, propinas: 2006, personas: 47 },
  { nombre: 'Emilio Salinas', total: 9900, tickets: 19, propinas: 1485, personas: 40 },
  { nombre: 'Camila Ruiz', total: 7400, tickets: 15, propinas: 1110, personas: 30 },
  { nombre: 'Santiago Herrera', total: 6200, tickets: 13, propinas: 868, personas: 26 },
  { nombre: 'Isabella Flores', total: 4900, tickets: 11, propinas: 637, personas: 20 },
]

// Top platillos — mix of brunch and dinner items
export const DEMO_PLATILLOS = [
  { nombre: 'Rib Eye 300g', cantidad: 28, total: 12600 },
  { nombre: 'Chilaquiles Rojos', cantidad: 62, total: 9920 },
  { nombre: 'Salmon a la Parrilla', cantidad: 31, total: 8370 },
  { nombre: 'Café Americano', cantidad: 118, total: 6490 },
  { nombre: 'Arrachera 250g', cantidad: 24, total: 7680 },
  { nombre: 'Avocado Toast', cantidad: 43, total: 6020 },
  { nombre: 'Pasta Trufa Negra', cantidad: 21, total: 5880 },
  { nombre: 'Eggs Benedict', cantidad: 30, total: 5670 },
  { nombre: 'Capuchino', cantidad: 76, total: 6080 },
  { nombre: 'Hamburguesa Angus', cantidad: 25, total: 5250 },
  { nombre: 'Smoothie Bowl Acai', cantidad: 34, total: 4726 },
  { nombre: 'Tacos de Arrachera', cantidad: 41, total: 4510 },
  { nombre: 'Costillas BBQ', cantidad: 13, total: 4940 },
  { nombre: 'Cheesecake NY', cantidad: 28, total: 4060 },
  { nombre: 'Mimosa', cantidad: 38, total: 4560 },
]

// Ventas por grupo — casual dining mix (suma ≈ ventas del día)
export const DEMO_GRUPOS = [
  { nombre: 'CARNES & PARRILLA', total: 19200 },
  { nombre: 'DESAYUNOS', total: 13400 },
  { nombre: 'CAFÉ & ESPRESSO', total: 12100 },
  { nombre: 'MARISCOS', total: 8900 },
  { nombre: 'PASTAS', total: 7400 },
  { nombre: 'TOAST & BAGELS', total: 6100 },
  { nombre: 'COCTELERÍA', total: 5600 },
  { nombre: 'BOWLS & ENSALADAS', total: 4800 },
  { nombre: 'JUGOS & SMOOTHIES', total: 4100 },
  { nombre: 'POSTRES', total: 3900 },
  { nombre: 'VINOS', total: 3300 },
  { nombre: 'TACOS & ANTOJITOS', total: 2900 },
]

// Pago metodos (suma ≈ ventas del día)
export const DEMO_PAGOS = [
  { nombre: 'Tarjeta de crédito', total: 33820 },
  { nombre: 'Efectivo', total: 24480 },
  { nombre: 'Tarjeta de débito', total: 14500 },
  { nombre: 'Transferencia electrónica', total: 14600 },
]

// Propinas por mesero
export const DEMO_PROPINAS = DEMO_MESEROS.map(m => ({ nombre: m.nombre, total: m.propinas }))

// Hourly sales pattern (for prediction widget)
export const DEMO_HOURLY = [
  { hora: '08:00', ventas: 2000 },
  { hora: '09:00', ventas: 4700 },
  { hora: '10:00', ventas: 6900 },
  { hora: '11:00', ventas: 8700 },
  { hora: '12:00', ventas: 9700 },
  { hora: '13:00', ventas: 10400 },
  { hora: '14:00', ventas: 8200 },
  { hora: '15:00', ventas: 5200 },
  { hora: '16:00', ventas: 2500 },
  { hora: '17:00', ventas: 1900 },
  { hora: '18:00', ventas: 4000 },
  { hora: '19:00', ventas: 6400 },
  { hora: '20:00', ventas: 7600 },
  { hora: '21:00', ventas: 5400 },
  { hora: '22:00', ventas: 3000 },
]

// AI Insights (what the system "detected")
export const DEMO_INSIGHTS = [
  { type: 'trend', title: 'Ventas +8% vs mes pasado', desc: 'Tendencia creciente sostenida los últimos 3 meses. Proyección: $2.6M este mes.' },
  { type: 'alert', title: 'Salmon stock bajo', desc: 'Al ritmo actual, quedan ~10 órdenes de Salmon a la Parrilla. Reordenar hoy.' },
  { type: 'insight', title: 'Sábados rinden 54% más', desc: 'Promedio sábado: $112,000 vs promedio L-V: $68,400. Considerar eventos especiales.' },
  { type: 'upsell', title: 'Oportunidad en postres', desc: 'Solo 14% de mesas piden postre. Promedio industria: 25%. +$7,400/día potencial.' },
  { type: 'staff', title: 'Alejandro: mejor TP del equipo', desc: 'Ticket promedio $547 vs promedio del equipo $438. Estudiar su técnica de venta.' },
]

// Week-over-week comparison
export const DEMO_WOW = {
  thisWeek: { ventas: 542000, tickets: 1042, personas: 2180 },
  lastWeek: { ventas: 511000, tickets: 984, personas: 2050 },
  change: { ventas: 6.1, tickets: 5.9, personas: 6.3 },
}

// POS Menu — premium casual dining
export const DEMO_MENU = [
  {
    id: 'breakfast', name: 'Desayunos', color: 'bg-amber-600',
    items: [
      { id: 'd1', name: 'Chilaquiles Rojos', price: 159 },
      { id: 'd2', name: 'Chilaquiles Verdes', price: 159 },
      { id: 'd3', name: 'Eggs Benedict', price: 189 },
      { id: 'd4', name: 'Machacado con Huevo', price: 179 },
      { id: 'd5', name: 'Enchiladas Suizas', price: 175 },
      { id: 'd6', name: 'Huevos Rancheros', price: 149 },
      { id: 'd7', name: 'Half & Half Combo', price: 199 },
      { id: 'd8', name: 'Avocado Toast', price: 139 },
    ],
  },
  {
    id: 'carnes', name: 'Carnes & Parrilla', color: 'bg-red-700',
    items: [
      { id: 'ca1', name: 'Rib Eye 300g', price: 450 },
      { id: 'ca2', name: 'Arrachera 250g', price: 320 },
      { id: 'ca3', name: 'Hamburguesa Angus', price: 210 },
      { id: 'ca4', name: 'Pollo a la Parrilla', price: 195 },
      { id: 'ca5', name: 'Tacos de Arrachera (3)', price: 165 },
      { id: 'ca6', name: 'Costillas BBQ', price: 380 },
    ],
  },
  {
    id: 'mariscos', name: 'Mariscos', color: 'bg-blue-600',
    items: [
      { id: 'ma1', name: 'Salmon a la Parrilla', price: 270 },
      { id: 'ma2', name: 'Ceviche de Camarón', price: 195 },
      { id: 'ma3', name: 'Tacos de Pescado (3)', price: 175 },
      { id: 'ma4', name: 'Atún Sellado', price: 290 },
      { id: 'ma5', name: 'Aguachile', price: 185 },
    ],
  },
  {
    id: 'pastas', name: 'Pastas', color: 'bg-orange-600',
    items: [
      { id: 'pa1', name: 'Pasta Trufa Negra', price: 280 },
      { id: 'pa2', name: 'Fetuccini Alfredo', price: 185 },
      { id: 'pa3', name: 'Risotto de Hongos', price: 220 },
      { id: 'pa4', name: 'Penne Arrabiata', price: 165 },
    ],
  },
  {
    id: 'bowls', name: 'Bowls & Ensaladas', color: 'bg-green-600',
    items: [
      { id: 'bo1', name: 'Smoothie Bowl Acai', price: 139 },
      { id: 'bo2', name: 'Buddha Bowl', price: 155 },
      { id: 'bo3', name: 'Caesar Salad', price: 145 },
      { id: 'bo4', name: 'Quinoa Bowl', price: 149 },
    ],
  },
  {
    id: 'coffee', name: 'Café & Bar', color: 'bg-yellow-800',
    items: [
      { id: 'c1', name: 'Café Americano', price: 55 },
      { id: 'c2', name: 'Capuchino', price: 80 },
      { id: 'c3', name: 'Latte', price: 75 },
      { id: 'c4', name: 'Espresso Doble', price: 60 },
      { id: 'c5', name: 'Matcha Latte', price: 95 },
      { id: 'c6', name: 'Mimosa', price: 120 },
      { id: 'c7', name: 'Aperol Spritz', price: 160 },
      { id: 'c8', name: 'Margarita', price: 145 },
    ],
  },
  {
    id: 'drinks', name: 'Bebidas', color: 'bg-cyan-600',
    items: [
      { id: 'dr1', name: 'Jugo de Naranja', price: 75 },
      { id: 'dr2', name: 'Jugo Verde', price: 95 },
      { id: 'dr3', name: 'Smoothie Verde', price: 89 },
      { id: 'dr4', name: 'Limonada con Menta', price: 70 },
      { id: 'dr5', name: 'Agua Mineral', price: 45 },
    ],
  },
  {
    id: 'desserts', name: 'Postres', color: 'bg-pink-600',
    items: [
      { id: 'de1', name: 'Cheesecake NY', price: 145 },
      { id: 'de2', name: 'Brownie con Helado', price: 125 },
      { id: 'de3', name: 'Tiramisú', price: 135 },
      { id: 'de4', name: 'Churros con Chocolate', price: 95 },
      { id: 'de5', name: 'Crème Brûlée', price: 130 },
    ],
  },
]

export function formatDemoMXN(n: number): string {
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
