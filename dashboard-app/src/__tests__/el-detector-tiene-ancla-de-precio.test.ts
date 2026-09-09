import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// EL DETECTOR COMPARABA DOS CIFRAS QUE ESCRIBE EL MISMO CLIENTE.
//
// `auditarCierreContraLaFila` compara `sum(items[].subtotal)` contra `total`. Esta
// manana se corrigio para que las lea de la FILA y no del cuerpo de la peticion -- pero
// la fila la escribio el POS, asi que las dos cifras siguen viniendo del mismo lado.
//
// Eso detecta el vector comun: bajar el `total` y dejar los renglones. Es el comun
// porque el total es UN campo y los renglones son varios. Pero no detecta al que baja
// los dos a la vez: la resta da cero y todo cuadra.
//
//     items: 1 corte $500      total declarado: $500     ->  diff 0, no dispara
//     items: 1 corte $50       total declarado: $50      ->  diff 0, TAMPOCO dispara
//
// El unico dato que el POS no dicta es el precio de `pos_menu_items`. Ese es el ancla.
//
// MEDIDO ANTES DE ESCRIBIRLO, porque un detector ruidoso ya costo caro dos veces en
// este repo: los quince falsos positivos del IVA en agosto, y las cuentas de split esta
// manana. Sobre los 94 renglones que existen en `pos_orders` de AMALAY (2026-09-09):
//
//     sin menuItemId ....... 0        precio por DEBAJO ..... 0
//     sin fila en el menu .. 0        precio por ARRIBA ..... 0
//
// Cero falsos positivos sobre los datos reales.

const src = readFileSync(join(__dirname, '..', 'app', 'api', 'pos',
  'save-order', 'route.ts'), 'utf8')
const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('el precio se compara contra el catalogo', () => {
  it('lee pos_menu_items acotado por client_id', () => {
    const i = codigo.indexOf('pos_menu_items?client_id=eq.')
    expect(i).toBeGreaterThan(-1)
    expect(codigo.slice(i, i + 260)).toMatch(/select=id,price/)
  })

  it('pide solo los ids de la orden, en UNA consulta', () => {
    // Una consulta por renglon en el camino de cierre es latencia en la caja.
    expect(codigo).toMatch(/id=in\.\(\$\{ids\.map\(encodeURIComponent\)\.join\(','\)\}\)/)
    expect(codigo).toMatch(/\[\.\.\.new Set\(items/)
  })

  it('los renglones cancelados no cuentan', () => {
    const i = codigo.indexOf('const ids = [...new Set(items')
    expect(codigo.slice(i, i + 200)).toMatch(/\.filter\(it => !it\?\.cancelled\)/)
  })
})

describe('conservador por diseno: preferir callar a acusar de mas', () => {
  it('sin catalogo legible NO se acusa', () => {
    // Mismo principio que con la tasa de IVA: un fallo de lectura no es evidencia.
    expect(codigo).toMatch(/if \(cat\.ok\)/)
  })

  it('un renglon que no esta en el catalogo se salta', () => {
    // Producto abierto o item viejo: no hay contra que compararlo.
    expect(codigo).toMatch(/if \(delMenu === undefined \|\| !\(delMenu > 0\)\) continue/)
  })

  it('solo se marca por DEBAJO del 90% del precio de menu', () => {
    // Un precio de menu que subio despues de cobrada la orden se ve igual que uno
    // editado a la baja: no hay historial de precios. El 90% deja pasar una
    // actualizacion normal y atrapa partir un precio a la mitad.
    expect(codigo).toMatch(/if \(cobrado >= delMenu \* 0\.9\) continue/)
  })

  it('un precio POR ARRIBA del menu nunca se marca', () => {
    // Cobrar de mas no es este vector, y marcarlo duplicaria los falsos positivos.
    // La unica comparacion es `cobrado >= delMenu * 0.9 -> continue`, asi que todo lo
    // que este arriba sale por ahi.
    expect(codigo).not.toMatch(/cobrado > delMenu/)
  })

  it('exige un faltante material, no cualquier centavo', () => {
    expect(codigo).toMatch(/if \(faltantePorPrecio > 100 && renglonesEditados\.length > 0\)/)
  })

  it('el ancla nunca rompe la deteccion que ya existia', () => {
    // Va en su propio try: si el catalogo truena, la comparacion suma-contra-total
    // sigue corriendo.
    const i = codigo.indexOf('let faltantePorPrecio = 0')
    const j = codigo.indexOf('const diff = expectedTotal - declaredTotal')
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    expect(codigo.slice(i, j)).toMatch(/\} catch \{ [^}]*\}/)
  })

  it('y NUNCA bloquea el guardado', () => {
    // Toda la funcion vive dentro de un try cuyo catch se traga cualquier error.
    // Cobrar no se puede caer porque el detector tenga un mal dia.
    //
    // La intencion se comprueba en el FUENTE (el comentario) y la estructura en el
    // CODIGO sin comentarios: la primera version de esta prueba buscaba el texto del
    // comentario dentro del codigo ya limpiado y fallaba por eso, no por el producto.
    expect(src).toMatch(/NUNCA bloquea ni rompe el guardado/)
    const cuerpo = codigo.slice(
      codigo.indexOf('async function auditarCierreContraLaFila'),
      codigo.indexOf('export async function POST'))
    expect(cuerpo).toMatch(/^\s*try \{/m)
    expect(cuerpo.trimEnd()).toMatch(/\} catch \{\s*\}\s*\}$/)
  })
})

