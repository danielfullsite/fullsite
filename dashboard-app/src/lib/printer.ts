/**
 * Thermal Printer Module — Print CSS + WebBluetooth ESC/POS
 * Supports: SEAFON 58mm and compatible 58mm/80mm thermal printers
 */

import { formatMXN, MENU_CATEGORIES } from './pos-data'
import type { Order, OrderItem } from './pos-data'
import { getStationForItem, STATION_LABELS, type StationName } from './pos-constants'

// ─── PRINT CSS (works on any device) ────────────────────────────────────────

export function printTicketCSS(order: Order) {
  const win = window.open('', '_blank', 'width=300,height=600')
  if (!win) return

  const items = order.items || []
  const now = order.closedAt ? new Date(order.closedAt) : new Date()
  const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  const itemRows = items.map(i => `
    <tr>
      <td style="text-align:left">${i.cantidad}x ${i.nombre}${i.modificadores ? '<br><small style="color:#666">' + i.modificadores + '</small>' : ''}</td>
      <td style="text-align:right;white-space:nowrap">${formatMXN(i.subtotal)}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { margin: 0; size: 58mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 11px; width: 58mm; padding: 4mm; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .line { border-top: 1px dashed #000; margin: 4px 0; }
  .big { font-size: 16px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; font-size: 11px; }
  .right { text-align: right; }
  .small { font-size: 9px; color: #666; }
</style>
</head><body>
  <div class="center bold" style="font-size:14px;margin-bottom:4px">AMALAY</div>
  <div class="center small">Coffee & Market</div>
  <div class="center small">San Pedro Garza García, NL</div>
  <div class="line"></div>

  <div style="display:flex;justify-content:space-between;font-size:10px">
    <span>Mesa: ${order.mesa}</span>
    <span>${order.mesero}</span>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:10px">
    <span>${dateStr}</span>
    <span>${timeStr}</span>
  </div>
  <div style="font-size:9px;color:#888">Orden: ${order.id.slice(0, 8)}</div>
  <div class="line"></div>

  <table>${itemRows}</table>
  <div class="line"></div>

  <table>
    <tr><td>Subtotal</td><td class="right">${formatMXN(order.subtotal)}</td></tr>
    ${order.descuento > 0 ? `<tr><td>Descuento</td><td class="right" style="color:red">-${formatMXN(order.descuento)}</td></tr>` : ''}
    <tr><td>IVA (16%)</td><td class="right">${formatMXN(order.iva)}</td></tr>
    <tr class="bold"><td style="font-size:14px">TOTAL</td><td class="right" style="font-size:14px">${formatMXN(order.total)}</td></tr>
    ${order.propina ? `<tr><td>Propina</td><td class="right">${formatMXN(order.propina)}</td></tr>` : ''}
    ${order.propina ? `<tr class="bold"><td>Total + propina</td><td class="right">${formatMXN(order.total + order.propina)}</td></tr>` : ''}
  </table>
  <div class="line"></div>

  <div class="center small" style="margin-top:2px">${order.metodoPago || ''}</div>
  <div class="center" style="margin-top:6px;font-size:10px">¡Gracias por tu visita!</div>
  <div class="center small">fullsite.mx</div>

  <script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}</script>
</body></html>`

  win.document.write(html)
  win.document.close()
}

// ESC/POS command constants (used by all Bluetooth functions)
const ESC = 0x1B
const GS = 0x1D
const LF = 0x0A
const DLE = 0x10

// ─── CASH DRAWER ────────────────────────────────────────────────────────────

export async function openCashDrawer(): Promise<boolean> {
  if (!btCharacteristic) {
    console.warn('[printer] No BT connection, cannot open cash drawer')
    return false
  }
  try {
    // ESC p 0 25 250 — kick drawer pin 2 (standard RJ-11 connection)
    const cmd = new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xFA])
    if (btCharacteristic.properties.writeWithoutResponse) {
      await btCharacteristic.writeValueWithoutResponse(cmd)
    } else {
      await btCharacteristic.writeValueWithResponse(cmd)
    }
    console.log('[printer] Cash drawer opened')
    return true
  } catch (e) {
    console.error('[printer] Cash drawer failed:', e)
    return false
  }
}

