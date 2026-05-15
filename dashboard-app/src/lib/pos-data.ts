// POS Menu Data — hardcoded for MVP
// SQL for Supabase tables (run when ready):
//
// CREATE TABLE pos_menu_items (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   client_id TEXT REFERENCES clients(id),
//   nombre TEXT NOT NULL,
//   categoria TEXT NOT NULL,
//   precio NUMERIC NOT NULL,
//   disponible BOOLEAN DEFAULT true,
//   orden_display INTEGER DEFAULT 0,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE pos_orders (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   client_id TEXT REFERENCES clients(id),
//   mesa INTEGER,
//   mesero TEXT,
//   personas INTEGER DEFAULT 1,
//   status TEXT DEFAULT 'abierta', -- abierta, enviada, cerrada, cancelada
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   metodo_pago TEXT, -- efectivo, tarjeta, mixto
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   closed_at TIMESTAMPTZ
// );
//
// CREATE TABLE pos_order_items (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   order_id UUID REFERENCES pos_orders(id),
//   menu_item_id UUID REFERENCES pos_menu_items(id),
//   nombre TEXT NOT NULL,
//   precio NUMERIC NOT NULL,
//   cantidad INTEGER DEFAULT 1,
//   modificadores TEXT,
//   status TEXT DEFAULT 'pendiente', -- pendiente, preparando, listo, entregado
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );

export interface MenuItem {
  id: string
  name: string
  price: number
}

export interface MenuCategory {
  id: string
  name: string
  items: MenuItem[]
}

export interface OrderItem {
  id: string
  menuItemId: string
  nombre: string
  precio: number
  cantidad: number
  modificadores: string[]  // ["Sin cebolla", "Extra queso +$25"]
  notas: string
  precioExtra: number      // sum of extra modifiers
  subtotal: number         // (precio + precioExtra) * cantidad
}

// Keep legacy alias for any other pages that import the old shape
export interface OrderItemLegacy {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers?: string
  status: 'pendiente' | 'preparando' | 'listo' | 'entregado'
  createdAt: Date
}

export interface ModificadorAgregar {
  name: string
  price: number
}

export const MODIFIERS_QUITAR = [
  'Sin cebolla', 'Sin chile', 'Sin crema', 'Sin queso',
  'Sin pan', 'Sin salsa', 'Sin jitomate', 'Sin aguacate'
]

export const MODIFIERS_AGREGAR: ModificadorAgregar[] = [
  { name: 'Extra queso', price: 25 },
  { name: 'Extra aguacate', price: 35 },
  { name: 'Extra proteína', price: 45 },
  { name: 'Extra huevo', price: 20 },
  { name: 'Extra salsa', price: 0 },
  { name: 'Leche de almendra', price: 15 },
  { name: 'Leche de avena', price: 15 },
  { name: 'Shot extra', price: 20 },
]

export interface Order {
  id: string
  mesa: number
  mesero: string
  personas: number
  status: 'abierta' | 'enviada' | 'cerrada' | 'cancelada'
  items: OrderItem[]
  subtotal: number
  iva: number
  total: number
  metodoPago?: string
  createdAt: Date
  closedAt?: Date
}

export interface Mesa {
  number: number
  capacity: number
  status: 'disponible' | 'ocupada' | 'cuenta'
  orderId?: string
  mesero?: string
  personas?: number
  total?: number
}

export const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: 'calientes',
    name: 'Calientes',
    items: [
      { id: '1', name: 'Cafe Americano', price: 48 },
      { id: '2', name: 'Cafe Latte', price: 85 },
      { id: '3', name: 'Capuchino', price: 85 },
      { id: '4', name: 'Chai Latte', price: 115 },
    ],
  },
  {
    id: 'frios',
    name: 'Frios',
    items: [
      { id: '5', name: 'Latte Frio', price: 95 },
      { id: '6', name: 'Frappe Mokka', price: 105 },
      { id: '7', name: 'Smoothie Verde', price: 95 },
    ],
  },
  {
    id: 'alimentos',
    name: 'Alimentos',
    items: [
      { id: '8', name: 'Chilaquiles', price: 255 },
      { id: '9', name: 'Half & Half', price: 310 },
      { id: '10', name: 'Enchiladas Suizas', price: 265 },
      { id: '11', name: 'Avocado Toast', price: 200 },
      { id: '12', name: 'Salmon Bagel', price: 350 },
      { id: '13', name: 'Miss Benedict', price: 310 },
      { id: '14', name: 'Garden Omelet', price: 265 },
      { id: '15', name: 'French Toast', price: 200 },
    ],
  },
  {
    id: 'postres',
    name: 'Postres',
    items: [
      { id: '16', name: 'Cheesecake', price: 130 },
      { id: '17', name: 'Carrot Cake', price: 135 },
      { id: '18', name: 'Pancakes', price: 215 },
    ],
  },
  {
    id: 'jugos',
    name: 'Jugos',
    items: [
      { id: '19', name: 'Jugo de Naranja', price: 75 },
      { id: '20', name: 'Jugo Verde', price: 85 },
    ],
  },
]

export const MESEROS = [
  'Omar Aguilera',
  'Hector Rodriguez',
  'Brayan Berlanga',
  'Daniela Rico',
  'Julio Hernandez',
  'Oscar Rios',
]

export const IVA_RATE = 0.16

// Sample mesas for the table map
export const MESAS_CONFIG: Mesa[] = Array.from({ length: 16 }, (_, i) => ({
  number: i + 1,
  capacity: i < 4 ? 2 : i < 10 ? 4 : 6,
  status: 'disponible' as const,
}))

export function formatMXN(amount: number): string {
  return `$${amount.toFixed(2)}`
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11)
}
