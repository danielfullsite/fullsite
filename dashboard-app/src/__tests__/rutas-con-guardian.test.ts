// Ninguna ruta de API puede quedar abierta a internet sin que alguien lo declare.
//
// Esta prueba existe porque el mismo hueco apareció tres veces en un día:
//   · /api/integrations/uber-eats/{menu,store}  — se podía reemplazar el menú de un
//     restaurante en Uber Eats, marcar sus platillos agotados o pausar su tienda, sin
//     credenciales. Un POST sin cabecera devolvía 400 de validación, no 401.
//   · /api/agents/{events,metrics}  — un `?client_id=` en la barra de direcciones leía
//     las alertas de cualquier restaurante.
//   · /api/agents/{ack,outcome}/[id]  — se podían calificar como falso positivo las
//     alertas de un restaurante ajeno, corrompiendo su número de precisión.
//
// Las tres tienen la misma forma: el handler consulta con SUPABASE_SERVICE_KEY, que
// ignora RLS por diseño. Cuando la capa de datos no puede protegerte, el handler es el
// único lugar donde se decide quién eres — y ahí no había nadie preguntando.
//
// El barrido resuelve guardianes TRANSITIVAMENTE. Sin eso da falsos positivos: en
// /api/pos/db los cuatro handlers son `return handle(request, 'GET')` y el withPOSAuth
// vive dentro de `handle`. Marcar esa ruta como abierta habría sido ruido, y el ruido
// es cómo mueren estas pruebas.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { GUARDIANES, RUTAS_PUBLICAS } from '@/lib/seguridad/guardianes-api'

const RAIZ_API = join(process.cwd(), 'src', 'app', 'api')
const RAIZ_SRC = join(process.cwd(), 'src')
const METODO_HTTP = /^(GET|POST|PUT|PATCH|DELETE)$/

/** Un handler HTTP exportado y el texto de su cuerpo. */
interface Handler {
  ruta: string   // '/agents/events'
  metodo: string // 'GET'
  llave: string  // 'GET /agents/events'
  cuerpo: string
  archivo: string // implementación real; puede vivir fuera de route.ts por re-export
}

function archivosDeRuta(dir: string): string[] {
  const salida: string[] = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entrada.name)
    if (entrada.isDirectory()) salida.push(...archivosDeRuta(p))
    else if (entrada.name === 'route.ts') salida.push(p)
  }
  return salida.sort()
}

const RE_HANDLER = /(?:^|\n)\s*export\s+(?:async\s+)?(?:function\s+|const\s+)(\w+)\b/g
const RE_REEXPORT = /(?:^|\n)\s*export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g
const RE_AYUDANTE = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\()/g

interface DeclaracionExportada {
  nombre: string
  cuerpo: string
}

interface Reexport {
  importado: string
  exportado: string
  modulo: string
}

function declaracionesExportadas(fuente: string): DeclaracionExportada[] {
  const marcas = [...fuente.matchAll(RE_HANDLER)]
  return marcas.map((marca, indice) => {
    const inicio = marca.index ?? 0
    const fin = indice + 1 < marcas.length ? marcas[indice + 1].index : fuente.length
    return { nombre: marca[1], cuerpo: fuente.slice(inicio, fin) }
  })
}

function reexports(fuente: string): Reexport[] {
  const salida: Reexport[] = []
  for (const marca of fuente.matchAll(RE_REEXPORT)) {
    for (const entrada of marca[1].split(',')) {
      const limpia = entrada.trim()
      if (!limpia || limpia.startsWith('type ')) continue
      const partes = limpia.split(/\s+as\s+/)
      salida.push({
        importado: partes[0],
        exportado: partes[1] ?? partes[0],
        modulo: marca[2],
      })
    }
  }
  return salida
}

function resolverModulo(desde: string, modulo: string): string {
  const base = modulo.startsWith('@/')
    ? join(RAIZ_SRC, modulo.slice(2))
    : resolve(dirname(desde), modulo)
  const candidatos = [`${base}.ts`, `${base}.tsx`, base, join(base, 'index.ts'), join(base, 'index.tsx')]
  const encontrado = candidatos.find(candidato => existsSync(candidato) && statSync(candidato).isFile())
  if (!encontrado) throw new Error(`No se pudo resolver el re-export ${modulo} desde ${desde}`)
  return encontrado
}

