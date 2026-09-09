'use strict'
// El instalador tiene que llevar la huella. Es indispensable, no opcional.
//
// QUÉ PASÓ
//
// Comparando el candidato de instalación contra lo que hoy corre en AMALAY (la línea
// 1.3.12, rama integracion/electron-1.3.12) apareció esto, medido el 2026-09-08:
//
//   línea instalada   electron-builder-pos.json y package.json traen `extraResources`
//                     copiando electron-app/fingerprint/ al paquete, y main.js instala
//                     esos binarios a C:\fullsite\ la primera vez que arranca
//   candidato         NINGUNA de las dos cosas
//
// El efecto es traicionero: en la caja de AMALAY los binarios YA están en C:\fullsite\
// de la instalación anterior, así que la huella seguiría funcionando ahí y la regresión
// pasaría desapercibida. Se rompe en la SIGUIENTE caja — o sea, en el primer cliente
// nuevo. Es una regresión de clonabilidad disfrazada de nada.
//
// Los binarios son propietarios (SDK DigitalPersona U.are.U) y no se commitean. Lo que sí
// se puede sostener con una prueba es que la RUTA exista: que el empaquetado los lleve si
// están, y que el arranque los instale si el paquete los trae.
//
// Run: node --test electron-app/local-server/tests/instalador-lleva-la-huella.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const EA = path.join(__dirname, '..', '..')
const leerJson = (rel) => JSON.parse(fs.readFileSync(path.join(EA, rel), 'utf8'))
const leer = (rel) => fs.readFileSync(path.join(EA, rel), 'utf8')

/** El bloque de extraResources, esté donde esté según el archivo. */
function extraResources(config) {
  const lista = config.extraResources || (config.build && config.build.extraResources)
  return Array.isArray(lista) ? lista : []
}

function copiaLaHuella(config, dondeDice) {
  const regla = extraResources(config).find(r => r && r.from === 'fingerprint')
  assert.ok(regla, `${dondeDice}: falta la regla extraResources que copia fingerprint/ al paquete`)
  assert.equal(regla.to, 'fingerprint', `${dondeDice}: el destino tiene que llamarse fingerprint`)
  const filtro = (regla.filter || []).join(' ')
  assert.match(filtro, /\.exe/, `${dondeDice}: el filtro debe incluir el .exe del servicio`)
  assert.match(filtro, /\.dll/, `${dondeDice}: el filtro debe incluir el DLL del SDK`)
}

describe('El empaquetado lleva el servicio de huella', () => {
  test('electron-builder-pos.json lo copia', () => {
    copiaLaHuella(leerJson('electron-builder-pos.json'), 'electron-builder-pos.json')
  })

  test('package.json lo copia también', () => {
    // Los dos configs se usan según cómo se dispare el build. Si sólo uno lo trae, el
    // instalador sale sin huella la mitad de las veces y nadie sabe cuál mitad.
    copiaLaHuella(leerJson('package.json'), 'package.json')
  })

  test('la carpeta donde se dejan los binarios existe en el repo', () => {
    const dir = path.join(EA, 'fingerprint')
    assert.ok(fs.existsSync(dir), 'falta electron-app/fingerprint/ — el build no tendría de dónde copiar')
    assert.ok(
      fs.existsSync(path.join(dir, 'README.md')),
      'falta el README que dice qué binarios van ahí y cómo se obtienen',
    )
  })

  test('los binarios propietarios NO están commiteados', () => {
    // Si algún día aparecen aquí, es una licencia de terceros dentro del repo.
    const dentro = fs.readdirSync(path.join(EA, 'fingerprint'))
    const binarios = dentro.filter(f => /\.(exe|dll)$/i.test(f))
    assert.deepEqual(binarios, [], `no se commitean binarios propietarios: ${binarios.join(', ')}`)
  })
})

describe('El arranque instala el servicio desde el paquete', () => {
  const main = leer('main.js')
  const cuerpo = (() => {
    const i = main.indexOf('function startFingerprintService()')
    assert.ok(i > -1, 'no existe startFingerprintService en main.js')
    return main.slice(i, i + 2200)
  })()

  test('busca los binarios dentro del paquete, no sólo en C:\\fullsite', () => {
    assert.match(cuerpo, /resourcesPath/, 'no lee del paquete: la huella no sería clonable')
    assert.match(cuerpo, /fingerprint-service\.exe/)
    assert.match(cuerpo, /DPUruNet\.dll/)
  })

  test('los copia a C:\\fullsite la primera vez', () => {
    assert.match(cuerpo, /copyFileSync/, 'encuentra los binarios pero no los instala')
    assert.match(cuerpo, /mkdirSync/, 'no crea C:\\fullsite si no existe')
  })

  test('copia sólo lo que falta, sin pisar lo que ya está en la caja', () => {
    // En AMALAY ya hay binarios en C:\fullsite\ de la instalación anterior. Pisarlos con
    // los del paquete podría bajar una versión que ahí sí funciona.
    assert.match(cuerpo, /if \(!fs\.existsSync\(fpExe\)\) fs\.copyFileSync/)
    assert.match(cuerpo, /if \(!fs\.existsSync\(fpDll\)\) fs\.copyFileSync/)
  })

  test('si el paquete no trae los binarios, no revienta el arranque', () => {
    // Un build hecho sin el SDK a la mano es normal en desarrollo. No puede tumbar el POS.
    assert.match(cuerpo, /try\s*\{[\s\S]*?catch/, 'la auto-instalación tiene que ir en try/catch')
  })
})
