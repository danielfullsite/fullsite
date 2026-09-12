import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// HABIA DOS PUERTAS PARA CANCELAR UN PLATILLO, Y UNA NO PEDIA NADA.
//
// `/api/pos/cancel-item` esta endurecida (PERM-07): exige aprobacion de gerente
// verificada en el servidor y guarda evidencia -- `monto`, `approval_mode`,
// `solicitante_rol`, `ya_enviado_a_cocina`. Su comentario dice que cierra el vector
// de "cancelar un platillo ya servido y quedarse la diferencia".
//
// Las DOS pantallas de cocina (`/pos/cocina` y `/cocina`) no la usaban. Marcaban el
// item y lo guardaban con `/api/pos/save-order`, que es la ruta de guardado
// ORDINARIO: sin aprobacion de gerente y sin evidencia. El registro que dejaban tenia
// solo `{ item, reason }`. Todo el endurecimiento se rodeaba cancelando desde la
// cocina, que es ademas la pantalla que tiene el platillo enfrente.
//
// En `pos_audit_log` de AMALAY: de doce cancelaciones historicas, ONCE traen
// `approval_mode` nulo. No se puede afirmar desde la base cual pantalla las produjo
// --pudieron venir de una version anterior del POS-- pero el hecho comprobado es que
// esta pantalla PODIA producirlas.
//
// Y UNA SEGUNDA COSA, encontrada al converger las puertas: `cancel-item` escribia
// `items` SIN tocar `order_revision`. `r1_save_order` solo escribe cuando
// `order_revision = p_expected_revision` y despues la incrementa (definicion leida en
// produccion). Al no moverla, una terminal con la revision ANTERIOR seguia empatando:
// su siguiente guardado pasaba el filtro y su `items` -- de antes del cancel, sin la
// marca -- pisaba el arreglo entero. El gerente cancelaba, la bitacora lo registraba,
// y el siguiente guardado devolvia el platillo a la cuenta EN SILENCIO.

const limpiar = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ruta = readFileSync(
  join(__dirname, '..', 'app', 'api', 'pos', 'cancel-item', 'route.ts'), 'utf8')
const rutaLimpia = limpiar(ruta)

const KDS = [
  ['pos/cocina', join(__dirname, '..', 'app', 'pos', 'cocina', 'page.tsx')],
  ['cocina', join(__dirname, '..', 'app', 'cocina', 'page.tsx')],
] as const

