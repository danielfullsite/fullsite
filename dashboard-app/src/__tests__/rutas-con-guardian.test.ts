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
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { GUARDIANES, RUTAS_PUBLICAS } from '@/lib/seguridad/guardianes-api'

const RAIZ_API = join(process.cwd(), 'src', 'app', 'api')

/** Un handler HTTP exportado y el texto de su cuerpo. */
interface Handler {
  ruta: string   // '/agents/events'
  metodo: string // 'GET'
  llave: string  // 'GET /agents/events'
  cuerpo: string
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

const RE_HANDLER = /export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/g
const RE_AYUDANTE = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\()/g

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
    const marcas = [...fuente.matchAll(RE_HANDLER)]

    for (let i = 0; i < marcas.length; i++) {
      const inicio = marcas[i].index ?? 0
      const fin = i + 1 < marcas.length ? marcas[i + 1].index : fuente.length
      const metodo = marcas[i][1]
      handlers.push({ ruta, metodo, llave: `${metodo} ${ruta}`, cuerpo: fuente.slice(inicio, fin) })
    }
  }
  return handlers
}

/** Guardianes efectivos por archivo, cacheados por ruta. */
const efectivosPorRuta = new Map<string, string[]>()
function guardianesDe(ruta: string): string[] {
  if (!efectivosPorRuta.has(ruta)) {
    const archivo = join(RAIZ_API, ruta.slice(1), 'route.ts')
    efectivosPorRuta.set(ruta, guardianesEfectivos(readFileSync(archivo, 'utf8')))
  }
  return efectivosPorRuta.get(ruta)!
}

const HANDLERS = recolectarHandlers()
const tieneGuardian = (h: Handler) => guardianesDe(h.ruta).some(g => h.cuerpo.includes(g))

describe('toda ruta de API tiene guardián o está declarada pública', () => {
  it('el barrido encuentra las rutas (si esto falla, la ruta base cambió)', () => {
    expect(HANDLERS.length).toBeGreaterThan(80)
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
    ]
    const sinSesion = CRITICAS.filter(llave => {
      const h = HANDLERS.find(x => x.llave === llave)
      if (!h) return false // cubierto por la prueba de entradas muertas
      return !['requireTenant', 'withPOSAuth'].some(g => h.cuerpo.includes(g))
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
