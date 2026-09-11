import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALLOW, MANAGER_ONLY_WRITE, MANAGER_ONLY_DELETE, CAMPOS_SOLO_DE_GERENTE,
  camposProhibidos, isManager,
} from '@/lib/pos-db-policy'

// OP-50, el hallazgo más caro del inventario de pendientes y el único 🔴 P0 que seguía
// abierto ahí: "el proxy `db` es la superficie de escritura real del POS".
//
// Los dos proxies escriben con service_role, o sea que se saltan RLS por completo. Lo
// único que separa a un mesero del dinero es lo que diga `pos-db-policy.ts`. Y aunque la
// tabla `pos_orders` TIENE que ser escribible por meseros —la escriben todo el día—,
// dentro viven las cifras del arqueo. Con un shift token cualquiera podía mandar
//
//     PATCH pos_orders?id=eq.<orden>   { "total": 1 }
//
// y el arqueo cuadraba, porque la comprobación es `pagos == total`. La diferencia se la
// queda quien cobró. Es el mismo skimming que `/api/pos/save-order` detecta recomputando
// el total desde los renglones — sólo que ese detector vive en la ruta de guardado y este
// camino la rodea entera.
//
// LO QUE SE VERIFICÓ ANTES DE CERRARLO (2026-09-08), porque un 403 a media comanda cuesta
// más que el hueco:
//
//   · las ÚNICAS escrituras del cliente a pos_orders por este camino son
//     `kds_item_status` (kds/page.tsx:332) y `mesero` (pos/page.tsx:4295)
//   · el guardado va por APP_API a /api/pos/save-order, que recalcula server-side
//   · la cola offline reproduce por ese mismo endpoint, no por el proxy
//   · los precios sólo se escriben desde /admin/menu, que es pantalla de gerente
//
// Por eso se prohíbe por COLUMNA y no por tabla: una lista de lo prohibido deja pasar
// cualquier columna legítima que aún no conozcamos; una de lo permitido rompe el POS en
// cuanto alguien agregue un campo.

const MESERO = 'mesero'
const GERENTE = 'gerente'

describe('un mesero no puede tocar las cifras del dinero', () => {
  it('bajar el total de una orden se rechaza', () => {
    expect(camposProhibidos('pos_orders', MESERO, JSON.stringify({ total: 1 }))).toEqual(['total'])
  })

  it('y también el resto de lo que mueve el arqueo', () => {
    for (const columna of ['subtotal', 'iva', 'descuento', 'propina', 'saldo', 'pagos', 'payment_status']) {
      expect(camposProhibidos('pos_orders', MESERO, JSON.stringify({ [columna]: 0 })),
        `${columna} debería estar prohibida`).toContain(columna)
    }
  })

  it('no se puede colar entre columnas legítimas', () => {
    // El intento evidente: esconder el total dentro de una escritura que sí es suya.
    const prohibidas = camposProhibidos('pos_orders', MESERO,
      JSON.stringify({ kds_item_status: '{}', mesero: 'Ana', total: 1 }))
    expect(prohibidas).toEqual(['total'])
  })

  it('ni en un lote donde sólo una fila la trae', () => {
    const prohibidas = camposProhibidos('pos_orders', MESERO,
      JSON.stringify([{ mesero: 'Ana' }, { mesero: 'Luis' }, { descuento: 9999 }]))
    expect(prohibidas).toEqual(['descuento'])
  })

  it('tampoco cambiando de turno o de restaurante', () => {
    // Mover una orden a otro turno la saca del corte; cambiarle el client_id la saca del
    // restaurante. Las dos son formas de desaparecer dinero sin tocar el total.
    expect(camposProhibidos('pos_orders', MESERO, JSON.stringify({ turno_id: 'otro' }))).toContain('turno_id')
    expect(camposProhibidos('pos_orders', MESERO, JSON.stringify({ client_id: 'otro-restaurante' }))).toContain('client_id')
  })
})

