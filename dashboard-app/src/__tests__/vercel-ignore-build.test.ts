import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Candado del Ignore Build Step de Vercel.
 *
 * Vive bajo dashboard-app/ y no en tests/ de la raíz porque **CI sólo corre
 * pruebas con working-directory: dashboard-app**. Una prueba en la raíz no se
 * ejecutaría nunca — es el caso de tests/security/m1m2-xss-escape.test.js, que
 * está huérfano hoy. Lee el vercel.json de la raíz con fs, igual que
 * offline-sw.test.ts y t24-login-offline-cableado.test.ts leen su fuente.
 *
 * El contrato de Vercel está al revés de la intuición y es fácil invertirlo sin
 * darse cuenta:
 *   exit 0 -> SALTAR el build
 *   exit 1 -> CONSTRUIR
 *
 * Invertirlo no falla ruidosamente: o se queman builds de más (vuelve el
 * `build-rate-limit` que dejó la cola de PRs en rojo), o —mucho peor— producción
 * deja de desplegarse en silencio. Por eso estas pruebas fijan ambos sentidos.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const VERCEL_JSON = path.resolve(AQUI, '../../../vercel.json')

// Fuente única de verdad: el comando se lee del propio vercel.json, no de una
// copia. Va inline y no como script porque `.vercelignore` excluye `/scripts/`
// y además `*.sh`; un archivo aparte podría no existir cuando Vercel corre el
// paso, y el fallo sería silencioso.
const IGNORE_COMMAND: string = JSON.parse(readFileSync(VERCEL_JSON, 'utf-8')).ignoreCommand

/** Crea un repo temporal con un commit base y un segundo commit que toca `archivos`. */
function repoQueToca(archivos: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vib-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })

  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@fullsite.local')
  git('config', 'user.name', 'test')

  writeFileSync(path.join(dir, 'base.txt'), 'base\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')

  for (const rel of archivos) {
    const destino = path.join(dir, rel)
    mkdirSync(path.dirname(destino), { recursive: true })
    writeFileSync(destino, 'cambio\n')
  }
  git('add', '-A')
  git('commit', '-q', '-m', 'cambio')

  return dir
}

/** Devuelve el exit code real del ignoreCommand parado en ese repo. */
function correr(dir: string): number | null {
  return spawnSync('bash', ['-c', IGNORE_COMMAND], { cwd: dir, encoding: 'utf-8' }).status
}

const SALTAR = 0
const CONSTRUIR = 1

describe('vercel-ignore-build · salta lo que no puede cambiar el deploy', () => {
  const casos: Array<[string, string[]]> = [
    ['docs/', ['docs/playbooks/algo.md']],
    ['docs/ con varios archivos', ['docs/a.md', 'docs/b/c.md']],
    ['.github/ workflows', ['.github/workflows/ci.yml']],
    ['.github/ scripts', ['.github/scripts/agente.py']],
    ['electron-app/', ['electron-app/local-server/core/event-store.js']],
    ['graphify-out/', ['graphify-out/graph.json']],
    ['tests/ de la raíz', ['tests/ci/otra.test.js']],
    ['scripts/ de la raíz', ['scripts/deploy.sh']],
    ['fullsite-web/', ['fullsite-web/index.html']],
    ['mezcla de excluidos', ['docs/x.md', '.github/workflows/y.yml', 'electron-app/z.js']],
  ]

  for (const [nombre, archivos] of casos) {
    it(`salta cuando el diff sólo toca ${nombre}`, () => {
      expect(correr(repoQueToca(archivos))).toBe(SALTAR)
    })
  }
})

describe('vercel-ignore-build · construye ante cualquier cambio desplegable', () => {
  const casos: Array<[string, string[]]> = [
    ['dashboard-app/', ['dashboard-app/src/app/pos/layout.tsx']],
    ['un html de la raíz', ['fullsite.html']],
    ['package.json de la raíz', ['package.json']],
    ['el propio vercel.json', ['vercel.json']],
    ['una migración de supabase', ['supabase/migrations/20260101_x.sql']],
  ]

  for (const [nombre, archivos] of casos) {
    it(`construye cuando el diff toca ${nombre}`, () => {
      expect(correr(repoQueToca(archivos))).toBe(CONSTRUIR)
    })
  }

  it('construye si un solo archivo desplegable acompaña a puros excluidos', () => {
    // El caso que más se repite en este repo: un PR que es casi todo docs
    // pero trae un archivo de app. No se puede saltar.
    const dir = repoQueToca(['docs/a.md', 'docs/b.md', 'dashboard-app/src/lib/x.ts'])
    expect(correr(dir)).toBe(CONSTRUIR)
  })
})

describe('vercel-ignore-build · el comando vive en vercel.json', () => {
  it('vercel.json declara ignoreCommand', () => {
    const cfg = JSON.parse(readFileSync(VERCEL_JSON, 'utf-8'))
    expect(cfg.ignoreCommand, 'sin ignoreCommand vuelve el build-rate-limit').toBeTruthy()
  })

  it('excluye docs/ y .github/, que son la mayor fuente de builds inútiles', () => {
    expect(IGNORE_COMMAND).toContain(':(exclude)docs/')
    expect(IGNORE_COMMAND).toContain(':(exclude).github/')
  })

  it('nunca excluye dashboard-app/, que es lo que sí se despliega', () => {
    expect(IGNORE_COMMAND).not.toContain('dashboard-app')
  })
})

describe('vercel-ignore-build · falla hacia construir, nunca hacia no desplegar', () => {
  it('sin commit padre construye en vez de saltar', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vib-raiz-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@fullsite.local')
    git('config', 'user.name', 'test')
    writeFileSync(path.join(dir, 'unico.txt'), 'x\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'primer commit')

    // Un repo sin HEAD^ no se puede comparar. El default seguro es construir:
    // saltar aquí dejaría producción sin desplegar y en silencio.
    expect(correr(dir)).toBe(CONSTRUIR)
  })
})
