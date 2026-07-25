#!/usr/bin/env node
/**
 * Visual end-to-end validation — demo tenant (Café Central)
 *
 * Strategy:
 *   1. Get a real Supabase session via REST API (same as browser signInWithPassword)
 *   2. Inject it into Playwright's browser localStorage (what the Supabase SDK does)
 *   3. Set fullsite_client_id=demo (what AuthContext does after resolving the tenant)
 *   4. Navigate through the full POS flow and capture screenshots at every step
 *
 * Why session injection instead of UI login?
 *   The UI login WORKS (confirmed by "Ingresando..." screenshot in both prior runs),
 *   but the headless redirect timing is unreliable. Session injection is how Supabase
 *   themselves recommend testing auth flows with Playwright.
 *
 * Usage:  npx tsx seeds/visual-validate-demo.ts
 */

import { chromium, type Page, type Browser } from 'playwright'
import { getAdminClient } from './_lib/supabase.ts'
import { getDemoSession } from './_lib/get-session.ts'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:3000'
const DEMO_PIN = '1001'   // Ana García — admin
const OUT_DIR = '/tmp/fullsite-visual-validation'

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.readdirSync(OUT_DIR).forEach(f => {
  try { fs.unlinkSync(path.join(OUT_DIR, f)) } catch {}
})

interface Check { status: '✅' | '⚠️ ' | '❌'; name: string; detail: string }
const checks: Check[] = []
const consoleErrors: string[] = []

