// Demo data for Atope — Cocina Española, San Pedro Garza García
// Premium Spanish restaurant: tapas, paellas, cochinillo, vinos
// Ticket promedio ~$750, ~$1.5M MXN/month

export const ATOPE_RESTAURANT = {
  name: 'Atope',
  tagline: 'Cocina Española como Dios manda',
  location: 'Distrito Armida, San Pedro Garza García, NL',
  type: 'Cocina Española · Tapas & Paellas',
  mesas: 22,
  meseros: [
    'Rodrigo Martínez', 'Valentina Solis', 'Andrés Navarro', 'Lucía Herrera',
    'Mateo Jiménez', 'Paula Domínguez', 'Carlos Ruiz', 'Ana Beltrán',
  ],
  phone: '+52 (81) 1625-5274',
  email: 'info@atope.mx',
  instagram: '@atope.mx',
}

// Sabado fuerte: $68,500 a las 4pm, cerrará ~$95K
export const ATOPE_KPIS = {
  ventas_dia: 68500,
  ventas_brutas: 72400,
  descuentos: 3900,
  tickets_count: 86,
  personas_restaurant: 178,
  ticket_promedio: 797,
  mesas_atendidas: 19,
  ordenes_llevar: 4,
  efectivo: 10275,
  tarjeta: 48950,
  transferencia: 9275,
  propinas_total: 10275,
  hora_pico: '14:00 - 15:30',
  ultima_venta: '16:08',
  paella_total: 18400,
  tapas_total: 12600,
}

export const ATOPE_YESTERDAY = {
  ventas_dia: 42800,
  tickets_count: 58,
  ticket_promedio: 738,
}

export const ATOPE_LAST_WEEK = {
  ventas_dia: 65200,
  tickets_count: 82,
}

export const ATOPE_DOW_AVG = {
  ventas_dia: 62000,
}

// 90 days of history — Spanish restaurant pattern
// Weekdays ~$35-45K, Fri ~$55-65K, Sat ~$70-95K, Sun ~$50-65K
function generateHistory(): { fecha: string; ventas_dia: number; tickets_count: number; ticket_promedio: number }[] {
  const data = []
  const today = new Date()
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dow = d.getDay()
    const dateStr = d.toISOString().split('T')[0]

    let base: number
    if (dow === 6) base = 75000 + Math.random() * 20000       // Sat: $75-95K (paellas + vino)
    else if (dow === 0) base = 50000 + Math.random() * 15000   // Sun: $50-65K (brunch español)
    else if (dow === 5) base = 55000 + Math.random() * 12000   // Fri: $55-67K (cenas)
    else if (dow === 4) base = 42000 + Math.random() * 8000    // Thu: $42-50K
    else base = 35000 + Math.random() * 10000                   // Mon-Wed: $35-45K

    const trendMultiplier = 1 + (90 - i) * 0.001
    base *= trendMultiplier
    base += (Math.random() - 0.5) * 4000

    const ventas = Math.round(base)
    const tickets = Math.round(ventas / (700 + Math.random() * 150))
    const tp = Math.round(ventas / tickets)

    data.push({ fecha: dateStr, ventas_dia: ventas, tickets_count: tickets, ticket_promedio: tp })
  }
  return data
}

export const ATOPE_HISTORY = generateHistory()

// Monthly summary
export const ATOPE_MONTHLY = {
  ventas_mes: 1480000,
  dias_transcurridos: 27,
  ventas_proyectadas: 1645000,
  meta_mensual: 1500000,
  pct_meta: 98.7,
}

