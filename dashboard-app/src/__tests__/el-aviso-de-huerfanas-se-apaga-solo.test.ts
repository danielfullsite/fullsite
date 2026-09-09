import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluarAvisoDeHuerfanas } from '@/lib/pos-cierre-guard'

// UN AVISO QUE NO SE PODIA RESOLVER TRABAJANDO.
//
// Visto en la caja de AMALAY el 2026-09-08, en pantalla:
//   "Cierre anterior con 13 ordenes abiertas — Motivo: LNKBCVLKBCV
//    Verifica el mapa de mesas para localizar las ordenes huérfanas."
//
// Comprobado contra la base el mismo día:
//   ids_declarados 13 · existen_en_pos_orders 13 · siguen_abiertas 0
//
// El aviso era del Z#2 del 1 de septiembre. Llevaba SIETE DIAS y DOS cierres Z
// encima (Z#3 el día 3, Z#4 el día 5) sin apagarse, porque la consulta pedía el
// último cierre que TUVO órdenes abiertas — un hecho histórico que nunca deja de
// ser cierto — y nadie preguntaba si seguían abiertas.
//
// Lo único que lo quitaba era la "X". O sea que la única forma de resolverlo era
// ignorarlo, que es exactamente cómo se le enseña a la gente a ignorar el aviso
// que sí importa.

const TRECE = Array.from({ length: 13 }, (_, i) => `orden-${i + 1}`)

describe('el caso real de AMALAY', () => {
  it('con las 13 ya cerradas, el aviso desaparece', () => {
    const a = evaluarAvisoDeHuerfanas(TRECE, { determinado: true, abiertas: [] }, 'LNKBCVLKBCV')
    expect(a.mostrar).toBe(false)
    expect(a.siguenAbiertas).toBe(0)
  })

  it('y mientras de verdad quedaban, avisaba con el número de HOY', () => {
    const a = evaluarAvisoDeHuerfanas(TRECE, { determinado: true, abiertas: ['orden-2', 'orden-7'] }, 'LNKBCVLKBCV')
    expect(a.mostrar).toBe(true)
    expect(a.siguenAbiertas).toBe(2)
    expect(a.texto).toMatch(/Quedan 2 de 13/)
  })
})

describe('no se confunde con órdenes que no son de ese cierre', () => {
  it('una mesa abierta HOY no es huérfana de aquel cierre', () => {
    const a = evaluarAvisoDeHuerfanas(TRECE, { determinado: true, abiertas: ['mesa-de-hoy'] }, null)
    expect(a.mostrar).toBe(false)
  })

  it('y sólo cuenta la intersección', () => {
    const a = evaluarAvisoDeHuerfanas(
      TRECE, { determinado: true, abiertas: ['orden-1', 'mesa-de-hoy', 'orden-13'] }, null)
    expect(a.siguenAbiertas).toBe(2)
  })
})

describe('un fallo de red no se convierte en "ya no hay"', () => {
  it('si no se pudo comprobar, el aviso se queda — y lo dice', () => {
    // Callar aquí sería leer un fallo como un hecho. Es el error del 2026-08-31.
    const a = evaluarAvisoDeHuerfanas(TRECE, { determinado: false, motivo: 'HTTP 401' }, 'LNKBCVLKBCV')
    expect(a.mostrar).toBe(true)
    expect(a.siguenAbiertas).toBeNull()
    expect(a.texto).toMatch(/no se pudo comprobar/i)
    expect(a.texto).toMatch(/HTTP 401/)
  })

  it('y no inventa un número que no sabe', () => {
    const a = evaluarAvisoDeHuerfanas(TRECE, { determinado: false, motivo: 'sin conexion' }, null)
    expect(a.siguenAbiertas).toBeNull()
    expect(a.texto).toMatch(/13/)  // sí dice cuántas se declararon; eso sí lo sabe
  })
})

describe('casos de borde', () => {
  it('sin órdenes declaradas no hay aviso', () => {
    expect(evaluarAvisoDeHuerfanas([], { determinado: true, abiertas: [] }, null).mostrar).toBe(false)
  })

  it('ni siquiera cuando la lectura falló — no había nada que comprobar', () => {
    expect(evaluarAvisoDeHuerfanas([], { determinado: false, motivo: 'x' }, null).mostrar).toBe(false)
  })

  it('una sola orden se dice en singular', () => {
    const a = evaluarAvisoDeHuerfanas(['a'], { determinado: true, abiertas: ['a'] }, null)
    expect(a.texto).toMatch(/Queda(n)? 1 de 1 orden /)
  })

  it('el motivo se arrastra cuando existe, y no se inventa cuando no', () => {
    const con = evaluarAvisoDeHuerfanas(['a'], { determinado: true, abiertas: ['a'] }, 'se fue la luz')
    expect(con.texto).toMatch(/motivo: se fue la luz/)
    const sin = evaluarAvisoDeHuerfanas(['a'], { determinado: true, abiertas: ['a'] }, null)
    expect(sin.texto).not.toMatch(/motivo/)
  })
})

describe('la pantalla usa la política y ya no cuenta por su cuenta', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app', 'pos', 'turno', 'page.tsx'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('llama a evaluarAvisoDeHuerfanas', () => {
    expect(page).toMatch(/evaluarAvisoDeHuerfanas\(/)
  })

  it('consulta el estado actual de esas órdenes', () => {
    expect(page).toMatch(/pos_orders\?client_id=eq\.\$\{_cid\(\)\}&id=in\./)
  })

  it('ya no muestra la longitud del arreglo histórico', () => {
    expect(page).not.toMatch(/Cierre anterior con \{orphanCierre\.count\}/)
  })

  it('y marca la lectura como no determinada cuando el fetch falla', () => {
    expect(page).toMatch(/determinado: false/)
  })
})
