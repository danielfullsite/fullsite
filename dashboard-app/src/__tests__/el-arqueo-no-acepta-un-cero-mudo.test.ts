import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluarArqueo, leerContado, UMBRAL_EXPLICACION_MXN } from '@/lib/pos-cierre-guard'

// EL CORTE DE CAJA NO DETECTABA NADA.
//
// Leído el 2026-09-08 de `pos_cierres` en la base de AMALAY, los OCHO cierres que
// existen desde julio, sin excepción:
//
//   folio_z  fecha        total_ventas  total_contado  diferencia   notas
//        4   2026-09-05           0.00           0.00       -1.00   (ninguna)
//        3   2026-09-03       5,957.76           0.00   -5,957.76   (ninguna)
//        2   2026-09-01           0.00           0.00        0.00   "LNKBCVLKBCV"
//        1   2026-08-31           0.00           0.00        0.00   (ninguna)
//
// El Z#3 declaró un faltante de CASI SEIS MIL PESOS y se guardó sin una palabra.
// No fue descuido del cajero: el wizard aceptaba el campo vacío como 0
// (`Number(cashInput) || 0`) y rotulaba la nota como "(opcional)" en la misma
// pantalla donde decía "requiere explicacion".
//
// Estas pruebas fallan contra el código anterior al arreglo. Ese es el punto.

describe('un cero escrito y un cero por omisión no son lo mismo', () => {
  it('el campo vacío no es cero: es "no me dijiste"', () => {
    expect(leerContado('')).toBeNull()
    expect(leerContado('   ')).toBeNull()
  })

  it('un cero escrito a mano sí es una afirmación', () => {
    expect(leerContado('0')).toBe(0)
  })

  it('y la basura no se convierte en cero a la callada', () => {
    // `Number('abc') || 0` daba 0 — el mismo cero mudo por otra puerta.
    expect(leerContado('abc')).toBeNull()
    expect(leerContado('$500')).toBeNull()
  })

  it('lee decimales y espacios como lo que son', () => {
    expect(leerContado(' 1234.56 ')).toBe(1234.56)
  })
})

describe('no se cierra la caja sin contar el efectivo', () => {
  it('sin capturar nada, no se puede cerrar', () => {
    const v = evaluarArqueo(null, -5957.76, '')
    expect(v.puedeCerrar).toBe(false)
    expect(v.motivo).toMatch(/escribe/i)
  })

  it('el mensaje le dice al cajero qué hacer si de verdad no hay nada', () => {
    // Sin esto, la regla nueva sólo sería un muro. "Escribe 0" es la salida.
    expect(evaluarArqueo(null, 0, '').motivo).toMatch(/escribe 0/i)
  })

  it('un contado negativo tampoco pasa', () => {
    expect(evaluarArqueo(-100, 0, '').puedeCerrar).toBe(false)
  })

  it('contando bien y sin diferencia, cierra sin fricción', () => {
    const v = evaluarArqueo(5957.76, 0, '')
    expect(v).toEqual({ puedeCerrar: true, exigeExplicacion: false, motivo: null })
  })
})

describe('la explicación que la pantalla prometía ahora se exige', () => {
  it('EL CASO REAL: el Z#3 no se habría podido cerrar mudo', () => {
    const v = evaluarArqueo(0, -5957.76, '')
    expect(v.puedeCerrar).toBe(false)
    expect(v.exigeExplicacion).toBe(true)
  })

  it('y con una explicación de verdad sí cierra', () => {
    const v = evaluarArqueo(0, -5957.76, 'Se depositó todo en la caja fuerte antes del corte')
    expect(v.puedeCerrar).toBe(true)
    expect(v.exigeExplicacion).toBe(true)
  })

  it('"LNKBCVLKBCV" es tecleo, no explicación — pero pasa el mínimo de 10', () => {
    // Honestidad sobre el alcance: esta regla mide LARGO, no sentido. La nota real
    // del Z#2 tiene 11 caracteres y pasa. Lo que la regla impide es el silencio,
    // que es lo que ocurrió en 7 de los 8 cierres. Detectar tecleo aleatorio es
    // otro problema y no se resuelve con una validación de formulario.
    expect(evaluarArqueo(0, -5957.76, 'LNKBCVLKBCV').puedeCerrar).toBe(true)
  })

  it('una nota corta no alcanza', () => {
    expect(evaluarArqueo(0, -5957.76, 'faltó').puedeCerrar).toBe(false)
  })

  it('espacios no cuentan como explicación', () => {
    expect(evaluarArqueo(0, -5957.76, '              ').puedeCerrar).toBe(false)
  })
})

describe('el umbral es el mismo que la pantalla anuncia', () => {
  it('vale $50, que es el número que el wizard enseña', () => {
    expect(UMBRAL_EXPLICACION_MXN).toBe(50)
  })

  it('justo en el umbral todavía no exige nota', () => {
    expect(evaluarArqueo(100, 50, '').puedeCerrar).toBe(true)
    expect(evaluarArqueo(100, -50, '').puedeCerrar).toBe(true)
  })

  it('un centavo arriba sí', () => {
    expect(evaluarArqueo(100, 50.01, '').puedeCerrar).toBe(false)
    expect(evaluarArqueo(100, -50.01, '').puedeCerrar).toBe(false)
  })

  it('un sobrante grande también se explica, no sólo un faltante', () => {
    // Un sobrante puede ser una venta no registrada, que es el patrón de fraude
    // que más se parece a "buena noticia".
    expect(evaluarArqueo(9000, 3000, '').puedeCerrar).toBe(false)
  })
})

describe('el wizard usa la política, no su propia versión', () => {
  const wizard = readFileSync(
    join(__dirname, '..', 'components', 'pos', 'CierreCajaWizard.tsx'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('ya no convierte el campo vacío en cero', () => {
    expect(wizard).not.toMatch(/Number\(cashInput\)\s*\|\|\s*0/)
  })

  it('lee el campo con leerContado', () => {
    expect(wizard).toMatch(/leerContado\(cashInput\)/)
  })

  it('y consulta evaluarArqueo antes de dejar cerrar', () => {
    expect(wizard).toMatch(/evaluarArqueo\(/)
  })

  it('la nota ya no se ofrece como opcional cuando se exige', () => {
    expect(wizard).not.toMatch(/Notas del cierre \(opcional\)</)
  })
})

describe('la guarda del arqueo vive en el handler, no solo en el boton', () => {
  it('REGRESION (fuente): handleSave vuelve a evaluar arqueo.puedeCerrar antes de tomar el candado', () => {
    const wizard = readFileSync(join(process.cwd(), 'src/components/pos/CierreCajaWizard.tsx'), 'utf8')
    const i = wizard.indexOf('const handleSave = async')
    const cabeza = wizard.slice(i, wizard.indexOf('closingRef.current = true', i))
    expect(cabeza).toMatch(/if \(!arqueo\.puedeCerrar\) \{ setPinError\(/)
  })
})