function textToBytes(text: string): number[] {
  const encoder = new TextEncoder()
  return Array.from(encoder.encode(text))
}

// ─── PRE-TICKET (precuenta — antes de cobrar) ──────────────────────────────

export function printPreTicketCSS(order: Order) {
  const win = window.open('', '_blank', 'width=300,height=600')
  if (!win) return

  const items = order.items || []
  const now = new Date()
  const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  const itemRows = items.map(i => `
    <tr>
      <td style="text-align:left">${i.cantidad}x ${i.nombre}${i.modificadores ? '<br><small style="color:#666">' + i.modificadores + '</small>' : ''}</td>
      <td style="text-align:right;white-space:nowrap">${formatMXN(i.subtotal)}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { margin: 0; size: 58mm auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: 11px; width: 58mm; padding: 4mm; color: #000; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .line { border-top: 1px dashed #000; margin: 4px 0; }
  .big { font-size: 16px; font-weight: bold; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; font-size: 11px; }
</style>
</head><body>
  <div class="center bold" style="font-size:14px;margin-bottom:2px">*** PRE-CUENTA ***</div>
  <div class="center bold" style="font-size:13px;margin-bottom:4px">AMALAY</div>
  <div class="center" style="font-size:9px">Coffee & Market</div>
  <div class="line"></div>

  <div style="display:flex;justify-content:space-between;font-size:10px">
    <span>Mesa: ${order.mesa}</span>
    <span>${order.mesero}</span>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:10px">
    <span>${dateStr}</span>
    <span>${timeStr}</span>
  </div>
  <div class="line"></div>

  <table>${itemRows}</table>
  <div class="line"></div>

  <table>
    <tr><td>Subtotal</td><td style="text-align:right">${formatMXN(order.subtotal)}</td></tr>
    ${order.descuento > 0 ? `<tr><td>Descuento</td><td style="text-align:right;color:red">-${formatMXN(order.descuento)}</td></tr>` : ''}
    <tr><td>IVA (16%)</td><td style="text-align:right">${formatMXN(order.iva)}</td></tr>
    <tr class="bold"><td style="font-size:14px">TOTAL</td><td style="text-align:right;font-size:14px">${formatMXN(order.total)}</td></tr>
  </table>
  <div class="line"></div>

  <div class="center" style="margin-top:4px;font-size:10px;font-weight:bold">* ESTE NO ES UN COMPROBANTE FISCAL *</div>
  <div class="center" style="font-size:9px;margin-top:2px">Propina no incluida</div>

  <script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}</script>
</body></html>`

  win.document.write(html)
  win.document.close()
}

export async function printPreTicketBluetooth(order: Order): Promise<boolean> {
  if (!btCharacteristic) throw new Error('Impresora no conectada')

  const cmds: number[] = []
  const now = new Date()
  const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  // Init
  cmds.push(ESC, 0x40)

  // Center + PRE-CUENTA header
  cmds.push(ESC, 0x61, 0x01)
  cmds.push(ESC, 0x45, 0x01)
  cmds.push(GS, 0x21, 0x01)
  cmds.push(...textToBytes('*** PRE-CUENTA ***\n'))
  cmds.push(GS, 0x21, 0x11)
  cmds.push(...textToBytes('AMALAY\n'))
  cmds.push(GS, 0x21, 0x00)
  cmds.push(ESC, 0x45, 0x00)
  cmds.push(...textToBytes('Coffee & Market\n'))
  cmds.push(...textToBytes('--------------------------------\n'))

  // Left align
  cmds.push(ESC, 0x61, 0x00)
  cmds.push(...textToBytes(`Mesa: ${order.mesa}  ${order.mesero}\n`))
  cmds.push(...textToBytes(`${dateStr}  ${timeStr}\n`))
  cmds.push(...textToBytes('--------------------------------\n'))

  // Items
  for (const item of order.items) {
    const name = `${item.cantidad}x ${item.nombre}`
    const price = formatMXN(item.subtotal)
    const spaces = Math.max(1, 32 - name.length - price.length)
    cmds.push(...textToBytes(name + ' '.repeat(spaces) + price + '\n'))
    if (item.modificadores) {
      cmds.push(...textToBytes(`  ${item.modificadores}\n`))
    }
  }
  cmds.push(...textToBytes('--------------------------------\n'))

  // Totals
  const pad = (label: string, val: string) => {
    const spaces = Math.max(1, 32 - label.length - val.length)
    return label + ' '.repeat(spaces) + val + '\n'
  }
  cmds.push(...textToBytes(pad('Subtotal', formatMXN(order.subtotal))))
  if (order.descuento > 0) {
    cmds.push(...textToBytes(pad('Descuento', '-' + formatMXN(order.descuento))))
  }
  cmds.push(...textToBytes(pad('IVA (16%)', formatMXN(order.iva))))
  cmds.push(ESC, 0x45, 0x01)
  cmds.push(GS, 0x21, 0x01)
  cmds.push(...textToBytes(pad('TOTAL', formatMXN(order.total))))
  cmds.push(GS, 0x21, 0x00)
  cmds.push(ESC, 0x45, 0x00)
  cmds.push(...textToBytes('--------------------------------\n'))

  // Footer
  cmds.push(ESC, 0x61, 0x01)
  cmds.push(...textToBytes('* NO ES COMPROBANTE FISCAL *\n'))
  cmds.push(...textToBytes('Propina no incluida\n'))

  // Feed + cut
  cmds.push(LF, LF, LF, LF)
  cmds.push(GS, 0x56, 0x00)

  const data = new Uint8Array(cmds)
  const CHUNK_SIZE = 128
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE)
    if (btCharacteristic.properties.writeWithoutResponse) {
      await btCharacteristic.writeValueWithoutResponse(chunk)
    } else {
      await btCharacteristic.writeValueWithResponse(chunk)
    }
    await new Promise(r => setTimeout(r, 50))
  }
  return true
}

