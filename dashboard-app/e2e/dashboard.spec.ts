import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('loads dashboard page', async ({ page }) => {
    await page.goto('/')
    // Should either show dashboard content or redirect to login
    await page.waitForURL(/\/(login)?$/, { timeout: 10000 })
    const url = page.url()
    if (url.includes('/login')) {
      // Not authenticated — verify login page loads
      await expect(page.locator('input[type="email"]')).toBeVisible()
    } else {
      // Authenticated — verify dashboard content
      await expect(page.locator('text=/Resumen|Cargando/i')).toBeVisible({ timeout: 15000 })
    }
  })

  test('period selector renders', async ({ page }) => {
    await page.goto('/')
    await page.waitForURL(/\/(login)?$/, { timeout: 10000 })
    if (!page.url().includes('/login')) {
      await expect(page.locator('button:text("Dia")')).toBeVisible()
      await expect(page.locator('button:text("Semana")')).toBeVisible()
      await expect(page.locator('button:text("Mes")')).toBeVisible()
    }
  })

  test('settings button toggles widget panel', async ({ page }) => {
    await page.goto('/')
    await page.waitForURL(/\/(login)?$/, { timeout: 10000 })
    if (!page.url().includes('/login')) {
      const settingsBtn = page.locator('button[title="Personalizar dashboard"]')
      await settingsBtn.click()
      await expect(page.locator('text=Personalizar dashboard')).toBeVisible()
      // Close
      await page.locator('text=Cerrar').click()
      await expect(page.locator('text=Personalizar dashboard')).not.toBeVisible()
    }
  })
})
