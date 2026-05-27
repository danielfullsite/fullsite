// Global state management with Zustand
import { create } from 'zustand'
import type { Order, StaffMember, MenuCategory, StationName } from './types'

interface POSState {
  // Auth
  staff: StaffMember | null
  setStaff: (staff: StaffMember | null) => void

  // Menu
  menu: MenuCategory[]
  setMenu: (menu: MenuCategory[]) => void

  // Current order
  currentOrder: Order | null
  setCurrentOrder: (order: Order | null) => void

  // All open orders
  openOrders: Order[]
  setOpenOrders: (orders: Order[]) => void
  addOrder: (order: Order) => void
  updateOrder: (id: string, updates: Partial<Order>) => void

  // Network
  isOnline: boolean
  setOnline: (online: boolean) => void
  pendingSyncCount: number
  setPendingSyncCount: (count: number) => void

  // Printers
  connectedPrinters: Record<StationName | 'default', string | null>
  setPrinter: (station: StationName | 'default', name: string | null) => void
}

export const usePOSStore = create<POSState>((set) => ({
  staff: null,
  setStaff: (staff) => set({ staff }),

  menu: [],
  setMenu: (menu) => set({ menu }),

  currentOrder: null,
  setCurrentOrder: (currentOrder) => set({ currentOrder }),

  openOrders: [],
  setOpenOrders: (openOrders) => set({ openOrders }),
  addOrder: (order) => set((s) => ({ openOrders: [...s.openOrders, order] })),
  updateOrder: (id, updates) => set((s) => ({
    openOrders: s.openOrders.map((o) => (o.id === id ? { ...o, ...updates } : o)),
  })),

  isOnline: true,
  setOnline: (isOnline) => set({ isOnline }),
  pendingSyncCount: 0,
  setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),

  connectedPrinters: { default: null, cocina: null, barra: null, caja: null },
  setPrinter: (station, name) => set((s) => ({
    connectedPrinters: { ...s.connectedPrinters, [station]: name },
  })),
}))
