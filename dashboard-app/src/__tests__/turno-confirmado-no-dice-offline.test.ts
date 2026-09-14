// UN TURNO QUE LA CAJA CONFIRMÓ NO PUEDE ANUNCIARSE COMO «SOLO LOCAL».
//
// Campo, AMALAY, 2026-09-13 (palabras de Daniel): «le pico a abrir turno, le
// pongo cero pesos al turno, le pico a abrir turno y dice turno local sin
// conexión».
//
// En modo Caja, `openTurno` manda el comando `TURN_OPEN`, exige el recibo y
// lanza si la Caja no confirmó. Para llegar a la línea siguiente, la autoridad
// que gobierna el turno YA lo escribió en su bitácora durable. Aun así el
// registro salía con `sincronizado: false`, que `pos-data.ts` define como «quedó
// SOLO local (offline o POST fallido) y está encolado».
//
// Ese `false` hacía tres daños, no uno:
//   · el aviso «Turno abierto LOCAL (sin conexión)» sobre un turno que sí abrió
//     (`app/pos/turno/page.tsx:551`),
//   · un registro de auditoría afirmando `sincronizado: false` de algo
//     confirmado (`page.tsx:543`),
//   · y una copia durable sin `synced_at` (`page.tsx:528`), que es la que
//     después puede resucitar un turno ya cerrado.
//
// Esta prueba lee el fuente porque la afirmación es sobre el fuente: que la rama
// de Caja no vuelva a etiquetar como no-sincronizado lo que la Caja confirmó.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const fuente = readFileSync(new URL('../lib/pos-data.ts', import.meta.url), 'utf8')

describe('modo Caja: el turno confirmado se anuncia como confirmado', () => {
  it('REGRESION: el recibo de TURN_OPEN produce `sincronizado: true`', () => {
    const i = fuente.indexOf("const receipt = await ejecutarComandoCaja('turn:open', 'TURN_OPEN'")
    expect(i, 'debe existir la rama de Caja de openTurno').toBeGreaterThan(-1)
    const rama = fuente.slice(i, i + 2000)

    // La guarda que hace verdadera la afirmación: sin recibo válido, se lanza.
    expect(rama).toMatch(/throw new Error\('Caja no confirmó la apertura de turno\.'\)/)

    // Y el registro que sale de ahí no puede decir que quedó sólo local.
    const confirmado = rama.slice(rama.indexOf('const confirmed = '))
    const linea = confirmado.slice(0, confirmado.indexOf('\n'))
    expect(linea, `el turno confirmado por Caja no puede ir como no sincronizado:\n${linea}`)
      .not.toMatch(/sincronizado:\s*false/)
    expect(linea).toMatch(/sincronizado:\s*true/)
  })

  it('la definición de `sincronizado` sigue siendo la misma, para que el cambio signifique algo', () => {
    expect(fuente).toMatch(/`sincronizado: false` = el turno quedó SOLO local/)
  })
})
