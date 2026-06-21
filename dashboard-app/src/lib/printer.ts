/**
 * Thermal Printer Module — Print CSS + WebBluetooth ESC/POS
 * Supports: SEAFON 58mm and compatible 58mm/80mm thermal printers
 */

import { formatMXN, MENU_CATEGORIES } from './pos-data'
import type { Order, OrderItem } from './pos-data'
import { getStationForItem, STATION_LABELS, isTiempoItem, type StationName } from './pos-constants'

// ─── PRINT CSS (works on any device) ────────────────────────────────────────

export function printTicketCSS(order: Order) {
  const win = window.open('', '_blank', 'width=300,height=600')
  if (!win) return

  const items = (order.items || []).filter(i => !isTiempoItem(i))
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

  <div class="center" style="margin-top:8px">
    <div style="font-size:9px;font-weight:bold;margin-bottom:4px">FACTURA ELECTRÓNICA</div>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(`https://app.fullsite.mx/factura?order=${order.id.slice(0, 8)}&total=${order.total}&fecha=${(order.closedAt ? new Date(order.closedAt) : new Date()).toISOString().split('T')[0]}`)}" style="width:100px;height:100px" />
    <div style="font-size:8px;color:#666;margin-top:2px">Escanea para solicitar tu factura</div>
  </div>

  <div class="line"></div>
  <div class="center" style="margin-top:4px;font-size:10px">¡Gracias por tu visita!</div>
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

// ─── ANCHO DE TICKET ────────────────────────────────────────────────────────
// Las impresoras EC Line EC-PM-80250 (80mm, vía bridge) imprimen 48 columnas;
// la SEAFON Bluetooth (58mm, de prueba) imprime 32. Los builders reciben el
// ancho como parámetro: bridge → 48, Bluetooth → 32.

type TicketCols = 32 | 48
const COLS_BT: TicketCols = 32 // 58mm (SEAFON Bluetooth)
const COLS_BRIDGE: TicketCols = 48 // 80mm (EC-PM-80250 vía bridge)

function dashedLine(cols: TicketCols): string {
  return '-'.repeat(cols) + '\n'
}

function padLine(label: string, val: string, cols: TicketCols): string {
  const spaces = Math.max(1, cols - label.length - val.length)
  return label + ' '.repeat(spaces) + val + '\n'
}

// ─── CASH DRAWER ────────────────────────────────────────────────────────────

export async function openCashDrawer(): Promise<boolean> {
  // 1) Bridge local (terminal Windows con impresora de caja + cajón RJ-11)
  if (await bridgeDrawer()) {
    console.log('[printer] Cash drawer opened (bridge)')
    return true
  }
  // 2) Bluetooth (reconecta si la impresora se durmió)
  if (!(await ensureConnected('default')) || !btCharacteristic) {
    console.warn('[printer] No BT connection, cannot open cash drawer')
    return false
  }
  try {
    // ESC p 0 25 250 — kick drawer pin 2 (standard RJ-11 connection)
    await writeToPrinter(btCharacteristic, new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xFA]))
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

// ─── PRINT BRIDGE (servicio local en la terminal Windows) ──────────────────
// fullsite-os/tools/print-bridge — escucha en 127.0.0.1:7717 y entrega bytes
// ESC/POS a impresoras USB/red. Localhost está exento de mixed-content, así
// que el POS en HTTPS puede llamarlo. Primera opción de impresión; si no
// responde se cae a Bluetooth y luego a CSS.

const BRIDGE_URL = 'http://127.0.0.1:7717'
const BRIDGE_HEALTH_TTL_MS = 30_000

let bridgeAvailable: boolean | null = null
let bridgeLastCheck = 0

async function isBridgeAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const now = Date.now()
  if (bridgeAvailable !== null && now - bridgeLastCheck < BRIDGE_HEALTH_TTL_MS) {
    return bridgeAvailable
  }
  bridgeLastCheck = now
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 800)
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    bridgeAvailable = res.ok
  } catch {
    bridgeAvailable = false
  }
  if (bridgeAvailable) console.log('[printer] Print bridge detectado en', BRIDGE_URL)
  return bridgeAvailable
}

// ── Escritura serializada a impresora ───────────────────────────────────────
// ESC/POS es sensible al orden de bytes: dos impresiones concurrentes (o un
// keep-alive a media impresión) intercalarían chunks y corromperían el ticket.
// Toda escritura BT/USB pasa por esta cola global.
let printChain: Promise<void> = Promise.resolve()
const BT_CHUNK_SIZE = 128

