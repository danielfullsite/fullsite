#!/usr/bin/env node
'use strict'
// Sella las credenciales de Supabase dentro del instalador.
//
// POR QUÉ
// -------
// Una terminal instalada por .exe no tiene variables de entorno, y la receta de
// clonado no escribe `supabaseUrl`/`supabaseAnonKey` en su config.json. Medido
// contra AMALAY el 2026-09-14, eso costaba DOS cosas al mismo tiempo:
//
//   1. `local_server_heartbeats` con cero filas desde que existe: la flota no
//      reporta y no hay diagnóstico remoto — hay que ir físicamente.
//   2. La terminal NO se auto-actualiza. Antes de instalar, `main.js` consulta
//      el freno de versiones, y ese `estaBloqueada` lanza sin credencial. El
//      auto-instalador falla CERRADO a propósito, así que no instala nunca.
//
// NO agrega exposición: es la MISMA anon key que ya viaja dentro del instalador,
// dentro del `ui-bundle`, porque la web la publica como
// NEXT_PUBLIC_SUPABASE_ANON_KEY. Lo único que cambia es que ahora el proceso
// principal también la puede leer.
//
// El archivo generado está en .gitignore. La llave no entra al repo.
//
//   node electron-app/scripts/sellar-credenciales.cjs
//
// Falla con código 1 si no hay credenciales en el entorno: un instalador sin
// sellar es un instalador que nace mudo y sin poder actualizarse, y eso tiene
// que romper el build, no descubrirse tres meses después en una caja.

const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

const DESTINO = join(__dirname, '..', 'credenciales-selladas.json')

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const permitirSinSellar = process.argv.includes('--permitir-sin-sellar')

if (!url || !key) {
  const faltan = [!url && 'SUPABASE_URL', !key && 'SUPABASE_ANON_KEY'].filter(Boolean).join(' y ')
  if (permitirSinSellar) {
    console.warn(`[sellar] Sin ${faltan}: se empaqueta SIN sellar (build local).`)
    console.warn('[sellar] Esa terminal no reportará telemetría ni se auto-actualizará.')
    process.exit(0)
  }
  console.error(`[sellar] FALTA ${faltan} en el entorno del build.`)
  console.error('[sellar] Un instalador sin sellar nace mudo y sin poder actualizarse.')
  console.error('[sellar] Para un build local a propósito: --permitir-sin-sellar')
  process.exit(1)
}

writeFileSync(DESTINO, JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }, null, 2) + '\n', 'utf8')

// Nunca se imprime la llave; sólo la prueba de que quedó escrita.
console.log(`[sellar] Credenciales selladas en ${DESTINO}`)
console.log(`[sellar] url: ${url.replace(/\/\/([^.]+)\./, '//***.')}  ·  key: ${key.length} caracteres`)
