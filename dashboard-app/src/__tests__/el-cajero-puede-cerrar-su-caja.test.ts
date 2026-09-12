import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  puedeEscribirEn, MANAGER_ONLY_WRITE, NIVEL_MINIMO_DE_ESCRITURA, camposProhibidos,
} from '@/lib/pos-db-policy'

// EL CORTE Z DE UNA CAJA LOGUEADA COMO CAJERO MORIA EN 403.
//
// `pos_cash_movements` y `pos_cierres` estaban en MANAGER_ONLY_WRITE desde el 2026-08-25
// (commit 02ce02c2 — verificado con `git log -S`, no fue de esta sesion). El efecto:
//
//   1. Una terminal POS con shift token y SIN sesion de Supabase se rutea por
//      `/api/pos/db` (supabase-fetch-patch.ts:51). Eso es TODA caja de kiosco.
//   2. `isManager` = admin | gerente | dueño. `cajero` NO esta.
//   3. El retiro de caja y el Corte Z salen con 403.
//   4. Y un 403 en el replay de la cola se clasifica terminal (pos-offline-db.ts): NO
//      se reintenta jamas. El dinero del turno no sube nunca, y la terminal muestra el
//      corte hecho. Nadie se entera hasta que alguien compara.
//
// AMALAY tiene CUATRO cajeros activos (consultado en pos_staff el 2026-09-08). Los ocho
// cierres que existen se guardaron bien porque los hizo Daniel, que es admin. El dia del
// cutover lo ve el primer cajero que cierre.
//
// POR QUE NO SE RESOLVIO CON UNA APROBACION FIRMADA EN LA CABECERA: el cierre se ENCOLA,
// y el replay reproduce la operacion sin cabeceras. Quedaria igual de roto justo en el
// caso offline, que es el que mas importa.

describe('el vector: la caja puede cerrar su turno', () => {
  it('un cajero puede registrar el cierre', () => {
    expect(puedeEscribirEn('pos_cierres', 'cajero')).toBe(true)
  })

  it('y un retiro de caja', () => {
    expect(puedeEscribirEn('pos_cash_movements', 'cajero')).toBe(true)
  })

  it('tambien puede abrir y cerrar su turno', () => {
    expect(puedeEscribirEn('pos_turnos', 'cajero')).toBe(true)
  })

  it('gerente, admin y dueño tambien, claro', () => {
    for (const rol of ['gerente', 'admin', 'dueño']) {
      expect(puedeEscribirEn('pos_cierres', rol), rol).toBe(true)
      expect(puedeEscribirEn('pos_cash_movements', rol), rol).toBe(true)
    }
  })

  it('capitan alcanza: esta por encima de cajero', () => {
    expect(puedeEscribirEn('pos_cierres', 'capitan')).toBe(true)
  })
})

describe('lo que NO se abrio', () => {
  it('un MESERO sigue sin poder inventar un cierre', () => {
    // Era el vector que el candado original queria cerrar, y sigue cerrado.
    expect(puedeEscribirEn('pos_cierres', 'mesero')).toBe(false)
    expect(puedeEscribirEn('pos_cash_movements', 'mesero')).toBe(false)
    expect(puedeEscribirEn('pos_turnos', 'mesero')).toBe(false)
  })

  it('ni un rol desconocido, ni uno vacio', () => {
    for (const rol of ['cocina', 'barra', '', null, undefined, 'CAJERO']) {
      expect(puedeEscribirEn('pos_cierres', rol as string), String(rol)).toBe(false)
    }
  })

  it('las tablas de IDENTIDAD siguen pidiendo gerente', () => {
    // Dan de alta identidad: sin esto, cualquiera con shift token se reescribe el PIN
    // del gerente. Nada de esto se relajo.
    for (const t of ['pos_staff', 'pos_terminals', 'pos_fingerprint_templates']) {
      expect(puedeEscribirEn(t, 'cajero'), t).toBe(false)
      expect(puedeEscribirEn(t, 'gerente'), t).toBe(true)
    }
  })

  it('y los precios del menu tambien', () => {
    expect(puedeEscribirEn('pos_menu_items', 'cajero')).toBe(false)
    expect(puedeEscribirEn('pos_menu_items', 'mesero')).toBe(false)
    expect(puedeEscribirEn('pos_menu_items', 'gerente')).toBe(true)
  })

  it('el candado por COLUMNA de pos_orders sigue intacto', () => {
    // Un cajero puede mover la caja, pero no bajarle el total a una orden.
    expect(camposProhibidos('pos_orders', 'cajero', JSON.stringify({ total: 1 }))).toContain('total')
  })

  it('y tampoco puede reabrir un turno cerrado', () => {
    expect(camposProhibidos('pos_turnos', 'cajero', JSON.stringify({ closed_at: null })).length)
      .toBeGreaterThan(0)
  })

  it('una tabla sin regla sigue abierta a la operacion normal', () => {
    expect(puedeEscribirEn('pos_orders', 'mesero')).toBe(true)
  })
})

describe('las dos listas no se pisan', () => {
  it('las tablas de caja YA NO estan en MANAGER_ONLY_WRITE', () => {
    expect(MANAGER_ONLY_WRITE.has('pos_cierres')).toBe(false)
    expect(MANAGER_ONLY_WRITE.has('pos_cash_movements')).toBe(false)
  })

  it('y tienen su nivel minimo declarado', () => {
    expect(NIVEL_MINIMO_DE_ESCRITURA.pos_cierres).toBe(2)
    expect(NIVEL_MINIMO_DE_ESCRITURA.pos_cash_movements).toBe(2)
    expect(NIVEL_MINIMO_DE_ESCRITURA.pos_turnos).toBe(2)
  })
})

describe('los DOS proxies usan la misma funcion', () => {
  // Que uno quedara protegido y el otro no ya paso antes en este repo.
  const lee = (r: string) => readFileSync(join(__dirname, '..', 'app', 'api', 'pos', 'db', r), 'utf8')

  for (const ruta of ['route.ts', '[...path]/route.ts']) {
    it(`${ruta} llama a puedeEscribirEn`, () => {
      expect(lee(ruta)).toMatch(/!puedeEscribirEn\(table, auth\.role\)/)
    })

    it(`${ruta} ya no decide con MANAGER_ONLY_WRITE por su cuenta`, () => {
      expect(lee(ruta)).not.toMatch(/MANAGER_ONLY_WRITE\.has\(table\) && !isManager/)
    })
  }
})