export async function printPreTicket(order: Order) {
  if (isBluetoothConnected() && btCharacteristic) {
    try {
      await printPreTicketBluetooth(order)
      return
    } catch (e) {
      console.warn('[printer] Bluetooth pre-ticket failed, CSS fallback:', e)
    }
  }
  printPreTicketCSS(order)
}

// ─── WEBBLUETOOTH ESC/POS (Android Chrome) ──────────────────────────────────

function buildESCPOS(order: Order): Uint8Array {
  const cmds: number[] = []

  // Initialize printer
  cmds.push(ESC, 0x40) // ESC @ — init

  // Center align
  cmds.push(ESC, 0x61, 0x01) // ESC a 1 — center

  // Bold on + double height
  cmds.push(ESC, 0x45, 0x01) // ESC E 1 — bold on
  cmds.push(GS, 0x21, 0x11) // GS ! 0x11 — double width+height
  cmds.push(...textToBytes('AMALAY\n'))
  cmds.push(GS, 0x21, 0x00) // normal size
  cmds.push(ESC, 0x45, 0x00) // bold off
  cmds.push(...textToBytes('Coffee & Market\n'))
  cmds.push(...textToBytes('San Pedro Garza Garcia, NL\n'))

  // Dashed line
  cmds.push(...textToBytes('--------------------------------\n'))

  // Left align
  cmds.push(ESC, 0x61, 0x00) // ESC a 0 — left

  const now = order.closedAt ? new Date(order.closedAt) : new Date()
  const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  cmds.push(...textToBytes(`Mesa: ${order.mesa}  ${order.mesero}\n`))
  cmds.push(...textToBytes(`${dateStr}  ${timeStr}\n`))
  cmds.push(...textToBytes(`Orden: ${order.id.slice(0, 8)}\n`))
  cmds.push(...textToBytes('--------------------------------\n'))

  // Items
  for (const item of order.items) {
    const name = `${item.cantidad}x ${item.nombre}`
    const price = formatMXN(item.subtotal)
    const spaces = Math.max(1, 32 - name.length - price.length)
    cmds.push(...textToBytes(name + ' '.repeat(spaces) + price + '\n'))
    if (item.modificadores) {
      cmds.push(...textToBytes(`  ${item.modificadores}\n`))
    }
  }

  cmds.push(...textToBytes('--------------------------------\n'))

  // Totals
  const pad = (label: string, val: string) => {
    const spaces = Math.max(1, 32 - label.length - val.length)
    return label + ' '.repeat(spaces) + val + '\n'
  }

  cmds.push(...textToBytes(pad('Subtotal', formatMXN(order.subtotal))))
  if (order.descuento > 0) {
    cmds.push(...textToBytes(pad('Descuento', '-' + formatMXN(order.descuento))))
  }
  cmds.push(...textToBytes(pad('IVA (16%)', formatMXN(order.iva))))

  // Bold total
  cmds.push(ESC, 0x45, 0x01) // bold on
  cmds.push(GS, 0x21, 0x01) // double height
  cmds.push(...textToBytes(pad('TOTAL', formatMXN(order.total))))
  cmds.push(GS, 0x21, 0x00) // normal
  cmds.push(ESC, 0x45, 0x00) // bold off

  if (order.propina) {
    cmds.push(...textToBytes(pad('Propina', formatMXN(order.propina))))
    cmds.push(ESC, 0x45, 0x01)
    cmds.push(...textToBytes(pad('Total + propina', formatMXN(order.total + order.propina))))
    cmds.push(ESC, 0x45, 0x00)
  }

  cmds.push(...textToBytes('--------------------------------\n'))

  // Center
  cmds.push(ESC, 0x61, 0x01)
  if (order.metodoPago) {
    cmds.push(...textToBytes(`${order.metodoPago}\n`))
  }
  cmds.push(LF)
  cmds.push(...textToBytes('Gracias por tu visita!\n'))
  cmds.push(...textToBytes('fullsite.mx\n'))

  // Feed + cut
  cmds.push(LF, LF, LF)
  cmds.push(GS, 0x56, 0x00) // GS V 0 — full cut (if supported)

  return new Uint8Array(cmds)
}

