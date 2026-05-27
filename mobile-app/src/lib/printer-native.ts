// Native Bluetooth printer for React Native
// Uses react-native-ble-plx or expo-bluetooth-serial for direct ESC/POS
// This is a scaffold — actual BLE implementation depends on the chosen library

import type { Order, StationName } from './types'

const ESC = 0x1B
const GS = 0x1D
const LF = 0x0A

interface PrinterDevice {
  id: string
  name: string
  address: string
}

interface PrinterConnection {
  device: PrinterDevice
  connected: boolean
}

// Station -> printer mapping
const stationPrinters = new Map<StationName | 'default', PrinterConnection>()

function textToBytes(text: string): number[] {
  const encoder = new TextEncoder()
  return Array.from(encoder.encode(text))
}

// ─── Connection Management ─────────────────────────────────────────────────

export async function scanForPrinters(): Promise<PrinterDevice[]> {
  // TODO: Implement with expo-bluetooth-serial or react-native-ble-plx
  // This will use native Bluetooth scanning instead of WebBluetooth
  console.log('[printer-native] Scanning for printers...')
  return []
}

export async function connectPrinter(device: PrinterDevice, station: StationName | 'default' = 'default'): Promise<boolean> {
  // TODO: Implement native BLE connection
  stationPrinters.set(station, { device, connected: true })
  console.log(`[printer-native] Connected ${device.name} to ${station}`)
  return true
}

export async function disconnectPrinter(station: StationName | 'default') {
  stationPrinters.delete(station)
}

export function isConnected(station: StationName | 'default' = 'default'): boolean {
  return stationPrinters.get(station)?.connected ?? false
}

// ─── ESC/POS Builders (reused from web version) ───────────────────────────

export function buildTicketESCPOS(order: Order): Uint8Array {
  const cmds: number[] = []
  const now = order.closedAt ? new Date(order.closedAt) : new Date()
  const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  const formatMXN = (n: number) => `$${n.toFixed(2)}`

  cmds.push(ESC, 0x40) // init
  cmds.push(ESC, 0x61, 0x01) // center
  cmds.push(ESC, 0x45, 0x01, GS, 0x21, 0x11)
  cmds.push(...textToBytes('AMALAY\n'))
  cmds.push(GS, 0x21, 0x00, ESC, 0x45, 0x00)
  cmds.push(...textToBytes('Coffee & Market\n'))
  cmds.push(...textToBytes('San Pedro Garza Garcia, NL\n'))
  cmds.push(...textToBytes('--------------------------------\n'))
  cmds.push(ESC, 0x61, 0x00) // left

  cmds.push(...textToBytes(`Mesa: ${order.mesa}  ${order.mesero}\n`))
  cmds.push(...textToBytes(`${dateStr}  ${timeStr}\n`))
  cmds.push(...textToBytes('--------------------------------\n'))

  for (const item of order.items) {
    const name = `${item.cantidad}x ${item.nombre}`
    const price = formatMXN(item.subtotal)
    const spaces = Math.max(1, 32 - name.length - price.length)
    cmds.push(...textToBytes(name + ' '.repeat(spaces) + price + '\n'))
  }

  cmds.push(...textToBytes('--------------------------------\n'))

  const pad = (label: string, val: string) => {
    const s = Math.max(1, 32 - label.length - val.length)
    return label + ' '.repeat(s) + val + '\n'
  }
  cmds.push(...textToBytes(pad('Subtotal', formatMXN(order.subtotal))))
  if (order.descuento > 0) cmds.push(...textToBytes(pad('Descuento', '-' + formatMXN(order.descuento))))
  cmds.push(...textToBytes(pad('IVA (16%)', formatMXN(order.iva))))
  cmds.push(ESC, 0x45, 0x01, GS, 0x21, 0x01)
  cmds.push(...textToBytes(pad('TOTAL', formatMXN(order.total))))
  cmds.push(GS, 0x21, 0x00, ESC, 0x45, 0x00)

  cmds.push(...textToBytes('--------------------------------\n'))
  cmds.push(ESC, 0x61, 0x01) // center
  cmds.push(...textToBytes('Gracias por tu visita!\n'))
  cmds.push(...textToBytes('fullsite.mx\n'))
  cmds.push(LF, LF, LF, GS, 0x56, 0x00) // cut

  return new Uint8Array(cmds)
}

export function buildKitchenESCPOS(order: Order, station: StationName, stationLabel: string): Uint8Array {
  const cmds: number[] = []
  const timeStr = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  cmds.push(ESC, 0x40)
  cmds.push(ESC, 0x61, 0x01, ESC, 0x45, 0x01, GS, 0x21, 0x11)
  cmds.push(...textToBytes(`${stationLabel}\n`))
  cmds.push(GS, 0x21, 0x00, ESC, 0x45, 0x00)
  cmds.push(...textToBytes(`Mesa ${order.mesa} - ${order.mesero}\n`))
  cmds.push(...textToBytes(`${timeStr}\n`))
  cmds.push(...textToBytes('--------------------------------\n'))

  cmds.push(ESC, 0x61, 0x00, ESC, 0x45, 0x01)
  for (const item of order.items) {
    cmds.push(GS, 0x21, 0x01)
    cmds.push(...textToBytes(`${item.cantidad}x ${item.nombre}\n`))
    cmds.push(GS, 0x21, 0x00)
    if (item.modificadores?.length) {
      cmds.push(...textToBytes(`  >> ${item.modificadores.join(', ')}\n`))
    }
  }
  cmds.push(ESC, 0x45, 0x00)

  if (order.notas) {
    cmds.push(...textToBytes('--------------------------------\n'))
    cmds.push(ESC, 0x45, 0x01)
    cmds.push(...textToBytes(`NOTA: ${order.notas}\n`))
    cmds.push(ESC, 0x45, 0x00)
  }

  cmds.push(LF, LF, LF, LF, GS, 0x56, 0x00)
  return new Uint8Array(cmds)
}

// ─── Print Functions ───────────────────────────────────────────────────────

export async function sendToDevice(_station: StationName | 'default', _data: Uint8Array): Promise<boolean> {
  // TODO: Implement with native BLE write
  // const conn = stationPrinters.get(station)
  // if (!conn?.connected) return false
  // Native BLE supports larger MTU (512+ bytes) vs WebBluetooth (128)
  // so we can send in bigger chunks for faster printing
  console.log('[printer-native] sendToDevice — not yet implemented')
  return false
}

export async function printTicket(order: Order): Promise<boolean> {
  const data = buildTicketESCPOS(order)
  return sendToDevice('default', data)
}

export async function printKitchenTicket(order: Order, station: StationName, label: string): Promise<boolean> {
  const data = buildKitchenESCPOS(order, station, label)
  return sendToDevice(station, data)
}

export async function openCashDrawer(): Promise<boolean> {
  const cmd = new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xFA])
  return sendToDevice('default', cmd)
}
