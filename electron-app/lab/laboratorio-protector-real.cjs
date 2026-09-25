'use strict'
// Laboratorio: la autoridad offline de la Caja con el protector REAL del sistema operativo
// (safeStorage de Electron → Keychain en macOS, DPAPI en Windows). Bloque POS, 2026-09-24.
//
// Lo que las pruebas `node --test` no pueden mostrar: que dentro de Electron el almacén se
// sella con el SO de verdad y que Pedro lo vuelve a abrir tras reiniciar sin red.
//
// Uso:  node electron-app/lab/laboratorio-protector-real.cjs
// Sin red real: la nube es un fetch falso. PIN y personas sintéticos. Nada fuera de un tmpdir.
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const electron = require(path.join(__dirname, '..', 'node_modules', 'electron'))
  const r = spawnSync(electron, [__filename], { stdio: 'inherit', timeout: 120000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } })
  process.exit(r.status === null ? 2 : r.status)
}

const { app, safeStorage } = require('electron')
const { ActorAuthority } = require('../local-server/core/actor-authority')
const { protectorDeElectron } = require('../local-server/core/protector-so')

app.whenReady().then(async () => {
  const resultado = { ok: false, pasos: [] }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-protector-real-'))
  const paso = (nombre, ok, detalle = '') => { resultado.pasos.push({ nombre, ok, detalle }); if (!ok) throw new Error(nombre) }
  try {
    const protector = protectorDeElectron(safeStorage)
    paso('safeStorage disponible y no basic_text', protector.available === true,
      typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : process.platform)
    let red = true
    const nube = async url => {
      if (!red) throw new TypeError('sin red')
      if (url.endsWith('/api/pos/pin')) return Response.json({ staff: { id: 'g-lab', name: 'Gerente lab', role: 'gerente' }, shiftToken: 'sesion-lab' })
      if (url.endsWith('/api/pos/staff-roster')) return Response.json({ client_id: 'lab-real', staff: [{ id: 'g-lab', role: 'gerente' }] })
      return new Response('{}', { status: 404 })
    }
    const crear = () => new ActorAuthority({ directory: dir, restaurantId: 'lab-real', fetchImpl: nube, protector, terminalId: 'POS-LAB' })
    const a = crear()
    const online = await a.login({ pin: '4102', deviceId: 'POS-LAB', restaurantId: 'lab-real' })
    await a.idle()
    paso('entrada con red', online.offline === false)
    const archivos = fs.readdirSync(dir).sort()
    paso('sólo archivos sellados en disco', JSON.stringify(archivos) === JSON.stringify(['actor-credentials.sealed', 'actor-signing-key.sealed']), archivos.join(','))
    const crudo = Buffer.concat(archivos.map(f => fs.readFileSync(path.join(dir, f))))
    paso('ni PIN, ni id, ni llave hex a la vista', !crudo.includes('4102') && !crudo.includes('g-lab') && !/[a-f0-9]{64}/.test(crudo.toString('latin1')))
    red = false
    const offline = await crear().login({ pin: '4102', deviceId: 'POS-LAB', restaurantId: 'lab-real' })
    paso('reinicio sin red: entra con el almacén sellado por el SO', offline.offline === true && offline.staff.id === 'g-lab')
    let rechazado = false
    try { await crear().login({ pin: '0000', deviceId: 'POS-LAB', restaurantId: 'lab-real' }) } catch (e) { rechazado = e.code === 'OFFLINE_USER_NOT_PREPARED' }
    paso('PIN equivocado sin red se rechaza', rechazado)
    resultado.ok = true
  } catch (e) {
    resultado.error = e.message
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
    console.log('RESULTADO ' + JSON.stringify(resultado))
    app.exit(resultado.ok ? 0 : 1)
  }
})
