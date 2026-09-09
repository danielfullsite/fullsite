import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LA SECCION ANTI-FRAUDE DEL CORTE ESTABA ESTRUCTURALMENTE VACIA.
//
// `pos/corte/page.tsx` pedia `getAuditLog(200)` -- los 200 eventos mas recientes de
// TODA la historia, sin filtro de fecha ni de turno -- y de ahi filtraba
// `item_cancelled`/`order_cancelled` para presentarlos como "las cancelaciones de este
// corte". Dos errores encima:
//
//   1. SIN VENTANA. El corte de una fecha vieja mostraba cancelaciones de otros dias,
//      o cero, porque los 200 eventos mas nuevos no contienen nada de esa fecha.
//   2. 200 NO ALCANZA. En AMALAY, con la operacion apenas de prueba, `item_added` ya
//      lleva 788 filas y `order_sent_kitchen` 346 (medido en `pos_audit_log`). Con
//      cien tickets al dia, 200 eventos son como veinte minutos de servicio.
//
// Es justo el numero donde un gerente buscaria una cancelacion despues de servir --
// el mismo vector que `/api/pos/cancel-item` existe para detectar.
//
// Y UN TERCERO, del mismo tipo: las ordenes se pedian con `limit=200` y
// `order=created_at.desc`, o sea que en un dia grande se quedaba con las 200 MAS
// NUEVAS y tiraba el arranque del dia en silencio. AMALAY llego a 141 tickets el
// 2026-07-05, y las ordenes son mas que los tickets.

const limpiar = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const corte = limpiar(readFileSync(
  join(__dirname, '..', 'app', 'pos', 'corte', 'page.tsx'), 'utf8'))
const datos = limpiar(readFileSync(
  join(__dirname, '..', 'lib', 'pos-data.ts'), 'utf8'))

describe('la bitacora se pide con ventana, no "lo ultimo"', () => {
  it('el corte ya no usa getAuditLog sin acotar', () => {
    expect(corte).not.toMatch(/getAuditLog\(200\)/)
  })

  it('modo turno: desde la apertura del turno', () => {
    // `pos_audit_log` no tiene `turno_id`; el turno se acota por tiempo desde que
    // abrio, que es exactamente lo que abarca.
    expect(corte).toMatch(/getAuditLogRange\(turnoActivo\.opened_at, null, ACCIONES_DE_CANCELACION\)/)
  })

  it('modo fecha: el DIA DE VENTA del tenant, no el dia natural', () => {
    const i = corte.indexOf('getAuditLogRange(\n')
    const bloque = corte.slice(corte.indexOf('const a = corteMode'), corte.indexOf('const a = corteMode') + 600)
    expect(i === -1 ? bloque : bloque).toMatch(/zonedStartOfDayISO\(selectedDate\)/)
    expect(bloque).toMatch(/zonedStartOfDayISO\(diaSiguiente\(selectedDate\)\)/)
  })

  it('el filtro de acciones se aplica en el SERVIDOR', () => {
    // Traer todo y filtrar en el navegador es lo que producia la ventana de veinte
    // minutos: el limite se gasta en `item_added`.
    expect(datos).toMatch(/action=in\.\(\$\{actions\.join\(','\)\}\)/)
  })

  it('el rango sin extremo superior queda abierto (turno vivo)', () => {
    expect(datos).toMatch(/hastaISO\s*\n?\s*\?/)
    expect(datos).toMatch(/created_at=gte\.\$\{encodeURIComponent\(desdeISO\)\}`/)
  })

  it('lt en el extremo superior, no lte', () => {
    // Con `lte` sobre el inicio del dia siguiente se cuela un evento de las 00:00:00.
    expect(datos).toMatch(/created_at=lt\.\$\{encodeURIComponent\(hastaISO\)\}/)
  })

  it('y sigue acotado al restaurante', () => {
    const i = datos.indexOf('export async function getAuditLogRange')
    expect(datos.slice(i, i + 1200)).toMatch(/client_id=eq\.\$\{_getClientId\(\)\}/)
  })
})

describe('anular cuenta como cancelacion', () => {
  it('item_voided esta en la lista', () => {
    // El modal del POS ofrece cancelar, cancelar-preparado (merma) y ANULAR. Anular
    // es el unico sin rastro de merma: dejarlo fuera del contador hacia que la opcion
    // con menos rendicion de cuentas fuera tambien la invisible.
    expect(corte).toMatch(/ACCIONES_DE_CANCELACION = \['item_cancelled', 'item_voided', 'order_cancelled'\]/)
  })

  it('el filtro del navegador usa la misma lista, no una copia', () => {
    expect(corte).toMatch(/ACCIONES_DE_CANCELACION as readonly string\[\]\)\.includes\(e\.action\)/)
  })
})

describe('el tope de ordenes deja de ser silencioso', () => {
  it('sube de 200 a 1000', () => {
    expect(corte).toMatch(/const TOPE_DE_ORDENES = 1000/)
    expect(corte).not.toMatch(/order=created_at\.desc&limit=200/)
  })

  it('las dos consultas de ordenes usan el mismo tope', () => {
    const usos = corte.match(/limit=\$\{TOPE_DE_ORDENES\}/g) || []
    expect(usos.length).toBe(2)   // por fecha y por turno
  })

  it('llegar al tope se detecta', () => {
    expect(corte).toMatch(/setCorteTruncado\(o\.length >= TOPE_DE_ORDENES\)/)
  })

  it('y se le dice al operador, no se presenta como total del dia', () => {
    expect(corte).toMatch(/corteTruncado && \(/)
    expect(corte).toMatch(/NO lo tomes como el total del día/)
  })
})

describe('/pos/auditoria se queda como estaba', () => {
  it('ahi "los 200 mas recientes" SI es lo que se quiere', () => {
    // Es un visor de actividad reciente, no un corte. Cambiarlo seria un cambio
    // cosmetico dentro de un fix.
    const auditoria = limpiar(readFileSync(
      join(__dirname, '..', 'app', 'pos', 'auditoria', 'page.tsx'), 'utf8'))
    expect(auditoria).toMatch(/getAuditLog\(200\)/)
  })
})