// Top meseros — Spanish restaurant style (higher sales per person due to wine)
export const ATOPE_MESEROS = [
  { nombre: 'Rodrigo Martínez', total: 215400, tickets: 42, propinas: 32310 },
  { nombre: 'Valentina Solis', total: 198700, tickets: 38, propinas: 29805 },
  { nombre: 'Andrés Navarro', total: 187200, tickets: 36, propinas: 24336 },
  { nombre: 'Lucía Herrera', total: 172800, tickets: 34, propinas: 22464 },
  { nombre: 'Mateo Jiménez', total: 156300, tickets: 31, propinas: 18756 },
  { nombre: 'Paula Domínguez', total: 143500, tickets: 28, propinas: 17220 },
  { nombre: 'Carlos Ruiz', total: 128900, tickets: 25, propinas: 14179 },
  { nombre: 'Ana Beltrán', total: 118200, tickets: 24, propinas: 11820 },
]

// Top platillos — Atope's actual menu items with realistic volumes
export const ATOPE_PLATILLOS = [
  { nombre: 'Paella Valenciana', total: 138000, qty: 120, precio: 1150 },
  { nombre: 'Paella Negra con Alioli', total: 96750, qty: 75, precio: 1290 },
  { nombre: 'Cochinillo Atope', total: 92000, qty: 80, precio: 1150 },
  { nombre: 'Solomillo con Foie Gras', total: 84500, qty: 100, precio: 845 },
  { nombre: 'Gambas al Ajillo', total: 68400, qty: 180, precio: 380 },
  { nombre: 'Croquetas de Jamón Ibérico', total: 62500, qty: 250, precio: 250 },
  { nombre: 'Paella Mixta', total: 59400, qty: 60, precio: 990 },
  { nombre: 'Pulpo a la Gallega', total: 57850, qty: 130, precio: 445 },
  { nombre: 'Patatas Bravas', total: 51000, qty: 200, precio: 255 },
  { nombre: 'Chuletillas de Cordero', total: 47400, qty: 60, precio: 790 },
  { nombre: 'Tarta de Queso Vasca', total: 42900, qty: 130, precio: 330 },
  { nombre: 'Meloso de Bogavante', total: 39600, qty: 40, precio: 990 },
  { nombre: 'Rabo de Toro', total: 38400, qty: 80, precio: 480 },
  { nombre: 'Tortilla Española', total: 34450, qty: 130, precio: 265 },
  { nombre: 'Carajillo Atope', total: 33150, qty: 170, precio: 195 },
]

// Categorias — Spanish restaurant breakdown
export const ATOPE_CATEGORIAS = [
  { nombre: 'ARROCES & PAELLAS', total: 386150, pct: 26.1 },
  { nombre: 'PLATOS FUERTES', total: 262300, pct: 17.7 },
  { nombre: 'TAPAS CALIENTES', total: 198400, pct: 13.4 },
  { nombre: 'ENTRADAS FRÍAS', total: 142800, pct: 9.6 },
  { nombre: 'VINOS', total: 215600, pct: 14.6 },
  { nombre: 'MONTADITOS', total: 78500, pct: 5.3 },
  { nombre: 'POSTRES', total: 68900, pct: 4.7 },
  { nombre: 'COCTELES & DESTILADOS', total: 62400, pct: 4.2 },
  { nombre: 'CAFÉS', total: 34200, pct: 2.3 },
  { nombre: 'CERVEZAS', total: 28750, pct: 1.9 },
]

// Metodos de pago
export const ATOPE_PAGOS = [
  { nombre: 'Tarjeta de crédito', total: 680000, pct: 45.9 },
  { nombre: 'Tarjeta de débito', total: 385000, pct: 26.0 },
  { nombre: 'Efectivo', total: 220000, pct: 14.9 },
  { nombre: 'Transferencia', total: 145000, pct: 9.8 },
  { nombre: 'American Express', total: 50000, pct: 3.4 },
]

