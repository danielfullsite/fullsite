// Un PATCH sin filtro cerro los ONCE turnos de AMALAY de un solo golpe.
//
// INCIDENTE 2026-08-31. En la base quedaron once turnos con
// `closed_at = 20:07:00.918` — el MISMO milisegundo — varios de ellos ABIERTOS
// despues de esa hora, y todos con `closed_by = 'Daniel'` y sin nota.
//
// Once clics no caen en el mismo milisegundo. Fue UNA sola escritura tocando once
// filas.
//
// CAUSA RAIZ: posicion de argumentos.
//
//   queueOperation(table, method, data, endpoint?, base_version?, transport?)
//                                       4o         5o
//
//   // como estaba en CierreCajaWizard:
//   queueOperation('pos_turnos', 'PATCH', payload,
//                  undefined,                       // <- endpoint
//                  `pos_turnos?id=eq.${turnoId}`,   // <- base_version (!)
//                  'SUPABASE_REST')
//
// El filtro caia en `base_version`. Con `endpoint` undefined, el replay arma la URL
// como `item.endpoint || item.table` -> `/rest/v1/pos_turnos`, SIN filtro, y
// PostgREST aplica el PATCH a todo lo que la credencial alcance.
//
// TypeScript no podia verlo: los dos parametros son `string | undefined`.
//
// DOS DEFENSAS, porque una sola no basta:
//   1. La llamada corregida (que es el bug de verdad).
//   2. `esMutacionSinFiltro`: el replay se niega a mandar un PATCH/DELETE sin filtro,
//      venga de donde venga. Falla cerrado y conserva el payload.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { esMutacionSinFiltro } from '@/lib/pos-offline-db'

describe('La guardia reconoce la forma peligrosa', () => {
  it('PATCH y DELETE sin `?` en la ruta son mutaciones sin filtro', () => {
    expect(esMutacionSinFiltro('PATCH', 'pos_turnos')).toBe(true)
    expect(esMutacionSinFiltro('DELETE', 'pos_orders')).toBe(true)
  })

  it('con filtro, pasan', () => {
    expect(esMutacionSinFiltro('PATCH', 'pos_turnos?id=eq.abc')).toBe(false)
    expect(esMutacionSinFiltro('DELETE', 'pos_orders?id=eq.1')).toBe(false)
  })

  it('un POST nunca es sospechoso — inserta, no reescribe', () => {
    expect(esMutacionSinFiltro('POST', 'pos_turnos')).toBe(false)
    expect(esMutacionSinFiltro('POST', 'pos_cierres')).toBe(false)
  })

  it('una ruta vacia o indefinida se trata como sin filtro', () => {
    expect(esMutacionSinFiltro('PATCH', '')).toBe(true)
    expect(esMutacionSinFiltro('PATCH', undefined as unknown as string)).toBe(true)
  })
})

describe('El replay se niega a mandar la mutacion sin filtro', () => {
  const fuente = readFileSync(join(process.cwd(), 'src/lib/pos-offline-db.ts'), 'utf8')

  it('la guardia corre ANTES de construir la URL y de hacer fetch', () => {
    const iGuardia = fuente.indexOf('esMutacionSinFiltro(item.method, restPath)')
    const iFetch = fuente.indexOf('const res = await fetch(url, {', iGuardia)
    expect(iGuardia, 'la guardia debe existir en el replay').toBeGreaterThan(-1)
    expect(iFetch).toBeGreaterThan(iGuardia)
  })

  it('falla CERRADO: marca terminal y conserva el payload, no lo borra', () => {
    const i = fuente.indexOf('esMutacionSinFiltro(item.method, restPath)')
    const bloque = fuente.slice(i, i + 600)
    expect(bloque).toContain("'TERMINAL_NON_RETRYABLE'")
    expect(bloque).toContain('MUTACION_SIN_FILTRO')
    expect(bloque, 'debe saltarse el envio').toContain('continue')
  })
})

