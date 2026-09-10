import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
const { JSDOM } = require('jsdom')
const html = readFileSync(resolve(process.cwd(), '../electron-app/setup.html'), 'utf8')
const printer = (id: string, enabled = true) => ({ printer_id: id, name: id, enabled, station_ids: ['caja'],
  document_types: ['receipt'], copies: 3, connection: { type: 'tcp', host: '127.0.0.1', port: 9100 } })
async function setup(config: Record<string, unknown>) {
  const save = vi.fn(async () => ({ ok: true }))
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost', beforeParse(window: any) {
    window.setupBridge = { getInfo: async () => ({ hostname: 'fixture' }), loadPrinters: async () => ({ state: 'configured', config }), savePrinters: save }
    window.confirm = () => true
  } })
  dom.window.goTo = vi.fn()
  await dom.window.setupStep5()
  return { dom, save, select: dom.window.document.getElementById('pfDrawerPrinter') as HTMLSelectElement }
}
it('setup preserves an explicit drawer and never selects a printer automatically', async () => {
  const first = await setup({ printers: [printer('one'), printer('two'), printer('disabled', false)] })
  try {
    expect(first.select.value).toBe('')
    expect([...first.select.options].map(o => o.value)).toEqual(['', 'one', 'two'])
    first.select.value = 'two'; first.select.dispatchEvent(new first.dom.window.Event('change', { bubbles: true }))
    await first.dom.window.pfProceed()
    expect(first.save).toHaveBeenCalledWith(expect.objectContaining({ drawer_printer_id: 'two' }))
  } finally { first.dom.window.close() }
  const restored = await setup({ printers: [printer('one'), printer('two')], drawer_printer_id: 'two' })
  try {
    expect(restored.select.value).toBe('two')
    await restored.dom.window.pfProceed()
    expect(restored.save).toHaveBeenCalledWith(expect.objectContaining({ drawer_printer_id: 'two' }))
  } finally { restored.dom.window.close() }
})
it('deleting the assigned printer retains an invalid assignment for review until explicitly cleared, then saves empty configuration', async () => {
  const s = await setup({ printers: [printer('one')], drawer_printer_id: 'one' })
  try {
    s.dom.window.pfDelete(0)
    expect(s.select.value).toBe('one')
    expect(s.select.selectedOptions[0].textContent).toContain('Revisa')
    s.select.value = ''; s.select.dispatchEvent(new s.dom.window.Event('change', { bubbles: true }))
    await s.dom.window.pfProceed()
    expect(s.save).toHaveBeenCalledWith({ schema_version: 2, printers: [], routing: {} })
  } finally { s.dom.window.close() }
})