describe('lo que un mesero SÍ tiene que poder hacer sigue pasando', () => {
  it('cocina marca los renglones', () => {
    expect(camposProhibidos('pos_orders', MESERO, JSON.stringify({ kds_item_status: '{"1":"lista"}' }))).toEqual([])
  })

  it('se reasigna el mesero de la orden', () => {
    expect(camposProhibidos('pos_orders', MESERO, JSON.stringify({ mesero: 'Ana' }))).toEqual([])
  })

  it('una columna nueva requiere un permiso explícito antes de escribirse por el proxy', () => {
    // Una columna nueva puede modificar autoridad o contabilidad. Los cambios de
    // cuenta pasan por su operación autenticada; el proxy sólo admite sus campos explícitos.
    expect(camposProhibidos('pos_orders', MESERO, JSON.stringify({ notas_de_alergia: 'sin nuez' }))).toEqual(['notas_de_alergia'])
  })

  it('las tablas sin cifras de dinero no se filtran', () => {
    expect(camposProhibidos('pos_mesas', MESERO, JSON.stringify({ total: 1 }))).toEqual([])
  })
})

describe('el gerente sí puede', () => {
  it('para los tres roles de mando', () => {
    for (const rol of ['gerente', 'admin', 'dueño']) {
      expect(isManager(rol), `${rol} debería ser mando`).toBe(true)
      expect(camposProhibidos('pos_orders', rol, JSON.stringify({ total: 1 }))).toEqual([])
    }
  })
})

describe('los bordes, que es donde se cuelan', () => {
  it('un cuerpo ilegible NO se deja pasar por las dudas', () => {
    // Si no se puede leer qué escribe, no se puede afirmar que no toca el dinero.
    expect(camposProhibidos('pos_orders', MESERO, '{roto')).toEqual(['(cuerpo ilegible)'])
  })

  it('sin cuerpo no hay nada que prohibir', () => {
    expect(camposProhibidos('pos_orders', MESERO, undefined)).toEqual([])
  })

  it('un rol ausente se trata como mesero, no como gerente', () => {
    // Fallar cerrado: un token sin rol no puede heredar permisos de mando.
    for (const rol of [undefined, null, '', 'desconocido']) {
      expect(camposProhibidos('pos_orders', rol as string, JSON.stringify({ total: 1 }))).toEqual(['total'])
    }
  })
})

describe('las dos puertas están cerradas, no una', () => {
  const raiz = join(__dirname, '..')
  const sinComentarios = (r: string) =>
    readFileSync(join(raiz, r), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // Hay DOS proxies. Gatear uno solo deja la puerta abierta por el otro — que es
  // exactamente como este hueco sobrevivió a la auditoría anterior.
  for (const ruta of ['app/api/pos/db/route.ts', 'app/api/pos/db/[...path]/route.ts']) {
    it(`${ruta} comprueba las columnas`, () => {
      expect(sinComentarios(ruta)).toMatch(/prepararCuerpoProxy\(/)
    })

    it(`${ruta} exige gerente para borrar una orden`, () => {
      expect(sinComentarios(ruta)).toMatch(/MANAGER_ONLY_DELETE/)
    })
  }
})

describe('la lista cubre lo que tiene que cubrir', () => {
  it('los precios del menú son de gerente', () => {
    // Bajarle el precio a un platillo y cobrarlo barato es el mismo robo por otro camino.
    expect(MANAGER_ONLY_WRITE.has('pos_menu_items')).toBe(true)
  })

  it('una orden no se borra: se cancela', () => {
    // Borrarla la saca del arqueo sin dejar rastro; cancelarla queda registrada.
    expect(MANAGER_ONLY_DELETE.has('pos_orders')).toBe(true)
  })

  it('pos_orders sigue siendo escribible por meseros', () => {
    // Si alguien "arregla" esto metiéndola a MANAGER_ONLY_WRITE, el POS deja de funcionar
    // para todo el personal de piso. La protección va por columna, a propósito.
    expect(MANAGER_ONLY_WRITE.has('pos_orders')).toBe(false)
    expect(ALLOW.has('pos_orders')).toBe(true)
  })

  it('toda tabla con columnas protegidas está permitida', () => {
    for (const tabla of Object.keys(CAMPOS_SOLO_DE_GERENTE)) {
      expect(ALLOW.has(tabla), `${tabla} protege columnas pero no está en ALLOW`).toBe(true)
    }
  })
})