describe('Ninguna llamada del codigo encola una mutacion sin filtro', () => {
  // Este barrido es lo que impide que el error vuelva en OTRO archivo. La llamada de
  // CierreCajaWizard pasaba desapercibida justamente por verse normal.
  function archivos(dir: string, acc: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (n === '__tests__' || n === 'node_modules') continue
      if (statSync(p).isDirectory()) archivos(p, acc)
      else if (/\.tsx?$/.test(n)) acc.push(p)
    }
    return acc
  }

  /** Corta la llamada completa leyendo parentesis balanceados (soporta multilinea). */
  function llamadas(src: string): string[] {
    const out: string[] = []
    let i = src.indexOf('queueOperation(')
    while (i !== -1) {
      let j = i + 'queueOperation('.length
      let nivel = 1
      while (j < src.length && nivel > 0) {
        if (src[j] === '(') nivel++
        else if (src[j] === ')') nivel--
        j++
      }
      out.push(src.slice(i, j))
      i = src.indexOf('queueOperation(', j)
    }
    return out
  }

  /** Separa los argumentos de primer nivel (ignora comas dentro de {}, [], (), ``). */
  function argumentos(llamada: string): string[] {
    const cuerpo = llamada.slice('queueOperation('.length, -1)
    const args: string[] = []
    let act = '', nivel = 0, comilla = ''
    for (let k = 0; k < cuerpo.length; k++) {
      const c = cuerpo[k]
      if (comilla) {
        if (c === comilla && cuerpo[k - 1] !== '\\') comilla = ''
      } else if (c === "'" || c === '"' || c === '`') comilla = c
      else if ('([{'.includes(c)) nivel++
      else if (')]}'.includes(c)) nivel--
      else if (c === ',' && nivel === 0) { args.push(act.trim()); act = ''; continue }
      act += c
    }
    if (act.trim()) args.push(act.trim())
    return args
  }

  it('toda llamada con PATCH o DELETE queda filtrada, por tabla o por endpoint', () => {
    const malas: string[] = []
    for (const f of archivos(join(process.cwd(), 'src'))) {
      const src = readFileSync(f, 'utf8')
      for (const ll of llamadas(src)) {
        const a = argumentos(ll)
        const metodo = (a[1] || '').replace(/['"`]/g, '')
        if (metodo !== 'PATCH' && metodo !== 'DELETE') continue
        // El replay usa `endpoint || table`: basta con que UNO de los dos lleve filtro.
        const tabla = a[0] || ''
        const endpoint = a[3] || 'undefined'
        if (!tabla.includes('?') && !endpoint.includes('?')) {
          malas.push(`${f.replace(process.cwd() + '/', '')}: ${metodo} tabla=${tabla} endpoint=${endpoint}`)
        }
      }
    }
    expect(malas, `mutaciones sin filtro:\n${malas.join('\n')}`).toEqual([])
  })

  it('el detector SI atrapa la forma del incidente', () => {
    // Sin esta prueba, la de arriba podria estar pasando por no detectar nada.
    const conBug = "queueOperation('pos_turnos', 'PATCH', payload, undefined, `pos_turnos?id=eq.${t}`, 'SUPABASE_REST')"
    const a = argumentos(llamadas(conBug)[0])
    expect(a[1].replace(/['"`]/g, '')).toBe('PATCH')
    expect(a[0].includes('?')).toBe(false)
    expect(a[3]).toBe('undefined')   // el filtro se fue al 5o
    expect(a[4]).toContain('?')      // aqui esta, en el lugar equivocado
  })

})

describe('El cierre de caja apunta al turno correcto', () => {
  const wizard = readFileSync(join(process.cwd(), 'src/components/pos/CierreCajaWizard.tsx'), 'utf8')

  it('REGRESION: el filtro va en `endpoint` (4o), no en `base_version` (5o)', () => {
    // La forma exacta del incidente. Si alguien vuelve a correr el argumento, esto falla.
    expect(wizard).not.toMatch(/queueOperation\('pos_turnos',\s*'PATCH',\s*\w+,\s*undefined,/)
    expect(wizard).toMatch(/queueOperation\('pos_turnos',\s*'PATCH',\s*\w+,\s*`pos_turnos\?id=eq\.\$\{turnoId\}`/)
  })

  it('el POST del cierre SI puede ir sin endpoint — inserta una fila nueva', () => {
    expect(wizard).toMatch(/queueOperation\('pos_cierres',\s*'POST',\s*\w+,\s*undefined/)
  })
})
