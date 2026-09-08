import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  edadDelDato, fecharAfirmacion, masReciente, HORAS_PARA_HABLAR_EN_PRESENTE,
} from '@/lib/agents/edad-del-dato'

// Un hallazgo habla en PRESENTE. «41 ingredientes sin stock — los platillos que los
// requieren no se pueden preparar» se lee como una frase sobre hoy, y de ahí sale una
// decisión: qué se compra esta tarde, qué se saca del menú esta noche.
//
// Medido en producción el 2026-09-08:
//
//   pos_inventory_products de AMALAY   último updated_at 2026-07-10 — hace 60 días
//   hallazgos de inventory en la base  71 de 155, 56 de ellos «critical»
//   fuente de finance (wansoft_daily)  sin datos desde 2026-07-20
//
// El agente de mayor volumen del sistema lleva dos meses diciendo en rojo qué no se puede
// cocinar hoy, leyendo una tabla que no se mueve desde julio. El cálculo está bien; la
// frase es falsa.
//
// La respuesta NO es callarlo — eso ya se decidió con el fraude. Es fecharlo.

const AHORA = Date.parse('2026-09-08T12:00:00Z')
const hace = (horas: number) => new Date(AHORA - horas * 3_600_000).toISOString()

describe('qué tan viejo es el dato', () => {
  it('un dato de hace dos horas habla del presente', () => {
    const e = edadDelDato(hace(2), AHORA)
    expect(e.declarada).toBe(true)
    expect(e.enPresente).toBe(true)
  })

  it('el inventario real de AMALAY, de hace 60 días, no', () => {
    const e = edadDelDato('2026-07-10', AHORA)
    expect(e.declarada).toBe(true)
    expect(e.enPresente).toBe(false)
    expect(e.dias).toBeGreaterThan(58)
  })

  it('NO DECLARAR no es lo mismo que estar fresco', () => {
    // El error más fácil aquí sería tratar el silencio como «está bien».
    const e = edadDelDato(null, AHORA)
    expect(e.declarada).toBe(false)
    expect(e.enPresente).toBe(false)
  })

  it('una fecha ilegible tampoco pasa por fresca', () => {
    const e = edadDelDato('ayer en la tarde', AHORA)
    expect(e.declarada).toBe(false)
    expect(e.enPresente).toBe(false)
    expect(e.hasta).toBe('ayer en la tarde')   // se conserva para poder depurarlo
  })

  it('una fecha suelta se toma al final del día, lo más favorable al agente', () => {
    // 2026-09-07 a las 23:59 son 12 horas antes del corte, no 36.
    expect(edadDelDato('2026-09-07', AHORA).enPresente).toBe(true)
  })

  it('el umbral se mide en horas, no en días', () => {
    expect(HORAS_PARA_HABLAR_EN_PRESENTE).toBeLessThanOrEqual(48)
  })
})

describe('cómo queda la frase', () => {
  const FRASE = '41 ingredientes sin stock — auto-86 activo'

  it('el dato viejo sale fechado, y el hallazgo completo sigue ahí', () => {
    const t = fecharAfirmacion(FRASE, edadDelDato('2026-07-10', AHORA))
    expect(t).toContain('Con datos al 2026-07-10')
    expect(t).toContain('hace 60 días')
    expect(t).toContain(FRASE)
  })

  it('el dato fresco se queda exactamente igual', () => {
    expect(fecharAfirmacion(FRASE, edadDelDato(hace(1), AHORA))).toBe(FRASE)
  })

  it('sin declarar no se ensucia la frase', () => {
    // La presión va sobre el agente que no declara —el barrido de abajo— y no sobre quien
    // lee la pantalla.
    expect(fecharAfirmacion(FRASE, edadDelDato(null, AHORA))).toBe(FRASE)
  })

  it('fechar no suaviza, no esconde y no baja el tono', () => {
    const t = fecharAfirmacion('robo de $4,200 en cancelaciones', edadDelDato('2026-07-10', AHORA))
    expect(t).toContain('robo de $4,200')
    for (const suave of ['posible', 'quizá', 'podría', 'aparente']) {
      expect(t.toLowerCase()).not.toContain(suave)
    }
  })

  it('un texto vacío no se convierte en una tarjeta que sólo dice una fecha', () => {
    expect(fecharAfirmacion('', edadDelDato('2026-07-10', AHORA))).toBe('')
  })
})

describe('el dato más nuevo de un lote', () => {
  it('toma el mayor', () => {
    expect(masReciente(
      [{ created_at: '2026-09-01' }, { created_at: '2026-09-05' }, { created_at: '2026-08-30' }],
      'created_at')).toBe('2026-09-05')
  })

  it('sin filas devuelve null, no una fecha inventada', () => {
    expect(masReciente([], 'created_at')).toBeNull()
    expect(masReciente(null, 'created_at')).toBeNull()
  })

  it('ignora filas sin el campo en vez de tropezar', () => {
    expect(masReciente([{ x: 1 }, { created_at: '2026-09-05' }], 'created_at')).toBe('2026-09-05')
  })
})

const raiz = join(__dirname, '..')
const sinComentarios = (r: string) =>
  readFileSync(join(raiz, r), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('nadie escribe a la pantalla sin decir de cuándo es su dato', () => {
  it('el engine fecha el hallazgo al insertarlo', () => {
    const motor = sinComentarios('lib/agents/engine.ts')
    expect(motor).toMatch(/fecharAfirmacion\(event\.title/)
    expect(motor).toMatch(/fecharAfirmacion\(event\.explanation/)
    expect(motor).toMatch(/frescura: edad/)
  })

  // Sin este barrido la regla dura hasta el próximo agente que alguien escriba. Es el
  // error que ya costó una semana: el arreglo del `+00:00` estaba en UN archivo y nadie
  // revisó los demás.
  const AGENTES = ['operations', 'inventory', 'fraud', 'staff', 'finance']

  for (const agente of AGENTES) {
    it(`${agente} declara la frescura en TODOS sus hallazgos`, () => {
      const src = sinComentarios(`lib/agents/${agente}.ts`)
      const emisiones = src.split('events.push({').length - 1
      const declaran = src.split('datos_hasta: datosHasta').length - 1
      expect(emisiones).toBeGreaterThan(0)
      expect(declaran).toBe(emisiones)
    })
  }
})
