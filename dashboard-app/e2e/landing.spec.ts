import { test, expect } from '@playwright/test'

// Landing page is static HTML served from root, not from Next.js
// These tests only run if the landing page is served (e.g. via a static file server)
// Skip in CI where only the Next.js dev server runs

test.describe('Landing Page', () => {
  test.skip(({ browserName }) => true, 'Landing page requires static file server — run manually')

  test('loads hero section', async ({ page }) => {
    await page.goto('/landing.html')
    await expect(page.locator('#hero')).toBeVisible()
  })

  test('pricing shows $4,999', async ({ page }) => {
    await page.goto('/landing.html')
    await expect(page.locator('text=$4,999')).toBeVisible()
  })
})
