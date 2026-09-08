import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { MUESTRA_MINIMA_PRECISION } from '@/lib/agents/types'

// Dos formas de mentir con números, las dos verificadas en el código:
//
// 1. `precision_rate: precisionRate ?? 0` — sin un solo veredicto la API
//    reportaba 0%, que no se lee como «sin datos» sino como «los agentes fallan
//    siempre». Cero y ausencia no son lo mismo.
//
// 2. Un porcentaje sin su denominador. Con 4 veredictos, un 25% se lee igual de
//    firme que con 400, y con ese número alguien apaga un agente por ruido
//    muestral. Medido en la base el 2026-09-08: 4 desenlaces en toda la
//    historia.
//
// Y una tercera, que resultó ser distinta de lo que parecía: había un circuito
// completo —función de guardado, lectura y ruta de API— apuntando a la tabla
// `agent_feedback`, que NO existe. No le mentía a nadie porque nunca se
// ejecutaba: la función no la llamaba ningún botón. Era código muerto que
// apuntaba a la nada, del tipo exacto que ya quemó a este proyecto.

const raiz = join(__dirname, '..')
const leer = (r: string) => readFileSync(join(raiz, r), 'utf8')
const sinComentarios = (f: string) =>
  f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('la precisión no finge saber', () => {
  it('cero veredictos NO se reporta como cero por ciento', () => {
    const ruta = sinComentarios(leer('app/api/agents/metrics/route.ts'))
    // El patrón exacto que convertía «sin datos» en «falla siempre».
    expect(ruta).not.toMatch(/precision_rate:\s*precisionRate\s*\?\?\s*0/)
    expect(ruta).toMatch(/precision_rate:\s*precisionRate\b/)
  })

  it('el porcentaje viaja siempre con su denominador', () => {
    const ruta = sinComentarios(leer('app/api/agents/metrics/route.ts'))
    expect(ruta).toMatch(/juzgados:/)
    expect(ruta).toMatch(/muestra_insuficiente:/)
  })

  it('la pantalla no pinta porcentaje con muestra corta', () => {
    const pantalla = sinComentarios(leer('app/agentes/page.tsx'))
    expect(pantalla).toMatch(/muestra_insuficiente/)
    // Y cuando lo pinta, dice sobre cuántos.
    expect(pantalla).toMatch(/juzgados/)
  })

  it('el mínimo es un número declarado, no uno suelto en el código', () => {
    expect(MUESTRA_MINIMA_PRECISION).toBeGreaterThanOrEqual(10)
  })
})

describe('la consulta dice cuando no trajo todo', () => {
  it('el límite se declara y se compara, en vez de truncar en silencio', () => {
    // El mismo patrón que ya mordió en el panel, donde una consulta leía las
    // 5,000 órdenes MÁS VIEJAS y nadie lo sabía.
    const ruta = sinComentarios(leer('app/api/agents/metrics/route.ts'))
    expect(ruta).toMatch(/const LIMITE\s*=/)
    expect(ruta).toMatch(/truncado:/)
    expect(ruta).not.toMatch(/limit=500/)
  })
})

describe('no queda circuito apuntando a la nada', () => {
  it('la ruta que escribía a una tabla inexistente ya no está', () => {
    expect(existsSync(join(raiz, 'app/api/agents/feedback/route.ts'))).toBe(false)
  })

  it('mission-control no conserva los restos', () => {
    const pantalla = leer('app/mission-control/page.tsx')
    expect(pantalla).not.toMatch(/agents\/feedback/)
    expect(pantalla).not.toMatch(/saveAction/)
    expect(pantalla).not.toMatch(/setActioned/)
  })

  it('nadie más llama a esa ruta', () => {
    for (const archivo of ['app/mission-control/page.tsx', 'app/agentes/page.tsx']) {
      expect(leer(archivo)).not.toMatch(/\/api\/agents\/feedback/)
    }
  })
})
