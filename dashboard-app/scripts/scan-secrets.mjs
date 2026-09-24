#!/usr/bin/env node
/**
 * Escaneo de secretos en archivos RASTREADOS por git (contención V-A10 / V-C07).
 *
 * Uso:
 *   node dashboard-app/scripts/scan-secrets.mjs          # escanea todo el repo
 *   SCAN_SECRETS_LEAKED_SHA256=<hex>[,<hex>] node ...     # + huellas de secretos filtrados
 *
 * Sale con código 1 si encuentra algo. NUNCA imprime el valor encontrado: solo
 * `archivo:línea  regla`. Lo usa también la prueba guardián
 * src/__tests__/contencion-escaneo-secretos.test.ts.
 *
 * Reglas:
 *   password-grant-literal  literal de contraseña a ≤15 líneas de `grant_type=password`
 *   password-const-literal  constante *PASSWORD / *PASS asignada a un literal
 *   password-literal        password/passwd/pwd/contraseña = literal (código y .md; en .md
 *                           también "Password: valor" sin comillas)
 *                           y valores por defecto (`args.password or "x"`, `pass || 'x'`)
 *   telegram-bot-token      token de bot de Telegram (id numérico : ≥30 caracteres)
 *   credential-pair         esquema://usuario:contraseña@host y curl -u usuario:contraseña
 *   jwt                     token JWT de 3 segmentos (eyJ….eyJ….firma), salvo rol `anon`
 *   live-api-key            sk_live_/pk_live_/rk_live_, sk-… (OpenAI/Anthropic), gsk_… (Groq)
 *   env-secret-assignment   SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY / DEEPGRAM_API_KEY /
 *                           FACTURAMA_* asignadas a un valor literal (no process.env, no ${{ secrets }})
 *   leaked-literal-sha256   literal entre comillas cuya SHA-256 coincide con una huella de
 *                           secreto filtrado (LEAKED_SHA256 + SCAN_SECRETS_LEAKED_SHA256)
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Huellas SHA-256 de secretos que ya se filtraron. Se compara la huella, nunca el literal.
//
// VACÍA A PROPÓSITO (2026-09-23): la contraseña del usuario demo (V-A10) sigue VIGENTE
// hasta que Daniel la rote, y es de baja entropía: publicar su SHA-256 en el repo sería
// publicar un verificador que se rompe por diccionario en segundos. Mientras no se rote,
// su huella se pasa por la variable de entorno SCAN_SECRETS_LEAKED_SHA256 (en local o como
// secret de CI). DESPUÉS de rotarla, la huella del valor viejo ya no protege nada y se
// agrega aquí para que nadie la reintroduzca. Ver ROTATION-RUNBOOK.md.
export const LEAKED_SHA256 = [
]

// Rutas excluidas. Cada entrada DEBE decir por qué. Preferir arreglar a excluir.
export const PATH_ALLOWLIST = [
  // Este escáner y su prueba contienen los patrones que buscan (armados en tiempo de
  // ejecución, pero la documentación los nombra).
  { re: /^dashboard-app\/scripts\/scan-secrets\.mjs$/, why: 'el propio escáner' },
  { re: /^dashboard-app\/src\/__tests__\/contencion-escaneo-secretos\.test\.ts$/, why: 'prueba del escáner' },
  // Lockfiles: hashes de integridad (sha512-…) que no son secretos y son enormes.
  { re: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/, why: 'lockfile' },
]

// Deuda conocida (se reporta, no se esconde). Cada entrada es archivo+regla exactos.
// Fixtures de prueba con valores INVENTADOS que el escáner no puede distinguir por forma.
// Archivo+regla exactos, cada uno con su razón.
export const FIXTURE_ALLOWLIST = [
  // La prueba verifica que el redactor de integraciones oculta `request.nested.password`;
  // el valor es inventado para esa prueba.
  { file: 'dashboard-app/src/__tests__/integrations/category-a.test.ts', rule: 'password-literal', why: 'fixture del redactor' },
]

// Vacía desde 2026-09-23: las cuentas de sandbox, Wansoft y demo se retiraron del árbol.
// Si algo entra aquí, debe decir por qué y quedar en el informe; preferir arreglar.
export const KNOWN_DEBT = [
]

const PLACEHOLDER_RE = /(sentinel|no-debe|service[_-]?key|fixture|fake|dummy|example|mock|synthetic|placeholder|redacted|\*\*\*|changeme|change[-_]?me|your[-_]|^tu[-_]|<|test|xxx|todo|here|replace|sample|ejemplo|fals[oa]|prueba)/i

const INPUT_TYPES = new Set(['text', 'number', 'password', 'email', 'tel', 'hidden', 'current-password', 'new-password', 'numeric'])

/** Referencia a variable/expresión, no un valor: $VAR, ${x}, process.env.X, {{ }}, %s … */
function isCodeRef(v) {
  return /^(\$|\{|%|process\.env|os\.environ|env\.|getenv|import\.meta)/.test(v) || /\$\{|\{\{/.test(v) || /^[A-Z][A-Z0-9_]{3,}$/.test(v)
}

function isPlaceholder(v) {
  if (!v) return true
  if (PLACEHOLDER_RE.test(v)) return true
  if (/^(.)\1+$/.test(v)) return true // 'xxxxxxxx', '00000000'
  return false
}

const RULES = {
  jwtG: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g,
  liveKey: /\b(?:(?:sk|pk|rk)_live_[A-Za-z0-9]{16,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}|gsk_[A-Za-z0-9]{24,})/,
  envAssign: /\b(SUPABASE_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|DEEPGRAM_API_KEY|FACTURAMA_[A-Z_]+)\b["']?\s*[:=]\s*(["'`]?)([^\s"'`,;)}]+)\2/g,
  grant: /grant_type=password/,
  pwLiteral: /\bpass(?:word|wd)?["']?\s*[:=]\s*(["'`])((?:(?!\1)[^$\\]){6,})\1/gi,
  pwConst: /\b[A-Z][A-Z0-9_]*PASS(?:WORD|WD)?\b["']?\s*[:=]\s*(["'`])((?:(?!\1)[^$\\]){6,})\1/g,
  // password / passwd / pwd / contraseña seguido de un literal entre comillas o backticks
  // (código .ts/.js/.py y también documentación .md: `Password: \`valor\``).
  pwAny: /\b(?:password|passwd|pwd|contrase(?:ñ|n)a)\b["'*]*\s*[:=]\s*\**\s*(["'`])((?:(?!\1)[^\\\n]){4,})\1/gi,
  // Markdown/texto: "Password: valor" sin comillas, con valor que parece contraseña
  // (≥6, sin espacios, con letra y dígito o símbolo).
  pwMdPlain: /\b(?:password|contrase(?:ñ|n)a)\b\**\s*:\s*\**\s*([^\s`'"|<>()]{6,})/gi,
  // Pares usuario:contraseña: userinfo en URL (esquema://user:pass@host) y curl -u user:pass.
  credPair: /(?:[a-z][a-z0-9+.-]*:\/\/[^\s:/@"'`]+:([^\s@/"'`]{4,})@|\s-u\s+["']?[^\s:"']+:([^\s"']{4,}))/gi,
  // Estilo variable de entorno sin comillas: SA_PASSWORD=valor (docker -e, .env, shell).
  envPass: /\b[A-Z][A-Z0-9_]*PASS(?:WORD|WD)?=([^\s'"`$]{4,})/g,
  // Valor por defecto literal: args.password or "x" / password || 'x' / pass ?? 'x'
  pwDefault: /\b\w*(?:password|passwd|pwd|pass)\w*\s*(?:\bor\b|\|\||\?\?)\s*(["'`])((?:(?!\1)[^\\\n]){4,})\1/gi,
  // Token de bot de Telegram: id numérico + ':AA' + 33 caracteres
  telegram: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/,
  quoted: /(["'`])((?:(?!\1)[^\\\n]){4,64})\1/g,
}

/** Rol declarado en el payload de un JWT (sin verificar firma); null si no decodifica. */
export function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return typeof payload?.role === 'string' ? payload.role : null
  } catch { return null }
}

function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex') }

/**
 * Escanea un texto. Devuelve [{ file, line, rule }] — sin el valor.
 * @param {string} file ruta relativa a la raíz del repo
 * @param {string} text contenido
 * @param {{ leakedHashes?: string[] }} [opts]
 */
export function scanText(file, text, opts = {}) {
  const leaked = new Set((opts.leakedHashes ?? []).map(h => h.trim().toLowerCase()).filter(Boolean))
  const lines = text.split(/\r?\n/)
  const out = []
  const hit = (i, rule) => out.push({ file, line: i + 1, rule })

  const grantLines = []
  lines.forEach((l, i) => { if (RULES.grant.test(l)) grantLines.push(i) })

  lines.forEach((l, i) => {
    for (const m of l.matchAll(RULES.jwtG)) {
      // La llave `anon` de Supabase va en TODO bundle del navegador
      // (NEXT_PUBLIC_SUPABASE_ANON_KEY): es publicable por diseño y el control es la
      // RLS. Cualquier otro rol (service_role, authenticated = sesión de alguien) falla.
      if (jwtRole(m[0]) === 'anon') continue
      hit(i, 'jwt')
    }
    if (RULES.liveKey.test(l)) hit(i, 'live-api-key')

    for (const m of l.matchAll(RULES.envAssign)) {
      const v = m[3]
      if (/^(process\.env|import\.meta|env\.|\$|os\.environ|getenv|Deno\.env|secrets\.)/.test(v)) continue
      if (v.length < 12 || isPlaceholder(v)) continue
      hit(i, 'env-secret-assignment')
    }

    if (grantLines.some(g => Math.abs(g - i) <= 15)) {
      for (const m of l.matchAll(RULES.pwLiteral)) {
        if (isPlaceholder(m[2])) continue
        hit(i, 'password-grant-literal')
      }
    }

    for (const m of l.matchAll(RULES.pwConst)) {
      // EXPECTED_PASS = "✅ PASS (esperado)": etiqueta con espacios, no contraseña.
      // …ni solo MAYÚSCULAS/símbolos (EXPECTED_PASS = "PASS_ESPERADO"): etiqueta, no secreto.
      if (/\s/.test(m[2]) || /^[^a-z0-9]+$/.test(m[2]) || isPlaceholder(m[2])) continue
      hit(i, 'password-const-literal')
    }

    for (const m of l.matchAll(RULES.pwAny)) {
      // `type={x ? 'password' : 'number'}`: el "valor" es un tipo de <input>, no un secreto.
      if (INPUT_TYPES.has(m[2].toLowerCase())) continue
      // Texto de UI ("Mostrar contraseña' : 'Ocultar…"): una contraseña no lleva espacios.
      if (/\s/.test(m[2])) continue
      if (isPlaceholder(m[2]) || isCodeRef(m[2])) continue
      hit(i, 'password-literal')
    }

    if (/\.(md|mdx|txt)$/i.test(file)) {
      for (const m of l.matchAll(RULES.pwMdPlain)) {
        const v = m[1].replace(/[.,;:*]+$/, '')
        if (v.length < 6 || isPlaceholder(v) || isCodeRef(v)) continue
        if (!(/[A-Za-z]/.test(v) && /[0-9!@#$%^&*?_~+=-]/.test(v))) continue
        hit(i, 'password-literal')
      }
    }

    for (const m of l.matchAll(RULES.pwDefault)) {
      if (/\s/.test(m[2]) || isPlaceholder(m[2]) || isCodeRef(m[2])) continue
      hit(i, 'password-literal')
    }
    if (RULES.telegram.test(l)) hit(i, 'telegram-bot-token')

    for (const m of l.matchAll(RULES.envPass)) {
      if (isPlaceholder(m[1]) || isCodeRef(m[1])) continue
      hit(i, 'password-literal')
    }

    for (const m of l.matchAll(RULES.credPair)) {
      const v = m[1] ?? m[2]
      if (!v || isPlaceholder(v) || isCodeRef(v)) continue
      hit(i, 'credential-pair')
    }

    if (leaked.size) {
      for (const m of l.matchAll(RULES.quoted)) {
        if (leaked.has(sha256(m[2]))) hit(i, 'leaked-literal-sha256')
      }
    }
  })
  return out
}

export function repoRoot(from = path.dirname(fileURLToPath(import.meta.url))) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: from, encoding: 'utf8' }).trim()
}

export function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean)
}

/** Escanea todos los archivos rastreados. Devuelve { findings, scanned, skipped }. */
export function scanRepo(root = repoRoot(), opts = {}) {
  const leakedHashes = [
    ...LEAKED_SHA256,
    ...(opts.leakedHashes ?? []),
    ...String(process.env.SCAN_SECRETS_LEAKED_SHA256 || '').split(','),
  ].filter(Boolean)
  const findings = []
  let scanned = 0, skipped = 0
  // Cada omisión queda contada por motivo (y con ruta) para poder justificarla.
  const skippedBy = { allowlist: [], missing: [], notFile: [], tooLarge: [], binary: [] }
  const skip = (why, f) => { skipped++; skippedBy[why].push(f) }
  for (const f of trackedFiles(root)) {
    if (PATH_ALLOWLIST.some(a => a.re.test(f))) { skip('allowlist', f); continue }
    const abs = path.join(root, f)
    let st
    try { st = statSync(abs) } catch { skip('missing', f); continue } // borrado en el working tree
    if (!st.isFile()) { skip('notFile', f); continue } // symlink a dir / submódulo
    if (st.size > 5 * 1024 * 1024) { skip('tooLarge', f); continue }
    const buf = readFileSync(abs)
    if (buf.subarray(0, 8000).includes(0)) { skip('binary', f); continue } // binario (imágenes, fuentes, pdf…)
    scanned++
    for (const h of scanText(f, buf.toString('utf8'), { leakedHashes })) {
      if ([...KNOWN_DEBT, ...FIXTURE_ALLOWLIST].some(d => d.file === h.file && d.rule === h.rule)) continue
      findings.push(h)
    }
  }
  return { findings, scanned, skipped, skippedBy }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const { findings, scanned, skipped, skippedBy } = scanRepo()
  for (const f of findings) console.log(`${f.file}:${f.line}  ${f.rule}`)
  if (process.argv.includes('--skipped')) {
    for (const [why, list] of Object.entries(skippedBy)) for (const f of list) console.log(`omitido(${why})  ${f}`)
  }
  console.log(`omitidos por motivo: ${Object.entries(skippedBy).map(([k, v]) => `${k}=${v.length}`).join(' ')}`)
  console.log(`\nscan-secrets: ${findings.length} hallazgo(s) en ${scanned} archivos (${skipped} omitidos). Valores NO impresos.`)
  process.exit(findings.length ? 1 : 0)
}
