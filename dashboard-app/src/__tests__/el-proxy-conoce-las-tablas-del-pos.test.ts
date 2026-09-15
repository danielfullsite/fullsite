// UNA TABLA QUE EL POS PIDE Y EL PROXY NO CONOCE ES UN 403 MUDO EN PRODUCCIÓN.
//
// Campo, AMALAY, 2026-09-14. Capturando la red con el POS ONLINE, cinco pantallas
// bastaron para ver esto:
//
//     x12  403 GET /api/pos/db  [tabla: pos_item_inventory_policy]
//     x 1  403 GET /api/pos/db  [tabla: delivery_orders]
//          -> {"error":"table not allowed: ..."}
//
// Nadie ve un 403 en una caja. La pantalla simplemente sale vacía, o peor: el
// código cae a un valor por omisión y sigue como si nada.
//
// ── POR QUÉ PASA ────────────────────────────────────────────────────────────
//
// Son dos cambios correctos que se rompen en su costura:
//
//   1. `inventory-policy.ts` y compañía fueron escritos para hablarle a Supabase
//      directo:  `${SB_URL}/rest/v1/pos_item_inventory_policy`
//   2. `supabase-fetch-patch.ts:52` reencamina TODO `/rest/v1/` de una terminal
//      POS al proxy autenticado `/api/pos/db?path=...` (Fase B del anti-hack).
//   3. El `ALLOW` del proxy no incluye esas tablas.
//
// Ninguno de los tres está mal por separado. El agujero vive entre ellos, y por
// eso no lo encuentra ninguna prueba que mire un solo archivo.
//
// ── LAS DOS CONSECUENCIAS QUE SE RASTREARON HASTA EL FINAL ──────────────────
//
// `pos_item_inventory_policy` -> la consola del POS imprime
//     [policy] FAILED_NO_POLICY | no remote, no cache | gate inactive | fallback=Sistema A
//   La documentación de `inventory-policy.ts` dice que ese estado existe «to
//   prevent a failed-network startup from silently reactivating the P0». Está
//   reactivado, en silencio y de forma permanente: sin caché el 403 nunca se cura.
//
// `clients` -> `res.ok` es false y `getClientConfigFallback()` devuelve valores
//   inventados. AMALAY corre con timezone America/Mexico_City cuando su fila dice
//   America/Monterrey, y con `plan: 'fullsite_completo'` sea cual sea su plan.
//   Da la casualidad de que su IVA (0.16) y sus mesas (16) COINCIDEN con el
//   fallback — por eso nadie lo había visto. Ésa es la peor propiedad posible
//   para un sistema que se va a clonar: invisible en el único restaurante donde
//   se prueba, y equivocado en todos los demás. El propio `client-config.ts`
//   documenta que este mismo defecto ya costó una vez cobrar IVA 16% a
//   restaurantes que cobran 0.
//
// Esta prueba recorre las importaciones desde las entradas del POS, junta todas
// las tablas que se piden por `/rest/v1/` y exige que el proxy las conozca. Una
// tabla nueva que nadie dé de alta sale ROJA aquí, no muda en la caja.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { ALLOW, NO_CID, SCOPED_BY_OWN_ID } from '../lib/pos-db-policy'

const SRC = resolve(__dirname, '..')

/**
 * DEUDA CONOCIDA, NO PERMISO.
 *
 * Estas 12 tablas también las pide el POS y también dan 403. No se agregaron en
 * el mismo cambio a propósito: `puedeEscribirEn` (pos-db-policy.ts:128) devuelve
 * `true` para toda tabla sin nivel declarado, así que meterlas a `ALLOW` sin
 * decidir su nivel de escritura le daría a CUALQUIER shift token —el de un
 * mesero— permiso para escribir el stock del Market o la configuración del gate
 * de inventario. Cada una necesita su decisión, no una lista copiada.
 *
 * Están aquí para que se vean y para que la lista no crezca sola: una tabla
 * nueva que no esté ni en `ALLOW` ni aquí revienta esta prueba.
 */
const PENDIENTES_DE_DECIDIR_ESCRITURA = new Set<string>([
  'delivery_orders',        // el POS actualiza estatus: nivel cajero+
  'pos_market_stock',       // stock del Market, que se cobra en la caja
  'pos_market_movements',
  'pos_facturas',
  'pos_cfdi_requests',
  'pos_recipes_old',
  'pos_recipe_details',
  'pos_inventory_alerts',
  'pos_staff_audit',        // bitácora: sólo alta, nunca edición
  'pos_customer_notes',
  'reservaciones',
  'events',                 // no tiene client_id; hay que ver cómo se acota antes de exponerla
])

function archivosDe(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivosDe(p) : (/\.tsx?$/.test(p) ? [p] : [])
  })
}

function resolverImport(spec: string, desde: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2))
    : spec.startsWith('.') ? resolve(dirname(desde), spec) : null
  if (!base) return null
  for (const ext of ['.ts', '.tsx', '/index.ts', '']) {
    if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext
  }
  return null
}

