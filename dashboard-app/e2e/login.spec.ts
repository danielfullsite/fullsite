import { test, expect } from '@playwright/test'

test.describe('Login Page', () => {
  test('renders login form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('input[type="email"]')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('shows fullsite branding', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('text=fullsite').first()).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'test@invalid.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    await expect(page.locator('[class*="red"]').first()).toBeVisible({ timeout: 10000 })
  })

  test('google oauth button exists', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('text=Continuar con Google')).toBeVisible()
  })
})
