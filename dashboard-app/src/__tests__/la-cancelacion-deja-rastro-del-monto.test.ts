import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// CANCELAR RENGLONES ANTES DE COBRAR APAGABA EL UNICO DETECTOR VIVO.
//
// El guion, de la caceria del 2026-09-08:
//
//   1. Mesa de 4, cuenta $2,320. El mesero imprime y cobra $2,320 en EFECTIVO.
//   2. Con la cuenta todavia abierta, cancela dos platos fuertes YA COMIDOS de $400
//      cada uno, motivo "error de captura". El dialogo pide PIN de gerente -- que en
//      AMALAY son 4 digitos y se teclean a la vista.
//   3. El POS recalcula: el total baja a $1,392.
//   4. Cobra $1,392. El cajon abre, el ticket sale por $1,392.
//   5. Se embolsa $928.
//
// POR QUE NO SE VEIA. El `cancelled: true` SI se guarda en `items`... hasta que se
// cobra: handlePayment manda `items: payingItems`, que excluye los cancelados, y
// `r1_save_order` hace `items = coalesce(p_items, items)`. El renglon desaparece del
// ticket. El detector de skimming de save-order recomputa el total desde los items que
// recibio -- exactamente los que se cobraron -- asi que la resta da cero y
// `skimming_suspect` no se escribe nunca.
//
// El unico rastro quedaba en pos_audit_log, y ese rastro NO TRAIA EL MONTO: decia que
// se cancelo un platillo, no cuanto dinero se fue. Sin monto no hay deteccion posible.
//
// POR QUE NO SE PERSISTEN LOS CANCELADOS EN `items`, que era el arreglo obvio: rompe
// tres consumidores a la vez -- el corte suma platillos desde `items`
// (corte/page.tsx:369-373), la vista ops_daily_desde_pos los explota para
// `platillos_top`, y r1_reconcile_order los volveria a descontar del inventario despues
// de que reverseIngredientDeduction ya los revirtio. El log es el lugar correcto.

const ruta = readFileSync(
  join(__dirname, '..', 'app', 'api', 'pos', 'cancel-item', 'route.ts'), 'utf8',
)
const codigo = ruta.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const migracion = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'PENDIENTE_20260912170000_cancel_item_atomico.sql'),
  'utf8',
)

describe('la bitacora registra cuanto dinero se cancelo', () => {
  it('guarda el monto del renglon', () => {
    expect(codigo).toMatch(/monto: Number\(targetItem\.subtotal\)/)
  })

  it('y la cantidad', () => {
    expect(codigo).toMatch(/cantidad: Number\(targetItem\.cantidad\)/)
  })

  it('distingue un error de captura de una cancelacion despues de servir', () => {
    // Es la diferencia entre "me equivoque al capturar" y "cancele comida que el
    // cliente ya se comio". Sin esto, las dos se ven igual en el log.
    expect(codigo).toMatch(/ya_enviado_a_cocina: Number\(targetItem\.sent_quantity\) > 0/)
  })

  it('el monto se captura al CANCELAR, no al cobrar', () => {
    // Si se intentara leer despues del cobro ya no existiria: el cobro sobreescribe
    // `items` sin los cancelados. Esto ancla que la escritura del log viva en esta
    // ruta y no en save-order.
    expect(codigo).toMatch(/targetItem/)
    expect(codigo).toMatch(/r1_cancel_item_atomic/)
    expect(codigo).toMatch(/p_details: details/)
    expect(migracion).toMatch(/insert into public\.pos_audit_log/)
  })
})

describe('lo que NO se toco, a proposito', () => {
  it('los renglones cancelados siguen SIN persistirse en items', () => {
    // Persistirlos rompe el corte, platillos_top y la reconciliacion de inventario.
    // Si alguien lo cambia, esta prueba se pone roja y el comentario explica por que.
    expect(codigo).toContain('prepararCancelacionItem(order, item_id, { prepared, voided, reason })')
    expect(readFileSync(join(__dirname, '..', 'lib', 'cancelacion-item.ts'), 'utf8')).toMatch(/\{ \.\.\.i, cancelled: true,/)
    expect(codigo).not.toMatch(/payingItems/)
  })

  it('la guarda de concurrencia sigue en su lugar', () => {
    expect(codigo).toMatch(/p_expected_updated_at: updatedAt/)
    expect(codigo).toMatch(/p_expected_revision: Number\(revisionActual\) \|\| 0/)
    expect(migracion).toMatch(/where id=p_order_id and client_id=p_client_id for update/)
    expect(migracion).toMatch(/current_order\.updated_at is distinct from p_expected_updated_at/)
    expect(migracion).toMatch(/current_order\.order_revision,0\) is distinct from p_expected_revision/)
  })

  it('y la idempotencia por operation_id tambien', () => {
    expect(codigo).toMatch(/operation_id/)
  })
})