// AI Insights personalized for a Spanish restaurant
export const ATOPE_INSIGHTS = [
  {
    type: 'trend',
    title: 'Paellas +18% este mes',
    detail: 'Las paellas subieron de $327K a $386K vs mes pasado. La Paella Negra creció 32% — considerar como plato estrella en redes.',
    priority: 'high',
  },
  {
    type: 'alert',
    title: 'Jamón ibérico: stock para 3 días',
    detail: 'Consumo promedio: 2.1 kg/día. Stock actual: 6.8 kg. Próximo pedido sugerido: 15 kg (proveedor España directo).',
    priority: 'critical',
  },
  {
    type: 'upsell',
    title: 'Vino con paella = +$890 por mesa',
    detail: '62% de las mesas que piden paella NO piden vino. Si el mesero sugiere maridaje, el ticket sube $890 promedio. Rodrigo ya lo hace (78% de sus paellas llevan vino).',
    priority: 'high',
  },
  {
    type: 'staffing',
    title: 'Sábados: necesitas 1 mesero más',
    detail: 'Los sábados tienes 19 mesas promedio con 6 meseros = 3.2 mesas/mesero. El ideal es 2.5. Con 7 meseros el ticket sube $45 por mesa (menos espera).',
    priority: 'medium',
  },
  {
    type: 'fraud',
    title: '0 alertas de fraude esta semana',
    detail: 'Sin descuentos no autorizados, sin cancelaciones sospechosas, sin cortesías excesivas. Todo limpio.',
    priority: 'low',
  },
  {
    type: 'menu',
    title: 'Coquinas: food cost 58% — revisar',
    detail: 'Las Coquinas tienen el food cost más alto del menú. Precio actual $395, costo $229. Opciones: subir a $445 o reducir porción de 180g a 150g.',
    priority: 'medium',
  },
]

// Food cost data — realistic for Spanish restaurant
export const ATOPE_FOOD_COST = [
  { platillo: 'Paella Valenciana', precio: 1150, costo: 287, margen_pct: 75.0 },
  { platillo: 'Paella Negra', precio: 1290, costo: 412, margen_pct: 68.1 },
  { platillo: 'Cochinillo Atope', precio: 1150, costo: 345, margen_pct: 70.0 },
  { platillo: 'Solomillo con Foie', precio: 845, costo: 338, margen_pct: 60.0 },
  { platillo: 'Gambas al Ajillo', precio: 380, costo: 152, margen_pct: 60.0 },
  { platillo: 'Croquetas Jamón', precio: 250, costo: 55, margen_pct: 78.0 },
  { platillo: 'Pulpo a la Gallega', precio: 445, costo: 178, margen_pct: 60.0 },
  { platillo: 'Patatas Bravas', precio: 255, costo: 38, margen_pct: 85.1 },
  { platillo: 'Tarta Queso Vasca', precio: 330, costo: 66, margen_pct: 80.0 },
  { platillo: 'Coquinas', precio: 395, costo: 229, margen_pct: 42.0 },
  { platillo: 'Carajillo Atope', precio: 195, costo: 39, margen_pct: 80.0 },
  { platillo: 'Rabo de Toro', precio: 480, costo: 168, margen_pct: 65.0 },
]

// Vinos más vendidos
export const ATOPE_VINOS = [
  { nombre: 'Atope España (Copa)', total: 48000, qty: 200, precio: 240 },
  { nombre: 'Muga Reserva', total: 39800, qty: 20, precio: 1990 },
  { nombre: 'Sol y Nieve (Copa)', total: 28500, qty: 150, precio: 190 },
  { nombre: 'Viña Ardanza Reserva', total: 27480, qty: 12, precio: 2290 },
  { nombre: 'Juan Gil', total: 23140, qty: 13, precio: 1795 },
  { nombre: 'Sangría Tinto (Jarra)', total: 21175, qty: 55, precio: 385 },
  { nombre: 'La Rosca Brut (Copa)', total: 15750, qty: 90, precio: 175 },
  { nombre: 'Carmelo Rodero Crianza', total: 14425, qty: 5, precio: 2885 },
]

