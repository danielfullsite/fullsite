// Demo data for a fictional restaurant "Casa Montaña"
// Premium casual dining in Monterrey — ~$1M MXN/month
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

// ~$1M/month = ~$33,300/day avg (30 days) but some days higher
// Today is a strong Saturday: $38,450 so far at 3pm, will close ~$52K

export const DEMO_KPIS = {
  ventas_dia: 38450,
  ventas_brutas: 40120,
  descuentos: 1670,
  tickets_count: 74,
  personas_restaurant: 156,
  ticket_promedio: 520,
  mesas_atendidas: 22,
  ordenes_llevar: 8,
  efectivo: 11535,
  tarjeta: 21148,
  transferencia: 5767,
  propinas_total: 5768,
  hora_pico: '13:00 - 14:00',
  ultima_venta: '15:12',
  chilaquiles_total: 4890,
  half_half_total: 2150,
}

export const DEMO_YESTERDAY = {
  ventas_dia: 35200,
  tickets_count: 68,
  ticket_promedio: 518,
}

export const DEMO_LAST_WEEK = {
  ventas_dia: 36800,
  tickets_count: 71,
}

export const DEMO_DOW_AVG = {
  ventas_dia: 37500,
}

// 90 days of history — realistic seasonality
// Weekdays ~$28-35K, Sat ~$45-55K, Sun ~$38-48K
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
    if (dow === 6) base = 48000 + Math.random() * 8000       // Sat: $48-56K
    else if (dow === 0) base = 40000 + Math.random() * 8000   // Sun: $40-48K
    else if (dow === 5) base = 35000 + Math.random() * 5000   // Fri: $35-40K
    else base = 28000 + Math.random() * 7000                   // Mon-Thu: $28-35K

    // Trend: slight growth over 3 months (+8%)
    const trendMultiplier = 1 + (90 - i) * 0.0009
    base *= trendMultiplier

    // Random noise
    base += (Math.random() - 0.5) * 3000

    const ventas = Math.round(base)
    const tickets = Math.round(ventas / (480 + Math.random() * 80))

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

// Mesero ranking — 8 meseros, top 3 carry the weight
export const DEMO_MESEROS = [
  { nombre: 'Alejandro Treviño', total: 8200, tickets: 16, propinas: 1640, personas: 34 },
  { nombre: 'Sofía Garza', total: 7100, tickets: 14, propinas: 1420, personas: 28 },
  { nombre: 'Diego Cantú', total: 5900, tickets: 11, propinas: 1062, personas: 24 },
  { nombre: 'Valeria Lozano', total: 5400, tickets: 10, propinas: 918, personas: 22 },
  { nombre: 'Emilio Salinas', total: 4800, tickets: 9, propinas: 720, personas: 19 },
  { nombre: 'Camila Ruiz', total: 3200, tickets: 6, propinas: 480, personas: 13 },
  { nombre: 'Santiago Herrera', total: 2400, tickets: 5, propinas: 336, personas: 10 },
  { nombre: 'Isabella Flores', total: 1450, tickets: 3, propinas: 192, personas: 6 },
]

// Top platillos — mix of brunch and dinner items
export const DEMO_PLATILLOS = [
  { nombre: 'Rib Eye 300g', cantidad: 12, total: 5400 },
  { nombre: 'Chilaquiles Rojos', cantidad: 28, total: 4480 },
  { nombre: 'Salmon a la Parrilla', cantidad: 14, total: 3780 },
  { nombre: 'Café Americano', cantidad: 52, total: 2860 },
  { nombre: 'Avocado Toast', cantidad: 19, total: 2660 },
  { nombre: 'Pasta Trufa Negra', cantidad: 9, total: 2520 },
  { nombre: 'Eggs Benedict', cantidad: 13, total: 2470 },
  { nombre: 'Capuchino', cantidad: 34, total: 2720 },
  { nombre: 'Hamburguesa Angus', cantidad: 11, total: 2310 },
  { nombre: 'Smoothie Bowl Acai', cantidad: 15, total: 2085 },
  { nombre: 'Tacos de Arrachera', cantidad: 18, total: 1980 },
  { nombre: 'Latte', cantidad: 28, total: 2100 },
  { nombre: 'Limonada con Menta', cantidad: 22, total: 1540 },
  { nombre: 'Cheesecake NY', cantidad: 10, total: 1450 },
  { nombre: 'Mimosa', cantidad: 16, total: 1280 },
]

