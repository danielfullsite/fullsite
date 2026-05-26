// Multi-tenant client configuration
// Each client gets their own config that controls branding, features, and data source

export interface ClientConfig {
  id: string
  name: string
  location: string
  type: string
  logo?: string
  // Theme
  defaultTheme: 'light' | 'dark'
  accentColor: string // tailwind color
  // Features enabled
  features: {
    pos: boolean
    posRestaurant: boolean
    posTienda: boolean
    delivery: boolean
    ecommerce: boolean
    inventory: boolean
    foodCost: boolean
    facturacion: boolean
    nomina: boolean
    agentesIA: boolean
    coach: boolean
    chatIA: boolean
    resenas: boolean
    giftCards: boolean
  }
  // Data source
  dataSource: 'supabase' | 'demo' // demo = uses hardcoded data from demo-data.ts
  supabaseClientId?: string // for filtering data in multi-tenant DB
  // Staff
  meseros: string[]
  mesas: number
  // Wansoft integration
  wansoft?: { subsidiaryId: string }
}

// ─── Client Registry ────────────────────────────────────────────────────────

const CLIENTS: Record<string, ClientConfig> = {
  amalay: {
    id: 'amalay',
    name: 'AMALAY',
    location: 'Monterrey, NL',
    type: 'Brunch & Café',
    defaultTheme: 'light',
    accentColor: 'emerald',
    features: {
      pos: true, posRestaurant: true, posTienda: true, delivery: false,
      ecommerce: false, inventory: true, foodCost: true, facturacion: true,
      nomina: false, agentesIA: true, coach: true, chatIA: true,
      resenas: false, giftCards: true,
    },
    dataSource: 'supabase',
    supabaseClientId: 'amalay',
    meseros: [
      'Omar Aguilera', 'Hector Enrique Rodriguez Lopez', 'Brayan Berlanga Solis',
      'Daniela Edith Rico Segura', 'Julio Cesar Hernández Hernández',
      'Mauricio Rodriguez Rodriguez', 'Oscar Rios Alvarado', 'Alexis Alejandro Ocampo Vera',
    ],
    mesas: 16,
    wansoft: { subsidiaryId: '1' },
  },
  demo: {
    id: 'demo',
    name: 'Casa Montaña',
    location: 'Valle Oriente, Monterrey, NL',
    type: 'Casual Dining · Brunch & Cena',
    defaultTheme: 'dark',
    accentColor: 'emerald',
    features: {
      pos: true, posRestaurant: true, posTienda: true, delivery: true,
      ecommerce: true, inventory: true, foodCost: true, facturacion: true,
      nomina: true, agentesIA: true, coach: true, chatIA: true,
      resenas: true, giftCards: true,
    },
    dataSource: 'demo',
    meseros: [
      'Alejandro Treviño', 'Sofía Garza', 'Diego Cantú', 'Valeria Lozano',
      'Emilio Salinas', 'Camila Ruiz', 'Santiago Herrera', 'Isabella Flores',
    ],
    mesas: 28,
  },
}

// New client template — copy and customize
export const NEW_CLIENT_TEMPLATE: ClientConfig = {
  id: '',
  name: '',
  location: '',
  type: '',
  defaultTheme: 'light',
  accentColor: 'emerald',
  features: {
    pos: true, posRestaurant: true, posTienda: false, delivery: false,
    ecommerce: false, inventory: true, foodCost: true, facturacion: true,
    nomina: false, agentesIA: true, coach: true, chatIA: true,
    resenas: false, giftCards: false,
  },
  dataSource: 'supabase',
  meseros: [],
  mesas: 16,
}

export function getClientConfig(clientId: string): ClientConfig {
  return CLIENTS[clientId] || CLIENTS.demo
}

export function getClientIdFromEmail(email: string): string {
  // Map emails to client IDs
  const EMAIL_MAP: Record<string, string> = {
    'ramonfaur.daniel@gmail.com': 'amalay',
    'monica@fullsite.mx': 'amalay',
    'demo@fullsite.mx': 'demo',
  }
  return EMAIL_MAP[email] || 'demo'
}

export function getAllClients(): ClientConfig[] {
  return Object.values(CLIENTS)
}
