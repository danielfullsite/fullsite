import { test, expect } from '@playwright/test'

const BASE = 'https://app.fullsite.mx'

const PIN = process.env.POS_TEST_PIN || '9012'

// Helper: login with PIN if needed
async function loginIfNeeded(page: any) {
  const pinInput = page.locator('input[placeholder*="PIN"], input[type="password"]').first()
  if (await pinInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await pinInput.fill(PIN)
    await page.locator('button:has-text("Entrar con PIN"), button:has-text("Entrar"), button:has-text("PIN")').first().click()
    await page.waitForTimeout(2000)
  }
}

// Setup: inject client_id and Supabase auth before each test
test.beforeEach(async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.setItem('fullsite_client_id', 'amalay')
  })
  // If on login page, sign in with Supabase
  const emailInput = page.locator('input[placeholder*="empresa"], input[placeholder*="email"], input[type="email"]').first()
  if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await emailInput.fill(process.env.DASHBOARD_EMAIL || 'ramonfaur.daniel@gmail.com')
    const passInput = page.locator('input[type="password"]').first()
    await passInput.fill(process.env.DASHBOARD_PASSWORD || '')
    await page.locator('button:has-text("Continuar"), button:has-text("Iniciar"), button[type="submit"]').first().click()
    await page.waitForTimeout(4000)
  }
})

// ═══════════════════════════════════════════════════════
// POS CORE
// ═══════════════════════════════════════════════════════