// Ventas por grupo — casual dining mix
export const DEMO_GRUPOS = [
  { nombre: 'CARNES & PARRILLA', total: 8900 },
  { nombre: 'DESAYUNOS', total: 6200 },
  { nombre: 'CAFÉ & ESPRESSO', total: 5580 },
  { nombre: 'MARISCOS', total: 4100 },
  { nombre: 'PASTAS', total: 3400 },
  { nombre: 'TOAST & BAGELS', total: 2800 },
  { nombre: 'COCTELERÍA', total: 2600 },
  { nombre: 'BOWLS & ENSALADAS', total: 2200 },
  { nombre: 'JUGOS & SMOOTHIES', total: 1900 },
  { nombre: 'POSTRES', total: 1800 },
  { nombre: 'VINOS', total: 1500 },
  { nombre: 'TACOS & ANTOJITOS', total: 1350 },
]

// Pago metodos
export const DEMO_PAGOS = [
  { nombre: 'Tarjeta de crédito', total: 14380 },
  { nombre: 'Tarjeta de débito', total: 6768 },
  { nombre: 'Efectivo', total: 11535 },
  { nombre: 'Transferencia electrónica', total: 5767 },
]

// Propinas por mesero
export const DEMO_PROPINAS = DEMO_MESEROS.map(m => ({ nombre: m.nombre, total: m.propinas }))

// Hourly sales pattern (for prediction widget)
export const DEMO_HOURLY = [
  { hora: '08:00', ventas: 1200 },
  { hora: '09:00', ventas: 2800 },
  { hora: '10:00', ventas: 4100 },
  { hora: '11:00', ventas: 5200 },
  { hora: '12:00', ventas: 5800 },
  { hora: '13:00', ventas: 6200 },
  { hora: '14:00', ventas: 4900 },
  { hora: '15:00', ventas: 3100 },
  { hora: '16:00', ventas: 1500 },
  { hora: '17:00', ventas: 1100 },
  { hora: '18:00', ventas: 2400 },
  { hora: '19:00', ventas: 3800 },
  { hora: '20:00', ventas: 4500 },
  { hora: '21:00', ventas: 3200 },
  { hora: '22:00', ventas: 1800 },
]

// AI Insights (what the system "detected")
export const DEMO_INSIGHTS = [
  { type: 'trend', title: 'Ventas +8% vs mes pasado', desc: 'Tendencia creciente sostenida los últimos 3 meses. Proyección: $1.08M en junio.' },
  { type: 'alert', title: 'Salmon stock bajo', desc: 'Al ritmo actual, quedan ~6 órdenes de Salmon a la Parrilla. Reordenar hoy.' },
  { type: 'insight', title: 'Sábados rinden 52% más', desc: 'Promedio sábado: $51,200 vs promedio L-V: $33,600. Considerar eventos especiales.' },
  { type: 'upsell', title: 'Oportunidad en postres', desc: 'Solo 14% de mesas piden postre. Promedio industria: 25%. +$3,200/día potencial.' },
  { type: 'staff', title: 'Alejandro: mejor TP del equipo', desc: 'Ticket promedio $513 vs promedio del equipo $438. Estudiar su técnica de venta.' },
]

// Week-over-week comparison
export const DEMO_WOW = {
  thisWeek: { ventas: 198500, tickets: 382, personas: 803 },
  lastWeek: { ventas: 187200, tickets: 361, personas: 758 },
  change: { ventas: 6.0, tickets: 5.8, personas: 5.9 },
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
