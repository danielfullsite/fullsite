import { test, expect } from '@playwright/test'

test.describe('POS -- Punto de Venta', () => {
  test('loads POS page or redirects to login', async ({ page }) => {
    await page.goto('/pos')
    await page.waitForLoadState('networkidle')
    const url = page.url()
    // Either shows POS or redirects to login (no auth)
    expect(url).toMatch(/\/(pos|login)/)
  })

  test('POS page has dark background', async ({ page }) => {
    await page.goto('/pos')
    await page.waitForLoadState('networkidle')
    if (!page.url().includes('/login')) {
      const bgElements = await page.locator('[class*="bg-slate-9"]').count()
      expect(bgElements).toBeGreaterThan(0)
    }
  })
})

test.describe('POS Sub-pages', () => {
  const subPages = ['/pos/cocina', '/pos/qr', '/pos/facturacion']

  for (const path of subPages) {
    test(`${path} loads without error`, async ({ page }) => {
      test.setTimeout(60_000)
      const response = await page.goto(path, { timeout: 30_000 })
      // Should not 500
      expect(response?.status()).toBeLessThan(500)
      await page.waitForLoadState('domcontentloaded')
      // Page rendered something
      const body = page.locator('body')
      await expect(body).toBeVisible()
    })
  }
})