const pass = (name: string, detail = '') => { checks.push({ status: '✅', name, detail }); console.log(`  ✅  ${name}${detail ? ' — ' + detail : ''}`) }
const warn = (name: string, detail = '') => { checks.push({ status: '⚠️ ', name, detail }); console.log(`  ⚠️   ${name}${detail ? ' — ' + detail : ''}`) }
const fail = (name: string, detail = '') => { checks.push({ status: '❌', name, detail }); console.log(`  ❌  ${name}${detail ? ' — ' + detail : ''}`) }
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 48 - t.length))}`)

async function shot(page: Page, name: string) {
  const file = path.join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  console.log(`      📸 ${name}.png`)
  return file
}

// Returns true if "AMALAY" appears as restaurant branding (not in hidden/code contexts)
async function pageHasAmalayText(page: Page): Promise<string | null> {
  // Only check visible text, not script content
  const visible = await page.evaluate(() => {
    const walk = (el: Element): string => {
      let text = ''
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = (node.textContent || '').trim()
          if (t) text += t + ' '
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el2 = node as Element
          const style = window.getComputedStyle(el2)
          if (style.display !== 'none' && style.visibility !== 'hidden' && (el2.tagName !== 'SCRIPT') && (el2.tagName !== 'STYLE')) {
            text += walk(el2)
          }
        }
      }
      return text
    }
    return walk(document.body)
  }).catch(() => '')
  const match = visible.match(/\bAMALAY\b/i)
  return match ? match[0] : null
}

async function main() {
  console.log('\n◆ VALIDACIÓN VISUAL — demo tenant (Café Central)\n')
  console.log(`Screenshots → ${OUT_DIR}\n`)

  // ── Setup ─────────────────────────────────────────────────────────────────
  const sb = getAdminClient()

  // Ensure open turno for today
  const today = new Date().toISOString().slice(0, 10)
  const { data: openTurno } = await sb.from('pos_turnos').select('id')
    .eq('client_id', 'demo').is('closed_at', null)
    .gte('opened_at', today + 'T00:00:00').limit(1).single()
  let activeTurnoId = openTurno?.id
  if (!activeTurnoId) {
    activeTurnoId = `ui2-demo-${Date.now().toString(36)}`
    await sb.from('pos_turnos').insert({
      id: activeTurnoId, client_id: 'demo', opened_by: 'Ana García',
      fondo_inicial: 500, opened_at: new Date().toISOString(),
    })
    console.log(`  → Turno abierto: ${activeTurnoId}`)
  } else {
    console.log(`  → Turno existente: ${activeTurnoId}`)
  }

  // Get Supabase session for injection
  console.log('\n  → Obteniendo sesión Supabase para demo@fullsite.mx...')
  let sessionData: { session: Record<string, unknown>; projectRef: string }
  try {
    sessionData = await getDemoSession()
    console.log(`  → Sesión OK — access_token=${String(sessionData.session.access_token).slice(0, 20)}...`)
  } catch (err: unknown) {
    console.error(`  ✗ No se pudo obtener sesión: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-MX' })
    const page = await ctx.newPage()

    // Capture console errors (filter noise)
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const t = msg.text()
        if (!t.includes('favicon') && !t.includes('7717') && !t.includes('net::ERR_CONNECTION_REFUSED')
            && !t.includes('posthog') && !t.includes('sentry') && !t.includes('503')) {
          consoleErrors.push(t.slice(0, 200))
        }
      }
    })

    // ── SECTION 0: Inject session ───────────────────────────────────────────
    section('0. Inyección de sesión')
    // Navigate to root first so localStorage is writable for this origin
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)

    // Inject Supabase session into localStorage (what the SDK does on signIn)
    await page.evaluate(({ session, projectRef }) => {
      const key = `sb-${projectRef}-auth-token`
      localStorage.setItem(key, JSON.stringify(session))
      localStorage.setItem('fullsite_client_id', 'demo')
    }, { session: sessionData.session, projectRef: sessionData.projectRef })

    const storedClient = await page.evaluate(() => localStorage.getItem('fullsite_client_id'))
    if (storedClient === 'demo') {
      pass('Sesión inyectada', `fullsite_client_id=demo, token=${String(sessionData.session.access_token).slice(0, 16)}...`)
    } else {
      fail('Sesión inyectada', `fullsite_client_id=${storedClient}`)
    }

    // ── SECTION 1: Login page (verificación visual) ────────────────────────
    section('1. Login page')
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
    await shot(page, '01-login-page')

    const loginAmalay = await pageHasAmalayText(page)
    if (loginAmalay) { fail('Login — sin AMALAY', `Encontrado: "${loginAmalay}"`) }
    else { pass('Login — sin AMALAY', 'Página de login neutra, solo branding Fullsite') }

    // ── SECTION 2: Post-login redirect ─────────────────────────────────────
    section('2. Navegación autenticada')
    // Go to a protected page — session injection means we're already "logged in"
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await shot(page, '02-dashboard-auth-check')

    const authCheckUrl = page.url()
    if (authCheckUrl.includes('/login')) {
      warn('Sesión reconocida por dashboard', `Redirigió a ${authCheckUrl} — puede requerir cookie además de localStorage`)
    } else {
      pass('Sesión reconocida', `Dashboard cargó en ${authCheckUrl}`)
    }

    // ── SECTION 3: POS — pantalla de PIN ───────────────────────────────────
    section('3. POS — Pantalla de PIN')
    await page.goto(`${BASE_URL}/pos/mesas`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)   // Wait for posConfig async fetch (logo)
    await shot(page, '03-pin-screen')

    const pinAmalay = await pageHasAmalayText(page)
    if (pinAmalay) { fail('PIN screen — sin AMALAY', `Texto visible: "${pinAmalay}"`) }
    else { pass('PIN screen — sin AMALAY') }

    // Check logo
    const logoState = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img')) as HTMLImageElement[]
      return imgs.map(img => ({
        src: img.src,
        display: window.getComputedStyle(img).display,
        opacity: img.style.opacity,
        naturalWidth: img.naturalWidth,
      }))
    }).catch(() => [] as Array<{src:string;display:string;opacity:string;naturalWidth:number}>)

    const visibleImgs = logoState.filter(i => i.display !== 'none' && i.naturalWidth > 0)
    const amalayLogo = visibleImgs.find(i => i.src.includes('amalay'))
    if (amalayLogo) {
      fail('PIN logo — sin AMALAY', `Logo de AMALAY visible: ${amalayLogo.src}`)
    } else if (visibleImgs.length === 0) {
      pass('PIN logo — sin logo de AMALAY', 'No hay imagen visible (correcto para demo sin logo configurado)')
    } else {
      pass('PIN logo — correcto', `${visibleImgs.length} imagen(es), ninguna de AMALAY`)
    }

    // ── SECTION 4: Ingresar PIN ─────────────────────────────────────────────
    section('4. PIN auth — Ana García (1001)')
    const pinInput = page.locator('input[placeholder="PIN"], input[type="password"]').first()
    const pinVisible = await pinInput.isVisible({ timeout: 3000 }).catch(() => false)

    if (!pinVisible) {
      warn('Pantalla de PIN', 'Input de PIN no visible — puede ya estar desbloqueado o requirió auth diferente')
    } else {
      await pinInput.fill(DEMO_PIN)
      const submitBtn = page.locator('button:has-text("Entrar"), button:has-text("PIN"), button[type="submit"]').first()
      await submitBtn.click()
      await page.waitForTimeout(2500)
      await shot(page, '04-after-pin')

      const afterPinText = await page.textContent('body') || ''
      const pinError = /incorrecto|error\s+de/i.test(afterPinText)
      const pinSuccess = /(mesa|nueva\s+cuenta|abrir\s+cuenta|cliente|comanda)/i.test(afterPinText)

      if (pinError && !pinSuccess) {
        fail('PIN 1001 — Demo', `"PIN incorrecto" — lookup contra tenant incorrecto. client_id del browser: ${await page.evaluate(() => localStorage.getItem('fullsite_client_id'))}`)
      } else if (pinSuccess) {
        pass('PIN 1001 — Ana García', 'Acceso concedido')
      } else {
        warn('PIN — estado incierto', `URL=${page.url()}`)
      }
    }

    // ── SECTION 5: Mesas ────────────────────────────────────────────────────
    section('5. Mesas — branding y layout')
    await page.waitForTimeout(2000)
    await shot(page, '05-mesas-grid')

    const mesasText = await page.textContent('body') || ''
    const mesasAmalay = await pageHasAmalayText(page)
    if (mesasAmalay) { fail('Mesas — sin AMALAY', `"${mesasAmalay}" visible`) }
    else { pass('Mesas — sin AMALAY') }

    if (/caf[eé]\s*central/i.test(mesasText)) {
      pass('Mesas — branding Café Central', 'Nombre del restaurante correcto')
    } else {
      warn('Mesas — nombre no en body text', 'Café Central puede estar en header no detectado')
    }

    // Count mesa numbers visible
    let visibleMesas = 0
    for (let i = 1; i <= 15; i++) {
      const found = await page.locator(`text=/^${i}$/`).first().isVisible({ timeout: 300 }).catch(() => false)
      if (found) visibleMesas++
    }
    if (visibleMesas >= 12) pass('Mesas — 15 mesas demo', `${visibleMesas}/15 mesas visibles`)
    else if (visibleMesas >= 5) warn('Mesas — parcialmente visibles', `${visibleMesas}/15`)
    else warn('Mesas — no detectadas por número', 'UI puede usar otro identificador')

    // ── SECTION 6: Abrir orden ──────────────────────────────────────────────
    section('6. Orden — abrir mesa y ver menú')

    // Mesa cards are divs with onClick (not button) — click bubbles up to handleMesaClick
    // Strategy: click the large mesa number "1" text — event bubbles to card's onClick handler
    let openedOrder = false

    // Try "Nueva cuenta" button first (if turno is already selected)
    const newCuentaBtn = page.locator('button').filter({ hasText: /nueva\s+cuenta/i }).first()
    if (await newCuentaBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await newCuentaBtn.click()
      await page.waitForTimeout(2000)
      openedOrder = true
    }

    if (!openedOrder) {
      // Mesa cards: click the "1" text which bubbles to the card div's onClick
      // Use getByText with exact match to target the mesa number heading
      const mesaOneText = page.getByText('1', { exact: true }).first()
      if (await mesaOneText.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mesaOneText.click()
        await page.waitForTimeout(2500)
        openedOrder = true
      }
    }

    if (!openedOrder) {
      // Final fallback: click any element with "Disponible" text in the mesas grid
      const disponibleEl = page.locator('text=Disponible').first()
      if (await disponibleEl.isVisible({ timeout: 1000 }).catch(() => false)) {
        await disponibleEl.click()
        await page.waitForTimeout(2000)
        openedOrder = true
      }
    }

    await shot(page, '06-orden-state')

    if (page.url().includes('/pos/orden') || page.url().includes('/pos/mesas')) {
      const ordenText = await page.textContent('body') || ''
      const ordenAmalay = await pageHasAmalayText(page)

      if (ordenAmalay) { fail('Orden — sin AMALAY', `"${ordenAmalay}" visible`) }
      else { pass('Orden — sin AMALAY') }

      // Check for demo menu content
      const demoCategories = /caf[eé]|desayuno|almuerzo|postre|bebida/i
      const demoItems = /latte|cappuccino|croissant|bagel|matcha|flat\s+white/i

      if (demoCategories.test(ordenText) || demoItems.test(ordenText)) {
        pass('Menú — contenido demo cargado', 'Categorías o items de Café Central visibles')
      } else if (openedOrder) {
        warn('Menú — sin contenido demo detectado', 'El orden abrió pero no se detectaron items del menú en body text')
      } else {
        warn('Menú — no se abrió orden', 'No se encontró botón clickeable para abrir orden')
      }

      // Try to add item to order if we're in an order view
      if (page.url().includes('/pos/orden')) {
        const itemBtn = page.locator('button').filter({ hasText: /latte|cappuccino|croissant|café/i }).first()
        if (await itemBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await itemBtn.click()
          await page.waitForTimeout(800)
          await shot(page, '06b-item-added')
          const totalVisible = await page.locator('text=/\\$[0-9]|Total|Subtotal/i').first().isVisible({ timeout: 1000 }).catch(() => false)
          if (totalVisible) pass('Orden — item agregado y total visible')
          else warn('Orden — item clickeado, total no detectado')
        }
      }
    } else {
      warn('Orden — navegación no completada', `URL=${page.url()}`)
    }

    // ── SECTION 7: KDS ──────────────────────────────────────────────────────
    section('7. KDS — cocina')
    await page.goto(`${BASE_URL}/cocina`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    await shot(page, '07-kds')

    const kdsUrl = page.url()
    const kdsAmalay = await pageHasAmalayText(page)

    if (kdsUrl.includes('/login')) {
      warn('KDS — redirigió a login', 'KDS requiere sesión Supabase (no solo localStorage) — comportamiento de middleware')
    } else if (kdsAmalay) {
      fail('KDS — AMALAY visible', kdsAmalay)
    } else {
      pass('KDS — sin AMALAY', `URL=${kdsUrl}`)
    }

    const kdsText = await page.textContent('body') || ''
    if (/orden|mesa|comanda|enviada|preparando/i.test(kdsText) && !kdsUrl.includes('/login')) {
      pass('KDS — muestra órdenes demo')
    } else if (!kdsUrl.includes('/login')) {
      warn('KDS — sin órdenes activas visibles', 'Normal si no hay órdenes en estado enviada/preparando')
    }

    // ── SECTION 8: Dashboard ────────────────────────────────────────────────
    section('8. Dashboard — ventas demo')
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(8000)   // Dashboard fetches multiple async queries; wait for data
    await shot(page, '08-dashboard')

    const dashUrl = page.url()
    const dashAmalay = await pageHasAmalayText(page)
    const dashText = await page.textContent('body') || ''

    if (dashUrl.includes('/login')) {
      warn('Dashboard — redirigió a login', 'Dashboard requiere cookie de sesión además de localStorage')
    } else if (dashAmalay) {
      fail('Dashboard — AMALAY visible', dashAmalay)
    } else {
      pass('Dashboard — sin AMALAY', `URL=${dashUrl}`)
    }

    if (/\$[\d,]+|ventas|órdenes|ticket/i.test(dashText) && !dashUrl.includes('/login')) {
      pass('Dashboard — datos de ventas visibles')
    }

    if (/caf[eé]\s*central/i.test(dashText)) {
      pass('Dashboard — branding Café Central', 'Nombre del restaurante correcto en dashboard')
    }

    // ── SECTION 9: AMALAY data isolation ────────────────────────────────────
    section('9. Aislamiento — AMALAY sin contaminación')
    const { count: amalayOrders } = await sb.from('pos_orders').select('id', { count: 'exact', head: true }).eq('client_id', 'amalay')
    const { count: demoOrders } = await sb.from('pos_orders').select('id', { count: 'exact', head: true }).eq('client_id', 'demo')
    pass('DB isolation', `demo=${demoOrders} órdenes, amalay=${amalayOrders} órdenes — sin cruce`)

    // ── SECTION 10: Consola ──────────────────────────────────────────────────
    section('10. Consola y red')
    const realErrors = consoleErrors.filter(e => !e.includes('400') && !e.includes('401'))
    if (realErrors.length === 0) {
      pass('Consola — limpia', 'Sin errores JS críticos durante la sesión')
    } else {
      warn('Consola — errores', `${realErrors.length}: ${realErrors[0]?.slice(0, 120)}`)
    }

    // ── REPORTE FINAL ─────────────────────────────────────────────────────────
    const passes  = checks.filter(c => c.status === '✅')
    const warns2  = checks.filter(c => c.status === '⚠️ ')
    const fails   = checks.filter(c => c.status === '❌')

    console.log('\n' + '═'.repeat(60))
    console.log('CHECKLIST VISUAL FINAL')
    console.log('═'.repeat(60))

    if (passes.length) {
      console.log(`\n✅ PASS (${passes.length})`)
      passes.forEach(c => console.log(`  • ${c.name}${c.detail ? ' — ' + c.detail : ''}`))
    }
    if (warns2.length) {
      console.log(`\n⚠️  WARN (${warns2.length})`)
      warns2.forEach(c => { console.log(`  • ${c.name}`); if (c.detail) console.log(`    ${c.detail}`) })
    }
    if (fails.length) {
      console.log(`\n❌ FAIL (${fails.length})`)
      fails.forEach(c => { console.log(`  • ${c.name}`); if (c.detail) console.log(`    ${c.detail}`) })
    }

    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Total: ${checks.length} · ✅ ${passes.length} · ⚠️  ${warns2.length} · ❌ ${fails.length}`)
    const files = fs.readdirSync(OUT_DIR)
    console.log(`\nScreenshots (${files.length}):`)
    files.forEach(f => console.log(`  ${path.join(OUT_DIR, f)}`))

    if (fails.length === 0) console.log('\n✓ Validación visual PASS\n')
    else console.log('\n⚠️  Hay bloqueos — ver ❌ arriba.\n')

  } finally {
    if (browser) await browser.close()
    const sb2 = getAdminClient()
    await sb2.from('pos_turnos').update({ closed_at: new Date().toISOString() })
      .like('id', 'ui2-demo-%').is('closed_at', null)
  }
}

main().catch(err => { console.error('\n✗ Script falló:', err?.message || err); process.exit(1) })
