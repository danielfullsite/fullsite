// POS Menu Data — AMALAY real menu (Wansoft)
//
// SQL for Supabase (run in SQL Editor):
//
// CREATE TABLE pos_orders (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   client_id TEXT DEFAULT 'amalay',
//   mesa INTEGER,
//   mesero TEXT,
//   personas INTEGER DEFAULT 1,
//   status TEXT DEFAULT 'abierta',
//   subtotal NUMERIC DEFAULT 0,
//   iva NUMERIC DEFAULT 0,
//   total NUMERIC DEFAULT 0,
//   descuento NUMERIC DEFAULT 0,
//   metodo_pago TEXT,
//   notas TEXT,
//   items JSONB,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   closed_at TIMESTAMPTZ
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
  { name: 'Extra proteina', price: 45 },
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
  descuento: number
  metodoPago?: string
  notas?: string
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
    id: 'chilaquiles', name: 'Chilaquiles & Enchiladas', items: [
      { id: 'c1', name: 'Chilaquiles', price: 292 },
      { id: 'c2', name: 'Chilaquiles Light', price: 304 },
      { id: 'c3', name: 'Enchiladas Suizas', price: 261 },
    ]
  },
  {
    id: 'eggs', name: 'Eggs & Keto', items: [
      { id: 'e1', name: 'Machacado con Huevo', price: 274 },
      { id: 'e2', name: 'Half & Half Combo', price: 287 },
      { id: 'e3', name: 'Garden Omelet', price: 264 },
      { id: 'e4', name: 'Combo Fit', price: 264 },
      { id: 'e5', name: 'Egg and Pancake Combo', price: 277 },
      { id: 'e6', name: 'Miss Benedict', price: 310 },
    ]
  },
  {
    id: 'coffee', name: 'Coffee', items: [
      { id: 'cf1', name: 'Cafe Americano', price: 48 },
      { id: 'cf2', name: 'Capuchino Caliente', price: 89 },
      { id: 'cf3', name: 'Cafe Latte Caliente', price: 94 },
      { id: 'cf4', name: 'Latte Frio', price: 102 },
      { id: 'cf5', name: 'Matcha Latte Frio', price: 127 },
      { id: 'cf6', name: 'Chai Latte Frio', price: 122 },
      { id: 'cf7', name: 'Mocca Latte Caliente', price: 100 },
    ]
  },
  {
    id: 'toast', name: 'Toast & Bagels', items: [
      { id: 't1', name: 'Avocado Toast', price: 252 },
      { id: 't2', name: 'Amalay Salmon Special Toast', price: 402 },
      { id: 't3', name: 'El Mexicano Toast', price: 183 },
      { id: 't4', name: 'Salmon Bagel', price: 350 },
    ]
  },
  {
    id: 'especiales', name: 'Everyday Specials', items: [
      { id: 'es1', name: 'Combo Amalay', price: 360 },
      { id: 'es2', name: 'French Toast', price: 220 },
    ]
  },
  {
    id: 'signature', name: 'Signature', items: [
      { id: 'sg1', name: 'Mimosa Clasica', price: 160 },
      { id: 'sg2', name: 'Chamoyada de Mango', price: 120 },
    ]
  },
  {
    id: 'croissants', name: 'Croissants', items: [
      { id: 'cr1', name: 'Croque Madame Amalay', price: 308 },
      { id: 'cr2', name: 'Croissant Nutella', price: 99 },
      { id: 'cr3', name: 'Turkey & Swiss Croissant', price: 285 },
      { id: 'cr4', name: 'Croissant Almendra', price: 99 },
    ]
  },
  {
    id: 'jugos', name: 'Jugos', items: [
      { id: 'j1', name: 'Jugo de Naranja Natural', price: 78 },
      { id: 'j2', name: 'Jugo Verde de la Casa', price: 98 },
      { id: 'j3', name: 'Jugo Be Inmune', price: 115 },
      { id: 'j4', name: 'Jugo Dr Detox', price: 115 },
      { id: 'j5', name: 'Jugo U Glow', price: 115 },
    ]
  },
  {
    id: 'fresh', name: 'Fresh Drinks', items: [
      { id: 'f1', name: 'Limonada Natural', price: 63 },
      { id: 'f2', name: 'Limonada de Frutos Rojos', price: 62 },
    ]
  },
  {
    id: 'smoothies', name: 'Smoothies', items: [
      { id: 'sm1', name: 'Smoothie Mango-Matcha', price: 221 },
      { id: 'sm2', name: 'Smoothie Pink Flamingo', price: 152 },
      { id: 'sm3', name: 'Smoothie Tropical Coconut', price: 139 },
    ]
  },
  {
    id: 'frappes', name: 'Frappes', items: [
      { id: 'fr1', name: 'Frappe Matcha', price: 124 },
      { id: 'fr2', name: 'Frappe Mango-Maracuya', price: 120 },
    ]
  },
  {
    id: 'pancakes', name: 'Pancakes & Waffles', items: [
      { id: 'pw1', name: 'Classic Pancakes', price: 215 },
    ]
  },
  {
    id: 'paninis', name: 'Paninis', items: [
      { id: 'pn1', name: 'Chicken Panini', price: 296 },
    ]
  },
  {
    id: 'pizzas', name: 'Pizzas & Pastas', items: [
      { id: 'pz1', name: 'Pasta Mamarosa', price: 287 },
      { id: 'pz2', name: 'Pizza Pepperoni', price: 245 },
      { id: 'pz3', name: 'Pizza Margarita', price: 220 },
    ]
  },
  {
    id: 'bowls', name: 'Bowls', items: [
      { id: 'bw1', name: 'Acai Love Bowl', price: 232 },
      { id: 'bw2', name: 'Fruit Bowl', price: 150 },
    ]
  },
  {
    id: 'postres', name: 'Postres', items: [
      { id: 'ds1', name: 'Cheesecake', price: 130 },
      { id: 'ds2', name: 'Carrot Cake', price: 135 },
    ]
  },
  {
    id: 'bakery', name: 'Bakery', items: [
      { id: 'bk1', name: 'Concha de Mantequilla', price: 37 },
      { id: 'bk2', name: 'Healthy Crunchy Mix', price: 170 },
    ]
  },
  {
    id: 'sodas', name: 'Sodas & Agua', items: [
      { id: 'sd1', name: 'Coca Cola Regular 355ml', price: 34 },
      { id: 'sd2', name: 'Coca Cola Sin Azucar 355ml', price: 60 },
      { id: 'sd3', name: 'Coca Cola Light 355ml', price: 60 },
      { id: 'sd4', name: 'Agua Amalay 500ml', price: 44 },
      { id: 'sd5', name: 'Agua de Piedra Mineral', price: 57 },
      { id: 'sd6', name: 'Agua de Piedra Natural', price: 57 },
    ]
  },
  {
    id: 'tea', name: 'Tea & Tisanas', items: [
      { id: 'te1', name: 'Te Chai', price: 75 },
      { id: 'te2', name: 'Te Verde', price: 65 },
    ]
  },
  {
    id: 'alcohol', name: 'Bebidas OH', items: [
      { id: 'al1', name: 'Cerveza Artesanal', price: 95 },
      { id: 'al2', name: 'Vino Copa Tinto', price: 150 },
    ]
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

// ─── Supabase persistence ───────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function saveOrder(order: Order): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/pos_orders`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      client_id: 'amalay',
      mesa: order.mesa,
      mesero: order.mesero,
      personas: order.personas,
      status: order.status,
      subtotal: order.subtotal,
      iva: order.iva,
      total: order.total,
      descuento: order.descuento,
      metodo_pago: order.metodoPago ?? null,
      notas: order.notas ?? null,
      items: JSON.stringify(order.items),
      closed_at: order.closedAt ? order.closedAt.toISOString() : null,
    }),
  })
  return res.ok
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
  extra?: Record<string, unknown>
): Promise<boolean> {
  const body: Record<string, unknown> = { status, ...extra }
  if (status === 'cerrada') body.closed_at = new Date().toISOString()

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_orders?id=eq.${orderId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    }
  )
  return res.ok
}

export interface KitchenOrderFromDB {
  id: string
  mesa: number
  mesero: string
  status: string
  items: string // JSON string of OrderItem[]
  created_at: string
  notas: string | null
}

export async function getKitchenOrders(): Promise<KitchenOrderFromDB[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pos_orders?status=in.(enviada,preparando,lista)&order=created_at.desc`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      cache: 'no-store',
    }
  )
  if (!res.ok) return []
  return res.json()
}
