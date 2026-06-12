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
  const subPages = [
    '/pos/cocina', '/pos/barra', '/pos/kds', '/pos/qr', '/pos/facturacion',
    '/pos/mesas', '/pos/historial', '/pos/turno', '/pos/auditoria',
    '/pos/inventario', '/pos/recetas', '/pos/compras', '/pos/delivery',
  ]

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

test.describe('POS Corte — gate de PIN', () => {
  test('/pos/corte exige PIN de gerente antes de mostrar datos', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/pos/corte', { timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    // Sin sessionStorage corte_access, debe mostrar el gate (input password)
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 15_000 })
    // Y NO debe mostrar montos del corte
    await expect(page.locator('text=Total ventas')).toHaveCount(0)
  })
})