// Bluetooth printer state
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let btDevice: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let btCharacteristic: any = null

export function isBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getNavigatorBluetooth = (): any => (navigator as any).bluetooth

export function isBluetoothConnected(): boolean {
  return btDevice?.gatt?.connected ?? false
}

export function getBluetoothPrinterName(): string | null {
  return btDevice?.name ?? null
}

export async function connectBluetoothPrinter(): Promise<string> {
  if (!isBluetoothAvailable()) {
    throw new Error('Bluetooth no disponible en este navegador')
  }

  try {
    // Request any printer device
    btDevice = await getNavigatorBluetooth().requestDevice({
      filters: [
        { namePrefix: 'SEAFON' },
        { namePrefix: 'Printer' },
        { namePrefix: 'POS' },
        { namePrefix: 'BlueTooth' },
        { namePrefix: 'MTP' },
      ],
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb', // Common printer service
        '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Nordic UART
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Other common
      ],
    })

    if (!btDevice || !btDevice.gatt) {
      throw new Error('No se seleccionó impresora')
    }

    const server = await btDevice.gatt.connect()

    // Try to find the writable characteristic
    const services = await server.getPrimaryServices()
    for (const service of services) {
      const chars = await service.getCharacteristics()
      for (const char of chars) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          btCharacteristic = char
          console.log(`[printer] Connected to ${btDevice.name}, characteristic: ${char.uuid}`)
          return btDevice.name || 'Impresora Bluetooth'
        }
      }
    }

    throw new Error('No se encontró característica de escritura en la impresora')
  } catch (e) {
    btDevice = null
    btCharacteristic = null
    throw e
  }
}

