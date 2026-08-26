// Traducción de la salida de los agentes al español de un restaurante.
//
// Los casos son los textos REALES que Daniel vio en la campana:
//   Hermes           18 issues: 0 critical, 12 high
//   Alerta de Stock  ALERTAS: 225 sin stock, 0 critico, 0 bajo minimo
//   Config           1 issues
//
// Su reacción fue exacta: "los clientes no entienden".
import { describe, it, expect } from 'vitest'
import { traducir, traducirTanda, esTelemetria } from '@/lib/agentes/traducir'

const a = (agent_id: string, summary: string, priority = 'warning') => ({ agent_id, summary, priority })

describe('lo que NO debe llegarle al dueño', () => {
  it('descarta la telemetría de la plataforma', () => {
    expect(traducir(a('hermes', '18 issues: 0 critical, 12 high'))).toBeNull()
    expect(traducir(a('config-validator', '1 issues'))).toBeNull()
    expect(traducir(a('uptime-monitor', '0F 1W'))).toBeNull()
    expect(traducir(a('upselling', 'no KPI row in wansoft_kpis'))).toBeNull()
  })

  it('reconoce los conteos de su propia salida', () => {
    expect(esTelemetria('1 issues')).toBe(true)
    expect(esTelemetria('5 hallazgos')).toBe(true)
    expect(esTelemetria('3 anomalias detectadas')).toBe(true)
    expect(esTelemetria('0F 1W')).toBe(true)
    // …y NO confunde una frase de negocio con telemetría
    expect(esTelemetria('Ventas $12,400 estan 40% abajo de lo esperado')).toBe(false)
  })

  it('un riesgo de cero no es un aviso', () => {
    expect(traducir(a('antifraud', 'RIESGO: 0/100, 0 hallazgos'))).toBeNull()
  })

  it('nunca deja pasar texto en inglés de sistema', () => {
    for (const s of ['18 issues: 0 critical, 12 high', '1 issues', '0F 1W']) {
      expect(traducir(a('hermes', s))).toBeNull()
    }
  })
})

describe('lo que SÍ se traduce', () => {
  it('el faltante masivo y estable se dice como lo que es: captura pendiente', () => {
    // La auditoría mostró "225 sin stock" repetido 24 días idénticos. Un faltante
    // que no se mueve en seis semanas no es un faltante.
    const t = traducir(a('stock-alert', 'ALERTAS: 225 sin stock, 0 critico, 0 bajo minimo', 'critical'))!
    expect(t).toBeTruthy()
    expect(t.texto).toMatch(/^Revísalo:/)
    expect(t.texto).toMatch(/225 insumos/)
    expect(t.texto).toMatch(/inventario sin capturar/)
    // no alarma como si se hubieran acabado de verdad
    expect(t.severidad).toBe('media')
    expect(t.agente).toBe('Lo que se está acabando')
  })

  it('un faltante crítico de verdad sí alarma', () => {
    const t = traducir(a('stock-alert', 'ALERTAS: 8 sin stock, 3 critico, 0 bajo minimo', 'critical'))!
    expect(t.texto).toMatch(/^Pídelo:/)
    expect(t.severidad).toBe('alta')
  })

  it('los platillos que no se pueden preparar se dicen con acción', () => {
    const t = traducir(a('auto86', '2 ingredientes en cero, 35 platillos 86\'d'))!
    expect(t.texto).toMatch(/^Ajústalo:/)
    expect(t.texto).toMatch(/35 platillos no se pueden preparar/)
    expect(t.severidad).toBe('alta')
  })

  it('la proyección del cierre se dice sin jerga', () => {
    const t = traducir(a('predictor', 'Proyección: $87,161 (avance 78%)'))!
    expect(t.texto).toMatch(/rumbo a \$87,161/)
    expect(t.agente).toBe('Cómo va a cerrar el día')
  })

  it('una frase que ya habla del negocio se deja pasar', () => {
    const t = traducir(a('anomaly', 'Ventas $12,400 estan 40% abajo de lo esperado', 'critical'))!
    expect(t.texto).toMatch(/40% abajo/)
    expect(t.severidad).toBe('alta')
  })

  it('el nombre técnico nunca se muestra', () => {
    const t = traducir(a('stock-alert', 'ALERTAS: 8 sin stock, 3 critico'))!
    expect(t.agente).not.toMatch(/stock-alert|hermes|config/)
  })
})

describe('la tanda completa', () => {
  it('de la captura real de Daniel no sobrevive la jerga', () => {
    const crudos = [
      a('hermes', '18 issues: 0 critical, 12 high'),
      a('stock-alert', 'ALERTAS: 225 sin stock, 0 critico, 0 bajo minimo', 'critical'),
      a('config-validator', '1 issues'),
      a('hermes', '19 issues: 0 critical, 11 high'),
      a('config-validator', '1 issues'),
    ]
    const t = traducirTanda(crudos)
    // de los 5, sólo el de inventario dice algo del restaurante
    expect(t).toHaveLength(1)
    expect(t[0].texto).toMatch(/inventario sin capturar/)
    // y en todo el resultado no queda una sola palabra de sistema
    const todo = t.map(x => `${x.agente} ${x.texto}`).join(' ')
    expect(todo).not.toMatch(/issues|critical|high|ALERTAS/)
  })

  it('si nada habla del negocio, la lista queda vacía', () => {
    expect(traducirTanda([a('hermes', '1 issues'), a('config-validator', '1 issues')])).toEqual([])
  })
})
