// Revisión PR3 (H-1, H-7) — credenciales en scripts fuera del dashboard.
//
// H-1: .github/scripts/onboard_client.py tenía `--password` con un default literal, así que el
//      `args.password or sys.exit(...)` nunca salía: todo onboarding sin --password creaba un
//      admin con una contraseña conocida. Ahora no hay default: sin contraseña, sale con error
//      ANTES de cualquier llamada de red.
// H-7: scripts/sql/sandbox/tests/isolation_test.py creaba al usuario huérfano con una
//      contraseña aleatoria y entraba con el literal viejo → el login fallaba y la sección 8
//      no comprobaba el aislamiento. Ahora crea y entra con la MISMA variable.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(__dirname, '../../..')
const py = spawnSync('python3', ['-c', 'import requests'], { encoding: 'utf8' })
const hayPython = py.status === 0

describe('H-1 — onboard_client.py sin contraseña por defecto', () => {
  it.skipIf(!hayPython)('sin --password ni ONBOARD_OWNER_PASSWORD → sale con error y sin red', () => {
    const r = spawnSync('python3', [path.join(raiz, '.github/scripts/onboard_client.py'), '--id', 'x', '--name', 'y', '--email', 'z@fixture.test'], {
      encoding: 'utf8',
      // Sin variables de Supabase y con proxy muerto: si intentara red, fallaría distinto.
      env: { PATH: process.env.PATH ?? '', HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' } as unknown as NodeJS.ProcessEnv,
      timeout: 20_000,
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr + r.stdout).toMatch(/Falta --password/)
  })

  it('el argumento --password no tiene default literal', () => {
    const src = readFileSync(path.join(raiz, '.github/scripts/onboard_client.py'), 'utf8')
    const decl = src.split('\n').filter(l => l.includes('add_argument("--password"'))
    expect(decl).toHaveLength(1)
    expect(decl[0]).toMatch(/default=os\.environ\.get\("ONBOARD_OWNER_PASSWORD"\)/)
  })
})

describe('H-7 — isolation_test.py: el huérfano entra con la contraseña con la que se creó', () => {
  const src = readFileSync(path.join(raiz, 'scripts/sql/sandbox/tests/isolation_test.py'), 'utf8')
  it('crea con orphan_pass y todos los login del huérfano usan orphan_pass', () => {
    expect(src).toMatch(/orphan_pass = os\.urandom\(\d+\)\.hex\(\)/)
    expect(src).toMatch(/"password": orphan_pass/)
    const logins = src.split('\n').filter(l => /login\(auth, anon_key, orphan_email,/.test(l))
    expect(logins.length).toBeGreaterThanOrEqual(2)
    for (const l of logins) expect(l).toMatch(/orphan_email, orphan_pass\)/)
  })
  it('las contraseñas de los dueños vienen del entorno, sin respaldo literal', () => {
    expect(src).toMatch(/vantara_pass\s+= env_or_die\("VANTARA_OWNER_PASS"\)/)
    expect(src).toMatch(/nomada_pass\s+= env_or_die\("NOMADA_OWNER_PASS"\)/)
  })
})
