import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// EL DETECTOR IBA A ACUSAR AL MESERO QUE DIVIDE LA CUENTA BIEN.
//
// En el split PAREJO, `payingItems` no se reasigna (pos/page.tsx:3814): cada cuenta
// guarda TODOS los renglones de la mesa y solo cambia el total a 1/N. Asi que el
// detector de skimming, que compara la suma de los renglones contra el total, ve en una
// mesa de $2,816 dividida entre cuatro:
//
//     sum(items) = 281600¢   contra   total = 70400¢   ->  "faltante" de $2,112
//
// Cuatro veces, una por cuenta. Y el agente antifraude reporta POR MESERO: el acusado
// seria justo quien dividio la cuenta correctamente.
//
// Es el mismo envenenamiento del falso positivo del IVA de agosto -- quince eventos,
// todos falsos, que taparon el caso real. Un detector que dispara en cada mesa dividida
// no es conservador: es ruido que acusa a gente honesta.
//
// LA CEGUERA QUE NO SE PODIA DEJAR. Callar en las cuentas y ya habria dejado el split
// SIN deteccion -- y el split es justo donde vive el doble cobro. La suma solo tiene
// sentido contra la MADRE, y ese punto existe desde hoy: al liquidarse se escribe con
// estado 'dividida'. Ahi se compara lo servido contra lo que de verdad cobraron sus
// cuentas, que es donde se ve el faltante de "divido en cuatro y registro dos".

const ruta = readFileSync(
  join(__dirname, '..', 'app', 'api', 'pos', 'save-order', 'route.ts'), 'utf8',
)
const codigo = ruta.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('una cuenta de split no se audita sola', () => {
  it('se reconoce y se sale antes de comparar', () => {
    expect(codigo).toMatch(/if \(esCuentaDeCobroDeSplit\(o\.orderId\)\) return/)
  })

  it('la salida va ANTES de calcular la suma', () => {
    // Despues no serviria: el evento ya se habria escrito.
    const salida = codigo.indexOf('esCuentaDeCobroDeSplit(o.orderId)')
    const suma = codigo.indexOf('const sumItems = items')
    expect(salida).toBeGreaterThan(-1)
    expect(suma).toBeGreaterThan(salida)
  })
})

describe('la madre SI se audita, contra lo que cobraron sus cuentas', () => {
  it('el estado dividida entra a la auditoria', () => {
    expect(codigo).toMatch(/body\.status === 'cerrada' \|\| body\.status === 'dividida'/)
  })

  it('lee las cuentas del split para saber cuanto se cobro', () => {
    expect(codigo).toMatch(/id=like\.\$\{encodeURIComponent\(o\.orderId \+ '-C'\)\}\*/)
  })

  it('suma SOLO las cuentas efectivamente cobradas', () => {
    // Una cuenta cancelada o abierta no aporta dinero; contarla escondería el faltante.
    expect(codigo).toMatch(/c\.status === 'cerrada' \|\| c\.status === 'completada'/)
  })

  it('y si no se pueden leer, NO se acusa', () => {
    // Sin poder leerlas no se puede afirmar un faltante: es el mismo principio que con
    // la tasa de IVA — preferimos no reportar a reportar de mas.
    expect(codigo).toMatch(/if \(!cuentas\.ok\) return/)
    expect(codigo).toMatch(/if \(!Array\.isArray\(filas\) \|\| filas\.length === 0\) return/)
  })

  it('la fila trae su status, si no la rama no podria distinguir', () => {
    expect(codigo).toMatch(/select=items,total,descuento,mesero,status/)
  })
})

describe('lo que no se rompio', () => {
  it('una orden normal sigue midiendose contra su propio total', () => {
    expect(codigo).toMatch(/let declaredTotal = cents\(fila\.total \?\? 0\)/)
  })

  it('sigue leyendo la FILA y no el cuerpo', () => {
    expect(codigo).not.toMatch(/cents\(body\.total/)
    expect(codigo).toMatch(/const items = typeof fila\.items === 'string'/)
  })

  it('y sigue sin bloquear el guardado', () => {
    const i = codigo.indexOf('async function auditarCierreContraLaFila')
    const cuerpo = codigo.slice(i, codigo.indexOf('export async function POST'))
    expect(cuerpo).toMatch(/catch \{/)
    expect(cuerpo).not.toMatch(/return Response\.json/)
  })
})
