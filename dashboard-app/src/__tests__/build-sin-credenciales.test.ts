// El build no puede necesitar credenciales de tiempo de ejecución.
//
// Next evalúa los módulos durante el build (al recolectar los datos de página) y
// renderiza las páginas en el servidor para prerenderizarlas. Cualquier cliente de
// Supabase construido en esos dos momentos revienta el build cuando las variables no
// están — que es exactamente la situación de un preview de rama.
//
// Así se veía roto: TODOS los previews de Vercel fallaban, de todas las ramas y de
// todos los PR, con dos errores distintos según qué worker llegara primero:
//
//   Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required
//     → AuthContext hacía `useMemo(() => createClient(), [])`, y el cuerpo de un
//       useMemo SÍ corre en el render del servidor. AuthProvider vive en el layout
//       raíz, así que tronaban las 262 páginas; /acceso sólo fue la primera.
//
//   Error: supabaseUrl is required.
//     → api/onboarding y usePosRealtime construían el cliente en scope de módulo.
//
// El costo real no fue el build: fue que el check de Vercel quedó en rojo permanente
// para todo el mundo, y un check que siempre está rojo no informa nada — entrena a
// mergear pasando por encima de rojo.
//
// Contrapeso: que el build ya no truene NO significa que dé igual. Las NEXT_PUBLIC_*
// se inlinean en el bundle del navegador en tiempo de build, así que un build de
// producción sin ellas queda roto de forma permanente. Eso ahora lo atrapa un guardián
// explícito en next.config.ts, que sólo aplica cuando VERCEL_ENV === 'production'.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(process.cwd(), 'src')

function fuentes(dir: string): string[] {
  const salida: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      salida.push(...fuentes(p))
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      salida.push(p)
    }
  }
  return salida
}

const ARCHIVOS = fuentes(SRC).map(p => ({ ruta: relative(SRC, p), texto: readFileSync(p, 'utf8') }))

/** `const x = createClient(` / `let x = createClient(` sin indentar = scope de módulo. */
const EN_SCOPE_DE_MODULO = /^(?:export\s+)?(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*createClient\s*\(/m

describe('el build no necesita credenciales de tiempo de ejecución', () => {
  it('el barrido encuentra archivos (si falla, cambió la ruta base)', () => {
    expect(ARCHIVOS.length).toBeGreaterThan(200)
  })

  it('nadie construye un cliente de Supabase en scope de módulo', () => {
    const culpables = ARCHIVOS
      .filter(a => a.texto.includes('@supabase/supabase-js'))
      .filter(a => EN_SCOPE_DE_MODULO.test(a.texto))
      .map(a => a.ruta)

    expect(culpables, [
      '',
      'Estos archivos construyen el cliente al evaluarse el módulo:',
      ...culpables.map(r => `  · src/${r}`),
      '',
      'Next evalúa los módulos durante el build, cuando las variables no existen.',
      'Envuélvelo en una función perezosa:',
      '',
      '  let _sb: SupabaseClient | null = null',
      '  function getSupabase() {',
      '    if (!_sb) _sb = createClient(url, key)',
      '    return _sb',
      '  }',
      '',
    ].join('\n')).toEqual([])
  })

  it('supabase-browser devuelve el Proxy perezoso, no un cliente ya construido', () => {
    // Si alguien lo "simplifica" de vuelta a `return getSupabase()`, los dos
    // useMemo(() => createClient(), []) vuelven a construir en el render del servidor
    // y se cae el prerender de las 262 páginas otra vez.
    const fuente = ARCHIVOS.find(a => a.ruta === join('lib', 'supabase-browser.ts'))!
    expect(fuente).toBeDefined()
    expect(fuente.texto).toMatch(/import\s*\{\s*supabase\s*\}\s*from\s*'\.\/supabase'/)
    expect(fuente.texto).not.toMatch(/return\s+getSupabase\s*\(\s*\)/)
  })

  it('el export `supabase` sigue siendo perezoso', () => {
    const fuente = ARCHIVOS.find(a => a.ruta === join('lib', 'supabase.ts'))!
    expect(fuente.texto).toMatch(/export const supabase = new Proxy/)
  })

  it('next.config exige las variables en producción', () => {
    // El chequeo dejó de ser un efecto secundario del prerender; ahora es explícito.
    // Si desaparece, un deploy de producción sin variables embarca un bundle roto en
    // silencio, y eso no se arregla poniendo las variables después: hay que recompilar.
    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8')
    expect(config).toMatch(/VERCEL_ENV\s*===\s*'production'/)
    expect(config).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })
})
