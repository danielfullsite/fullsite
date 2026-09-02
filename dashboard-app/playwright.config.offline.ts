import { defineConfig, devices } from '@playwright/test'

// Config SÓLO para la suite offline. Existe por una razón concreta:
//
//   El Service Worker NO CORRE en `npm run dev`.
//
// El config normal (`playwright.config.ts`) levanta el dev server, así que las
// pruebas offline se SKIPEAN limpio — no fallan, simplemente no prueban nada. La
// suite lleva escrita desde hace tiempo y por eso nunca había medido nada:
//
//   test.skip(!swControls, 'Service worker no controla la página — corre contra
//                           un build de producción')
//
// Aquí se levanta el build de PRODUCCIÓN, que es donde el SW sí toma control. Es
// la única forma sin hardware de probar el arranque offline en un motor de
// browser de verdad.
//
// LO QUE NO CUBRE, y hay que decirlo: impresora térmica física, boot de Electron
// en la máquina, LAN real, y la validación de campo. Un verde aquí significa "el
// arranque offline del navegador no está roto", NO "el sistema está certificado".
export default defineConfig({
  testDir: './e2e',
  testMatch: 'offline.spec.ts',
  fullyParallel: false,          // la suite es .serial: comparte el estado del SW
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  // El precache del SW y las esperas de control tardan; el default de 30s se queda corto.
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Producción, no dev. Es todo el punto de este archivo.
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,            // un build de Next tarda
  },
})
