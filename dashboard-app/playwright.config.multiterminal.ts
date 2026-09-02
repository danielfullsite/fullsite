import { defineConfig, devices } from '@playwright/test'

// Config para la suite MULTITERMINAL (2 POS + KDS, online/offline).
// Igual que playwright.config.offline.ts: build de PRODUCCIÓN porque el
// Service Worker no corre en dev. Video SIEMPRE — es la evidencia.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'multiterminal-offline.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 420_000,
  use: {
    // PRODUCCIÓN REAL: SW, APIs y datos como los vive la caja. El build local no
    // sirve para esta suite — /api/pos/pin exige SUPABASE_SERVICE_KEY que solo
    // vive en Vercel. Escribe únicamente en el tenant demo (chickin-demo).
    baseURL: process.env.E2E_BASE_URL || 'https://app.fullsite.mx',
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'on',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
