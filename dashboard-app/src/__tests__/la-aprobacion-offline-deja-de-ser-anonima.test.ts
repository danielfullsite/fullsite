import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyManagerApproval, apruebaSospechosa } from '@/lib/manager-approval'

// `offline_approved: true` ERA UNA LLAVE UNIVERSAL.
//
// Encontrado el 2026-09-08 por la cacería de bugs de dinero. Un mesero, con su propio
// shift token de 8 horas, manda:
//
//     POST /api/pos/reopen-order
//     Authorization: Bearer <su token de MESERO>
//     { "order_id": "<ticket ya cobrado>", "offline_approved": true, "manager": "Eduardo" }
//
// y el servidor responde 200. La cuenta pagada vuelve a 'enviada', closed_at a null. El
// corte deja de contarla, "Esperado en caja" baja por ese monto, y el efectivo sobrante
// se lo lleva quien lo hizo. El Z cuadra al centavo.
//
// Ninguna de las dos rutas miraba `auth.role` en ningún momento, y prender
// POS_APPROVAL_STRICT no cerraba nada: ese check vive en el `else if` de abajo, así que
// la rama offline lo esquiva por ORDEN DE EVALUACIÓN. La bandera sólo bloquea a quien no
// manda ningún campo — y agregar `offline_approved: true` es un renglón de JSON.
//
// Y quedaba firmado por otro: el actor del log salía de `manager` (reopen) y de `mesero`
// (cancel), campos que pone el cliente. La bitácora acusaba al gerente.
//
// ── POR QUÉ ESTO NO BLOQUEA ─────────────────────────────────────────────────
//
// Lo obvio sería exigir rol de gerente en la sesión. Rompe el caso REAL: el gerente
// teclea su PIN en la terminal DEL MESERO, y la sesión sigue siendo del mesero. Sin red
// no hay token firmado, así que ese camino legítimo daría 403 — y un 403 en el replay de
// la cola se clasifica TERMINAL_NON_RETRYABLE (pos-offline-db.ts:821): el item se marca
// terminal y no se reintenta jamás. Cada cancelación hecha sin internet se perdería en
// silencio, la terminal la mostraría cancelada y el servidor la seguiría cobrando.
//
// Lo que se hace hoy es quitarle el anonimato, que es lo que lo hacía invisible.

const CLIENTE = 'amalay'

beforeEach(() => { vi.stubEnv('POS_APPROVAL_STRICT', '') })
afterEach(() => { vi.unstubAllEnvs() })

describe('el modo de aprobación dice QUIÉN pidió', () => {
  it('un mesero autoaprobándose queda marcado como tal', async () => {
    const r = await verifyManagerApproval({
      offlineApproved: true, clientId: CLIENTE, solicitanteRol: 'mesero',
    })
    expect(r.ok).toBe(true)                    // no se bloquea: rompería el offline
    expect(r.mode).toBe('offline_device_trust:mesero')
    expect(apruebaSospechosa(r)).toBe(true)    // pero se marca para que alguien lo mire
  })

  it('y un gerente aprobando en su terminal, no', async () => {
    const r = await verifyManagerApproval({
      offlineApproved: true, clientId: CLIENTE, solicitanteRol: 'gerente',
    })
    expect(r.mode).toBe('offline_device_trust:gerente')
    expect(apruebaSospechosa(r)).toBe(false)
  })

  it('los dos casos ya NO se ven iguales — que era el defecto', async () => {
    const mesero = await verifyManagerApproval({ offlineApproved: true, clientId: CLIENTE, solicitanteRol: 'mesero' })
    const gerente = await verifyManagerApproval({ offlineApproved: true, clientId: CLIENTE, solicitanteRol: 'gerente' })
    expect(mesero.mode).not.toBe(gerente.mode)
  })

  it('sin rol no se finge que se sabe', async () => {
    const r = await verifyManagerApproval({ offlineApproved: true, clientId: CLIENTE })
    expect(r.mode).toBe('offline_device_trust:desconocido')
    expect(apruebaSospechosa(r)).toBe(true)
  })

  it('cajero y capitán tampoco alcanzan el nivel de gerente', async () => {
    for (const rol of ['cajero', 'capitan']) {
      const r = await verifyManagerApproval({ offlineApproved: true, clientId: CLIENTE, solicitanteRol: rol })
      expect(apruebaSospechosa(r), `${rol} debería marcarse`).toBe(true)
    }
  })

  it('admin sí', async () => {
    const r = await verifyManagerApproval({ offlineApproved: true, clientId: CLIENTE, solicitanteRol: 'admin' })
    expect(apruebaSospechosa(r)).toBe(false)
  })
})

