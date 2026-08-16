import { test, expect } from '@playwright/test'

// ─────────────────────────────────────────────────────────────────────────────
// SUITE OFFLINE E2E — valida el POS en un BROWSER REAL (Chromium) con el service
// worker activo, simulando "sin internet". Es la única forma sin hardware de
// probar el boot offline / pantalla negra (#45) y el SW en un motor de browser
// de verdad — lo que ni los tests de Node ni los de IndexedDB alcanzan.
//
// ⚠️ REQUIERE UN BUILD DE PRODUCCIÓN: el service worker NO corre en `npm run dev`.
//    Corre así:
//      npm run build && npm run start        (en una terminal)
//      npx playwright test e2e/offline.spec.ts --config playwright.config.ts
//    (o apunta el webServer del config a `npm run build && npm run start`)
//
//    Contra `npm run dev`, los tests que dependen del SW se SKIPEAN limpio
//    (no fallan en falso).
//
// NO cubre (sigue siendo hardware): impresora térmica física, boot de Electron
// en el device, LAN real. Eso es la cert en terminal.
// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('POS offline — service worker + boot sin pantalla negra', () => {
  test('el POS ARRANCA offline sin pantalla negra (valida #45: precache de chunks)', async ({ page, context }) => {
    // 1. Carga online → registra y calienta el service worker (precache de chunks)
    await page.goto('/pos', { waitUntil: 'networkidle' }).catch(() => {})
    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready.then(() => true),
          new Promise<boolean>((r) => setTimeout(() => r(false), 5000)),
        ])
        return reg === true
      } catch { return false }
    })
    test.skip(!swReady, 'Service worker no activo — corre contra un build de producción (npm run build && npm run start)')

    // Dale tiempo al SW de precachear los chunks de las rutas del POS (install Phase 2)
    await page.waitForTimeout(3500)

    // 2. Apaga la red (simula sin internet, con el SW ya calentado)
    await context.setOffline(true)

    // 3. Recarga offline — el SW debe servir el shell + chunks desde caché
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})

    // 4. Verifica que la app REN­DERIZÓ (no pantalla negra, no página de error del browser)
    const html = await page.content()
    expect(html).not.toContain('ERR_INTERNET_DISCONNECTED')
    expect(html).not.toContain('This site can’t be reached')

    // React montó = hay contenido real. La pantalla negra = body prácticamente vacío.
    const bodyText = (await page.locator('body').innerText().catch(() => '')) || ''
    expect(bodyText.trim().length).toBeGreaterThan(20)

    // Señal más fuerte: algún nodo interactivo/render de la app (no un body en blanco)
    const renderedNodes = await page.locator('body *').count().catch(() => 0)
    expect(renderedNodes).toBeGreaterThan(10)
  })

  test('rutas del POS cargan offline (kds/mesas/cocina) — chunks por ruta cacheados', async ({ page, context }) => {
    await page.goto('/pos', { waitUntil: 'networkidle' }).catch(() => {})
    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false
      try { await navigator.serviceWorker.ready; return true } catch { return false }
    })
    test.skip(!swReady, 'Service worker no activo — corre contra build de producción')
    await page.waitForTimeout(3500)   // deja precachear todas las rutas
    await context.setOffline(true)

    for (const route of ['/pos/mesas', '/pos/kds', '/pos/cocina']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => {})
      const nodes = await page.locator('body *').count().catch(() => 0)
      expect(nodes, `${route} no debe quedar en pantalla negra offline`).toBeGreaterThan(10)
    }
  })

  test('IndexedDB del POS está disponible offline (no depende de red)', async ({ page, context }) => {
    await page.goto('/pos', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await context.setOffline(true)
    const idbOk = await page.evaluate(async () => {
      return await new Promise<boolean>((resolve) => {
        try {
          const req = indexedDB.open('offline-e2e-probe')
          req.onsuccess = () => { req.result.close(); indexedDB.deleteDatabase('offline-e2e-probe'); resolve(true) }
          req.onerror = () => resolve(false)
        } catch { resolve(false) }
      })
    })
    expect(idbOk).toBe(true)
  })
})