/**
 * Sigue un export HTTP hasta la declaración que realmente lo implementa. Fallar al
 * resolver es intencional: ignorar un re-export dejaría una ruta fuera del barrido.
 */
function resolverHandlerExportado(
  archivo: string,
  nombre: string,
  visitados = new Set<string>(),
): { archivo: string; cuerpo: string } {
  const llave = `${archivo}#${nombre}`
  if (visitados.has(llave)) throw new Error(`Ciclo de re-exports al resolver ${llave}`)
  visitados.add(llave)

  const fuente = readFileSync(archivo, 'utf8')
  const declaracion = declaracionesExportadas(fuente).find(item => item.nombre === nombre)
  if (declaracion) return { archivo, cuerpo: declaracion.cuerpo }

  const reexport = reexports(fuente).find(item => item.exportado === nombre)
  if (!reexport) throw new Error(`El handler ${nombre} exportado por ${archivo} no tiene implementación resoluble`)
  return resolverHandlerExportado(
    resolverModulo(archivo, reexport.modulo),
    reexport.importado,
    visitados,
  )
}

/**
 * Guardianes efectivos de un archivo: los registrados, más los ayudantes locales que
 * a su vez invocan a uno. Itera a punto fijo porque un ayudante puede llamar a otro.
 */
function guardianesEfectivos(fuente: string): string[] {
  const efectivos = new Set<string>(GUARDIANES)
  const ayudantes = new Map<string, string>()

  for (const m of fuente.matchAll(RE_AYUDANTE)) {
    const nombre = m[1] || m[2]
    if (!nombre || /^(GET|POST|PUT|PATCH|DELETE)$/.test(nombre)) continue
    // Cuerpo aproximado: del nombre hasta la siguiente declaración de nivel superior.
    const desde = m.index ?? 0
    const siguiente = fuente.slice(desde + m[0].length).search(/\n(?:export\s+)?(?:async\s+)?(?:function|const)\s/)
    ayudantes.set(nombre, fuente.slice(desde, siguiente === -1 ? undefined : desde + m[0].length + siguiente))
  }

  let cambio = true
  while (cambio) {
    cambio = false
    for (const [nombre, cuerpo] of ayudantes) {
      if (efectivos.has(nombre)) continue
      if ([...efectivos].some(g => cuerpo.includes(g))) { efectivos.add(nombre); cambio = true }
    }
  }
  return [...efectivos]
}

function recolectarHandlers(): Handler[] {
  const handlers: Handler[] = []
  for (const archivo of archivosDeRuta(RAIZ_API)) {
    const fuente = readFileSync(archivo, 'utf8')
    const ruta = '/' + relative(RAIZ_API, archivo).replace(/\/route\.ts$/, '').replace(/\\/g, '/')
    const metodos = new Set([
      ...declaracionesExportadas(fuente).map(item => item.nombre),
      ...reexports(fuente).map(item => item.exportado),
    ].filter(nombre => METODO_HTTP.test(nombre)))

    for (const metodo of metodos) {
      const implementacion = resolverHandlerExportado(archivo, metodo)
      handlers.push({
        ruta,
        metodo,
        llave: `${metodo} ${ruta}`,
        cuerpo: implementacion.cuerpo,
        archivo: implementacion.archivo,
      })
    }
  }
  return handlers
}

/** Guardianes efectivos, cacheados por el archivo donde vive la implementación. */
const efectivosPorArchivo = new Map<string, string[]>()
function guardianesDe(archivo: string): string[] {
  if (!efectivosPorArchivo.has(archivo)) {
    efectivosPorArchivo.set(archivo, guardianesEfectivos(readFileSync(archivo, 'utf8')))
  }
  return efectivosPorArchivo.get(archivo)!
}

const HANDLERS = recolectarHandlers()
const tieneGuardian = (h: Handler) => guardianesDe(h.archivo).some(g => h.cuerpo.includes(g))

