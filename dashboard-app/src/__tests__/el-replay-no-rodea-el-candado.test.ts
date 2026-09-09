import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAMPOS_SOLO_DE_GERENTE } from '@/lib/pos-db-policy'

// LA COLA RODEABA EL CANDADO DE COLUMNAS SI LA MAQUINA TENIA SESION DE DASHBOARD.
//
// El replay elegia transporte asi:
//
//     if (accessToken) { url = `${SUPABASE_URL}/rest/v1/${restPath}` }   // <- ganaba
//     else if (shiftToken) { url = `/api/pos/db?path=...` }
//
// O sea que con JWT de Supabase iba DIRECTO a PostgREST, rodeando `/api/pos/db` y con el
// `camposProhibidos` -- el candado que impide tocar `total`, `pagos`, `status` y demas.
//
// La precondicion se cumple sola: la sesion existe en cuanto ALGUIEN entro una vez al
// dashboard en esa maquina, que es justo lo que se hace para ver el corte. El refresh
// token de Supabase dura semanas.
//
// El vector: abrir DevTools (F12 esta registrado como atajo global en main.js), agregar
// a mano un registro en `sync_queue` con
//     {table:'pos_orders', method:'PATCH', data:{total:1}, transport:'SUPABASE_REST'}
// y esperar menos de 20 segundos a que el intervalo drene solo.
//
// EL ARREGLO: las tablas con candado por columna van SIEMPRE por el proxy, aunque haya
// JWT. No se pierde nada -- `withPOSAuth` sabe autenticar sesiones de Supabase.

const fuente = readFileSync(join(__dirname, '..', 'lib', 'pos-offline-db.ts'), 'utf8')
const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('el replay de las tablas con candado pasa por el proxy', () => {
  it('el JWT ya no gana por si solo', () => {
    // La condicion vieja, exacta. Si vuelve, el vector vuelve con ella.
    expect(codigo).not.toMatch(/if \(accessToken\) \{\s*\n\s*url = `\$\{SUPABASE_URL\}/)
  })

  it('se consulta si la tabla tiene candado de columnas', () => {
    expect(codigo).toMatch(/CAMPOS_SOLO_DE_GERENTE/)
    expect(codigo).toMatch(/conCandadoDeColumnas/)
  })

  it('con candado y JWT, va al proxy', () => {
    expect(codigo).toMatch(/accessToken && conCandadoDeColumnas[\s\S]{0,200}\/api\/pos\/db/)
  })

  it('sin candado, el JWT sigue yendo directo — no se cambia lo que ya funcionaba', () => {
    // Turnos, movimientos de caja y estados de KDS siguen su camino de siempre.
    expect(codigo).toMatch(/accessToken && !conCandadoDeColumnas[\s\S]{0,200}SUPABASE_URL/)
  })

  it('y el shift token sigue yendo por el proxy, como antes', () => {
    expect(codigo).toMatch(/else if \(shiftToken\)[\s\S]{0,200}\/api\/pos\/db/)
  })
})

describe('lo que evita que este arreglo rompa produccion', () => {
  it('manda x-fullsite-tenant al usar el JWT', () => {
    // `withPOSAuth` FALLA CERRADO (401) cuando el usuario tiene varias membresias y no
    // hay header, para no adivinar tenant. Daniel tiene ocho. Sin este header, forzar el
    // proxy desloguearia la caja y la cola dejaria de drenar -- peor que el hueco.
    expect(codigo).toMatch(/x-fullsite-tenant/)
    expect(codigo).toMatch(/tenantDeLaTerminal/)
  })

  it('el tenant sale de la terminal, no del item de la cola', () => {
    // El item lo puede haber escrito cualquiera; `fullsite_client_id` es lo que esta
    // terminal tiene aprovisionado.
    expect(codigo).toMatch(/localStorage\.getItem\('fullsite_client_id'\)/)
  })

  it('y si no hay tenant no se manda un header vacio', () => {
    expect(codigo).toMatch(/tenantDeLaTerminal \? \{ 'x-fullsite-tenant'/)
  })
})

describe('la lista de tablas protegidas es la misma en los dos lados', () => {
  it('pos_orders tiene candado de columnas', () => {
    // Es la unica hoy. Si mañana se agrega otra, el replay la protege sola porque lee
    // la MISMA constante que el proxy — no una copia.
    expect(Object.keys(CAMPOS_SOLO_DE_GERENTE)).toContain('pos_orders')
  })

  it('el replay lee la constante compartida, no una copia', () => {
    expect(fuente).toMatch(/import \{ CAMPOS_SOLO_DE_GERENTE \} from '\.\/pos-db-policy'/)
  })
})

describe('no se filtra al ENCOLAR, y esta escrito por que', () => {
  it('queueOperation no rechaza por campos de dinero', () => {
    // Se intento y se retiro: rompe `saveOrder` (que encola total/status/pagos por
    // APP_API, donde el servidor recalcula) y `updateOrderStatus` (que encola `status`
    // y es como el KDS mueve una comanda sin red).
    const i = codigo.indexOf('export async function queueOperation')
    const cuerpo = codigo.slice(i, codigo.indexOf('export ', i + 40))
    expect(cuerpo).not.toMatch(/camposProhibidos\(/)
    expect(cuerpo).not.toMatch(/OPERACION_NO_ENCOLABLE/)
  })

  it('y la razon queda en el archivo para que nadie lo reintente a ciegas', () => {
    expect(fuente).toMatch(/POR QUÉ NO SE FILTRA AQUÍ POR CAMPOS DE DINERO/)
    expect(fuente).toMatch(/updateOrderStatus/)
  })
})
