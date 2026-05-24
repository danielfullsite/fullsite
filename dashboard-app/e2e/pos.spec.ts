import { test, expect } from '@playwright/test'

test.describe('POS — Punto de Venta', () => {
  test('loads POS page', async ({ page }) => {
    await page.goto('/pos')
    // POS should load (dark theme)
    await expect(page.locator('text=/Mesa|Mesero|POS/i')).toBeVisible({ timeout: 15000 })
  })

  test('shows menu categories', async ({ page }) => {
    await page.goto('/pos')
    await page.waitForLoadState('networkidle')
    // Should show category tabs or menu items
    const hasCategories = await page.locator('[class*="bg-slate"]').count()
    expect(hasCategories).toBeGreaterThan(0)
  })

  test('navigation sidebar opens', async ({ page }) => {
    await page.goto('/pos')
    await page.waitForLoadState('networkidle')
    // Look for navigation toggle (hamburger menu)
    const menuBtn = page.locator('button').filter({ has: page.locator('svg') }).first()
    if (await menuBtn.isVisible()) {
      await menuBtn.click()
      // Should show nav items
      await expect(page.locator('text=/Mesas|Cocina|Inventario/i').first()).toBeVisible({ timeout: 5000 })
    }
  })
})

test.describe('POS Sub-pages', () => {
  const subPages = [
    { path: '/pos/cocina', title: /Cocina/i },
    { path: '/pos/qr', title: /QR/i },
    { path: '/pos/inventario', title: /Inventario/i },
    { path: '/pos/facturacion', title: /Facturacion|CFDI/i },
    { path: '/pos/historial', title: /Historial/i },
  ]

  for (const { path, title } of subPages) {
    test(`${path} loads correctly`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator(`text=${title}`).first()).toBeVisible({ timeout: 10000 })
    })
  }
})