export async function disconnectBluetoothPrinter() {
  if (btDevice?.gatt?.connected) {
    btDevice.gatt.disconnect()
  }
  btDevice = null
  btCharacteristic = null
}

export async function printTicketBluetooth(order: Order): Promise<boolean> {
  if (!btCharacteristic) {
    throw new Error('Impresora no conectada')
  }

  try {
    const data = buildESCPOS(order)

    // Send in chunks (BLE has ~20 byte MTU typically, but most printers handle 128-512)
    const CHUNK_SIZE = 128
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE)
      if (btCharacteristic.properties.writeWithoutResponse) {
        await btCharacteristic.writeValueWithoutResponse(chunk)
      } else {
        await btCharacteristic.writeValueWithResponse(chunk)
      }
      // Small delay between chunks
      await new Promise(r => setTimeout(r, 50))
    }

    console.log(`[printer] Printed ${data.length} bytes`)
    return true
  } catch (e) {
    console.error('[printer] Print failed:', e)
    throw e
  }
}

// ─── KITCHEN TICKET VIA BLUETOOTH ───────────────────────────────────────────

export async function printKitchenTicketBluetooth(order: Order): Promise<boolean> {
  if (!btCharacteristic) {
    throw new Error('Impresora no conectada')
  }

  const cmds: number[] = []
  const now = new Date()
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  // Initialize
  cmds.push(ESC, 0x40)

  // Center + Bold + Big
  cmds.push(ESC, 0x61, 0x01)
  cmds.push(ESC, 0x45, 0x01)
  cmds.push(GS, 0x21, 0x11)
  cmds.push(...textToBytes('COCINA\n'))
  cmds.push(GS, 0x21, 0x00)
  cmds.push(ESC, 0x45, 0x00)

  cmds.push(...textToBytes(`Mesa ${order.mesa} - ${order.mesero}\n`))
  cmds.push(...textToBytes(`${timeStr}\n`))
  cmds.push(...textToBytes('--------------------------------\n'))

  // Left align, items
  cmds.push(ESC, 0x61, 0x00)
  cmds.push(ESC, 0x45, 0x01)

  for (const item of order.items) {
    cmds.push(GS, 0x21, 0x01) // double height for visibility
    cmds.push(...textToBytes(`${item.cantidad}x ${item.nombre}\n`))
    cmds.push(GS, 0x21, 0x00)
    if (item.modificadores) {
      cmds.push(...textToBytes(`  >> ${item.modificadores}\n`))
    }
  }

  cmds.push(ESC, 0x45, 0x00)

  if (order.notas) {
    cmds.push(...textToBytes('--------------------------------\n'))
    cmds.push(ESC, 0x45, 0x01)
    cmds.push(...textToBytes(`NOTA: ${order.notas}\n`))
    cmds.push(ESC, 0x45, 0x00)
  }

  // Feed + cut
  cmds.push(LF, LF, LF, LF)
  cmds.push(GS, 0x56, 0x00)

  const data = new Uint8Array(cmds)

  try {
    const CHUNK_SIZE = 128
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE)
      if (btCharacteristic.properties.writeWithoutResponse) {
        await btCharacteristic.writeValueWithoutResponse(chunk)
      } else {
        await btCharacteristic.writeValueWithResponse(chunk)
      }
      await new Promise(r => setTimeout(r, 50))
    }
    return true
  } catch (e) {
    console.error('[printer] Kitchen print failed:', e)
    throw e
  }
}

// ─── SMART PRINT: uses Bluetooth if connected, CSS fallback ─────────────────

export async function printKitchenTicket(order: Order) {
  if (isBluetoothConnected() && btCharacteristic) {
    try {
      await printKitchenTicketBluetooth(order)
      return
    } catch (e) {
      console.warn('[printer] Bluetooth kitchen print failed, falling back to CSS:', e)
    }
  }
  printKitchenTicketCSS(order)
}

