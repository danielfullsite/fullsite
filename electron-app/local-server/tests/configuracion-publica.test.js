'use strict'
// La pareja URL + llave anon que se inlinea en el paquete offline.
//
// 2026-09-10: la variable de CI traia la llave anon de STAGING con la URL de PROD y
// cuatro builds salieron en verde. Un paquete asi responde 401 a toda consulta
// directa y no se puede reparar despues de instalar. Estas pruebas anclan la guarda.
// Run: node --test electron-app/local-server/tests/configuracion-publica.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { verificarParejaSupabase, refDeLaUrl, claimsDeLaLlave } = require('../../scripts/configuracion-publica.cjs')

// Llaves SINTETICAS: mismo formato que las de Supabase (JWT HS256 con ref y role),
// firma inventada. Ningun valor de aqui abre nada.
const jwt = claims => {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.firma-sintetica`
}
const REF_A = 'aaaaaaaaaaaaaaaaaaaa'
const REF_B = 'bbbbbbbbbbbbbbbbbbbb'
const URL_A = `https://${REF_A}.supabase.co`
const anonDe = (ref, extra = {}) => jwt({ iss: 'supabase', ref, role: 'anon', iat: 1700000000, exp: 4102444800, ...extra })

describe('URL y llave del mismo proyecto', () => {
  test('la pareja correcta pasa y devuelve el ref', () => {
    assert.equal(verificarParejaSupabase({ url: URL_A, anonKey: anonDe(REF_A) }), REF_A)
  })

  test('REGRESION: llave de otro proyecto (staging con URL de prod) revienta y nombra los dos refs', () => {
    assert.throws(() => verificarParejaSupabase({ url: URL_A, anonKey: anonDe(REF_B) }),
      e => e.message.includes(REF_A) && e.message.includes(REF_B) && e.message.includes('gh variable set'))
  })

  test('el mensaje nunca imprime la llave', () => {
    const llave = anonDe(REF_B)
    try { verificarParejaSupabase({ url: URL_A, anonKey: llave }); assert.fail('debio lanzar') }
    catch (e) { assert.ok(!e.message.includes(llave) && !e.message.includes('firma-sintetica')) }
  })
})

describe('Solo la llave anon puede viajar en el paquete', () => {
  test('una service_role del proyecto correcto se rechaza: viajaria a cada terminal', () => {
    assert.throws(() => verificarParejaSupabase({ url: URL_A, anonKey: anonDe(REF_A, { role: 'service_role' }) }),
      /service_role/)
  })

  test('una llave publishable (sb_...) se rechaza: el POS la manda como Bearer JWT', () => {
    assert.throws(() => verificarParejaSupabase({ url: URL_A, anonKey: 'sb_publishable_xxxxxxxxxxxxxxxx' }), /publishable/)
  })

  test('una llave vencida se rechaza', () => {
    assert.throws(() => verificarParejaSupabase({ url: URL_A, anonKey: anonDe(REF_A, { exp: 1600000000 }) }), /vencida/)
  })
})

describe('Entradas rotas fallan cerradas, con el motivo', () => {
  test('llave que no es JWT', () => {
    assert.throws(() => claimsDeLaLlave('ci-placeholder-anon-key'), /no es un JWT/)
  })
  test('llave vacia', () => {
    assert.throws(() => claimsDeLaLlave(''), /vacia/)
  })
  test('URL que no es de Supabase', () => {
    assert.throws(() => refDeLaUrl('https://ci-placeholder.supabase.co'), /host de Supabase/)
    assert.throws(() => refDeLaUrl('https://app.fullsite.mx'), /host de Supabase/)
  })
  test('URL ilegible', () => {
    assert.throws(() => refDeLaUrl('no-es-url'), /no es una URL/)
  })
  test('JWT sin ref', () => {
    assert.throws(() => verificarParejaSupabase({ url: URL_A, anonKey: jwt({ role: 'anon' }) }), /ref del proyecto/)
  })
})

describe('El build la exige', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  test('REGRESION: build-offline-ui.cjs llama a verificarParejaSupabase salvo con FULLSITE_UI_BUNDLE_SINTETICO=1', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../scripts/build-offline-ui.cjs'), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
    assert.match(src, /verificarParejaSupabase\(/)
    assert.match(src, /FULLSITE_UI_BUNDLE_SINTETICO === '1'/)
  })
})
