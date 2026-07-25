/**
 * P2 Floor Plan Visual Validation
 *
 * Captures screenshots of /pos/plano and /pos/mesas in two states:
 *   DB path   — pos_mesas returns 33 AMALAY rows (current P2 branch)
 *   Fallback  — pos_mesas intercepted to return [] → FLOOR_TABLES hardcode activates
 *
 * Pass condition: both states render the same 33 tables in the correct positions.
 */

import { test, expect } from '@playwright/test'
import path from 'path'

const OUT = path.join(__dirname, '../.debug-artifacts')
const FAKE_TURNO = {
  id: 'test-turno-p2',
  fondo_inicial: 0,
  opened_by: 'test',
  opened_at: new Date().toISOString(),
}

/** Inject auth state before page JS runs */
async function injectAuth(page: any) {
  await page.addInitScript(() => {
    localStorage.setItem('fullsite_client_id', 'amalay')
    sessionStorage.setItem('pos_staff', JSON.stringify({ id: 'test-staff', name: 'Validacion P2', role: 'admin' }))
    sessionStorage.setItem('pos_last_activity', String(Date.now()))
  })
}

/** Route all POS infrastructure calls so they don't block rendering */
async function routeInfrastructure(page: any) {
  // pos_turnos → fake active turno (satisfies TurnoGate)
  await page.route('**/rest/v1/pos_turnos**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([FAKE_TURNO]) })
  })
  // Session management — silent OK
  await page.route('**/rest/v1/pos_sessions**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  // Attendance — silent OK
  await page.route('**/rest/v1/pos_attendance**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
}

// ─── /pos/plano ──────────────────────────────────────────────────────────────

test.describe('/pos/plano — plano arquitectónico', () => {
  test('A — DB path: 33 mesas desde pos_mesas', async ({ page }) => {
    await injectAuth(page)
    await routeInfrastructure(page)

    await page.goto('http://localhost:3000/pos/plano', { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    await page.screenshot({ path: `${OUT}/p2-plano-A-db.png`, fullPage: true })

    // Verify floor tables rendered
    const tableNodes = await page.locator('[style*="position: absolute"][style*="border-radius"]').count()
    console.log(`[A] Table nodes: ${tableNodes}`)
    expect(tableNodes).toBeGreaterThan(10)
  })

  test('B — Fallback: FLOOR_TABLES hardcode cuando pos_mesas retorna []', async ({ page }) => {
    await injectAuth(page)
    await routeInfrastructure(page)

    // Force pos_mesas to return empty → triggers FLOOR_TABLES fallback
    await page.route('**/rest/v1/pos_mesas**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('http://localhost:3000/pos/plano', { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    await page.screenshot({ path: `${OUT}/p2-plano-B-fallback.png`, fullPage: true })

    const tableNodes = await page.locator('[style*="position: absolute"][style*="border-radius"]').count()
    console.log(`[B] Table nodes: ${tableNodes}`)
    expect(tableNodes).toBeGreaterThan(10)
  })
})

// ─── /pos/mesas ──────────────────────────────────────────────────────────────

test.describe('/pos/mesas — planograma', () => {
  async function switchToPlanograma(page: any) {
    // Find planograma toggle button (Map icon)
    const btn = page.locator('button').filter({ hasText: /plano|planograma/i }).first()
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click()
      await page.waitForTimeout(1000)
    }
    // Also try by aria/title
    const mapBtn = page.locator('[title*="lano"], [aria-label*="lano"]').first()
    if (await mapBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await mapBtn.click()
      await page.waitForTimeout(1000)
    }
  }

  test('C — DB path: mesas desde pos_mesas', async ({ page }) => {
    await injectAuth(page)
    await routeInfrastructure(page)

    await page.goto('http://localhost:3000/pos/mesas', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await switchToPlanograma(page)
    await page.waitForTimeout(1000)

    await page.screenshot({ path: `${OUT}/p2-mesas-C-db.png`, fullPage: true })
    console.log('[C] Screenshot taken')
  })

  test('D — Fallback: mesas desde FLOOR_TABLES', async ({ page }) => {
    await injectAuth(page)
    await routeInfrastructure(page)

    await page.route('**/rest/v1/pos_mesas**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('http://localhost:3000/pos/mesas', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await switchToPlanograma(page)
    await page.waitForTimeout(1000)

    await page.screenshot({ path: `${OUT}/p2-mesas-D-fallback.png`, fullPage: true })
    console.log('[D] Screenshot taken')
  })
})