// Exportada para tests (serialización de escrituras concurrentes).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeToPrinter(char: any, data: Uint8Array): Promise<void> {
  const run = async () => {
    for (let i = 0; i < data.length; i += BT_CHUNK_SIZE) {
      const chunk = data.slice(i, i + BT_CHUNK_SIZE)
      if (char.properties.writeWithoutResponse) {
        await char.writeValueWithoutResponse(chunk)
      } else {
        await char.writeValueWithResponse(chunk)
      }
      await new Promise(r => setTimeout(r, 50))
    }
  }
  const p = printChain.then(run, run)
  printChain = p.then(() => undefined, () => undefined)
  return p
}

function bytesToBase64(data: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < data.length; i += CHUNK) {
    bin += String.fromCharCode(...data.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** Imprime vía bridge. Si falla, encola para retry automático. */
async function bridgePrint(bytes: Uint8Array, station?: StationName): Promise<boolean> {
  if (!(await isBridgeAvailable())) {
    // Bridge not available — enqueue for retry
    try {
      const { enqueueFailedPrint, startRetryLoop } = await import('./print-queue')
      enqueueFailedPrint(bytes, station || 'tickets', 'comanda')
      startRetryLoop()
    } catch { /* print-queue not available */ }
    return false
  }
  try {
    const res = await fetch(`${BRIDGE_URL}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(station ? { station } : {}), data: bytesToBase64(bytes) }),
    })
    if (!res.ok) {
      console.warn(`[printer] Bridge /print HTTP ${res.status}`)
      // Enqueue failed print for retry
      try {
        const { enqueueFailedPrint, startRetryLoop } = await import('./print-queue')
        enqueueFailedPrint(bytes, station || 'tickets', 'comanda')
        startRetryLoop()
      } catch { /* */ }
      return false
    }
    console.log(`[printer] Bridge imprimió ${bytes.length} bytes${station ? ` (${station})` : ''}`)
    return true
  } catch (e) {
    console.warn('[printer] Bridge print falló:', e)
    bridgeAvailable = false
    // Enqueue for retry
    try {
      const { enqueueFailedPrint, startRetryLoop } = await import('./print-queue')
      enqueueFailedPrint(bytes, station || 'tickets', 'comanda')
      startRetryLoop()
    } catch { /* */ }
    return false
  }
}

/** Kick de cajón vía bridge. Devuelve false si no está disponible. */
async function bridgeDrawer(): Promise<boolean> {
  if (!(await isBridgeAvailable())) return false
  try {
    const res = await fetch(`${BRIDGE_URL}/drawer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    return res.ok
  } catch (e) {
    console.warn('[printer] Bridge drawer falló:', e)
    bridgeAvailable = false
    return false
  }
}

// ─── PRE-TICKET (precuenta — antes de cobrar) ──────────────────────────────

export function printPreTicketCSS(order: Order) {
  const win = window.open('', '_blank', 'width=300,height=600')
  if (!win) return

  const items = (order.items || []).filter(i => !isTiempoItem(i))
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

function buildPreTicketBytes(order: Order, cols: TicketCols = COLS_BT): Uint8Array {
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
  cmds.push(...textToBytes(dashedLine(cols)))

  // Left align
  cmds.push(ESC, 0x61, 0x00)
  cmds.push(...textToBytes(`Mesa: ${order.mesa}  ${order.mesero}\n`))
  cmds.push(...textToBytes(`${dateStr}  ${timeStr}\n`))
  cmds.push(...textToBytes(dashedLine(cols)))

  // Items
  for (const item of order.items.filter(i => !isTiempoItem(i))) {
    const name = `${item.cantidad}x ${item.nombre}`
    const price = formatMXN(item.subtotal)
    cmds.push(...textToBytes(padLine(name, price, cols)))
    if (item.modificadores) {
      cmds.push(...textToBytes(`  ${item.modificadores}\n`))
    }
  }
  cmds.push(...textToBytes(dashedLine(cols)))

  // Totals
  cmds.push(...textToBytes(padLine('Subtotal', formatMXN(order.subtotal), cols)))
  if (order.descuento > 0) {
    cmds.push(...textToBytes(padLine('Descuento', '-' + formatMXN(order.descuento), cols)))
  }
  cmds.push(...textToBytes(padLine('IVA (16%)', formatMXN(order.iva), cols)))
  cmds.push(ESC, 0x45, 0x01)
  cmds.push(GS, 0x21, 0x01)
  cmds.push(...textToBytes(padLine('TOTAL', formatMXN(order.total), cols)))
  cmds.push(GS, 0x21, 0x00)
  cmds.push(ESC, 0x45, 0x00)
  cmds.push(...textToBytes(dashedLine(cols)))

  // Footer
  cmds.push(ESC, 0x61, 0x01)
  cmds.push(...textToBytes('* NO ES COMPROBANTE FISCAL *\n'))
  cmds.push(...textToBytes('Propina no incluida\n'))

  // Feed + cut
  cmds.push(LF, LF, LF, LF)
  cmds.push(GS, 0x56, 0x00)

  return new Uint8Array(cmds)
}

export async function printPreTicketBluetooth(order: Order): Promise<boolean> {
  if (!(await ensureConnected('default')) || !btCharacteristic) throw new Error('Impresora no conectada')

  const data = buildPreTicketBytes(order)
  await writeToPrinter(btCharacteristic, data)
  return true
}

export async function printPreTicket(order: Order) {
  // 1) Bridge local
  if (await bridgePrint(buildPreTicketBytes(order, COLS_BRIDGE))) return
  // 2) Bluetooth (reconecta si la impresora se durmió)
  if (await ensureConnected('default')) {
    try {
      await printPreTicketBluetooth(order)
      return
    } catch (e) {
      console.warn('[printer] Bluetooth pre-ticket failed, CSS fallback:', e)
    }
  }
  // 3) CSS
  printPreTicketCSS(order)
}

// ─── WEBBLUETOOTH ESC/POS (Android Chrome) ──────────────────────────────────

function buildESCPOS(order: Order, cols: TicketCols = COLS_BT): Uint8Array {
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
  cmds.push(...textToBytes(dashedLine(cols)))

  // Left align
  cmds.push(ESC, 0x61, 0x00) // ESC a 0 — left

  const now = order.closedAt ? new Date(order.closedAt) : new Date()
  const dateStr = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  cmds.push(...textToBytes(`Mesa: ${order.mesa}  ${order.mesero}\n`))
  cmds.push(...textToBytes(`${dateStr}  ${timeStr}\n`))
  cmds.push(...textToBytes(`Orden: ${order.id.slice(0, 8)}\n`))
  cmds.push(...textToBytes(dashedLine(cols)))

  // Items
  for (const item of order.items.filter(i => !isTiempoItem(i))) {
    const name = `${item.cantidad}x ${item.nombre}`
    const price = formatMXN(item.subtotal)
    cmds.push(...textToBytes(padLine(name, price, cols)))
    if (item.modificadores) {
      cmds.push(...textToBytes(`  ${item.modificadores}\n`))
    }
  }

  cmds.push(...textToBytes(dashedLine(cols)))

  // Totals
  cmds.push(...textToBytes(padLine('Subtotal', formatMXN(order.subtotal), cols)))
  if (order.descuento > 0) {
    cmds.push(...textToBytes(padLine('Descuento', '-' + formatMXN(order.descuento), cols)))
  }
  cmds.push(...textToBytes(padLine('IVA (16%)', formatMXN(order.iva), cols)))

  // Bold total
  cmds.push(ESC, 0x45, 0x01) // bold on
  cmds.push(GS, 0x21, 0x01) // double height
  cmds.push(...textToBytes(padLine('TOTAL', formatMXN(order.total), cols)))
  cmds.push(GS, 0x21, 0x00) // normal
  cmds.push(ESC, 0x45, 0x00) // bold off

  if (order.propina) {
    cmds.push(...textToBytes(padLine('Propina', formatMXN(order.propina), cols)))
    cmds.push(ESC, 0x45, 0x01)
    cmds.push(...textToBytes(padLine('Total + propina', formatMXN(order.total + order.propina), cols)))
    cmds.push(ESC, 0x45, 0x00)
  }

  cmds.push(...textToBytes(dashedLine(cols)))

  // Center
  cmds.push(ESC, 0x61, 0x01)
  if (order.metodoPago) {
    cmds.push(...textToBytes(`${order.metodoPago}\n`))
  }
  cmds.push(LF)

  // QR Code for CFDI self-service invoice
  const facturaURL = `https://app.fullsite.mx/factura?order=${order.id.slice(0, 8)}&total=${order.total}&fecha=${(order.closedAt ? new Date(order.closedAt) : new Date()).toISOString().split('T')[0]}`
  cmds.push(...textToBytes('FACTURA ELECTRONICA\n'))
  // ESC/POS QR Code: GS ( k — store + print QR
  const qrData = new TextEncoder().encode(facturaURL)
  const qrLen = qrData.length + 3
  // Set QR model
  cmds.push(GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00)
  // Set QR size (module size 4)
  cmds.push(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x04)
  // Set error correction (L)
  cmds.push(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30)
  // Store QR data
  cmds.push(GS, 0x28, 0x6B, qrLen & 0xFF, (qrLen >> 8) & 0xFF, 0x31, 0x50, 0x30, ...qrData)
  // Print QR
  cmds.push(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30)
  cmds.push(LF)
  cmds.push(...textToBytes('Escanea para tu factura\n'))

  cmds.push(...textToBytes(dashedLine(cols)))
  cmds.push(...textToBytes('Gracias por tu visita!\n'))
  cmds.push(...textToBytes('fullsite.mx\n'))

  // Feed + cut
  cmds.push(LF, LF, LF)
  cmds.push(GS, 0x56, 0x00) // GS V 0 — full cut (if supported)

  return new Uint8Array(cmds)
}

// ─── MULTI-PRINTER SYSTEM ──────────────────────────────────────────────────
// Each station (cocina, barra, caja) can have its own Bluetooth printer.
// The 'default' key is the main POS printer (for tickets, pre-tickets).

type PrinterSlot = StationName | 'default'

interface PrinterConnection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  device: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  characteristic: any
  name: string
}

const printers = new Map<PrinterSlot, PrinterConnection>()

// Backward-compatible aliases
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let btDevice: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let btCharacteristic: any = null

function syncLegacyRefs() {
  const main = printers.get('default')
  btDevice = main?.device ?? null
  btCharacteristic = main?.characteristic ?? null
}

export function isBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export function isUsbAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getNavigatorBluetooth = (): any => (navigator as any).bluetooth

export function isBluetoothConnected(): boolean {
  const main = printers.get('default')
  return main?.device?.gatt?.connected ?? false
}

export function getBluetoothPrinterName(): string | null {
  return printers.get('default')?.name ?? null
}

export function getStationPrinterName(station: PrinterSlot): string | null {
  return printers.get(station)?.name ?? null
}

export function isStationPrinterConnected(station: PrinterSlot): boolean {
  const p = printers.get(station)
  return p?.device?.gatt?.connected ?? false
}

export function getAllConnectedPrinters(): { slot: PrinterSlot; name: string }[] {
  const result: { slot: PrinterSlot; name: string }[] = []
  for (const [slot, conn] of printers) {
    if (conn.device?.gatt?.connected) {
      result.push({ slot, name: conn.name })
    }
  }
  return result
}

async function connectPrinterDevice(): Promise<PrinterConnection> {
  if (!isBluetoothAvailable()) {
    throw new Error('Bluetooth no disponible en este navegador')
  }

  const device = await getNavigatorBluetooth().requestDevice({
    filters: [
      { namePrefix: 'SEAFON' },
      { namePrefix: 'Printer' },
      { namePrefix: 'POS' },
      { namePrefix: 'BlueTooth' },
      { namePrefix: 'MTP' },
    ],
    optionalServices: [
      '000018f0-0000-1000-8000-00805f9b34fb',
      '49535343-fe7d-4ae5-8fa9-9fafd205e455',
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    ],
  })

  if (!device || !device.gatt) {
    throw new Error('No se seleccionó impresora')
  }

  const server = await device.gatt.connect()
  const services = await server.getPrimaryServices()

  for (const service of services) {
    const chars = await service.getCharacteristics()
    for (const char of chars) {
      if (char.properties.write || char.properties.writeWithoutResponse) {
        const name = device.name || 'Impresora Bluetooth'
        console.log(`[printer] Connected to ${name}, characteristic: ${char.uuid}`)
        return { device, characteristic: char, name }
      }
    }
  }

  throw new Error('No se encontró característica de escritura en la impresora')
}

// ─── WebUSB (impresoras térmicas USB, ej. SEAFON 58mm) ────────────────────
// Devuelve un PrinterConnection con la MISMA forma que el de Bluetooth:
// - characteristic.writeValueWithoutResponse(data) → usbDevice.transferOut(ep, data)
// - device.gatt.connected → usbDevice.opened
// Así todo el pipeline de impresión existente funciona sin cambios.

async function connectUsbPrinterDevice(): Promise<PrinterConnection> {
  if (!isUsbAvailable()) {
    throw new Error('WebUSB no disponible en este navegador')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usb: any = (navigator as any).usb

  // Filtro por clase 7 (printer); fallback sin filtros si el chooser no muestra nada
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let usbDevice: any
  try {
    usbDevice = await usb.requestDevice({ filters: [{ classCode: 7 }] })
  } catch {
    usbDevice = await usb.requestDevice({ filters: [] })
  }
  if (!usbDevice) throw new Error('No se seleccionó impresora USB')

  await usbDevice.open()
  if (usbDevice.configuration === null) {
    await usbDevice.selectConfiguration(1)
  }

  // Buscar interface con endpoint bulk OUT (preferir clase 7 = printer)
  let ifaceNum = -1
  let epOut = -1
  let altSetting = 0
  const candidates: { iface: number; alt: number; ep: number; isPrinter: boolean }[] = []
  for (const iface of usbDevice.configuration.interfaces) {
    for (const alt of iface.alternates) {
      for (const ep of alt.endpoints) {
        if (ep.direction === 'out' && ep.type === 'bulk') {
          candidates.push({
            iface: iface.interfaceNumber,
            alt: alt.alternateSetting,
            ep: ep.endpointNumber,
            isPrinter: alt.interfaceClass === 7,
          })
        }
      }
    }
  }
  const chosen = candidates.find(c => c.isPrinter) ?? candidates[0]
  if (!chosen) {
    await usbDevice.close()
    throw new Error('La impresora USB no tiene endpoint de escritura (bulk OUT)')
  }
  ifaceNum = chosen.iface
  epOut = chosen.ep
  altSetting = chosen.alt

  await usbDevice.claimInterface(ifaceNum)
  if (altSetting !== 0) {
    try { await usbDevice.selectAlternateInterface(ifaceNum, altSetting) } catch { /* opcional */ }
  }

  const name =
    usbDevice.productName ||
    `USB ${usbDevice.vendorId?.toString(16)}:${usbDevice.productId?.toString(16)}` ||
    'Impresora USB'

  const write = async (data: BufferSource) => {
    const result = await usbDevice.transferOut(epOut, data)
    if (result.status !== 'ok') {
      throw new Error(`Error al escribir a impresora USB (${result.status})`)
    }
  }

  // Adapter con la forma del par device/characteristic de Web Bluetooth
  const characteristic = {
    uuid: `usb-ep-${epOut}`,
    properties: { write: true, writeWithoutResponse: true },
    writeValueWithoutResponse: write,
    writeValueWithResponse: write,
  }
  const device = {
    name,
    isUsb: true,
    gatt: {
      get connected() { return !!usbDevice.opened },
      disconnect: () => { usbDevice.close().catch(() => {}) },
    },
  }

  console.log(`[printer] Connected USB ${name}, iface ${ifaceNum}, ep OUT ${epOut}`)
  return { device, characteristic, name }
}

/** Connect the default (main POS) printer via USB */
export async function connectUsbPrinter(): Promise<string> {
  try {
    const conn = await connectUsbPrinterDevice()
    printers.set('default', conn)
    syncLegacyRefs()
    return conn.name
  } catch (e) {
    printers.delete('default')
    syncLegacyRefs()
    throw e
  }
}

/** Connect a station-specific printer via USB */
export async function connectStationUsbPrinter(station: StationName): Promise<string> {
  try {
    const conn = await connectUsbPrinterDevice()
    printers.set(station, conn)
    console.log(`[printer] Station ${station} → ${conn.name} (USB)`)
    savePrinterAssignments()
    return conn.name
  } catch (e) {
    printers.delete(station)
    throw e
  }
}

/** Connect the default (main POS) printer */
export async function connectBluetoothPrinter(): Promise<string> {
  try {
    const conn = await connectPrinterDevice()
    printers.set('default', conn)
    attachAutoReconnect('default', conn)
    startKeepAlive()
    syncLegacyRefs()
    return conn.name
  } catch (e) {
    printers.delete('default')
    syncLegacyRefs()
    throw e
  }
}

/** Connect a station-specific printer */
export async function connectStationPrinter(station: StationName): Promise<string> {
  try {
    const conn = await connectPrinterDevice()
    printers.set(station, conn)
    attachAutoReconnect(station, conn)
    startKeepAlive()
    console.log(`[printer] Station ${station} → ${conn.name}`)
    savePrinterAssignments()
    return conn.name
  } catch (e) {
    printers.delete(station)
    throw e
  }
}

export async function disconnectBluetoothPrinter() {
  const main = printers.get('default')
  if (main?.device?.gatt?.connected) {
    main.device.gatt.disconnect()
  }
  printers.delete('default')
  syncLegacyRefs()
}

export async function disconnectStationPrinter(station: StationName) {
  const conn = printers.get(station)
  if (conn?.device?.gatt?.connected) {
    conn.device.gatt.disconnect()
  }
  printers.delete(station)
  savePrinterAssignments()
}

export async function disconnectAllPrinters() {
  for (const [, conn] of printers) {
    if (conn.device?.gatt?.connected) {
      conn.device.gatt.disconnect()
    }
  }
  printers.clear()
  syncLegacyRefs()
  savePrinterAssignments()
}

// ─── RECONEXIÓN AUTOMÁTICA + KEEP-ALIVE ────────────────────────────────────
// Las impresoras BLE baratas (SEAFON y clones) se duermen tras unos segundos
// sin tráfico y cortan la conexión GATT. Tres defensas:
// 1. Keep-alive: DLE EOT 1 (status en tiempo real, no imprime) cada 25s
// 2. Auto-reconexión al evento gattserverdisconnected (con backoff)
// 3. ensureConnected() antes de cada impresión

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rediscoverCharacteristic(device: any): Promise<any | null> {
  const server = await device.gatt.connect()
  const services = await server.getPrimaryServices()
  for (const service of services) {
    const chars = await service.getCharacteristics()
    for (const char of chars) {
      if (char.properties.write || char.properties.writeWithoutResponse) return char
    }
  }
  return null
}

/** Reconecta un slot si la conexión GATT se cayó. No requiere gesto de usuario
 *  porque ya tenemos el BluetoothDevice del pairing original. */
async function ensureConnected(slot: PrinterSlot): Promise<boolean> {
  const conn = printers.get(slot)
  if (!conn) return false
  if (conn.device?.isUsb) return !!conn.device?.gatt?.connected // USB: no hay re-claim sin gesto
  if (conn.device?.gatt?.connected) return true
  try {
    const char = await rediscoverCharacteristic(conn.device)
    if (!char) return false
    conn.characteristic = char
    syncLegacyRefs()
    console.log(`[printer] Reconectada ${conn.name} (${slot})`)
    return true
  } catch (e) {
    console.warn(`[printer] Reconexión fallida (${slot}):`, e)
    return false
  }
}

function attachAutoReconnect(slot: PrinterSlot, conn: PrinterConnection) {
  const device = conn.device
  if (!device || device.isUsb || typeof device.addEventListener !== 'function') return
  device.addEventListener('gattserverdisconnected', async () => {
    // Si el slot ya fue reasignado o desconectado a propósito, no reintentar
    if (printers.get(slot) !== conn) return
    console.warn(`[printer] ${conn.name} se desconectó — reintentando...`)
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
      if (printers.get(slot) !== conn) return
      if (await ensureConnected(slot)) return
    }
    console.warn(`[printer] ${conn.name}: no se pudo reconectar tras 5 intentos`)
  })
}

const KEEPALIVE_MS = 25_000
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let keepAliveTimer: any = null

function startKeepAlive() {
  if (keepAliveTimer) return
  keepAliveTimer = setInterval(async () => {
    for (const [, conn] of printers) {
      if (conn.device?.isUsb || !conn.device?.gatt?.connected) continue
      try {
        // DLE EOT 1 — consulta de status en tiempo real, no imprime nada.
        // Pasa por la cola para nunca caer a media impresión.
        await writeToPrinter(conn.characteristic, new Uint8Array([DLE, 0x04, 0x01]))
      } catch { /* la auto-reconexión se encarga */ }
    }
  }, KEEPALIVE_MS)
}

/** Get the characteristic for a station (falls back to default), reconnecting if needed */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCharForStation(station?: StationName): Promise<any | null> {
  if (station && await ensureConnected(station)) {
    return printers.get(station)!.characteristic
  }
  // Fallback to default printer
  if (await ensureConnected('default')) {
    return printers.get('default')!.characteristic
  }
  return null
}

/** Persist printer assignments (name only — BT reconnects manually) */
function savePrinterAssignments() {
  const assignments: Record<string, string> = {}
  for (const [slot, conn] of printers) {
    assignments[slot] = conn.name
  }
  localStorage.setItem('printer_assignments', JSON.stringify(assignments))
}

export function getSavedPrinterAssignments(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem('printer_assignments') || '{}')
  } catch { return {} }
}

export async function printTicketBluetooth(order: Order): Promise<boolean> {
  if (!(await ensureConnected('default')) || !btCharacteristic) {
    throw new Error('Impresora no conectada')
  }

  try {
    const data = buildESCPOS(order)

    await writeToPrinter(btCharacteristic, data)

    console.log(`[printer] Printed ${data.length} bytes`)
    return true
  } catch (e) {
    console.error('[printer] Print failed:', e)
    throw e
  }
}

// ─── KITCHEN TICKET VIA BLUETOOTH ───────────────────────────────────────────

export async function printKitchenTicketBluetooth(order: Order): Promise<boolean> {
  if (!(await ensureConnected('default')) || !btCharacteristic) {
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
  cmds.push(...textToBytes(dashedLine(COLS_BT)))

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
    cmds.push(...textToBytes(dashedLine(COLS_BT)))
    cmds.push(ESC, 0x45, 0x01)
    cmds.push(...textToBytes(`NOTA: ${order.notas}\n`))
    cmds.push(ESC, 0x45, 0x00)
  }

  // Feed + cut
  cmds.push(LF, LF, LF, LF)
  cmds.push(GS, 0x56, 0x00)

  const data = new Uint8Array(cmds)

  try {
    await writeToPrinter(btCharacteristic, data)
    return true
  } catch (e) {
    console.error('[printer] Kitchen print failed:', e)
    throw e
  }
}

// ─── SMART PRINT: uses Bluetooth if connected, CSS fallback ─────────────────

export async function printKitchenTicket(order: Order) {
  if (await ensureConnected('default')) {
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
  // 1) Bridge local (impresora de caja en la terminal Windows)
  if (await bridgePrint(buildESCPOS(order, COLS_BRIDGE))) return
  // 2) Bluetooth (reconecta si la impresora se durmió)
  if (await ensureConnected('default')) {
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
      ${i.modificadores && i.modificadores.length > 0 ? `<div style="font-size:11px;font-weight:normal;color:#666;margin-left:16px">${Array.isArray(i.modificadores) ? i.modificadores.join(', ') : i.modificadores}</div>` : ''}
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
  const stations: StationName[] = ['cocina', 'barra', 'caja']
  for (const item of order.items) {
    // Separadores de tiempo (Wansoft): van a TODAS las estaciones para que
    // cada una sepa qué partidas son de qué tiempo
    if (isTiempoItem(item)) {
      for (const s of stations) result[s].push(item)
      continue
    }
    // Estación explícita del item (fijada por el POS al agregar, por categoría de BD)
    // — el lookup por MENU_CATEGORIES estático falla con el catálogo Wansoft importado
    const station = item.station ?? getStationForItem(getCategoryIdForItem(item), item.nombre)
    result[station].push(item)
  }
  // Limpiar: quitar separadores colgantes (sin platillos después) y
  // estaciones que solo tienen separadores
  for (const s of stations) {
    const items = result[s]
    while (items.length > 0 && isTiempoItem(items[items.length - 1])) items.pop()
    if (items.every(i => isTiempoItem(i))) result[s] = []
  }
  return result
}

/**
 * Print a kitchen ticket for a specific station via Bluetooth ESC/POS.
 * Uses station-specific printer if connected, otherwise falls back to default.
 */
function buildStationTicketBytes(order: Order, station: StationName, items: OrderItem[], cols: TicketCols = COLS_BT): Uint8Array {
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
  cmds.push(...textToBytes(dashedLine(cols)))

  // Left align, items
  cmds.push(ESC, 0x61, 0x00)
  cmds.push(ESC, 0x45, 0x01)

  for (const item of items) {
    // Separador de tiempo (Wansoft): línea centrada e invertida "XX TIEMPO: N XX"
    if (isTiempoItem(item)) {
      cmds.push(ESC, 0x61, 0x01) // center
      cmds.push(GS, 0x42, 0x01) // inverted (white on black)
      cmds.push(...textToBytes(` ${item.nombre} \n`))
      cmds.push(GS, 0x42, 0x00)
      cmds.push(ESC, 0x61, 0x00) // back to left
      continue
    }
    cmds.push(GS, 0x21, 0x01)
    const sillaTag = item.silla && item.silla > 0 ? ` [S${item.silla}]` : ''
    cmds.push(...textToBytes(`${item.cantidad}x ${item.nombre}${sillaTag}\n`))
    cmds.push(GS, 0x21, 0x00)
    if (item.modificadores && item.modificadores.length > 0) {
      cmds.push(...textToBytes(`  >> ${item.modificadores.join(', ')}\n`))
    }
  }

  cmds.push(ESC, 0x45, 0x00)

  if (order.notas) {
    cmds.push(...textToBytes(dashedLine(cols)))
    cmds.push(ESC, 0x45, 0x01)
    cmds.push(...textToBytes(`NOTA: ${order.notas}\n`))
    cmds.push(ESC, 0x45, 0x00)
  }

  // Feed + cut
  cmds.push(LF, LF, LF, LF)
  cmds.push(GS, 0x56, 0x00)

  return new Uint8Array(cmds)
}

/**
 * Print a kitchen ticket for a specific station via Bluetooth ESC/POS.
 * Uses station-specific printer if connected, otherwise falls back to default.
 */
async function printStationTicketBluetooth(order: Order, station: StationName, items: OrderItem[]): Promise<boolean> {
  const char = await getCharForStation(station)
  if (!char) throw new Error('Impresora no conectada')

  const data = buildStationTicketBytes(order, station, items)
  await writeToPrinter(char, data)
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

  const itemRows = items.map(i => {
    if (isTiempoItem(i)) {
      return `<div style="font-size:12px;font-weight:bold;text-align:center;background:#000;color:#fff;padding:2px 0;margin:6px 0">${i.nombre}</div>`
    }
    const sillaTag = i.silla && i.silla > 0 ? ` [S${i.silla}]` : ''
    return `
    <div style="font-size:14px;font-weight:bold;margin:4px 0">
      ${i.cantidad}x ${i.nombre}${sillaTag}
      ${i.modificadores && i.modificadores.length > 0 ? `<div style="font-size:11px;font-weight:normal;color:#666;margin-left:16px">${i.modificadores.join(', ')}</div>` : ''}
    </div>
  `}).join('')

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

// ── Modo piloto: mute de comandas ────────────────────────────────────────
// Durante el piloto en paralelo con Wansoft, las comandas físicas las imprime
// SOLO Wansoft (evitar dobles en cocina). Este flag apaga printByStation en
// esta terminal (localStorage = por dispositivo). El KDS no se afecta — las
// órdenes siguen llegando por Supabase. Toggle protegido con PIN de gerente.

const COMANDAS_MUTED_KEY = 'pos_comandas_muted'

export function comandasMuted(): boolean {
  try { return localStorage.getItem(COMANDAS_MUTED_KEY) === '1' } catch { return false }
}

export function setComandasMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(COMANDAS_MUTED_KEY, '1')
    else localStorage.removeItem(COMANDAS_MUTED_KEY)
  } catch { /* private mode */ }
}

/**
 * Print per-station tickets: splits the order and prints a separate ticket
 * for each station that has items. Adds 200ms delay between tickets.
 */
export async function printByStation(order: Order) {
  if (comandasMuted()) {
    console.log('[printer] printByStation OMITIDO — modo piloto (comandas muteadas)')
    return
  }
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

    // 1) Bridge local: rutea por nombre de estación (cocina/barra/caja)
    if (await bridgePrint(buildStationTicketBytes(order, station, items, COLS_BRIDGE), station)) {
      printed = true
      continue
    }

    // 2) Bluetooth: station-specific printer first, then default (con reconexión)
    const char = await getCharForStation(station)
    if (char) {
      try {
        console.log(`[printer] Attempting Bluetooth print for ${station} (printer: ${getStationPrinterName(station) || getBluetoothPrinterName()})...`)
        await printStationTicketBluetooth(order, station, items)
        console.log(`[printer] Bluetooth print SUCCESS for ${station}`)
        printed = true
        continue
      } catch (e) {
        console.warn(`[printer] Bluetooth station print (${station}) FAILED, CSS fallback:`, e)
      }
    } else {
      console.log(`[printer] No BT connection for ${station}, using CSS`)
    }
    printStationTicketCSS(order, station, items)
    printed = true
  }

  if (!printed) {
    console.warn('[printer] No items to print in any station, falling back to full kitchen ticket')
    printKitchenTicketCSS(order)
  }
}