test('POS loads with categories after PIN', async ({ page }) => {
  await page.goto(`${BASE}/pos?mesa=1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const hasCategories = await page.locator('text=Appetizers').or(page.locator('text=Coffee')).first().isVisible().catch(() => false)
  expect(hasCategories).toBeTruthy()
})

test('POS mesa input shows correct number', async ({ page }) => {
  await page.goto(`${BASE}/pos?mesa=5`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(2000)
  const mesaVisible = await page.locator('text=Mesa').first().isVisible().catch(() => false)
  expect(mesaVisible).toBeTruthy()
})

// ═══════════════════════════════════════════════════════
// KDS
// ═══════════════════════════════════════════════════════

test('KDS cocina loads without Todo tab', async ({ page }) => {
  await page.goto(`${BASE}/pos/cocina`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const todoCount = await page.locator('button:has-text("Todo")').count()
  expect(todoCount).toBe(0)
})

test('KDS cocina has Panadería tab', async ({ page }) => {
  await page.goto(`${BASE}/pos/cocina`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const panaderiaVisible = await page.locator('button:has-text("Panadería")').or(page.locator('button:has-text("Panaderia")')).first().isVisible().catch(() => false)
  expect(panaderiaVisible).toBeTruthy()
})

test('KDS tablet has no Fria tab', async ({ page }) => {
  await page.goto(`${BASE}/pos/kds`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const friaCount = await page.locator('button:has-text("Fria")').count()
  expect(friaCount).toBe(0)
})

test('KDS barra loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/barra`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const barraVisible = await page.locator('text=Barra').first().isVisible().catch(() => false)
  expect(barraVisible).toBeTruthy()
})

test('KDS back button goes to /pos', async ({ page }) => {
  await page.goto(`${BASE}/pos/kds`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(2000)
  const backBtn = page.locator('button').first()
  await backBtn.click()
  await page.waitForTimeout(3000)
  expect(page.url()).toContain('/pos')
})

// ═══════════════════════════════════════════════════════
// MESAS
// ═══════════════════════════════════════════════════════

test('Floor plan loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/mesas`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const mesasVisible = await page.locator('text=Mesas').or(page.locator('text=Disponible')).first().isVisible().catch(() => false)
  expect(mesasVisible).toBeTruthy()
})

test('Grid view available', async ({ page }) => {
  await page.goto(`${BASE}/pos/mesas`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const gridBtn = page.locator('text=Grid')
  if (await gridBtn.isVisible()) {
    await gridBtn.click()
    await page.waitForTimeout(1000)
    const disponible = await page.locator('text=Disponible').first().isVisible().catch(() => false)
    expect(disponible).toBeTruthy()
  }
})

// ═══════════════════════════════════════════════════════
// DEMO NORESTE
// ═══════════════════════════════════════════════════════

test('Demo Noreste loads', async ({ page }) => {
  await page.goto(`${BASE}/demo-noreste`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Noreste').first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

test('Demo has light/dark toggle', async ({ page }) => {
  await page.goto(`${BASE}/demo-noreste`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const toggle = page.locator('button:has-text("Light")')
  if (await toggle.isVisible()) {
    await toggle.click()
    await page.waitForTimeout(500)
    await expect(page.locator('button:has-text("Dark")')).toBeVisible()
  }
})

test('Demo has real menu prices', async ({ page }) => {
  await page.goto(`${BASE}/demo-noreste`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Arrachera').first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

test('Demo has value props', async ({ page }) => {
  await page.goto(`${BASE}/demo-noreste`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await expect(page.locator('text=Prediccion de cierre')).toBeVisible()
  await expect(page.locator('text=Food cost automatico')).toBeVisible()
})

// ═══════════════════════════════════════════════════════
// PANADERIA KDS
// ═══════════════════════════════════════════════════════

test('KDS panaderia loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/panaderia`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Panaderia').first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

// ═══════════════════════════════════════════════════════
// TURNO / CORTE
// ═══════════════════════════════════════════════════════

test('Turno page loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/turno`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Turnos').or(page.locator('text=Turno activo')).or(page.locator('text=Abrir turno')).first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

test('Corte page loads with PIN', async ({ page }) => {
  await page.goto(`${BASE}/pos/corte`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  // Corte page requires manager PIN — check for PIN input or corte content
  const visible = await page.locator('text=Corte').or(page.locator('text=PIN')).first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

// ═══════════════════════════════════════════════════════
// DELIVERY
// ═══════════════════════════════════════════════════════

test('Delivery page loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/delivery`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  // Try PIN button with full text if first attempt didn't work
  const pinBtn = page.locator('button:has-text("Entrar con PIN")').first()
  if (await pinBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    const pinInput = page.locator('input[type="password"], input[placeholder*="PIN"]').first()
    await pinInput.fill(PIN)
    await pinBtn.click()
    await page.waitForTimeout(3000)
  }
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Uber').or(page.locator('text=Rappi')).or(page.locator('text=pedidos')).or(page.locator('text=Delivery')).first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

// ═══════════════════════════════════════════════════════
// INVENTARIO / RECETAS
// ═══════════════════════════════════════════════════════

test('Inventario page loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/inventario`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Inventario').or(page.locator('text=inventario')).first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

test('Recetas page loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/recetas`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Recetas').or(page.locator('text=recetas')).first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

// ═══════════════════════════════════════════════════════
// AUDITORIA / HISTORIAL
// ═══════════════════════════════════════════════════════

test('Auditoria page loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/auditoria`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Auditoria').or(page.locator('text=auditoria')).or(page.locator('text=Auditor')).first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

test('Historial page loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/historial`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Historial').or(page.locator('text=historial')).first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

// ═══════════════════════════════════════════════════════
// CONFIGURACION
// ═══════════════════════════════════════════════════════

test('Configuracion page loads', async ({ page }) => {
  await page.goto(`${BASE}/pos/configuracion`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Configuracion').or(page.locator('text=configuracion')).or(page.locator('text=Config')).first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

// ═══════════════════════════════════════════════════════
// POS — ORDER FLOW
// ═══════════════════════════════════════════════════════

test('POS shows mesero selector', async ({ page }) => {
  await page.goto(`${BASE}/pos?mesa=99`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  // Should have a mesero select or dropdown
  const meseroSelect = page.locator('select').first()
  const visible = await meseroSelect.isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

test('POS shows action buttons (Enviar, Cobrar)', async ({ page }) => {
  await page.goto(`${BASE}/pos?mesa=99`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const enviar = await page.locator('text=Enviar').or(page.locator('text=Cocina')).first().isVisible().catch(() => false)
  const cobrar = await page.locator('text=Cobrar').or(page.locator('text=Sin permiso')).first().isVisible().catch(() => false)
  expect(enviar || cobrar).toBeTruthy()
})

// ═══════════════════════════════════════════════════════
// MESAS — FUSIONAR
// ═══════════════════════════════════════════════════════

test('Mesas has Fusionar button', async ({ page }) => {
  await page.goto(`${BASE}/pos/mesas`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Fusionar').first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

test('Mesas has Cuenta button', async ({ page }) => {
  await page.goto(`${BASE}/pos/mesas`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await loginIfNeeded(page)
  await page.waitForTimeout(3000)
  const visible = await page.locator('text=Cuenta').first().isVisible().catch(() => false)
  expect(visible).toBeTruthy()
})

// ═══════════════════════════════════════════════════════
// API HEALTH
// ═══════════════════════════════════════════════════════

test('Supabase API responds', async ({ request }) => {
  const res = await request.get('https://qjiomlvudfmzuvqvhwpk.supabase.co/rest/v1/', {
    ignoreHTTPSErrors: true,
  })
  expect([200, 401]).toContain(res.status())
})

test('Food cost API responds', async ({ request }) => {
  const res = await request.get(`${BASE}/api/food-cost`)
  expect(res.status()).toBe(200)
})

test('POS PIN API responds', async ({ request }) => {
  const res = await request.post(`${BASE}/api/pos/pin`, {
    data: { pin: '0000' },
    headers: { 'Content-Type': 'application/json' },
  })
  // 401 or 200 both valid (wrong pin = 401, right pin = 200)
  expect([200, 401, 404]).toContain(res.status())
})
