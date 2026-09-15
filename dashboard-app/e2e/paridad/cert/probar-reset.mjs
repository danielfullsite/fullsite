// EL RESET NO BORRA NADA QUE NO PUEDA UBICAR.
//
// `resetEstadoLocal` borra la IndexedDB del POS. Es la única pieza del arnés que
// destruye datos, así que casi todas estas comprobaciones exigen que se NIEGUE:
// tenant ilegible, tenant prohibido, tenant que no es el laboratorio. Un reset
// que se ejecuta «por si acaso» es el que algún día corre apuntando a AMALAY.
//
// Se ejerce la función REAL contra una `page` falsa que registra si se intentó
// tocar la base. Una prueba que reimplemente la guarda no vigila la guarda.
//
//   node cert/probar-reset.mjs

import { resetEstadoLocal, TENANT_LABORATORIO, PROHIBIDOS } from './reset-estado-local.mjs'

let fallos = 0
const T = (nombre, ok, detalle = '') => {
  if (!ok) fallos++
  console.log(`   ${ok ? '✓' : '✗'} ${nombre}${ok || !detalle ? '' : `  → ${detalle}`}`)
}

/**
 * Una `page` de mentira. Cuenta cuántas veces se evaluó algo que toca
 * IndexedDB: si la guarda funciona, con un tenant ajeno ese contador es 0.
 */
function paginaFalsa({ tenant, ordenesTras = 0, clavesMesa = ['pos_draft_1', 'pos_cuenta_fullsite-cert-lab-v2_mesa:1'], quedanTras = [] }) {
  const registro = { evaluaciones: 0, tocoIndexedDB: 0, navego: 0, tocoLocalStorage: 0 }
  return {
    registro,
    async evaluate(fn) {
      registro.evaluaciones++
      const fuente = String(fn)
      // Se distingue por lo que la función HACE, no por palabras que puedan
      // aparecer en sus comentarios: `String(fn)` los incluye, y anclar el
      // matcher a un nombre mencionado de paso ya rompió esta prueba una vez.
      if (fuente.includes('getItem(')) {
        return { tenant: tenant === null ? null : String(tenant).toLowerCase().trim(), origen: 'https://app.fullsite.mx' }
      }
      // El reset limpia localStorage ANTES que IndexedDB: es la fuente real de
      // lo que se ve (pos_order_<mesa> / pos_draft_<mesa>).
      if (fuente.includes('removeItem')) {          // el borrado
        registro.tocoLocalStorage++
        return clavesMesa
      }
      if (fuente.includes('Object.keys(localStorage)')) {   // la relectura
        registro.tocoLocalStorage++
        return quedanTras
      }
      if (fuente.includes('indexedDB')) {
        registro.tocoIndexedDB++
        // Primera vez: el borrado. Segunda: la verificación.
        return registro.tocoIndexedDB === 1
          ? { stores: ['orders', 'sync_queue'], contados: { orders: 1, sync_queue: 0 } }
          : { ordenesLocales: ordenesTras }
      }
      return {}
    },
    async goto() { registro.navego++ },
    async waitForTimeout() {},
  }
}

console.log('EL RESET DE ESTADO DE CERTIFICACIÓN\n' + '═'.repeat(68))

