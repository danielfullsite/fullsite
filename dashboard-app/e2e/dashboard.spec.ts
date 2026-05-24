import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('loads and shows content or redirects to login', async ({ page }) => {
    await page.goto('/')
    await page.waitForURL(/\/(login)?$/, { timeout: 15000 })
    const url = page.url()
    if (url.includes('/login')) {
      await expect(page.locator('input[type="email"]')).toBeVisible()
    } else {
      const body = await page.textContent('body')
      expect(body?.length).toBeGreaterThan(100)
    }
  })

  test('login page has all required elements', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
    await expect(page.locator('text=Continuar con Google')).toBeVisible()
    await expect(page.locator('text=Bienvenido')).toBeVisible()
  })
})