export async function printTicket(order: Order) {
  if (isBluetoothConnected() && btCharacteristic) {
    try {
      await printTicketBluetooth(order)
      return
    } catch (e) {
      console.warn('[printer] Bluetooth print failed, falling back to CSS:', e)
    }
  }
  printTicketCSS(order)
}

// ─── KITCHEN TICKET CSS FALLBACK ────────────────────────────────────────────

export function printKitchenTicketCSS(order: Order) {
  const win = window.open('', '_blank', 'width=300,height=400')
  if (!win) return

  const items = order.items || []
  const now = new Date()
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  const itemRows = items.map(i => `
    <div style="font-size:14px;font-weight:bold;margin:4px 0">
      ${i.cantidad}x ${i.nombre}
      ${i.modificadores ? `<div style="font-size:11px;font-weight:normal;color:#666;margin-left:16px">${i.modificadores}</div>` : ''}
    </div>
  `).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { margin: 0; size: 58mm auto; }
  body { font-family: 'Courier New', monospace; width: 58mm; padding: 4mm; }
  .big { font-size: 18px; font-weight: bold; text-align: center; }
</style>
</head><body>
  <div class="big">COCINA</div>
  <div style="text-align:center;font-size:11px">Mesa ${order.mesa} · ${order.mesero} · ${timeStr}</div>
  <hr style="border-top:2px dashed #000;margin:6px 0">
  ${itemRows}
  ${order.notas ? `<hr style="border-top:1px dashed #000;margin:6px 0"><div style="font-size:11px"><b>NOTA:</b> ${order.notas}</div>` : ''}
  <script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}</script>
