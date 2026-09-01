// No se abre turno con cuentas abiertas del anterior — regla de Eduardo.
//
// Eduardo Esquivel, AMALAY:
//   "No puedes abrir un turno si sigues teniendo cuentas abiertas del turno
//    anterior… hay que matarlas todas."
//   "No puede haber cuentas abiertas de un día para otro."
//
// El repo ya tenía la guarda al CERRAR (GUARD-08). La de ABRIR no existía:
// `filterOpenOrders` sólo lo consumía `CierreCajaWizard`. Ésta es la simétrica.
//
// LO DELICADO: dos reglas correctas que parecen chocar.
//
// Eduardo dice BLOQUEAR. El protocolo de offline dice que abrir el día NUNCA se
// bloquea por red (regla dura #3). Se resuelven separando el caso: bloquea sólo si
// la consulta SE PUDO HACER y encontró cuentas. Si no se pudo saber, abre y avisa.
//
// Bloquear el arranque del día por un fetch fallido sería repetir el error del
// 2026-08-31: un fallo leído como si fuera un hecho.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  evaluarAperturaDeTurno,
  totalDeCuentas,
  type LecturaDeCuentas,
} from '@/lib/pos-cierre-guard'

const cuenta = (id: string, mesa: number, status: string, total: number) =>
  ({ id, mesa, mesero: 'Ana', status, total }) as never

describe('Con cuentas abiertas del turno anterior, NO se abre', () => {
  it('REGRESION: bloquea y devuelve las cuentas que estorban', () => {
    const lectura: LecturaDeCuentas = {
      determinado: true,
      cuentas: [cuenta('a', 3, 'enviada', 174), cuenta('b', 7, 'lista', 184.44)],
    }

    const v = evaluarAperturaDeTurno(lectura)

    expect(v.permitido).toBe(false)
    expect(v.bloqueantes).toHaveLength(2)
    expect(v.aviso).toMatch(/2 cuentas abiertas/)
  })

  it('el aviso está en singular cuando es una sola', () => {
    const v = evaluarAperturaDeTurno({ determinado: true, cuentas: [cuenta('a', 3, 'enviada', 174)] })
    expect(v.aviso).toMatch(/1 cuenta abierta/)
    expect(v.aviso).not.toMatch(/cuentas abiertas/)
  })

  it('sólo bloquean los estados que de verdad están abiertos', () => {
    // Una orden ya cobrada o cancelada no estorba. Si esto fallara, el POS quedaría
    // bloqueado para siempre por historia vieja.
    const lectura: LecturaDeCuentas = {
      determinado: true,
      cuentas: [
        cuenta('pagada', 1, 'pagada', 500),
        cuenta('cancelada', 2, 'cancelada', 300),
        cuenta('cerrada', 3, 'cerrada', 200),
        cuenta('viva', 4, 'preparando', 100),
      ],
    }

    const v = evaluarAperturaDeTurno(lectura)

    expect(v.permitido).toBe(false)
    expect(v.bloqueantes.map(b => b.id)).toEqual(['viva'])
  })

  it('sin cuentas abiertas, abre normal y sin ruido', () => {
    const v = evaluarAperturaDeTurno({ determinado: true, cuentas: [] })
    expect(v.permitido).toBe(true)
    expect(v.bloqueantes).toHaveLength(0)
    expect(v.aviso).toBeNull()
  })
})

describe('No poder comprobar NO es lo mismo que no haber nada', () => {
  it('REGRESION: si la consulta falló, SE ABRE igual — con aviso', () => {
    // Regla dura #3: abrir el día nunca se bloquea por red. Bloquear aquí dejaría al
    // restaurante sin poder arrancar por un 401 pasajero, que es peor que el problema
    // que se quiere evitar.
    const v = evaluarAperturaDeTurno({ determinado: false, motivo: 'tu sesión venció' })

    expect(v.permitido, 'un fallo de red NO puede detener el arranque del día').toBe(true)
    expect(v.bloqueantes).toHaveLength(0)
    expect(v.aviso).toMatch(/no se pudieron revisar/i)
    expect(v.aviso, 'el aviso debe decir qué revisar a mano').toMatch(/caja/i)
  })

  it('el motivo del fallo llega al operador, no se traga', () => {
    const v = evaluarAperturaDeTurno({ determinado: false, motivo: 'sin conexión' })
    expect(v.aviso).toContain('sin conexión')
  })
})