// Chart data for 14 days
export const ATOPE_CHART = (() => {
  const data = []
  const today = new Date()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const dow = d.getDay()
    let base = dow === 6 ? 82000 : dow === 0 ? 58000 : dow === 5 ? 60000 : 40000
    base += (Math.random() - 0.5) * 10000
    data.push({
      fecha: d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
      ventas: Math.round(base),
    })
  }
  return data
})()

// Prediccion del dia
export const ATOPE_PREDICTION = {
  projected_close: 94500,
  vs_yesterday: '+60%',
  vs_last_week: '+5.1%',
  vs_dow_avg: '+10.5%',
  confidence: 87,
}

// Agentes IA activos
export const ATOPE_AGENTS = [
  { id: 'anomaly', name: 'Detector de Anomalías', status: 'active', last_run: '14:00', finding: 'Vino Vega Sicilia: 2 botellas vendidas sin registro de apertura' },
  { id: 'auto86', name: 'Auto-86 Inventario', status: 'active', last_run: '12:00', finding: 'Jamón ibérico: 3 días de stock. Pedir 15kg.' },
  { id: 'predictor', name: 'Predicción de Cierre', status: 'active', last_run: '16:00', finding: 'Proyección: $94,500 (confianza 87%)' },
  { id: 'upselling', name: 'Upselling Coach', status: 'active', last_run: '13:00', finding: 'Oportunidad: 62% de paellas sin vino. Potencial: +$890/mesa' },
  { id: 'antifraud', name: 'Anti-Fraude', status: 'active', last_run: '15:00', finding: '0 alertas. Todo limpio.' },
  { id: 'staffing', name: 'Staffing Optimizer', status: 'active', last_run: '07:00', finding: 'Sábado: agregar 1 mesero turno noche' },
  { id: 'menu_eng', name: 'Menu Engineering', status: 'active', last_run: '06:00', finding: 'Coquinas: food cost 58%. Subir precio o reducir porción.' },
  { id: 'compras', name: 'Predicción de Compras', status: 'active', last_run: '17:00', finding: 'Lunes: pedir 8kg pulpo, 12kg gambas, 3 cajas vino Muga' },
  { id: 'briefing', name: 'Morning Briefing', status: 'active', last_run: '07:00', finding: 'Hoy sábado: meta $90K. 2 reservas de grupo (8+ personas).' },
  { id: 'quality', name: 'Kitchen Quality', status: 'active', last_run: '14:00', finding: '0 cancelaciones en cocina. Tiempo promedio: 22 min.' },
  { id: 'tips', name: 'Tips Analyzer', status: 'active', last_run: '06:00', finding: 'Rodrigo lidera propinas: $32K/mes (15% de sus ventas)' },
  { id: 'waste', name: 'Waste Detector', status: 'active', last_run: '06:00', finding: 'Merma semanal: $3,200 (1.2% de ventas). Dentro de rango.' },
]

// ROI mensual de los agentes
export const ATOPE_ROI = {
  total_mensual: 68400,
  costo_fullsite: 4999,
  roi_multiplier: 13.7,
  desglose: [
    { agente: 'Staffing Optimizer', ahorro: 18200, desc: 'Optimización de turnos — 1 mesero menos L-M sin impacto' },
    { agente: 'Anti-Fraude', ahorro: 12800, desc: 'Detección de cortesías no autorizadas y descuentos excesivos' },
    { agente: 'Upselling Coach', ahorro: 11500, desc: 'Maridaje vino+paella incrementa ticket $890/mesa' },
    { agente: 'Anomaly Detector', ahorro: 8900, desc: 'Detectó faltante de Vega Sicilia ($24,900/botella)' },
    { agente: 'Predicción de Compras', ahorro: 7200, desc: 'Reduce desperdicio de mariscos frescos 40%' },
    { agente: 'Menu Engineering', ahorro: 5400, desc: 'Identificó 3 platillos con food cost >55%' },
    { agente: 'Morning Briefing', ahorro: 4400, desc: 'Equipo preparado: reduce tiempo de reacción 50%' },
  ],
}