</body></html>`

  win.document.write(html)
  win.document.close()
}

// ─── STATION-BASED PRINTING ─────────────────────────────────────────────────

/**
 * Determine the category ID of an OrderItem by looking up its menuItemId
 * in MENU_CATEGORIES.
 */
function getCategoryIdForItem(item: OrderItem): string {
  for (const cat of MENU_CATEGORIES) {
    if (cat.items.some(mi => mi.id === item.menuItemId)) {
      return cat.id
    }
  }
  return ''
}

/**
 * Split an order's items by station (cocina, barra, caja).
 */
export function splitOrderByStation(order: Order): Record<StationName, OrderItem[]> {
  const result: Record<StationName, OrderItem[]> = { cocina: [], barra: [], caja: [] }
  for (const item of order.items) {
    const catId = getCategoryIdForItem(item)
    const station = getStationForItem(catId, item.nombre)
    result[station].push(item)
  }
  return result
}

/**
 * Print a kitchen ticket for a specific station via Bluetooth ESC/POS.
 */
async function printStationTicketBluetooth(order: Order, station: StationName, items: OrderItem[]): Promise<boolean> {
  if (!btCharacteristic) throw new Error('Impresora no conectada')

  const cmds: number[] = []
  const now = new Date()
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  const label = STATION_LABELS[station]

  // Initialize
  cmds.push(ESC, 0x40)

  // Center + Bold + Big
  cmds.push(ESC, 0x61, 0x01)
  cmds.push(ESC, 0x45, 0x01)
  cmds.push(GS, 0x21, 0x11)
  cmds.push(...textToBytes(`${label}\n`))
  cmds.push(GS, 0x21, 0x00)
  cmds.push(ESC, 0x45, 0x00)

  cmds.push(...textToBytes(`Mesa ${order.mesa} - ${order.mesero}\n`))
  cmds.push(...textToBytes(`${timeStr}\n`))
  cmds.push(...textToBytes('--------------------------------\n'))

  // Left align, items
  cmds.push(ESC, 0x61, 0x00)
  cmds.push(ESC, 0x45, 0x01)

  for (const item of items) {
    cmds.push(GS, 0x21, 0x01)
    cmds.push(...textToBytes(`${item.cantidad}x ${item.nombre}\n`))
    cmds.push(GS, 0x21, 0x00)
    if (item.modificadores && item.modificadores.length > 0) {
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

  // Feed + cut
  cmds.push(LF, LF, LF, LF)
  cmds.push(GS, 0x56, 0x00)

  const data = new Uint8Array(cmds)

  const CHUNK_SIZE = 128
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE)
    if (btCharacteristic.properties.writeWithoutResponse) {
      await btCharacteristic.writeValueWithoutResponse(chunk)
    } else {
      await btCharacteristic.writeValueWithResponse(chunk)
    }
    await new Promise(r => setTimeout(r, 50))
  }
  return true
}

/**
 * Print a kitchen ticket for a specific station via CSS fallback.
 */
function printStationTicketCSS(order: Order, station: StationName, items: OrderItem[]) {
  const win = window.open('', '_blank', 'width=300,height=400')
  if (!win) return

  const now = new Date()
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  const label = STATION_LABELS[station]

  const itemRows = items.map(i => `
    <div style="font-size:14px;font-weight:bold;margin:4px 0">
      ${i.cantidad}x ${i.nombre}
      ${i.modificadores && i.modificadores.length > 0 ? `<div style="font-size:11px;font-weight:normal;color:#666;margin-left:16px">${i.modificadores.join(', ')}</div>` : ''}
    </div>
  `).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { margin: 0; size: 58mm auto; }
  body { font-family: 'Courier New', monospace; width: 58mm; padding: 4mm; }
  .big { font-size: 18px; font-weight: bold; text-align: center; }
</style>
</head><body>
  <div class="big">${label}</div>
  <div style="text-align:center;font-size:11px">Mesa ${order.mesa} · ${order.mesero} · ${timeStr}</div>
  <hr style="border-top:2px dashed #000;margin:6px 0">
  ${itemRows}
  ${order.notas ? `<hr style="border-top:1px dashed #000;margin:6px 0"><div style="font-size:11px"><b>NOTA:</b> ${order.notas}</div>` : ''}
  <script>window.onload=function(){window.print();setTimeout(function(){window.close()},500)}</script>
</body></html>`

  win.document.write(html)
  win.document.close()
}

/**
 * Print per-station tickets: splits the order and prints a separate ticket
 * for each station that has items. Adds 200ms delay between tickets.
 */
export async function printByStation(order: Order) {
  const split = splitOrderByStation(order)
  const stations: StationName[] = ['cocina', 'barra', 'caja']
  let printed = false

  console.log('[printer] printByStation called. BT connected:', isBluetoothConnected(), 'characteristic:', !!btCharacteristic)
  console.log('[printer] Split:', { cocina: split.cocina.length, barra: split.barra.length, caja: split.caja.length })

  for (const station of stations) {
    const items = split[station]
    if (items.length === 0) {
      console.log(`[printer] ${station}: 0 items, skipping`)
      continue
    }

    console.log(`[printer] ${station}: ${items.length} items, printing...`)

    // Delay between tickets (not before the first)
    if (printed) {
      await new Promise(r => setTimeout(r, 200))
    }

    if (isBluetoothConnected() && btCharacteristic) {
      try {
        console.log(`[printer] Attempting Bluetooth print for ${station}...`)
        await printStationTicketBluetooth(order, station, items)
        console.log(`[printer] Bluetooth print SUCCESS for ${station}`)
        printed = true
        continue
      } catch (e) {
        console.warn(`[printer] Bluetooth station print (${station}) FAILED, CSS fallback:`, e)
      }
    } else {
      console.log(`[printer] No BT connection, using CSS for ${station}`)
    }
    printStationTicketCSS(order, station, items)
    printed = true
  }

  if (!printed) {
    console.warn('[printer] No items to print in any station, falling back to full kitchen ticket')
    printKitchenTicketCSS(order)
  }
}