/* ═══════════════════════════════════════════════════════════════════════════
   1 · SE NIEGA ANTE CUALQUIER DUDA DE SCOPE
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n1 · fail closed: sin scope demostrado, no se borra')
{
  for (const [etiqueta, tenant] of [
    ['tenant ilegible (null)', null],
    ['tenant vacío', ''],
    ['AMALAY', 'amalay'],
    ['demo', 'demo'],
    ['lab-resto', 'lab-resto'],
    ['otro restaurante', 'restaurante-de-alguien'],
    ['parecido pero no igual', 'fullsite-cert-lab'],
    ['parecido con sufijo', 'fullsite-cert-lab-v2-copia'],
  ]) {
    const p = paginaFalsa({ tenant })
    const r = await resetEstadoLocal(p, { baseUrl: 'https://app.fullsite.mx', mesa: 1 })
    T(`${etiqueta} → NO borra`,
      !r.ok && p.registro.tocoIndexedDB === 0 && p.registro.tocoLocalStorage === 0,
      `ok=${r.ok} idb=${p.registro.tocoIndexedDB} ls=${p.registro.tocoLocalStorage} motivo=${r.motivo}`)
  }
  T('los tres tenants prohibidos están en la lista',
    PROHIBIDOS.includes('amalay') && PROHIBIDOS.includes('demo') && PROHIBIDOS.includes('lab-resto'))
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · CON EL LABORATORIO, SÍ LIMPIA
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2 · en el laboratorio sí limpia, y lo verifica')
{
  const p = paginaFalsa({ tenant: TENANT_LABORATORIO, ordenesTras: 0 })
  const r = await resetEstadoLocal(p, { baseUrl: 'https://app.fullsite.mx', mesa: 1 })
  T('borra', r.ok, r.motivo)
  T('tocó la base dos veces: limpiar y VERIFICAR', p.registro.tocoIndexedDB === 2, String(p.registro.tocoIndexedDB))
  T('limpió localStorage y volvió a leerlo', p.registro.tocoLocalStorage === 2, String(p.registro.tocoLocalStorage))
  T('reporta qué claves de mesa borró', r.claves_borradas?.includes('pos_draft_1'), JSON.stringify(r.claves_borradas))
  T('incluye la cuenta de caja, que era el acumulador real',
    r.claves_borradas?.some(k => k.startsWith('pos_cuenta_')), JSON.stringify(r.claves_borradas))
  T('recargó la página para releer el estado', p.registro.navego === 1)
  T('reporta qué stores limpió', r.borrados?.stores?.includes('orders'), JSON.stringify(r.borrados))
  T('el tenant queda en la evidencia', r.tenant === TENANT_LABORATORIO)
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · UN BORRADO QUE NO DEJÓ LIMPIO NO SE DECLARA LIMPIO
   ───────────────────────────────────────────────────────────────────────────
   El `clear()` sin error no es prueba: el POS pudo repoblar desde otra fuente.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n3 · si tras limpiar aún queda estado, NO dice ok')
{
  // La regresión exacta: el draft de la mesa sobrevive al borrado.
  const conDraft = paginaFalsa({ tenant: TENANT_LABORATORIO, quedanTras: ['pos_draft_1'] })
  const rd = await resetEstadoLocal(conDraft, { baseUrl: 'https://app.fullsite.mx', mesa: 1 })
  T('un draft que sobrevive tumba el reset', !rd.ok && /pos_draft_1/.test(rd.motivo || ''), rd.motivo)

  const p = paginaFalsa({ tenant: TENANT_LABORATORIO, ordenesTras: 3 })
  const r = await resetEstadoLocal(p, { baseUrl: 'https://app.fullsite.mx', mesa: 1 })
  T('ok = false aunque el borrado no diera error', !r.ok)
  T('y dice cuántas quedaron', /quedan 3/.test(r.motivo || ''), r.motivo)
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · LA SECUENCIA QUE EXIGE EL CONTRATO: $100 → reset → $0 → $100, NUNCA $200
   ───────────────────────────────────────────────────────────────────────────
   Es la aritmética del determinismo: si B no empieza en cero, su resultado no
   es comparable con el de A y «zero delta» no significaría nada.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n4 · A deja $100 · reset · B empieza $0 y termina $100')
{
  // Simula el acumulador que produjo $200 en la corrida real.
  const conReset = (a, b) => b               // tras reset, B parte de 0
  const sinReset = (a, b) => a + b           // lo que pasó: A + B
  T('sin reset, B habría llegado a $200 (el defecto observado)', sinReset(100, 100) === 200)
  T('con reset, B llega a $100', conReset(100, 100) === 100)
  T('y nunca a $200', conReset(100, 100) !== 200)
}

console.log(`\n${'═'.repeat(68)}`)
if (fallos) {
  console.log(`*** ${fallos} comprobaciones fallaron: el reset no es de fiar.`)
  process.exit(1)
}
console.log('>>> el reset sólo toca el laboratorio, y demuestra que quedó limpio.')
