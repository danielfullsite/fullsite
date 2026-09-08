import { describe, it, expect } from 'vitest'
import {
  calificar, hayMuestraSuficiente, MINIMO_DIAS_PARA_PROMEDIAR,
  type Prediccion, type CierreReal,
} from '@/lib/agents/calificar-prediccion'

// El predictor dice a media tarde en cuánto va a cerrar el día; al día siguiente
// el cierre real está en la base. Es la única señal de calidad que este sistema
// puede producir sin trabajo humano y sin necesitar volumen.
//
// Lo difícil no es la resta. Entre el 20 de junio y el 3 de agosto de 2026 el
// predictor recibió el MISMO dato de entrada 34 días seguidos —la fuente había
// dejado de actualizarse y repetía la última fila— y sus proyecciones de esos
// días se ven como cualquier otra. Calificarlas mediría ruido con apariencia de
// rigor, y ese número alimentaría el aprendizaje.

const p = (fecha: string, proyectado: number, llevaba: number, hora = 15): Prediccion =>
  ({ fecha, proyectado, llevaba, hora })
const r = (fecha: string, ventas: number): CierreReal => ({ fecha, ventas })

describe('la resta, cuando el día sí cuenta', () => {
  it('mide el error contra el cierre real', () => {
    // Llevaba 40,000 a media tarde, proyectó 87,161 y el día cerró en 90,611.
    const c = calificar([p('2026-07-03', 87161, 40000)], [r('2026-07-03', 90611)])
    expect(c.calificados).toHaveLength(1)
    expect(c.calificados[0].error).toBe(-3450)
    expect(c.calificados[0].errorPct).toBeCloseTo(0.038, 3)
  })

  it('un error por debajo también es error, no un acierto', () => {
    // Caso real del 31 de agosto: llevaba 406 a las 5pm, proyectó 449, cerró 1756.
    const c = calificar([p('2026-08-31', 449, 406, 17)], [r('2026-08-31', 1756)])
    expect(c.calificados[0].error).toBeLessThan(0)
    expect(c.calificados[0].errorPct).toBeCloseTo(0.744, 2)
  })

  it('guarda la hora: una proyección de las 8pm no vale lo que una de las 2pm', () => {
    const c = calificar([p('2026-07-03', 87161, 40000, 20)], [r('2026-07-03', 90611)])
    expect(c.calificados[0].hora).toBe(20)
  })
})

describe('qué día NO cuenta', () => {
  it('descarta el dato de entrada congelado, aunque haya cierre real', () => {
    // El bug de los 34 días: la misma venta de entrada repetida.
    const preds = [
      p('2026-07-06', 87161, 68421), p('2026-07-07', 87161, 68421), p('2026-07-08', 87161, 68421),
    ]
    const reales = [r('2026-07-06', 55916), r('2026-07-07', 49754), r('2026-07-08', 51462)]
    const c = calificar(preds, reales)
    expect(c.calificados).toHaveLength(0)
    expect(c.descartados.map(d => d.motivo)).toEqual(
      Array(3).fill('dato-de-entrada-congelado'))
  })

  it('descarta cuando ya veía el día completo: eso es leer, no predecir', () => {
    // Caso real del 10 de julio: llevaba 41332 y el día cerró en 41332.
    const c = calificar([p('2026-07-10', 52652, 41332)], [r('2026-07-10', 41332)])
    expect(c.calificados).toHaveLength(0)
    expect(c.descartados[0].motivo).toBe('ya-veia-el-dia-completo')
  })

  it('descarta el día sin cierre real, en vez de contarlo como error cero', () => {
    // Aprender de un día cerrado es aprender basura.
    const c = calificar([p('2026-08-15', 50000, 30000)], [])
    expect(c.calificados).toHaveLength(0)
    expect(c.descartados[0].motivo).toBe('sin-cierre-real')
    expect(c.errorMedio).toBeNull()
  })

  it('un día que cerró en cero tampoco califica', () => {
    const c = calificar([p('2026-08-15', 50000, 30000)], [r('2026-08-15', 0)])
    expect(c.descartados[0].motivo).toBe('cerro-en-cero')
  })

  it('descartar no es fallar: los descartados no ensucian el promedio', () => {
    const c = calificar(
      [p('2026-07-03', 87161, 40000), p('2026-07-07', 87161, 68421), p('2026-07-08', 87161, 68421)],
      [r('2026-07-03', 90611), r('2026-07-07', 49754), r('2026-07-08', 51462)],
    )
    expect(c.calificados).toHaveLength(1)
    expect(c.descartados).toHaveLength(2)
    expect(c.errorMedio).toBeCloseTo(0.038, 3)   // sólo el día limpio
  })

  it('CASO REAL: llevaba más de lo que cerró el día — las dos fuentes no cuadran', () => {
    // 30 de agosto: la venta de entrada dice 725 y el cierre dice 682. Nadie
    // puede llevar vendido más de lo que cerró; alguna de las dos fuentes usa
    // otro criterio de día o de estado. Con las cuentas sin cuadrar no se puede
    // calificar a nadie, y ese día vale más descartarlo que promediarlo.
    const c = calificar([p('2026-08-30', 729, 725, 20)], [r('2026-08-30', 682)])
    expect(c.calificados).toHaveLength(0)
    expect(c.descartados[0].motivo).toBe('ya-veia-el-dia-completo')
  })

  it('cada descarte lleva su motivo escrito, no desaparece', () => {
    const c = calificar([p('2026-08-15', 50000, 30000)], [])
    expect(c.descartados[0]).toHaveProperty('fecha')
    expect(c.descartados[0]).toHaveProperty('motivo')
  })
})

describe('el promedio no pretende más de lo que sabe', () => {
  it('con pocos días, no hay muestra para promediar', () => {
    const c = calificar([p('2026-07-03', 87161, 40000)], [r('2026-07-03', 90611)])
    expect(c.errorMedio).not.toBeNull()          // se calcula
    expect(hayMuestraSuficiente(c)).toBe(false)  // pero no se debe publicar como medida
  })

  it('con suficientes días sí', () => {
    const preds = Array.from({ length: MINIMO_DIAS_PARA_PROMEDIAR }, (_, i) =>
      p(`2026-06-${String(i + 1).padStart(2, '0')}`, 1000 + i, 500 + i))
    const reales = preds.map(x => r(x.fecha, 1000))
    const c = calificar(preds, reales)
    expect(c.calificados).toHaveLength(MINIMO_DIAS_PARA_PROMEDIAR)
    expect(hayMuestraSuficiente(c)).toBe(true)
  })

  it('cuenta cuántos días cayeron dentro de un margen', () => {
    // Entradas distintas a propósito: repetirlas las marcaría como congeladas.
    const c = calificar(
      [p('a', 100, 50), p('b', 150, 51), p('c', 102, 52)],
      [r('a', 100), r('b', 100), r('c', 100)],
    )
    expect(c.dentroDe(0.05)).toBe(2)   // 0% y 2% de error
    expect(c.dentroDe(0.5)).toBe(3)
  })
})