describe('es un vector distinto y se registra aparte', () => {
  it('accion propia: price_edit_suspect', () => {
    expect(codigo).toMatch(/action: 'price_edit_suspect'/)
  })

  it('no se mezcla con skimming_suspect', () => {
    // Mezclarlos impediria medir cual esta ocurriendo, y el agente agrupa por accion.
    const i = codigo.indexOf("action: 'price_edit_suspect'")
    const j = codigo.indexOf("action: 'skimming_suspect'")
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(-1)
    expect(i).not.toBe(j)
  })

  it('guarda el renglon con los dos precios, no solo el total', () => {
    // Sin el detalle, quien revisa no puede saber que platillo mirar.
    expect(codigo).toMatch(/menu_item_id: id, precio_cobrado: cobrado, precio_menu: delMenu, cantidad,/)
  })

  it('el actor sale del token firmado, no del cuerpo', () => {
    const i = codigo.indexOf("action: 'price_edit_suspect'")
    expect(codigo.slice(i, i + 200)).toMatch(/actor: o\.actor/)
  })

  it('deja escrito el umbral con el que se marco', () => {
    // Si manana se afloja o se aprieta, los eventos viejos siguen siendo interpretables.
    expect(codigo).toMatch(/umbral_pct: 0\.9/)
  })
})

describe('el agente lo lee — si no, es otra deteccion muda', () => {
  const agente = readFileSync(join(__dirname, '..', '..', '..',
    '.github', 'scripts', 'antifraud_agent.py'), 'utf8')

  it('consulta la accion nueva', () => {
    expect(agente).toMatch(/"action": "eq\.price_edit_suspect"/)
  })

  it('la reporta agrupada por mesero', () => {
    expect(agente).toMatch(/def analyze_precios_editados/)
    expect(agente).toMatch(/"type": "precio_editado"/)
  })

  it('entra en el reporte y pesa en el score', () => {
    expect(agente).toMatch(/all_findings\.extend\(precio_findings\)/)
    expect(agente).toMatch(/"precio_editado": 30,/)
  })

  it('y un solo hallazgo basta para que el agente no se salte por falta de datos', () => {
    expect(agente).toMatch(/not aprobacion_findings and not precio_findings/)
  })
})