describe.each(KDS)('el KDS %s cancela por la puerta auditada', (_nombre, archivo) => {
  const src = limpiar(readFileSync(archivo, 'utf8'))
  // La ventana del handler de cancelacion, para no confundirse con otros fetch.
  const handler = src.slice(src.indexOf('const handleCancelItem'), src.indexOf('const handleCancelItem') + 4000)

  it('llama a /api/pos/cancel-item', () => {
    expect(handler).toMatch(/fetch\('\/api\/pos\/cancel-item'/)
  })

  it('y ya NO guarda la cancelacion por la ruta de guardado ordinario', () => {
    expect(handler).not.toMatch(/fetch\('\/api\/pos\/save-order'/)
  })

  it('manda el token FIRMADO del gerente que acaba de teclear el PIN', () => {
    // `verifyManagerPin` pide `/api/pos/pin` con `manager: true` (filtra rol
    // gerente+ EN EL SERVIDOR) y devuelve un shiftToken. Ya estaba en la mano.
    expect(handler).toMatch(/consumeManagerApproval\(manager\)/)
    expect(handler).toMatch(/approval_token: tokenDelGerente/)
  })

  it('sin token firmado se detiene y pide conexión', () => {
    expect(handler).toMatch(/if \(!tokenDelGerente\)/)
    expect(handler).not.toContain('offline_approved')
  })

  it('viaja con la credencial de la terminal', () => {
    expect(handler).toMatch(/\.\.\.getPOSAuthHeaders\(\)/)
    expect(handler).toMatch(/Authorization: `Bearer \$\{tokenDelGerente\}`/)
  })

  it('un item sin id NO se cancela por el camino viejo: se rechaza', () => {
    // Caer de vuelta a save-order reabriria exactamente lo que se esta cerrando.
    expect(handler).toMatch(/if \(!itemDelCancel\?\.id\)/)
    expect(handler).toMatch(/cancelalo desde el punto de venta/)
  })

  it('manda el motivo, que es lo que la ruta guarda como evidencia', () => {
    expect(handler).toMatch(/reason: cancelReason/)
  })

  it('trata already_applied como exito (la ruta es idempotente)', () => {
    expect(handler).toMatch(/!saveResult\.ok && !saveResult\.already_applied/)
  })
})

describe('una cancelacion es una revision de la orden', () => {
  it('cancel-item lee la revision actual', () => {
    expect(rutaLimpia).toMatch(/select=\*/)
    expect(rutaLimpia).toMatch(/order_revision: revisionActual/)
  })

  it('y la avanza en el MISMO PATCH que escribe los items', () => {
    // En el mismo PATCH para que el filtro de `updated_at` proteja las dos cosas:
    // si otra escritura gano la carrera, no afecta filas y sale 409, como antes.
    const i = rutaLimpia.indexOf('...cancellation.patch')
    expect(i).toBeGreaterThan(-1)
    expect(rutaLimpia.slice(i, i + 400)).toMatch(/order_revision: \(Number\(revisionActual\) \|\| 0\) \+ 1/)
  })

  it('devuelve la revision nueva a quien cancelo', () => {
    expect(rutaLimpia).toContain('revision: patchRows[0].order_revision')
  })

  it('el PATCH sigue protegido por updated_at', () => {
    expect(rutaLimpia).toMatch(/pos_orders\?id=eq\.\$\{order_id\}&updated_at=eq\./)
  })

  it('cero filas sigue siendo conflicto, no exito', () => {
    expect(rutaLimpia).toMatch(/patchRows\.length === 0/)
    expect(rutaLimpia).toMatch(/conflict: true/)
  })
})

describe('el POS adopta la revision que provoco', () => {
  const pos = limpiar(readFileSync(
    join(__dirname, '..', 'app', 'pos', 'page.tsx'), 'utf8'))
  const ventana = (() => {
    const i = pos.indexOf('const handleCancelItem = useCallback')
    return pos.slice(i, pos.indexOf('const handleTransferItem = useCallback', i))
  })()

  it('actualiza orderRevision con lo que devuelve la ruta', () => {
    // Sin esto, el avance que acaba de provocar le choca a el mismo en el proximo
    // guardado: un conflicto nuevo en CADA cancelacion.
    expect(ventana).toMatch(/setOrderRevision\(result\.revision\)/)
  })

  it('espera el recibo antes de marcar cancelado y no revierte inventario especulativamente', () => {
    expect(ventana.indexOf('await confirmarCancelacionItem')).toBeLessThan(ventana.indexOf('setCancelledItems'))
    expect(ventana).not.toContain('reverseIngredientDeduction(')
  })
})

describe('lo que la puerta auditada exige y la otra no exigia', () => {
  it('aprobacion de gerente verificada server-side', () => {
    expect(rutaLimpia).toMatch(/verifyShiftToken\(approval_token\)/)
    expect(rutaLimpia).toMatch(/ROLE_LVL\[p\.rol\] \|\| 0\) >= 4/)
  })

  it('el actor sale del token, no del cuerpo', () => {
    expect(rutaLimpia).toMatch(/actor: auth\.staffName \|\| auth\.staffId/)
  })

  it('guarda el monto del platillo cancelado', () => {
    expect(rutaLimpia).toMatch(/monto: Number\(targetItem\.subtotal\)/)
  })

  it('y si ya lo habia mandado la cocina', () => {
    // Es lo que distingue un error de captura de una cancelacion despues de servir.
    expect(rutaLimpia).toMatch(/ya_enviado_a_cocina: Number\(targetItem\.sent_quantity\) > 0/)
  })

  it('un rol bajo sin token queda bloqueado antes de tocar la orden', () => {
    expect(rutaLimpia).toMatch(/requesterLevel >= 4/)
    expect(rutaLimpia).toMatch(/MANAGER_APPROVAL_REQUIRED/)
    expect(rutaLimpia).not.toContain('offline_device_trust')
  })
})