describe('toda ruta de API tiene guardián o está declarada pública', () => {
  it('el barrido encuentra las rutas (si esto falla, la ruta base cambió)', () => {
    expect(HANDLERS.length).toBeGreaterThan(80)
  })

  it('sigue re-exports HTTP hasta la implementación sin perder sus guardianes', () => {
    const ruta = '/integrations/uber-eats/webhook'
    const get = HANDLERS.find(h => h.llave === `GET ${ruta}`)
    const post = HANDLERS.find(h => h.llave === `POST ${ruta}`)

    expect(get?.archivo).toMatch(/\/lib\/integrations\/uber-eats\/webhook-handler\.ts$/)
    expect(post?.archivo).toBe(get?.archivo)
    expect(tieneGuardian(post!)).toBe(true)
    expect(tieneGuardian(get!)).toBe(false)
  })

  it('ningún handler queda abierto sin declararlo', () => {
    const abiertos = HANDLERS
      .filter(h => !tieneGuardian(h) && !(h.llave in RUTAS_PUBLICAS))
      .map(h => h.llave)

    expect(abiertos, [
      '',
      'Estos handlers no tienen guardián y no están declarados públicos:',
      ...abiertos.map(k => `  · ${k}`),
      '',
      'Elige una:',
      '  1. Ponle un guardián de src/lib/seguridad/guardianes-api.ts.',
      '  2. Si usa un guardián nuevo, regístralo ahí — si no, este barrido no lo ve.',
      '  3. Si de verdad es pública, agrégala a RUTAS_PUBLICAS con la razón.',
      '',
    ].join('\n')).toEqual([])
  })

  it('las rutas que tocan datos de un restaurante resuelven el tenant desde la sesión', () => {
    // Un secreto compartido autentica a la máquina, no dice de qué restaurante es el
    // dato. Estas rutas leen o escriben por client_id, así que necesitan sesión.
    const CRITICAS = [
      'GET /agents/events', 'GET /agents/metrics',
      'POST /agents/ack/[id]', 'POST /agents/outcome/[id]',
      'POST /agents/run', 'POST /coach',
      'GET /dashboard/hourly-distribution',
      // Guardan y borran órdenes. `save-order` nunca acepta el tenant del cuerpo, y los
      // dos proxies llaman a Supabase con service_role — o sea que si el tenant no sale
      // de la sesión, no sale de ningún lado.
      'POST /pos/save-order',
      'GET /pos/db', 'POST /pos/db',
      'GET /pos/db/[...path]', 'POST /pos/db/[...path]',
      'PATCH /pos/db/[...path]', 'DELETE /pos/db/[...path]',
    ]

    // Una llave mal escrita aquí se ignoraba en silencio, y una prueba que no puede
    // ver es peor que no tener prueba. Ahora una entrada muerta falla.
    const inexistentes = CRITICAS.filter(k => !HANDLERS.some(h => h.llave === k))
    expect(inexistentes, `CRITICAS nombra rutas que no existen: ${inexistentes.join(', ')}`).toEqual([])

    const sinSesion = CRITICAS.filter(llave => {
      const h = HANDLERS.find(x => x.llave === llave)!
      // El archivo COMPLETO, no sólo el trozo del handler: en /pos/db los cuatro
      // métodos son `export const GET = handle` y el `withPOSAuth` vive dentro de
      // `handle`. Mirar sólo el trozo da el falso positivo que la cabecera de este
      // archivo ya documenta para el barrido de guardianes.
      const fuente = readFileSync(h.archivo, 'utf8')
      return !['requireTenant', 'withPOSAuth'].some(g => fuente.includes(g))
    })
    expect(sinSesion).toEqual([])
  })

  it('RUTAS_PUBLICAS no acumula excepciones muertas', () => {
    const llaves = new Set(HANDLERS.map(h => h.llave))
    const inexistentes = Object.keys(RUTAS_PUBLICAS).filter(k => !llaves.has(k))
    expect(inexistentes, `Declaradas públicas pero ya no existen: ${inexistentes.join(', ')}`).toEqual([])

    // Si una ruta pública ganó guardián, la excepción sobra — bórrala de la lista.
    const yaProtegidas = Object.keys(RUTAS_PUBLICAS).filter(k => {
      const h = HANDLERS.find(x => x.llave === k)
      return h ? tieneGuardian(h) : false
    })
    expect(yaProtegidas, `Ya tienen guardián; quita la excepción: ${yaProtegidas.join(', ')}`).toEqual([])
  })

  it('cada ruta pública trae una razón de verdad', () => {
    const flojas = Object.entries(RUTAS_PUBLICAS)
      .filter(([, razon]) => razon.trim().length < 25 || /todav|pendiente|TODO|arregl/i.test(razon))
      .map(([k]) => k)
    expect(flojas, `Sin razón real (eso es deuda, va en HUECOS_CONOCIDOS): ${flojas.join(', ')}`).toEqual([])
  })
})
