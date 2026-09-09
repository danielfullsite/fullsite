#!/usr/bin/env node
'use strict'

// Real built POS + real Electron + real PIN verification in Pedro. No Next
// server and no browser auth/session injection. Only pre-enrolment and catalog
// acquisition use synthetic cloud authority data, before WAN is cut.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const ROOT = path.resolve(__dirname, '../..')
const { _electron } = require(path.join(ROOT, 'dashboard-app/node_modules/playwright'))
const { expect } = require(path.join(ROOT, 'dashboard-app/node_modules/@playwright/test'))
const electronBinary = require('../node_modules/electron')
const { CURRENT_CONFIG_VERSION } = require('../local-server/config-schema')
const { ActorAuthority } = require('../local-server/core/actor-authority')
const { CatalogStore } = require('../local-server/core/catalog-store')
const { verifyPackage, ORIGIN } = require('../offline-ui/package-store')
const cred = require('../local-server/core/credencial-lan')

const bundlePath = path.resolve(process.argv[2] || path.join(ROOT, 'output/closure/offline-ui-package-lab'))
const bundle = verifyPackage(bundlePath)
const output = path.join(ROOT, 'output/closure/cold-boot')
fs.mkdirSync(output, { recursive: true })
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-cold-boot-'))
const tenant = 'closure-cold-boot-lab', pin = '927461'
const staff = { id: randomUUID(), name: 'Operador arranque frío', role: 'gerente' }
const secret = cred.generarSecreto()
const active = new Set()
const logs = new Map()
const results = []

