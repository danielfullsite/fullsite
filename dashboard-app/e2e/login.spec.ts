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
    await expect(page.locator('text=fullsite')).toBeVisible()
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'test@invalid.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    // Should show error message
    await expect(page.locator('text=/incorrecta|error|invalid/i')).toBeVisible({ timeout: 10000 })
  })

  test('email field validates format', async ({ page }) => {
    await page.goto('/login')
    const emailInput = page.locator('input[type="email"]')
    await emailInput.fill('not-an-email')
    await page.click('button[type="submit"]')
    // Browser validation should prevent submission
    const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid)
    expect(validity).toBe(false)
  })
})
