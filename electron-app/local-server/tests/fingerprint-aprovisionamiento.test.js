'use strict'
/**
 * APROVISIONAMIENTO DEL SECRETO DE HUELLA (Path A, D-5).
 *
 * El secreto es un contrato entre DOS procesos: Electron lo crea en
 * `<userData>/fingerprint/fingerprint-ipc-secret` y el servicio en C# lo lee de
 * ahí. Si los dos no coinciden, la huella muere con «FATAL: falta el
 * fingerprint-ipc-secret» y el operador sólo ve «lector no disponible».
 *
 * Estas pruebas fijan el comportamiento que hace que eso NO pase:
 * determinista, idempotente, que sobrevive al reinicio, que falla cerrado y que
 * nunca escribe el valor en un log.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  prepareFingerprintIpcSecret,
  resolveFingerprintIpcDirectory,
  FILE_NAME,
} = require('../core/fingerprint-ipc-secret')

function userDataTemporal(t) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'fullsite-prov-'))
  t.after(() => fs.rmSync(raiz, { recursive: true, force: true }))
  return raiz
}

test('la primera instalación crea UN secreto usable', async t => {
  const userData = userDataTemporal(t)
  const directorio = resolveFingerprintIpcDirectory({ userDataDirectory: userData })

  const secreto = prepareFingerprintIpcSecret({ directory: directorio })
  assert.match(secreto, /^[a-f0-9]{64}$/, 'el secreto debe ser 64 hex: es lo que valida el .cs')

  const archivo = path.join(directorio, FILE_NAME)
  assert.ok(fs.existsSync(archivo), 'debe quedar en disco para que el servicio lo lea')
  assert.equal(fs.readFileSync(archivo, 'utf8').trim(), secreto)
})

test('la ruta es la MISMA que el servicio en C# busca', async t => {
  // El .cs hace Path.Combine(userData, "fingerprint\\fingerprint-ipc-secret").
  // Si esta ruta cambiara, los dos procesos dejarían de encontrarse y el síntoma
  // sería «lector no disponible», que no apunta a nada.
  const directorio = resolveFingerprintIpcDirectory({ userDataDirectory: 'C:\\Users\\Cliente\\AppData\\Roaming\\fullsite-pos' })
  assert.equal(directorio, path.join('C:\\Users\\Cliente\\AppData\\Roaming\\fullsite-pos', 'fingerprint'))
  assert.equal(FILE_NAME, 'fingerprint-ipc-secret')
})

test('es idempotente: llamarlo mil veces no cambia el secreto', async t => {
  const userData = userDataTemporal(t)
  const directorio = resolveFingerprintIpcDirectory({ userDataDirectory: userData })

  const primero = prepareFingerprintIpcSecret({ directory: directorio })
  for (let i = 0; i < 25; i++) {
    assert.equal(prepareFingerprintIpcSecret({ directory: directorio }), primero)
  }
})

test('reinstalar NO rota el secreto en silencio', async t => {
  const userData = userDataTemporal(t)
  const directorio = resolveFingerprintIpcDirectory({ userDataDirectory: userData })
  const original = prepareFingerprintIpcSecret({ directory: directorio })

  // Una reinstalación vuelve a pasar por aquí. Si rotara, el servicio instalado
  // —que conserva el suyo— dejaría de hablar con Pedro y la huella moriría en
  // una caja que funcionaba.
  assert.equal(prepareFingerprintIpcSecret({ directory: directorio }), original)

  // La rotación existe, pero es EXPLÍCITA: borrar el archivo. No hay camino
  // accidental hacia ella.
  fs.rmSync(path.join(directorio, FILE_NAME))
  const nuevo = prepareFingerprintIpcSecret({ directory: directorio })
  assert.notEqual(nuevo, original, 'borrar el archivo sí debe producir uno nuevo')
  assert.match(nuevo, /^[a-f0-9]{64}$/)
})

test('un secreto malformado falla cerrado y pide reparación, no lo arregla solo', async t => {
  const userData = userDataTemporal(t)
  const directorio = resolveFingerprintIpcDirectory({ userDataDirectory: userData })
  fs.mkdirSync(directorio, { recursive: true })

  for (const basura of ['', '   ', 'no-soy-hex', 'ABCDEF', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64)]) {
    fs.writeFileSync(path.join(directorio, FILE_NAME), basura)
    assert.throws(
      () => prepareFingerprintIpcSecret({ directory: directorio }),
      /inválido/i,
      `«${basura.slice(0, 12)}…» debió rechazarse en vez de usarse`,
    )
  }
  // Y NO lo reemplaza por su cuenta: un secreto que aparece solo rompería al
  // servicio ya instalado sin avisar. El archivo sigue como estaba.
  assert.equal(fs.readFileSync(path.join(directorio, FILE_NAME), 'utf8'), 'A'.repeat(64))
})

test('un directorio inválido falla cerrado', async t => {
  for (const malo of ['', null, undefined, 42]) {
    assert.throws(() => prepareFingerprintIpcSecret({ directory: malo }), /inválido/i)
  }
  assert.throws(() => resolveFingerprintIpcDirectory({ userDataDirectory: '' }), /inválido/i)
})

test('el valor del secreto NUNCA aparece en la salida del proceso', async t => {
  const userData = userDataTemporal(t)
  const directorio = resolveFingerprintIpcDirectory({ userDataDirectory: userData })

  const escrito = []
  const logOriginal = console.log, warnOriginal = console.warn, errorOriginal = console.error
  console.log = console.warn = console.error = (...a) => escrito.push(a.map(String).join(' '))
  let secreto
  try { secreto = prepareFingerprintIpcSecret({ directory: directorio }) }
  finally { console.log = logOriginal; console.warn = warnOriginal; console.error = errorOriginal }

  const salida = escrito.join('\n')
  assert.ok(!salida.includes(secreto), 'el secreto no puede aparecer en la salida')
  // Ni siquiera un trozo suficiente para reconstruirlo.
  assert.ok(!salida.includes(secreto.slice(0, 16)), 'ni un prefijo del secreto')
})

test('el archivo del secreto no queda legible para todo el mundo', async t => {
  if (process.platform === 'win32') return    // en Windows la protección es por ACL, no por modo POSIX
  const userData = userDataTemporal(t)
  const directorio = resolveFingerprintIpcDirectory({ userDataDirectory: userData })
  prepareFingerprintIpcSecret({ directory: directorio })

  const modo = fs.statSync(path.join(directorio, FILE_NAME)).mode & 0o777
  assert.equal(modo, 0o600, 'sólo el dueño debe poder leerlo')
})