describe('lo que NO se puede romper: el POS sin internet', () => {
  it('la aprobación offline SIGUE pasando, venga de quien venga', async () => {
    // Ésta es la prueba que impide el arreglo ingenuo. Si alguien decide bloquear por
    // rol, se pone roja y el comentario de arriba explica por qué no se hizo.
    for (const rol of ['mesero', 'cajero', 'capitan', 'gerente', 'admin']) {
      const r = await verifyManagerApproval({ offlineApproved: true, clientId: CLIENTE, solicitanteRol: rol })
      expect(r.ok, `${rol} debe poder operar sin WAN`).toBe(true)
    }
  })

  it('y sin aprobación de ningún tipo sigue el rollout en dos fases', async () => {
    const grace = await verifyManagerApproval({ clientId: CLIENTE, solicitanteRol: 'mesero' })
    expect(grace).toMatchObject({ ok: true, mode: 'legacy_no_approval' })

    vi.stubEnv('POS_APPROVAL_STRICT', 'true')
    const strict = await verifyManagerApproval({ clientId: CLIENTE, solicitanteRol: 'mesero' })
    expect(strict).toMatchObject({ ok: false, mode: 'blocked' })
  })

  it('el token firmado online sigue ganando y no se marca', async () => {
    // El camino bueno no debe ensuciarse: si hubo token de gerente, `apruebaSospechosa`
    // tiene que ser falsa aunque quien pida sea un mesero.
    expect(apruebaSospechosa({ mode: 'online:gerente', solicitanteNivel: 1 })).toBe(false)
  })
})

describe('la bitácora ya no la dicta el cliente', () => {
  const lee = (r: string) =>
    readFileSync(join(__dirname, '..', 'app', 'api', 'pos', r, 'route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('reopen-order: el actor sale del token', () => {
    const src = lee('reopen-order')
    expect(src).toMatch(/actor: auth\.staffName/)
    expect(src).not.toMatch(/actor: \(typeof manager === 'string' && manager\)/)
  })

  it('cancel-item: el actor sale del token, no del `mesero` del cuerpo', () => {
    const src = lee('cancel-item')
    expect(src).toMatch(/actor: auth\.staffName/)
    expect(src).not.toMatch(/actor: mesero \|\| 'POS'/)
  })

  it('lo que el cliente afirma se guarda como afirmación, no como hecho', () => {
    for (const ruta of ['reopen-order', 'cancel-item']) {
      expect(lee(ruta), ruta).toMatch(/manager_declarado/)
    }
  })

  it('y las dos rutas registran el rol real y marcan lo que hay que revisar', () => {
    for (const ruta of ['reopen-order', 'cancel-item']) {
      expect(lee(ruta), ruta).toMatch(/solicitante_rol: auth\.role/)
      expect(lee(ruta), ruta).toMatch(/revisar:/)
    }
  })

  it('reopen-order le pasa el rol a la política', () => {
    expect(lee('reopen-order')).toMatch(/solicitanteRol: auth\.role/)
  })

  it('cancel-item, que tiene su propia copia, también pega el rol al modo', () => {
    expect(lee('cancel-item')).toMatch(/offline_device_trust:\$\{auth\.role/)
  })
})
