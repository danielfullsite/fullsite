import { test, expect } from '@playwright/test'

// These tests run in the 'mobile' project (iPhone 14 viewport)

test.describe('Mobile — Login', () => {
  test('login form is responsive', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('text=Continuar con Google')).toBeVisible()
    // Form should be full-width on mobile
    const form = page.locator('form')
    const box = await form.boundingBox()
    if (box) {
      expect(box.width).toBeGreaterThan(250)
    }
  })

  test('login page renders on mobile viewport', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('text=Bienvenido')).toBeVisible()
    await expect(page.locator('text=Continuar con Google')).toBeVisible()
  })
})

test.describe('Mobile — POS', () => {
  test('POS loads on mobile', async ({ page }) => {
    await page.goto('/pos')
    await page.waitForLoadState('domcontentloaded')
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })
})
