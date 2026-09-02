'use strict'
// El auto-update consultaba un repositorio que no es este proyecto.
//
// HALLADO el 2026-09-01. `update/manager.js` tenia:
//
//   const GITHUB_REPO = 'ramonfaurdaniel-png/fullsite'
//
// El repo real es `danielfullsite/fullsite` (verificado con
// `git remote get-url origin`). O sea que la mitad que YA estaba construida
// —detectar que hay version nueva— nunca pudo funcionar: preguntaba en el lugar
// equivocado, y fallaba en silencio porque el error se traga en un catch.
//
// POR QUE IMPORTA MAS DE LO QUE PARECE
//
// El auto-update es la llave de la escala. Hoy cada cambio del servidor local
// cuesta UNA VISITA POR RESTAURANTE, porque no viaja por Vercel. Con auto-update
// funcionando, cuesta un deploy. Un nombre de repo mal escrito bloqueaba eso.
//
// Estas pruebas no arrancan el servidor: leen la fuente. El manager hace peticiones
// HTTPS reales al construirse, y una prueba no debe salir a la red.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const FUENTE = fs.readFileSync(path.join(__dirname, '..', 'update', 'manager.js'), 'utf8')
// Se escanea CODIGO, no comentarios: el comentario que explica el bug cita el nombre
// viejo, y sin esto la prueba se acusaria a si misma.
const CODIGO = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('REGRESION: el updater consulta el repositorio REAL', () => {
  assert.match(CODIGO, /GITHUB_REPO\s*=\s*'danielfullsite\/fullsite'/,
    'GITHUB_REPO debe apuntar a danielfullsite/fullsite')
})

test('REGRESION: no vuelve a aparecer el repositorio equivocado', () => {
  assert.ok(!/ramonfaurdaniel-png/.test(CODIGO),
    'ramonfaurdaniel-png no es este proyecto: el updater nunca encontraria una version')
})

test('la URL de releases se arma con esa constante, no con un literal suelto', () => {
  // Si alguien escribe el repo a mano en la ruta, corregir la constante no serviria.
  assert.match(CODIGO, /\$\{GITHUB_REPO\}\/releases/,
    'la ruta de releases debe usar GITHUB_REPO')
})

test('sigue respetando las versiones bloqueadas desde Supabase', () => {
  // Es el freno de emergencia: si una version sale mala, se bloquea desde la nube
  // sin ir a cada restaurante. No se puede perder al cablear la Fase 2.
  assert.ok(/_isVersionBlocked/.test(CODIGO), 'debe existir la comprobacion de version bloqueada')
  assert.ok(CODIGO.indexOf('_isVersionBlocked') < CODIGO.indexOf('releases'),
    'la version bloqueada se comprueba ANTES de mirar releases')
})

test('los intervalos de consulta son sensatos para un restaurante', () => {
  // Consultar demasiado seguido gasta datos y ruido; demasiado espaciado retrasa un
  // parche urgente. Una hora es el equilibrio elegido.
  assert.match(CODIGO, /CHECK_INTERVAL\s*=\s*60 \* 60 \* 1000/)
})
