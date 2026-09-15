// EL PROXY CORRE CON service_role Y SE SALTA LA RLS.
//
// Barrido de permisos 2026-09-12. Las listas de `pos-db-policy` eran de
// PROHIBICIONES, así que cada tabla nueva en `ALLOW` nacía borrable y parchable
// por cualquier shift token. Medido sobre las 37 tablas: sólo `pos_orders`
// estaba cubierta para DELETE. Con un PIN de mesero:
//
//     DELETE pos_audit_log?client_id=eq.<tenant>   → se lleva la evidencia
//     PATCH  pos_audit_log?id=eq.<fila> {actor}    → se la atribuye a otro
//     PATCH  pos_turnos?id=eq.<turno> {efectivo_sistema, diferencia: 0}
//                                                  → cuadra el arqueo del turno
//
// Y el tercero no se podía cerrar con un candado de gerente: el Corte Z lo hace
// la caja, que opera como `cajero`, y su PATCH lleva exactamente esas columnas.
// Por eso el candado del dinero del turno es por NIVEL, no por rol de gerente.
import { describe, it, expect } from 'vitest'
import { camposProhibidos, puedeBorrarEn, SOLO_SE_INSERTA, BORRADO_PERMITIDO_A_ROL_OPERATIVO, ALLOW } from '@/lib/pos-db-policy'

const cuerpo = (o: unknown) => JSON.stringify(o)

describe('borrar es la excepción, no la regla', () => {
  it('REGRESION: un mesero no borra la bitácora ni ninguna otra tabla del proxy', () => {
    for (const tabla of ALLOW) {
      expect(puedeBorrarEn(tabla, 'mesero'), `mesero borrando ${tabla}`).toBe(false)
      expect(puedeBorrarEn(tabla, 'cajero'), `cajero borrando ${tabla}`).toBe(false)
    }
    expect(puedeBorrarEn('pos_audit_log', 'mesero')).toBe(false)
  })
  it('un gerente sí borra, y la lista de excepciones está vacía a propósito', () => {
    expect(puedeBorrarEn('pos_orders', 'gerente')).toBe(true)
    expect(puedeBorrarEn('pos_audit_log', 'admin')).toBe(true)
    expect([...BORRADO_PERMITIDO_A_ROL_OPERATIVO]).toEqual([])
  })
  it('una tabla nueva en ALLOW nace protegida, no borrable', () => {
    expect(puedeBorrarEn('tabla_que_alguien_agregue_manana', 'mesero')).toBe(false)
  })
})

describe('la bitácora se escribe, no se corrige', () => {
  it('pos_audit_log y pos_save_operations sólo admiten insertar para roles operativos', () => {
    expect(SOLO_SE_INSERTA.has('pos_audit_log')).toBe(true)
    expect(SOLO_SE_INSERTA.has('pos_save_operations')).toBe(true)
  })
  it('REGRESION (fuente): los dos proxies rechazan PATCH/DELETE sobre esas tablas', () => {
    for (const ruta of ['src/app/api/pos/db/route.ts', 'src/app/api/pos/db/[...path]/route.ts']) {
      const src = require('node:fs').readFileSync(require('node:path').join(process.cwd(), ruta), 'utf8')
      expect(src, ruta).toMatch(/SOLO_SE_INSERTA\.has\(table\) && !isManager\(auth\.role\)/)
      expect(src, ruta).toMatch(/!puedeBorrarEn\(table, auth\.role\)/)
    }
  })
})

describe('el dinero del turno tiene candado por nivel, no por gerente', () => {
  const arqueo = cuerpo({ efectivo_sistema: 4200, diferencia: 0 })
  it('REGRESION: un mesero no puede cuadrar el arqueo del turno', () => {
    expect(camposProhibidos('pos_turnos', 'mesero', arqueo).sort()).toEqual(['diferencia', 'efectivo_sistema'])
  })
  it('el cajero SÍ puede: es quien hace el Corte Z y su PATCH lleva esas columnas', () => {
    expect(camposProhibidos('pos_turnos', 'cajero', arqueo)).toEqual([])
    expect(camposProhibidos('pos_turnos', 'cajero', cuerpo({ closed_by: 'Caja', fondo_final: 659, closed_at: '2026-09-12T02:00:00Z' }))).toEqual([])
  })
  it('reabrir sigue siendo sólo de gerente, y el cierre normal pasa', () => {
    expect(camposProhibidos('pos_turnos', 'cajero', cuerpo({ closed_at: null }))).toEqual(['closed_at (reabrir)'])
    expect(camposProhibidos('pos_turnos', 'gerente', cuerpo({ closed_at: null }))).toEqual([])
  })
  it('el cierre y los movimientos de caja siguen la misma regla', () => {
    expect(camposProhibidos('pos_cierres', 'mesero', cuerpo({ total_contado: 0, diferencia: 0 })).length).toBe(2)
    expect(camposProhibidos('pos_cierres', 'cajero', cuerpo({ total_contado: 659, diferencia: 0 }))).toEqual([])
    expect(camposProhibidos('pos_cash_movements', 'mesero', cuerpo({ amount: 3000, type: 'retiro' })).length).toBe(2)
    expect(camposProhibidos('pos_cash_movements', 'cajero', cuerpo({ amount: 3000, type: 'retiro' }))).toEqual([])
  })
  it('lo que ya estaba protegido en pos_orders no cambió', () => {
    expect(camposProhibidos('pos_orders', 'mesero', cuerpo({ total: 1 }))).toEqual(['total'])
    expect(camposProhibidos('pos_orders', 'mesero', cuerpo({ kds_item_status: '{}' }))).toEqual([])
  })
})