describe('El total de lo que cuelga', () => {
  it('suma lo que hay que resolver antes de matar nada', () => {
    // Se enseña antes de cancelar: "vas a cerrar 2 cuentas por $358.44".
    expect(totalDeCuentas([cuenta('a', 3, 'enviada', 174), cuenta('b', 7, 'lista', 184.44)] as never))
      .toBeCloseTo(358.44, 2)
  })

  it('un total corrupto no truena la pantalla', () => {
    expect(totalDeCuentas([cuenta('a', 1, 'enviada', NaN as unknown as number)] as never)).toBe(0)
    expect(totalDeCuentas([])).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// El cableado en TurnoGate. Se lee la fuente porque el componente necesita DOM y
// este proyecto corre en `environment: 'node'` (ver vitest.config.ts).
describe('TurnoGate aplica la regla en el lugar correcto', () => {
  const gate = readFileSync(join(process.cwd(), 'src/components/pos/TurnoGate.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('REGRESION: el bloqueo se evalua ANTES de la pantalla de abrir turno', () => {
    // Si quedara despues, el operador veria el formulario y abriria igual.
    const iBloqueo = gate.indexOf("status === 'none' && veredicto && !veredicto.permitido")
    const iAbrir = gate.indexOf("status === 'none' && canOpenTurno")
    expect(iBloqueo).toBeGreaterThan(-1)
    expect(iAbrir).toBeGreaterThan(-1)
    expect(iBloqueo, 'el bloqueo va primero').toBeLessThan(iAbrir)
  })

  it('la politica NO se reimplementa en el componente', () => {
    // Toda la decision vive en evaluarAperturaDeTurno, que si es probable sin DOM.
    expect(gate).toContain('evaluarAperturaDeTurno(lectura)')
    expect(gate, 'el componente no debe decidir por su cuenta')
      .not.toMatch(/permitido:\s*(true|false)/)
  })

  it('REGRESION: cancela con filtro por id — nunca un PATCH abierto', () => {
    // Es el bug que cerro los once turnos de AMALAY. No se repite aqui.
    const i = gate.indexOf('cerrarCuentasHuerfanas')
    const cuerpo = gate.slice(i, i + 2000)
    expect(cuerpo).toContain('pos_orders?id=eq.')
    expect(cuerpo).toContain('client_id=eq.')
  })

  it('REGRESION: cancela, NO borra', () => {
    const i = gate.indexOf('cerrarCuentasHuerfanas')
    const cuerpo = gate.slice(i, i + 2000)
    expect(cuerpo).toContain("status: 'cancelada'")
    expect(cuerpo, 'jamas un DELETE sobre ordenes de produccion').not.toContain("method: 'DELETE'")
  })

  it('cada cancelacion queda auditada a nombre de quien la hizo', () => {
    const i = gate.indexOf('cerrarCuentasHuerfanas')
    const cuerpo = gate.slice(i, i + 2000)
    expect(cuerpo).toContain('_logAudit')
    expect(cuerpo).toContain('cuenta_huerfana_cancelada')
  })

  it('una falla parcial se reporta — no se declara exito a medias', () => {
    const i = gate.indexOf('cerrarCuentasHuerfanas')
    const cuerpo = gate.slice(i, i + 2000)
    expect(cuerpo).toContain('fallidas')
    expect(cuerpo).toContain('No se pudieron cerrar')
  })

  it('sin permiso de cierre, ofrece pedir ayuda en vez del boton', () => {
    expect(gate).toContain('canCloseTurno ?')
    expect(gate).toMatch(/Pide a un encargado/)
  })
})
