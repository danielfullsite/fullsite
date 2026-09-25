'use strict'
// Protector del sistema operativo para lo que la Caja guarda en disco (bloque POS, 2026-09-24).
//
// Por qué existe: la autoridad de PIN de la Caja (actor-authority.js) guardaba sus
// verificadores en JSON plano y la llave HMAC que los indexa en un archivo de texto al lado.
// Con los dos archivos en la mano, 10^4 HMACs bastan para encontrar el PIN de cada persona
// preparada — sin tocar la aplicación. Sellar con el SO (DPAPI en Windows, Keychain en macOS)
// hace que esos archivos, copiados a otra máquina o leídos por otro usuario del SO, no sirvan.
//
// LO QUE NO COMPRA, con honestidad: un proceso que corre como EL MISMO usuario del SO en la
// MISMA máquina puede pedirle al SO que abra el sello (así funciona DPAPI de usuario). La
// defensa contra eso es no dar a nadie sesión de Windows en la Caja, no este módulo.
//
// Interfaz: { available, nombre, seal(texto) -> Buffer, unseal(Buffer) -> texto }.
// `available: false` significa: no hay protección real y la Caja NO guarda credenciales
// offline (falla cerrado). Un protector nunca "degrada" a texto plano.
const crypto = require('node:crypto')

const PROTECTOR_NO_DISPONIBLE = Object.freeze({
  available: false,
  nombre: 'ninguno',
  seal() { throw new Error('Sin protector del sistema operativo') },
  unseal() { throw new Error('Sin protector del sistema operativo') },
})

/**
 * Protector real, con `safeStorage` de Electron. Sólo se usa desde el proceso principal y
 * después de `app.whenReady()`.
 *
 * En Linux sin llavero, Electron cae al backend `basic_text` y aun así dice que puede
 * cifrar: eso es texto plano con otro nombre, así que cuenta como NO disponible.
 */
function protectorDeElectron(safeStorage) {
  let disponible = false
  try {
    disponible = !!safeStorage && safeStorage.isEncryptionAvailable() === true
    if (disponible && typeof safeStorage.getSelectedStorageBackend === 'function') {
      const backend = safeStorage.getSelectedStorageBackend()
      if (backend === 'basic_text' || backend === 'unknown') disponible = false
    }
  } catch { disponible = false }
  if (!disponible) return PROTECTOR_NO_DISPONIBLE
  return Object.freeze({
    available: true,
    nombre: 'electron-safeStorage',
    seal: texto => safeStorage.encryptString(String(texto)),
    unseal: buffer => safeStorage.decryptString(Buffer.from(buffer)),
  })
}

/**
 * Protector de LABORATORIO: AES-256-GCM con una llave derivada de un secreto de prueba.
 * NO es protección del SO. Existe para que las pruebas `node --test` y los laboratorios
 * (que preparan credenciales desde Node y luego las lee Pedro dentro de Electron) puedan
 * ejercitar el almacén sellado. main.js sólo lo acepta con la app SIN empaquetar y la
 * variable explícita (ver `protectorParaLaCaja`).
 */
function protectorDePrueba(secreto = 'protector-de-prueba-no-es-proteccion') {
  const llave = crypto.createHash('sha256').update('fullsite-protector-prueba:' + secreto).digest()
  return Object.freeze({
    available: true,
    nombre: 'prueba',
    seal(texto) {
      const iv = crypto.randomBytes(12)
      const c = crypto.createCipheriv('aes-256-gcm', llave, iv)
      const cuerpo = Buffer.concat([c.update(String(texto), 'utf8'), c.final()])
      return Buffer.concat([Buffer.from('FSP1'), iv, c.getAuthTag(), cuerpo])
    },
    unseal(buffer) {
      const b = Buffer.from(buffer)
      if (b.length < 32 || b.subarray(0, 4).toString() !== 'FSP1') throw new Error('Sello inválido')
      const d = crypto.createDecipheriv('aes-256-gcm', llave, b.subarray(4, 16))
      d.setAuthTag(b.subarray(16, 32))
      return Buffer.concat([d.update(b.subarray(32)), d.final()]).toString('utf8')
    },
  })
}

/**
 * Qué protector recibe la Caja. En producción, SIEMPRE `safeStorage`. El de laboratorio
 * sólo con `empaquetada === false` y FULLSITE_LAB_PROTECTOR=prueba — una instalación de
 * restaurante (app empaquetada) no puede caer en él aunque alguien ponga la variable.
 */
function protectorParaLaCaja({ safeStorage, empaquetada, env = process.env }) {
  if (empaquetada === false && env.FULLSITE_LAB_PROTECTOR === 'prueba') {
    return protectorDePrueba(env.FULLSITE_LAB_PROTECTOR_SECRETO || undefined)
  }
  return protectorDeElectron(safeStorage)
}

module.exports = { PROTECTOR_NO_DISPONIBLE, protectorDeElectron, protectorDePrueba, protectorParaLaCaja }
