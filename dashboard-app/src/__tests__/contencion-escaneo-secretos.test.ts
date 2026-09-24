// Contención V-A10 / V-C07 — guardián de secretos en archivos RASTREADOS.
//
// En 6d6a31fc la contraseña del usuario demo (rol dueño) estaba literal en
// seeds/_lib/get-session.ts:23 junto a `grant_type=password`, y otra vez en
// seeds/validate-demo.ts:18. Este guardián recorre `git ls-files` con
// scripts/scan-secrets.mjs y falla si reaparece cualquier secreto de las reglas.
//
// Los ejemplos sintéticos de abajo se ARMAN en tiempo de ejecución (concatenación) para
// que este archivo no contenga él mismo un patrón detectable por otros escáneres.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
// @ts-expect-error — módulo .mjs sin tipos
import { scanText, scanRepo, repoRoot, jwtRole, KNOWN_DEBT, PATH_ALLOWLIST } from '../../scripts/scan-secrets.mjs'

type Hallazgo = { file: string; line: number; rule: string }
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwtCon = (role: string) => [b64({ alg: 'HS256', typ: 'JWT' }), b64({ role, iss: 'supabase', ref: 'proyectoficticio' }), 'f'.repeat(43)].join('.')
const reglas = (t: string, opts?: { leakedHashes?: string[] }) => (scanText('x.ts', t, opts) as Hallazgo[]).map(h => h.rule)

describe('scan-secrets — reglas (ejemplos sintéticos)', () => {
  it('literal de contraseña junto a grant_type=password', () => {
    const t = ["fetch(url + '/auth/v1/token?grant_" + "type=password', {", "  body: JSON.stringify({ email: e, pass" + "word: 'Qz7" + "vK2mPw9x' })", '})'].join('\n')
    expect(reglas(t)).toContain('password-grant-literal')
  })

  it('grant_type=password leyendo de variable de entorno NO dispara', () => {
    const t = ["fetch(url + '/auth/v1/token?grant_" + "type=password', {", '  body: JSON.stringify({ email, pass' + 'word: process.env.SEED_DEMO_PASSWORD })', '})'].join('\n')
    expect(reglas(t)).toEqual([])
  })

  it('constante *PASSWORD con literal', () => {
    expect(reglas("const DEMO_PASS" + "WORD = 'Qz7" + "vK2mPw9x'")).toContain('password-const-literal')
    expect(reglas("const DEMO_PASS" + "WORD = process.env.SEED_DEMO_PASSWORD")).toEqual([])
  })

  it('JWT con rol service_role o authenticated dispara; anon (publicable) no', () => {
    expect(reglas(`const k = '${jwtCon('service_role')}'`)).toContain('jwt')
    expect(reglas(`const k = '${jwtCon('authenticated')}'`)).toContain('jwt')
    expect(reglas(`const k = '${jwtCon('anon')}'`)).toEqual([])
    expect(jwtRole(jwtCon('service_role'))).toBe('service_role')
  })

  it('llaves vivas tipo sk_live / pk_live / sk-…', () => {
    expect(reglas('k = "sk_' + 'live_' + 'A1b2C3d4E5f6G7h8I9j0"')).toContain('live-api-key')
    expect(reglas('k = "pk_' + 'live_' + 'A1b2C3d4E5f6G7h8I9j0"')).toContain('live-api-key')
    expect(reglas('k = "sk-' + 'ant-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3"')).toContain('live-api-key')
  })

  it('asignación literal de SUPABASE_SERVICE_KEY / DEEPGRAM_API_KEY / FACTURAMA_*', () => {
    expect(reglas('SUPABASE_SERVICE' + '_KEY=Zq81kLm02PqrStu9')).toContain('env-secret-assignment')
    expect(reglas("DEEPGRAM_API" + "_KEY: 'a9f8e7d6c5b4a3f2e1d0'")).toContain('env-secret-assignment')
    expect(reglas('FACTURAMA_' + 'PASSWORD=Zq81kLm02PqrStu9')).toContain('env-secret-assignment')
  })

  it('referencias a entorno y fixtures de prueba NO disparan', () => {
    expect(reglas('const k = process.env.DEEPGRAM_API' + '_KEY')).toEqual([])
    expect(reglas('SUPABASE_SERVICE' + '_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}')).toEqual([])
    expect(reglas("process.env.DEEPGRAM_API" + "_KEY = 'dg-llave-maestra-falsa-0123'")).toEqual([])
  })

  it('huella SHA-256 de un secreto filtrado: detecta el literal sin conocerlo en claro', () => {
    const secreto = ['h', 'u', 'e', 'l', 'l', 'a', '-', 'X', '9', '!'].join('')
    const h = createHash('sha256').update(secreto).digest('hex')
    expect(reglas(`const x = '${secreto}'`, { leakedHashes: [h] })).toContain('leaked-literal-sha256')
    expect(reglas(`const x = 'otra-cosa'`, { leakedHashes: [h] })).toEqual([])
  })
})

describe('scan-secrets — guardián sobre el repo', () => {
  it('ningún archivo rastreado contiene secretos (salvo deuda declarada)', () => {
    const { findings, scanned } = scanRepo() as { findings: Hallazgo[]; scanned: number }
    expect(scanned).toBeGreaterThan(1000)
    // Solo archivo:línea:regla — el valor nunca se imprime.
    expect(findings.map(f => `${f.file}:${f.line} ${f.rule}`)).toEqual([])
  }, 60_000)

  it('el guardián SÍ ve la fuga original (6d6a31fc), si ese commit está disponible', () => {
    // Un guardián no vale hasta verlo fallar: se escanea el contenido del commit base.
    // En un clon superficial (CI) el commit puede no existir → se omite sin fallar.
    const base = '6d6a31fcabfc189ab8fd05fb0f6c0936fcbe916d'
    const archivos = ['dashboard-app/seeds/_lib/get-session.ts', 'dashboard-app/seeds/validate-demo.ts']
    let textos: string[]
    try {
      textos = archivos.map(f => execFileSync('git', ['show', `${base}:${f}`], { cwd: repoRoot(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
    } catch { return }
    const r = archivos.flatMap((f, i) => (scanText(f, textos[i]) as Hallazgo[]).map(h => `${h.file} ${h.rule}`))
    expect(r).toContain('dashboard-app/seeds/_lib/get-session.ts password-grant-literal')
    expect(r).toContain('dashboard-app/seeds/validate-demo.ts password-const-literal')
  })

  it('la allowlist y la deuda conocida están comentadas y acotadas', () => {
    for (const a of PATH_ALLOWLIST as Array<{ why: string }>) expect(a.why.length).toBeGreaterThan(3)
    // La deuda nunca incluye dashboard-app/: lo del dashboard se arregla, no se excluye.
    for (const d of KNOWN_DEBT as Array<{ file: string }>) expect(d.file.startsWith('dashboard-app/')).toBe(false)
  })
})
