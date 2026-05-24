import { test, expect } from '@playwright/test'

test.describe('Landing Page', () => {
  test('loads with intro animation', async ({ page }) => {
    await page.goto('/landing.html', { waitUntil: 'domcontentloaded' })
    // Intro element should exist
    await expect(page.locator('#intro')).toBeAttached()
    // Hero content should become visible after intro
    await expect(page.locator('#hero')).toBeVisible()
  })

  test('navigation renders all sections', async ({ page }) => {
    await page.goto('/landing.html')
    await page.waitForTimeout(3000) // Wait for intro animation
    const nav = page.locator('#nav')
    await expect(nav).toBeVisible()
    await expect(nav.locator('text=Agentes')).toBeVisible()
    await expect(nav.locator('text=Pricing')).toBeVisible()
    await expect(nav.locator('text=FAQ')).toBeVisible()
  })

  test('pricing shows $4,999 single plan', async ({ page }) => {
    await page.goto('/landing.html')
    await expect(page.locator('text=$4,999')).toBeVisible()
    // Should NOT have old 3-tier pricing
    await expect(page.locator('text=$2,500')).not.toBeVisible()
    await expect(page.locator('text=$14,000')).not.toBeVisible()
  })

  test('FAQ section has expandable items', async ({ page }) => {
    await page.goto('/landing.html')
    const faq = page.locator('#faq')
    await faq.scrollIntoViewIfNeeded()
    const details = faq.locator('details')
    const count = await details.count()
    expect(count).toBeGreaterThanOrEqual(4)
    // Click first FAQ
    await details.first().click()
    // Summary content should be visible
    await expect(details.first().locator('p')).toBeVisible()
  })

  test('WhatsApp CTA links are correct', async ({ page }) => {
    await page.goto('/landing.html')
    const waLinks = page.locator('a[href*="wa.me"]')
    const count = await waLinks.count()
    expect(count).toBeGreaterThanOrEqual(2)
    // All should point to the correct number
    for (let i = 0; i < count; i++) {
      const href = await waLinks.nth(i).getAttribute('href')
      expect(href).toContain('528112741000')
    }
  })

  test('PWA manifest is linked', async ({ page }) => {
    await page.goto('/landing.html')
    const manifest = page.locator('link[rel="manifest"]')
    await expect(manifest).toHaveAttribute('href', '/manifest.json')
  })
})
