// UN HOOK QUE NADIE MONTA NO DRENA NADA.
//
// Campo, AMALAY, 2026-09-14. Se abrió turno en la terminal con internet:
//
//   · la pantalla dijo «Turno activo · Abierto por Daniel a las 01:13 p.m.»
//   · IndexedDB guardó el turno mu1mf0vmkhs7 y encoló la subida a las 19:13:27Z
//   · Supabase NUNCA lo recibió
//   · minutos después la pantalla volvía a decir «Abrir turno»: el turno se perdió
//   · `/pos/mesas` decía «No hay turno abierto» mientras `/pos/turno` lo daba por activo
//
// La operación en la cola tenía `reintentos: 0` y `error: ''`. No es que fallara
// al subir: es que NUNCA SE INTENTÓ. Con `navigator.onLine === true` y después de
// despachar a mano un evento `online`, seguía ahí intacta.
//
// ── LA CAUSA ────────────────────────────────────────────────────────────────
//
// `TEST-MATRIX.md` §T-03 escribe el contrato con todas sus letras:
//
//     «Al reconectar: `window.online` → `syncAll()`»
//     | Impl | Test | Cert |
//     |  ✓   |  ✗   |  ✗   |
//
// El «Impl ✓» se puso porque el código EXISTE: `usePosOffline` escucha `online`,
// revisa cada 30 s y drena. Está bien escrito. Lo que nadie comprobó es que
// estuviera CONECTADO — y no lo estaba: el hook no lo importaba ni un archivo.
//
// Lo único que drenaba de verdad era `app/pos/layout.tsx`, al teclear el PIN. Un
// POS que se vende por aguantar sin internet, y cuya cola sólo se vacía cuando
// alguien vuelve a loguearse, no es offline: es un POS que guarda y espera.
//
// Esta prueba existe porque «el código existe» y «el código corre» son cosas
// distintas, y la matriz de pruebas no sabe distinguirlas.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SRC = resolve(__dirname, '..')

function archivosDe(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivosDe(p) : (/\.tsx?$/.test(p) ? [p] : [])
  })
}

const arbolVivo = [...archivosDe(join(SRC, 'app')), ...archivosDe(join(SRC, 'components'))]
const hook = readFileSync(join(SRC, 'hooks', 'usePosOffline.ts'), 'utf8')
const layout = readFileSync(join(SRC, 'app', 'pos', 'layout.tsx'), 'utf8')

describe('la cola se drena sola, sin que nadie teclee un PIN', () => {
  it('REGRESION: alguien monta usePosOffline (si nadie lo monta, no drena nada)', () => {
    const montadores = arbolVivo.filter(f => /usePosOffline/.test(readFileSync(f, 'utf8')))
      .map(f => f.replace(SRC + '/', ''))
    expect(montadores, 'usePosOffline existe pero no lo importa nadie: es código muerto').not.toEqual([])
  })

  it('REGRESION: lo monta la raíz del POS, que es la que siempre está viva', () => {
    // Si vive en una pantalla suelta, deja de drenar en cuanto el cajero navega
    // a otra. La raíz del POS está montada mientras el POS esté abierto.
    expect(layout).toMatch(/usePosOffline/)
  })

  it('el contrato de T-03 sigue vivo: el evento `online` dispara el drenado', () => {
    expect(hook).toMatch(/addEventListener\('online'/)
    expect(hook).toMatch(/handleOnline[\s\S]{0,200}syncNow\(\)/)
  })

  it('y hay red de seguridad por si el evento `online` nunca llega', () => {
    // Una reconexión silenciosa (el cable nunca «bajó» para el navegador) no
    // dispara `online`. Sin el intervalo, la cola se queda para siempre.
    expect(hook).toMatch(/setInterval/)
  })

  it('COSTO: el intervalo sólo toca la red si hay algo que subir', () => {
    // No es un detalle de estilo. En este proyecto el polling ya costó caro:
    // la cocina consultaba cada 2 s y se fueron ~12M requests. Revisar la cola
    // es local y gratis; salir a la red no. El orden importa — primero se mira
    // IndexedDB, y sólo si hay pendientes se sincroniza.
    expect(hook).toMatch(/getPendingQueue\([\s\S]{0,40}\)\s*\n?\s*if \(queue\.length > 0\) syncNow\(\)/)
  })

  it('se puede apagar sin desplegar código', () => {
    // Si el drenado resulta agresivo en campo, se apaga desde la terminal.
    expect(hook).toMatch(/FULLSITE_RECOVERY_SYNC_DISABLED/)
  })
})