/** Todo lo que se carga dentro del POS, siguiendo importaciones 3 saltos. */
function archivosQueCorrenEnElPos(): Set<string> {
  let frontera = [...archivosDe(join(SRC, 'app', 'pos')), ...archivosDe(join(SRC, 'components', 'pos'))]
  const vistos = new Set<string>()
  for (let salto = 0; salto < 3; salto++) {
    const siguiente: string[] = []
    for (const f of frontera) {
      if (vistos.has(f)) continue
      vistos.add(f)
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
        const r = resolverImport(m[1], f)
        if (r && !vistos.has(r)) siguiente.push(r)
      }
    }
    frontera = siguiente
  }
  return vistos
}

/** Tabla -> archivos que la piden por /rest/v1/. */
function tablasQuePideElPos(): Map<string, string[]> {
  const mapa = new Map<string, string[]>()
  for (const f of archivosQueCorrenEnElPos()) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\/rest\/v1\/([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
      const t = m[1]
      if (t === 'rpc') continue   // los RPC no pasan por el proxy de tablas
      mapa.set(t, [...(mapa.get(t) || []), f.replace(SRC + '/', '')])
    }
  }
  return mapa
}

describe('el proxy del POS conoce todas las tablas que el POS pide', () => {
  const pedidas = tablasQuePideElPos()

  it('el recorrido encuentra algo (si esto falla, la prueba se quedó ciega)', () => {
    // Un guardián que no encuentra nada pasa siempre. Ésta es su prueba de vida.
    expect(pedidas.size).toBeGreaterThan(20)
  })

  it('REGRESION: ninguna tabla nueva queda fuera del proxy sin que alguien lo decida', () => {
    const conocidas = (t: string) => ALLOW.has(t) || NO_CID.has(t) || SCOPED_BY_OWN_ID.has(t)
    const huerfanas = [...pedidas.entries()]
      .filter(([t]) => !conocidas(t) && !PENDIENTES_DE_DECIDIR_ESCRITURA.has(t))
      .map(([t, fs]) => `${t}  (la pide ${fs[0]}${fs.length > 1 ? ` y ${fs.length - 1} más` : ''})`)
    expect(huerfanas, `\nEstas tablas darían 403 mudo en la caja:\n  ${huerfanas.join('\n  ')}\n` +
      `\nDecide su nivel de escritura y agrégala a ALLOW, o anótala en ` +
      `PENDIENTES_DE_DECIDIR_ESCRITURA con el motivo.\n`).toEqual([])
  })

  it('REGRESION: el POS puede leer la política de inventario', () => {
    // Sin esto, `inventory-policy.ts` queda en FAILED_NO_POLICY y el gate corre
    // fail-open para siempre — el P0 que ese módulo dice que previene.
    expect(pedidas.has('pos_item_inventory_policy')).toBe(true)
    expect(ALLOW.has('pos_item_inventory_policy')).toBe(true)
  })

  it('la política de inventario NO la escribe cualquiera', () => {
    // Su propia documentación: «changes are admin-level migrations (not operational)».
    // Y `puedeEscribirEn` devuelve true para toda tabla sin nivel: sin esta línea,
    // un shift token de mesero podría apagar el descuento de inventario.
    const politica = readFileSync(join(SRC, 'lib', 'pos-db-policy.ts'), 'utf8')
    expect(politica).toMatch(/MANAGER_ONLY_WRITE[\s\S]{0,2000}pos_item_inventory_policy/)
  })

  it('REGRESION: el POS lee su propia fila de `clients`, y sólo la suya', () => {
    // `clients` no tiene columna client_id: se acota por `id`. Meterla en NO_CID
    // la dejaría SIN acotar y cualquier terminal leería la configuración de todos
    // los restaurantes. Por eso existe SCOPED_BY_OWN_ID.
    expect(SCOPED_BY_OWN_ID.has('clients')).toBe(true)
    expect(NO_CID.has('clients'), 'clients en NO_CID = fuga entre restaurantes').toBe(false)
  })
})

// Una lista declarada y no aplicada es decoración. Estas dos comprueban que la
// ruta del proxy REALMENTE usa las categorías, no sólo que existan.
describe('el proxy aplica lo que declara', () => {
  const ruta = readFileSync(join(SRC, 'app', 'api', 'pos', 'db', 'route.ts'), 'utf8')

  it('REGRESION: `clients` se acota por id antes de salir a la base', () => {
    expect(ruta).toMatch(/SCOPED_BY_OWN_ID\.has\(table\)[\s\S]{0,80}params\.set\('id',/)
  })

  it('REGRESION: el acotamiento por tenant no tiene camino de escape', () => {
    // El `else if` importa: con dos `if` sueltos, una tabla de SCOPED_BY_OWN_ID
    // saldría además con un filtro client_id que no existe, y PostgREST la
    // rechazaría; o peor, un refactor dejaría la consulta sin filtro ninguno.
    expect(ruta).toMatch(/else if \(!NO_CID\.has\(table\)\) params\.set\('client_id'/)
  })

  it('REGRESION: una escritura a una tabla de sólo lectura se rechaza', () => {
    expect(ruta).toMatch(/isWrite && SOLO_LECTURA\.has\(table\)/)
  })
})