async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function check(name, run) {
  await run(); results.push({ name, passed: true }); console.log('PASS', name)
}
function cleanEnv(extra) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: base, LANG: 'en_US.UTF-8', NODE_ENV: 'development' }
  for (const key of ['DISPLAY', 'XAUTHORITY', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA']) if (process.env[key]) env[key] = process.env[key]
  return { ...env, ...extra }
}
async function launch(terminal) {
  const bootstrap = path.join(base, 'offline-bootstrap.cjs')
  fs.writeFileSync(bootstrap, `
const { app, session } = require('electron');
const originalFetch = global.fetch;
global.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return Promise.reject(new TypeError('Laboratorio sin WAN'));
  return originalFetch(input, init);
};
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    const url = new URL(details.url);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    const packageAsset = url.origin === ${JSON.stringify(ORIGIN)} && !url.pathname.startsWith('/api/');
    done({ cancel: !local && !packageAsset && !['data:', 'blob:', 'about:', 'file:'].includes(url.protocol) });
  });
});
require(${JSON.stringify(path.join(ROOT, 'electron-app/main.js'))});
`)
  const app = await _electron.launch({ executablePath: electronBinary, args: [bootstrap], timeout: 60000,
    env: cleanEnv({ FULLSITE_DEV: '1', FULLSITE_USER_DATA_DIR: terminal.directory,
      FULLSITE_LOCAL_SERVER_PORT: String(terminal.port), FULLSITE_UI_BUNDLE_DIR: bundlePath }),
  })
  active.add(app)
  const log = []
  logs.set(terminal.name, log)
  app.process().stdout.on('data', bytes => log.push(String(bytes)))
  app.process().stderr.on('data', bytes => log.push(String(bytes)))
  const page = await app.firstWindow()
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) log.push(message.text()) })
  page.on('pageerror', error => log.push('PAGEERROR ' + error.stack))
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible({ timeout: 30000 })
  return { app, page, log, ...terminal }
}
async function stop(terminal) {
  // The real executable is killed, not node_modules/.bin/electron's shim.
  const process = terminal.app.process()
  process.kill('SIGKILL')
  await new Promise(resolve => process.exitCode !== null || process.signalCode ? resolve() : process.once('exit', resolve))
  active.delete(terminal.app)
  fs.writeFileSync(path.join(output, terminal.name + '.log'), terminal.log.join('\n'))
}
async function login(terminal) {
  for (const digit of pin) await terminal.page.getByRole('button', { name: digit, exact: true }).click()
  await terminal.page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(terminal.page).toHaveURL(ORIGIN + '/pos/mesas', { timeout: 15000 })
  await expect(terminal.page.getByRole('button', { name: 'Entrar', exact: true })).toHaveCount(0)
  const session = await terminal.page.evaluate(() => JSON.parse(sessionStorage.getItem('pos_actor_session') || 'null'))
  assert.equal(session?.staff?.id, staff.id)
  assert.equal(session?.offline, true)
  assert(session?.actor_token, 'Caja signs an actual offline session after typed PIN')
}
async function main() {
  const ports = [await freePort(), await freePort()]
  const terminals = ['Caja', 'POS2'].map((name, index) => ({ name, directory: path.join(base, name), port: ports[index], terminalId: randomUUID() }))
  for (const [index, terminal] of terminals.entries()) {
    fs.mkdirSync(terminal.directory)
    fs.writeFileSync(path.join(terminal.directory, 'config.json'), JSON.stringify({
      config_version: CURRENT_CONFIG_VERSION, restaurant_id: tenant, terminal_id: terminal.terminalId,
      terminal_role: index ? 'pos' : 'server_pos', terminal_name: terminal.name,
      localAuthorityEnabled: true,
      local_server_host: '127.0.0.1', local_server_port: terminal.port, protocol_version: '1.0',
      provisioned_at: new Date().toISOString(), pos_server_ip: index ? '127.0.0.1' : null,
      pos_server_port: index ? ports[0] : null, lan_secret: secret, instance_name: terminal.name,
    }))
  }
  const authority = new ActorAuthority({ directory: path.join(terminals[0].directory, 'actor-authority'), restaurantId: tenant,
    fetchImpl: async () => Response.json({ staff }) })
  for (const terminal of terminals) await authority.login({ pin, deviceId: terminal.terminalId, restaurantId: tenant })
  const catalog = new CatalogStore({ directory: path.join(terminals[0].directory, 'catalog'), restaurantId: tenant,
    fetchImpl: async () => Response.json({ schema_version: 1, complete: true, catalog_scope: 'restaurant', restaurant_id: tenant,
      refreshed_at: new Date().toISOString(), config: { id: tenant, display_name: 'Laboratorio arranque frío', mesas: 3,
        timezone: 'America/Monterrey', iva_rate: 0.16, features: { pos: true, posRestaurant: true } }, settings: {},
      categories: [{ id: 'drinks', name: 'Bebidas', active: true, items: [{ id: 'coffee', name: 'Café frío de laboratorio', price: 50, active: true, station: 'barra' }] }],
      payment_methods: [{ id: 'cash', name: 'Efectivo', type: 'efectivo', commission_pct: 0 }],
      modifiers: { groups: [], mods: [], item_links: [], category_links: [] },
    }) })
  await catalog.refresh('synthetic-preparation-only')
  let caja, pos2
  await check('Cold boot loads packaged POS with empty Chromium profile and no Next server or WAN', async () => {
    caja = await launch(terminals[0])
    assert.equal(caja.page.url(), ORIGIN + '/pos')
    assert.equal(await caja.page.evaluate(() => localStorage.getItem('FULLSITE_UI_PACKAGE')), bundle.manifest.revision)
    assert.equal(await caja.page.evaluate(() => sessionStorage.getItem('pos_actor_session')), null)
    assert.equal(await caja.page.evaluate(() => fetch('/api/pos/pin').then(() => false, () => true)), true)
    await caja.page.screenshot({ path: path.join(output, '01-pin-sin-internet.png') })
  })
  await check('Typed PIN is verified by prepared Caja and real static RSC navigation mounts the turno gate', async () => {
    await login(caja)
    const checks = await caja.page.evaluate(async () => ({
      workers: (await navigator.serviceWorker.getRegistrations()).length,
      rsc: await fetch('/pos/mesas?_rsc=real-check', { headers: { RSC: '1' } }).then(response => ({ type: response.headers.get('content-type'), status: response.status })),
    }))
    assert.equal(checks.workers, 0)
    assert.equal(checks.rsc.status, 200)
    assert.match(checks.rsc.type, /text\/x-component/)
    await caja.page.screenshot({ path: path.join(output, '02-mesas-pin-real.png') })
  })
  await check('Secondary cold boot reads Caja catalog over LAN and verifies PIN without private browser cache', async () => {
    pos2 = await launch(terminals[1])
    await login(pos2)
    const data = await pos2.page.evaluate(async () => {
      const headers = { 'x-fullsite-lan': localStorage.getItem('FULLSITE_LAN_SECRET'),
        'x-fullsite-restaurante': localStorage.getItem('fullsite_client_id'),
        'x-fullsite-terminal': localStorage.getItem('FULLSITE_TERMINAL_ID') }
      return fetch(localStorage.getItem('FULLSITE_BRIDGE_URL') + '/catalog', { headers }).then(response => response.json())
    })
    assert.equal(data.catalog?.categories[0]?.items[0]?.name, 'Café frío de laboratorio')
  })
  await check('Killing real Electron then restarting offline retains package and demands a fresh typed PIN', async () => {
    await stop(pos2)
    pos2 = await launch(terminals[1])
    assert.equal(await pos2.page.evaluate(() => sessionStorage.getItem('pos_actor_session')), null)
    assert.equal(await pos2.page.evaluate(() => localStorage.getItem('FULLSITE_UI_PACKAGE')), bundle.manifest.revision)
    await login(pos2)
    await pos2.page.screenshot({ path: path.join(output, '03-reinicio-sin-internet.png') })
  })
  await check('All tested screens keep running without unhandled renderer errors', async () => {
    assert.deepEqual([...caja.log, ...pos2.log].filter(line => line.startsWith('PAGEERROR ')), [])
  })
  await stop(pos2); await stop(caja)
}
main().catch(error => {
  results.push({ name: 'Execution', passed: false, error: error.stack })
  console.error(error.stack); process.exitCode = 1
}).finally(async () => {
  for (const [name, log] of logs) fs.writeFileSync(path.join(output, name + '.log'), log.join('\n'))
  for (const app of active) {
    try {
      const page = await app.firstWindow()
      fs.writeFileSync(path.join(output, `failure-${Date.now()}.txt`), await page.locator('body').innerText())
      await page.screenshot({ path: path.join(output, `failure-${Date.now()}.png`) })
      app.process().kill('SIGKILL')
    } catch {}
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ revision: bundle.manifest.revision, base, results }, null, 2))
})
