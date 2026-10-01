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
import { execFileSync, spawnSync } from 'node:child_process'
import { scanText, scanRepo, repoRoot, jwtRole, KNOWN_DEBT, PATH_ALLOWLIST } from '../../scripts/scan-secrets.mjs'

// Commit base de la contención. ¿Está en este clon? Solo esta pregunta decide omitir.
//
// `git cat-file -e <sha>` (SIN `^{commit}`) distingue los tres casos por su código:
//   0   → el objeto está                         → se corre la prueba
//   1   → el objeto no está (clon superficial)   → se OMITE (skipIf, visible)
//   otro (128 = error fatal de git; null = git no instalado) → se LANZA: el archivo
//        entero falla. Con `^{commit}` el «no está» también daba 128, así que un error
//        de git se confundía con «falta el commit» y omitía el guardián con la suite en
//        verde (revisión P-00, N2). repoRoot() también lanza si git no funciona.
const BASE = '6d6a31fcabfc189ab8fd05fb0f6c0936fcbe916d'
const BASE_DISPONIBLE = (() => {
  const r = spawnSync('git', ['cat-file', '-e', BASE], { cwd: repoRoot(), stdio: 'ignore' })
  if (r.status === 0) {
    const tipo = execFileSync('git', ['cat-file', '-t', BASE], { cwd: repoRoot(), encoding: 'utf8' }).trim()
    if (tipo !== 'commit') throw new Error(`el objeto base existe pero es «${tipo}», no un commit`)
    return true
  }
  if (r.status === 1) return false
  throw new Error(`git cat-file falló (status ${r.status}${r.error ? `, ${r.error.message}` : ''}): no se puede decidir si omitir el guardián`)
})()

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

  it('password literal en .md, .py y .ts, y en estilo variable de entorno', () => {
    const v = 'Qz7' + 'vK2m!9x'
    expect(reglas('- Pass' + 'word: `' + v + '` (sin cambio)')).toContain('password-literal')
    expect(scanText('n.md', '**Contrase' + 'ña:** ' + v).map((h: Hallazgo) => h.rule)).toContain('password-literal')
    expect(reglas('{"email": "a@b.mx", "pass' + 'word": "' + v + '"}')).toContain('password-literal')
    expect(reglas("docker run -e 'SA_PASS" + "WORD=" + v + "'")).toContain('password-literal')
    expect(reglas('"password": args.pass' + 'word or "' + v + '"')).toContain('password-literal')
  })

  it('pares usuario:contraseña y token de bot de Telegram', () => {
    expect(reglas('postgres://admin:' + 'Qz7vK2m9x' + '@db.host/x')).toContain('credential-pair')
    expect(reglas('curl -u admin:' + 'Qz7vK2m9x' + ' https://x')).toContain('credential-pair')
    expect(reglas("const T = '" + '123456789' + ':' + 'A'.repeat(2) + 'b1C2d3E4f5G6h7I8j9K0l1M2n3O4p5Q6r' + "'")).toContain('telegram-bot-token')
  })

  // Revisión adversarial PR3 (H-3): 28 formas que el escáner anterior NO detectaba.
  // Valores inventados; se arman concatenando para que este archivo no los contenga enteros.
  describe('formas de la revisión PR3 (H-3), todas deben detectarse', () => {
    const pw = 'Zk8m' + 'Q2vX9p'
    const casos: Array<[string, string, string]> = [
      ['yaml sin comillas password', 'cfg.yml', 'pass' + 'word: ' + pw],
      ['yaml sin comillas pass', 'cfg.yml', '  pass: ' + pw],
      ['.env minúsculas', '.env.example', 'db_pass' + 'word=' + pw],
      ['PASS= a secas', 'x.sh', 'PASS=' + pw],
      ['MYSQL_PWD=', 'x.sh', 'export MYSQL_' + 'PWD=' + pw],
      ['mysql -p', 'x.sh', 'mysql -uroot -p' + pw + ' db'],
      ['SQL PASSWORD', 'x.sql', "CREATE ROLE app LOGIN PASS" + "WORD '" + pw + "';"],
      ['SQL crypt()', 'x.sql', "update auth.users set encrypted_pass" + "word = crypt('" + pw + "', gen_salt('bf'));"],
      ['HTML value', 'x.html', '<input type="pass' + 'word" value="' + pw + '">'],
      ['MAYÚSCULAS+dígitos', 'x.ts', '{ "pass' + 'word": "' + 'AAAAAA' + '9999" }'],
      ['contiene "here"', 'x.ts', "pass" + "word: 'Sp" + "here2026!'"],
      ['contiene "todo"', 'x.py', 'pass' + 'word = "To' + 'dos2026$"'],
      ['contiene "test"', 'x.py', 'pass' + 'word = "Contest' + '2026!"'],
      ['contiene "prueba"', 'x.md', 'Contraseña: `Mipru' + 'eba2026!`'],
      ['contiene "sample"', 'x.ts', "const pass" + "word = 'Xsample' + '9!'".replace("' + '", '')],
      ['hex40 en const', 'x.ts', "const k = '" + 'a1b2c3d4e5'.repeat(4) + "'"],
      ['hex40 tras Token', 'x.ts', "headers: { Authorization: 'Token " + 'a1b2c3d4e5'.repeat(4) + "' }"],
      ['sb_secret_', 'x.ts', "const s = 'sb_" + "secret_" + 'AbCdEf0123456789xyz' + "'"],
      ['APP_USR- (Mercado Pago)', 'x.ts', "token = 'APP_" + "USR-1234567890123456-092312-abcdef0123456789-12345678'"],
      ['re_ (Resend)', 'x.ts', "key = 're_" + "AbCd1234_EfGh5678IjKl9012MnOp'"],
      ['ghp_', 'x.sh', 'GH=ghp' + '_' + 'A'.repeat(20) + 'b'.repeat(16)],
      ['AKIA', 'x.env', 'AWS=AKIA' + 'ABCDEFGHIJ012345'],
      ['SHIFT_TOKEN_SECRET=', '.env', 'SHIFT_TOKEN_' + 'SECRET=' + pw + 'aa11'],
      ['POS_PIN_PEPPER=', '.env', 'POS_PIN_' + 'PEPPER=' + pw + 'bb22'],
      ['KITCHEN_TOKEN_SECRET=', 'x.md', 'KITCHEN_TOKEN_' + 'SECRET=' + pw + 'cc33'],
      ['valor en la línea siguiente', 'x.py', 'pass' + 'word = (\n    "' + pw + '"\n)'],
      ['argparse default=', 'x.py', 'parser.add_argument("--pass' + 'word", default="' + pw + '", help="x")'],
      ['env_opt con respaldo', 'x.py', 'p = env_opt("VANTARA_OWNER_' + 'PASS", "' + pw + '")'],
      ['login(…, "…")', 'x.py', 'tok = login(auth, anon, email, "' + pw + '")'],
      ['--owner-pass', 'x.md', '  --owner-' + 'pass    "' + pw + '"'],
      ['correo / `clave`', 'x.md', '**Usuario demo:** `owner@vantara.sandbox` / `' + pw + '`'],
      ['tabla correo | clave', 'x.md', '| `owner@vantara.sandbox` | `' + pw + '` | VANTARA | dueño |'],
    ]
    for (const [nombre, archivo, texto] of casos) {
      it(nombre, () => { expect((scanText(archivo, texto) as Hallazgo[]).length, nombre).toBeGreaterThan(0) })
    }
  })

  // Re-revisión PR3: N-1 (PEM) y P3 baratos; N-4 (clave XOR en el cliente)
  describe('formas de la re-revisión (N-1, P3, N-4)', () => {
    const b = '-----BEGIN'
    const casos: Array<[string, string, string]> = [
      ['PEM en .pem', 'k.pem', b + ' PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----'],
      ['PEM RSA en template TS', 'x.ts', 'const k = `' + b + ' RSA PRIVATE KEY-----\nMIIEow...`'],
      ['PEM en JSON de cuenta de servicio', 'sa.json', '{"private_key": "' + b + ' PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----\\n"}'],
      ['Bearer hex40', 'x.ts', "headers: { Authorization: 'Bearer " + 'a1b2c3d4e5'.repeat(4) + "' }"],
      ['curl apikey', 'x.sh', 'curl -H "api' + 'key: ' + 'a1b2c3d4e5'.repeat(4) + '" https://x'],
      ['clientSecret camelCase', 'x.ts', "const client" + "Secret = 'Zk8mQ2vX9p4t'"],
      ['Slack xoxb', 'x.ts', "const t = 'xox" + "b-123456789012-ABCDEFabcdef'"],
      ['Google AIza', 'x.ts', "const g = 'AI" + "za" + 'A'.repeat(20) + 'b1c2d3e4f5g6h7i8j9k' + "'"],
      ['Stripe sk_test_', 'x.ts', "const s = 'sk_" + "test_" + 'A1b2C3d4E5f6G7h8' + "'"],
      ['clave XOR en el cliente', 'p.html', "const key = 'zq" + "-clave-xor-2026'\nr += String.fromCharCode(d.charCodeAt(i) ^ key.charCodeAt(i % key.length))"],
    ]
    for (const [nombre, archivo, texto] of casos) {
      it(nombre, () => { expect((scanText(archivo, texto) as Hallazgo[]).length, nombre).toBeGreaterThan(0) })
    }
    it('NO marca Bearer con variable/JWT ni una clave sin XOR', () => {
      expect(reglas('headers: { Authorization: `Bearer ${token}` }')).toEqual([])
      expect(reglas("const key = 'orden-por-fecha-2026'")).toEqual([])
      expect(reglas("fetch(u, { headers: { Authorization: 'Bearer sb_" + "publishable_AbCdEf0123456789xyzAbCdEf0123' } })")).toEqual([])
    })
  })

  it('NO marca referencias, marcadores ni formas de código', () => {
    const neg: Array<[string, string]> = [
      ['x.py', 'parser.add_argument("--pass' + 'word", default=os.environ.get("ONBOARD_OWNER_PASSWORD"))'],
      ['x.py', 'vantara_pass = env_or_die("VANTARA_OWNER_' + 'PASS")'],
      ['x.md', '| `owner@vantara.sandbox` | `***REDACTED***` (gestor de secretos) |'],
      ['x.ts', "const base = '" + '6d6a31fc'.repeat(5) + "'"],
      ['x.html', '<input type="pass' + 'word" placeholder="sk-ant-api03-..." autocomplete="off">'],
      ['x.ts', "const SB_KEY = 'sb_" + "publishable_AbCdEf0123456789xyzAbCdEf0123'"],
      ['x.sh', 'SHIFT_TOKEN_' + 'SECRET=${SHIFT_TOKEN_SECRET}'],
      ['x.md', 'Estado: PASS · T-01 PASS'],
      ['x.ts', "tipo: 'contrase" + "ña' : 'número'"],
      ['x.ts', 'const payload = { pass' + 'word: args.password, email }'],
    ]
    for (const [archivo, texto] of neg) expect((scanText(archivo, texto) as Hallazgo[]).map(h => `${archivo} ${h.rule}`), texto.slice(0, 30)).toEqual([])
  })

  it('NO confunde texto de UI ni tipos de input con contraseñas', () => {
    expect(reglas("aria-label={show ? 'Ocultar contrase" + "ña' : 'Mostrar contrase" + "ña'}")).toEqual([])
    expect(reglas("type={x ? 'pass" + "word' : 'number'}")).toEqual([])
    expect(reglas('EXPECTED_PASS = "PASS_ESPERADO"')).toEqual([])
    expect(reglas('password: process.env.SEED_DEMO_PASSWORD')).toEqual([])
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

  // Un guardián no vale hasta verlo fallar: se escanea el contenido del commit base.
  // En un clon superficial (CI) el commit puede no existir. Ese caso —y SOLO ese— se
  // declara OMITIDO (skipIf, visible en el reporte), no aprobado. Si el commit existe,
  // cualquier error de `git show` o del escaneo hace FALLAR la prueba (antes un
  // `catch { return }` convertía cualquier error en PASS silencioso; P-00, 2026-09-24).
  it.skipIf(!BASE_DISPONIBLE)('el guardián SÍ ve la fuga original (6d6a31fc)', () => {
    const base = BASE
    // archivo → regla que DEBE dispararse sobre su versión en la base (cuentas reales:
    // demo, sandbox, Wansoft; bot de Telegram; SA de SQL Server en docs de Wansoft).
    const esperado: Record<string, string> = {
      'dashboard-app/seeds/_lib/get-session.ts': 'password-grant-literal',
      'dashboard-app/seeds/validate-demo.ts': 'password-const-literal',
      'docs/knowledge/wansoft/AUTH-DIAGNOSIS.md': 'password-literal',
      'docs/knowledge/wansoft/ARCHITECTURE.md': 'password-literal',
      'docs/knowledge/wansoft/DATA-MODEL.md': 'password-literal',
      'docs/security/SECURITY-FOUNDATION-P0.md': 'password-literal',
      'scripts/sql/sandbox/bootstrap_auth.py': 'password-literal',
      'scripts/sql/sandbox/smoke_test.py': 'password-grant-literal',
      'scripts/sql/sandbox/tests/isolation_test.py': 'password-const-literal',
      '.github/scripts/onboard_client.py': 'password-literal',
      'fullsite.html': 'telegram-bot-token',
      'agents/wansoft/.env.example': 'telegram-bot-token',
      // Revisión PR3 (H-1/H-2): formas que el escáner anterior dejaba pasar
      'docs/playbooks/DEPLOY-SANDBOX.md': 'credential-pair',
      'docs/platform/CLONEABILITY-REPORT-v1.md': 'credential-context',
      'docs/archive/RUNBOOK-generic-old.md': 'credential-pair',
      'docs/constitution/ENGINEERING-AXIOMS.md': 'secret-assignment',
      'docs/archive/bibles/FULLSITE-DASHBOARD-GAP-ANALYSIS.md': 'secret-assignment',
    }
    // Además, líneas exactas que deben verse en la base (archivo:línea regla)
    const lineas = [
      '.github/scripts/onboard_client.py:185 credential-context',
      'scripts/sql/sandbox/tests/isolation_test.py:125 credential-context',
      'scripts/sql/sandbox/tests/isolation_test.py:127 credential-context',
      'scripts/sql/sandbox/tests/isolation_test.py:284 credential-context',
      'scripts/sql/sandbox/tests/isolation_test.py:312 credential-context',
      'docs/playbooks/DEPLOY-SANDBOX.md:6 credential-pair',
      'docs/playbooks/DEPLOY-SANDBOX.md:184 credential-pair',
      'docs/playbooks/DEPLOY-SANDBOX.md:219 credential-pair',
      'docs/playbooks/DEPLOY-SANDBOX.md:220 credential-pair',
      'docs/platform/CLONEABILITY-REPORT-v1.md:115 credential-context',
    ]
    const archivos = Object.keys(esperado)
    // Sin try/catch: con el commit presente, un archivo que no exista en la base o un
    // git que falle es un error real del guardián y debe verse como FALLA.
    const textos = archivos.map(f => execFileSync('git', ['show', `${base}:${f}`], { cwd: repoRoot(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 }))
    const r = new Set(archivos.flatMap((f, i) => (scanText(f, textos[i]) as Hallazgo[]).map(h => `${h.file} ${h.rule}`)))
    for (const f of archivos) expect(r.has(`${f} ${esperado[f]}`), `${f} ${esperado[f]}`).toBe(true)
    const extra = [...new Set(lineas.map(x => x.split(':')[0]))]
    const porLinea = new Set(extra.flatMap(f => {
      const t = execFileSync('git', ['show', `${base}:${f}`], { cwd: repoRoot(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      return (scanText(f, t) as Hallazgo[]).map(h => `${h.file}:${h.line} ${h.rule}`)
    }))
    for (const x of lineas) expect(porLinea.has(x), x).toBe(true)
    // Timeout explícito: ~0.6 s medido sin carga (21 `git show` + escaneo). El default
    // de 5 s se rebasó una vez con la máquina saturada (INTEGRATION-vitest-run1-loaded.log).
    // 30 s ≈ 50× lo normal: absorbe la carga sin volverse infinito. Si se excede, la
    // prueba FALLA — el timeout nunca aprueba nada.
  }, 30_000)

  it('la allowlist y la deuda conocida están comentadas y acotadas', () => {
    for (const a of PATH_ALLOWLIST as Array<{ why: string }>) expect(a.why.length).toBeGreaterThan(3)
    // La deuda del dashboard se limita a la clave XOR del vault (P0-4, requiere rediseño):
    // cualquier otra entrada nueva bajo dashboard-app/ hace fallar esta prueba.
    const permitidas = new Set(['dashboard-app/src/app/admin/vault/page.tsx', 'dashboard-app/src/app/internal/vault/page.tsx', 'dashboard-app/public/panel.html'])
    for (const d of KNOWN_DEBT as Array<{ file: string }>) if (d.file.startsWith('dashboard-app/')) expect(permitidas.has(d.file), d.file).toBe(true)
  })
})
