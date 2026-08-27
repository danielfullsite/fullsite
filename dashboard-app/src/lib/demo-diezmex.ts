export type DiezMexConcept = {
  id: 'grupo' | 'rosta' | 'macadam' | 'manteca' | 'atletico' | 'casa-oso'
  name: string
  descriptor: string
  location: string
  hours: string
  accent: string
  sales: number
  tickets: number
  avgTicket: number
  foodCost: number
  status: 'Operando' | 'Preapertura'
  topItems: string[]
}

export const DIEZMEX_CONCEPTS: DiezMexConcept[] = [
  {
    id: 'rosta', name: 'ROSTA', descriptor: 'Restaurante · bar · servicio completo',
    location: 'Arboleda, SPGG', hours: 'Comida y cena', accent: '#ff5a36',
    sales: 184200, tickets: 196, avgTicket: 940, foodCost: 31.2, status: 'Operando',
    topItems: ['Servicio de mesa', 'Cocina', 'Bar'],
  },
  {
    id: 'macadam', name: 'CAFÉ MACADAM', descriptor: 'Desayunos · brunch · café',
    location: 'Gómez Morín 922, SPGG', hours: 'Desayuno a cena', accent: '#7557d9',
    sales: 96840, tickets: 268, avgTicket: 361, foodCost: 28.7, status: 'Operando',
    topItems: ['Chilaquiles', 'Huevos', 'Café'],
  },
  {
    id: 'manteca', name: 'TACOS MANTECA', descriptor: 'Tacos · mostrador · alto volumen',
    location: 'Bosques del Valle, SPGG', hours: '07:00—15:00', accent: '#e1a51d',
    sales: 73560, tickets: 412, avgTicket: 179, foodCost: 29.4, status: 'Operando',
    topItems: ['Mostrador', 'Para llevar', 'Producción'],
  },
  {
    id: 'atletico', name: 'ATLÉTICO CAFÉ', descriptor: 'Specialty coffee · all-day brunch',
    location: 'Río Amazonas 189, SPGG', hours: '08:00—20:00', accent: '#188a59',
    sales: 84290, tickets: 307, avgTicket: 275, foodCost: 26.8, status: 'Operando',
    topItems: ['Café', 'AM', 'PM'],
  },
  {
    id: 'casa-oso', name: 'CASA OSO', descriptor: 'Concepto en preparación',
    location: 'Ubicación por confirmar', hours: 'Preapertura', accent: '#986548',
    sales: 0, tickets: 0, avgTicket: 0, foodCost: 0, status: 'Preapertura',
    topItems: ['Configuración', 'Capacitación', 'Apertura'],
  },
]

export const GROUP_TOTALS = {
  sales: DIEZMEX_CONCEPTS.reduce((sum, concept) => sum + concept.sales, 0),
  tickets: DIEZMEX_CONCEPTS.reduce((sum, concept) => sum + concept.tickets, 0),
  active: DIEZMEX_CONCEPTS.filter((concept) => concept.status === 'Operando').length,
}

export const GROUP_ALERTS = [
  { concept: 'Tacos Manteca', text: 'La hora pico inicia en 38 min. Producción sugerida: +18%.', tone: 'Atención' },
  { concept: 'Café Macadam', text: 'Dos insumos compartidos están por debajo del par.', tone: 'Inventario' },
  { concept: 'ROSTA', text: 'El ticket de bar está 11% arriba del comparativo semanal.', tone: 'Oportunidad' },
]

export const WEEK = [62, 68, 65, 74, 88, 100, 91]

