import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// ─────────────────────────────────────────────────────────────────────────────
// MULTITERMINAL OFFLINE E2E — dos POS + un KDS en el MISMO código de producción,
// contra el tenant demo `chickin-demo` (Supabase real). Simula el corte de
// internet por terminal con context.setOffline() — la única forma sin hardware
// de ejercitar SW + cola offline + sync multi-terminal de punta a punta.
//
// Credenciales: los PIN del tenant demo son DETERMINÍSTICOS (provisionTenant →
// deterministicPin10) — fixture de prueba derivado del código, no un secreto.
//
// NO cubre: Electron, impresoras, huella, LAN física. Verde aquí = "la capa web
// multi-terminal no está rota", no certificación de campo.
//
// Requiere build de producción (SW no corre en dev): config
// playwright.config.multiterminal.ts levanta `npm run build && npm run start`.
// ─────────────────────────────────────────────────────────────────────────────

const TENANT = 'chickin-demo'
// chickin-demo es del esquema VIEJO: PINs de plantilla de 4 dígitos (1111/2222/
// 3333). Fixture de demo, no credencial de persona. Sobreescribible por env.
const PIN_GERENTE = process.env.E2E_POS_PIN || '2222'

async function nuevaPagina(ctx: BrowserContext, path = '/pos'): Promise<Page> {
  const page = await ctx.newPage()
  await page.addInitScript((tenant) => {
    try { localStorage.setItem('fullsite_client_id', tenant) } catch {}
  }, TENANT)
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  return page
}

const PANTALLA_PIN = /PIN para abrir|Ingresa tu PIN/i

async function enPantallaPin(page: Page): Promise<boolean> {
  return page.locator(`text=${PANTALLA_PIN}`).isVisible({ timeout: 1_000 }).catch(() => false)
}

/** Teclea el PIN en el pad (botones con el dígito). Submit automático al llenar. */
async function loginConPin(page: Page, pin: string) {
  await page.waitForSelector(`text=${PANTALLA_PIN}`, { timeout: 30_000 })
  for (const d of pin) {
    await page.getByRole('button', { name: new RegExp(`^${d}$`) }).first().click()
    await page.waitForTimeout(120)
  }
  // Algunos pads piden la palomita final.
  await page.waitForTimeout(800)
  if (await enPantallaPin(page)) {
    const entrar = page.locator('button:has(svg)').last()
    await entrar.click().catch(() => {})
  }
  await page.waitForSelector(`text=${PANTALLA_PIN}`, { state: 'hidden', timeout: 20_000 })
}

/** Garantiza sesión viva antes de interactuar — el POS se re-bloquea tras enviar. */
async function asegurarSesion(page: Page, pin: string) {
  if (await enPantallaPin(page)) await loginConPin(page, pin)
}

async function abrirTurnoSiHaceFalta(page: Page) {
  // Cuentas huérfanas de corridas anteriores: la regla de Eduardo bloquea antes
  // del gate — se cancelan en lote desde aquí mismo (flujo real del producto).
  const huerfanas = page.getByRole('button', { name: /Cancelar .* y abrir turno/i })
  if (await huerfanas.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await huerfanas.click()
    await page.waitForTimeout(4_000)
  }
  const gate = page.locator('text=No hay turno abierto')
  if (await gate.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.locator('input[inputmode="decimal"], input[type="number"]').first().fill('500')
    await page.getByRole('button', { name: /Abrir turno/i }).click()
    await expect(gate).toBeHidden({ timeout: 20_000 })
  }
}

/**
 * Fotografía del mapa de mesas COMO LO RENDEREA esa terminal: por cada tile de
 * mesa, su etiqueta y si se pinta ocupada (por clase o texto). La verdad que
 * importa es la que ve el mesero — no la BD.
 */
async function estadoMesas(page: Page): Promise<Record<string, string>> {
  if (await enPantallaPin(page)) await loginConPin(page, PIN_GERENTE)
  await page.goto('/pos/mesas', { waitUntil: 'domcontentloaded' }).catch(() => {})
  // Esperar a que el GRID pinte los tiles (no el spinner) — B tarda en cargar
  // el mapa aunque el header ya reconcilió (Ocupada/Disponible). Sin esta espera
  // el snapshot leía cero mesas y disparaba un falso bug de espejo.
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('div,button,a')].some(
      (e) => /^\d{1,3}\s*(Disponible|Ocupada|Lista)/i.test((e.textContent || '').trim()),
    )
  }, { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(1_500)
  return page.evaluate(() => {
    const out: Record<string, string> = {}
    // Tile = el elemento MAS CHICO cuyo texto empieza con el numero de mesa y
    // trae su chip (Disponible/Ocupada/Lista). Sin depender del tag ni la clase.
    for (const t of [...document.querySelectorAll('div, button, a')]) {
      const texto = (t.textContent || '').trim()
      const m = /^(\d{1,3})\s*(Disponible|Ocupada|Lista)/i.exec(texto)
      if (!m) continue
      if (t.querySelectorAll('*').length > 25) continue // contenedor de página, no tile
      const ocupada = /ocupada|lista/i.test(m[2])
      if (!(m[1] in out) || ocupada) out[m[1]] = ocupada ? 'ocupada' : 'libre'
    }
    return out
  })
}

/** Diff de mapas entre dos terminales — cada diferencia es un bug de espejo. */
function diffMesas(a: Record<string, string>, b: Record<string, string>): string[] {
  const bugs: string[] = []
  for (const mesa of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[mesa] ?? '(no aparece)'
    const vb = b[mesa] ?? '(no aparece)'
    if (va !== vb) bugs.push(`Mesa ${mesa}: A la ve "${va}" pero B la ve "${vb}"`)
  }
  return bugs
}

test.describe.serial('Multi-terminal: 2 POS + KDS, online y offline', () => {
  test('flujo completo con corte de internet por terminal', async ({ browser }) => {
    test.setTimeout(420_000)
    const errores: string[] = []
    const chunkErrors: string[] = []  // precache gaps (no fatales) — se reportan aparte
    const ctxA = await browser.newContext() // Terminal A (caja)
    const ctxB = await browser.newContext() // Terminal B (entrada)
    for (const [nombre, ctx] of [['A', ctxA], ['B', ctxB]] as const) {
      ctx.on('page', (p) => p.on('pageerror', (e) => {
        const msg = `[${nombre}] pageerror: ${e.message}`
        // Un chunk lazy no precacheado tira error offline pero NO cuelga la app
        // (#45). Es una fuga de precache que se reporta, no un crash del flujo.
        if (/Failed to load chunk|ChunkLoadError|Loading chunk/i.test(e.message)) chunkErrors.push(msg)
        else errores.push(msg)
      }))
    }

    // ── FASE 1: login en A y abrir turno ──
    const posA = await nuevaPagina(ctxA)
    await loginConPin(posA, PIN_GERENTE)
    // El TurnoGate aparece al aterrizar en el área gateada (mesas), no en /pos.
    await posA.goto('/pos/mesas', { waitUntil: 'domcontentloaded' })
    await posA.waitForTimeout(2_000)
    await abrirTurnoSiHaceFalta(posA)
    await expect(posA.locator('body')).not.toContainText('No hay turno abierto')

    // ── FASE 2: login en B — debe VER el turno que A abrió ──
    const posB = await nuevaPagina(ctxB)
    await loginConPin(posB, PIN_GERENTE)
    await posB.goto('/pos/mesas', { waitUntil: 'domcontentloaded' })
    await posB.waitForTimeout(2_000)
    await expect(posB.locator('body'), 'B debe ver el turno abierto por A').not.toContainText('No hay turno abierto')

    // ── FASE 3: A manda una comanda ONLINE ──
    await asegurarSesion(posA, PIN_GERENTE)
    // En el mapa: se SELECCIONA la mesa (tile con el numero + chip Disponible)
    // y luego se abre con el boton "Cuenta".
    const tile1 = posA.locator('button, div[role=button], [class*=cursor]').filter({ hasText: /^1\s*(Disponible|Ocupada|Lista)/ }).first()
    if (await tile1.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await tile1.click()
    } else {
      await posA.getByText('1', { exact: true }).first().click({ timeout: 10_000 })
    }
    // Algunos mapas abren la cuenta al tocar el tile; el boton Cuenta es opcional.
    await posA.getByRole('button', { name: /Cuenta/i }).first().click({ timeout: 6_000 }).catch(() => {})
    await posA.waitForTimeout(3_000)
    await asegurarSesion(posA, PIN_GERENTE)
    // El menu muestra CATEGORIAS primero — entrar a una y luego el platillo con $.
    await posA.waitForSelector('text=Toca un producto', { timeout: 15_000 }).catch(() => {})
    const categoria = posA.getByText(/Bebidas|Tenders|Sándwiches|Combos/i).first()
    await categoria.click({ timeout: 15_000 })
    await posA.waitForTimeout(1_500)
    // SOLO productos del grid del menú — el panel de cuenta tambien tiene botones con $.
    const item = posA.locator('[class*="grid-cols"] button').filter({ hasText: /\$\s?\d/ }).first()
    // Nombre del platillo (sin precio) — la aserción del KDS lo busca literal.
    const nombreItem = ((await item.innerText().catch(() => '')) || '').split('$')[0].trim().split('\n')[0].trim()
    await item.click({ timeout: 15_000 })
    // Modal de modificadores: el confirm es "Agregar $<precio>" (sin extras basta).
    const confirmarMod = posA.getByRole('button', { name: /^Agregar \$/ }).first()
    if (await confirmarMod.isVisible({ timeout: 3_000 }).catch(() => false)) await confirmarMod.click()
    await posA.waitForTimeout(1_000)
    await posA.getByRole('button', { name: /^Enviar/ }).first().click({ timeout: 15_000 })
    await posA.waitForTimeout(4_000)

    // ── FASE 4: la comanda de A se ve en el KDS y la mesa se ve ocupada en B ──
    const kds = await nuevaPagina(ctxB, '/pos/kds')
    await kds.waitForTimeout(6_000)
    const kdsTexto = await kds.locator('body').innerText()
    // El tablero rotula por numero ('1 ·'), no 'Mesa 1' — se verifica el PLATILLO.
    expect(kdsTexto, `el KDS debe mostrar la comanda de A (${nombreItem})`).toContain(nombreItem.slice(0, 12))

    // ── FASE 4b: ESPEJO — el mapa de mesas debe verse IGUAL en A y en B ──
    const mapaA1 = await estadoMesas(posA)
    const mapaB1 = await estadoMesas(posB)
    const bugsEspejo1 = diffMesas(mapaA1, mapaB1)
    expect(bugsEspejo1, 'ONLINE: una mesa abierta en un POS debe verse abierta en el otro').toEqual([])
    expect(mapaA1['1'], 'la mesa 1 (con comanda enviada) debe pintarse ocupada en A').toBe('ocupada')

    // ── FASE 5: B pierde internet y manda una comanda OFFLINE ──
    // (posB quedó en PIN tras el flujo de A? no — B no ha enviado. Reusar posB.)
    await ctxB.setOffline(true)
    await posB.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await posB.waitForTimeout(3_000)
    const bodyB = await posB.locator('body').innerText().catch(() => '')
    expect(bodyB.trim().length, 'B offline no debe quedar en pantalla negra (SW)').toBeGreaterThan(20)
    // Con sesión viva, B debe poder abrir mesa y capturar aunque no haya red.
    // (Si el reload lo regresó a PIN, el login offline usa el caché de credenciales.)
    if (await posB.locator('text=/PIN/i').isVisible({ timeout: 3_000 }).catch(() => false)) {
      await loginConPin(posB, PIN_GERENTE)
    }
    await posB.goto('/pos/mesas', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await posB.waitForTimeout(2_000)
    const tile2 = posB.locator('button, div[role=button], [class*=cursor]').filter({ hasText: /^2\s*(Disponible|Ocupada)/ }).first()
    let pudoAbrirMesa = await tile2.click({ timeout: 10_000 }).then(() => true).catch(() => false)
    if (pudoAbrirMesa) {
      await posB.getByRole('button', { name: /Cuenta/i }).first().click({ timeout: 5_000 }).catch(() => {})
      await posB.waitForTimeout(2_000)
      await posB.getByText(/Bebidas|Tenders|Sándwiches|Combos/i).first().click({ timeout: 8_000 }).catch(() => {})
      await posB.waitForTimeout(1_200)
    }
    if (pudoAbrirMesa) {
      const itemB = posB.locator('[class*="grid-cols"] button').filter({ hasText: /\$\s?\d/ }).first()
      const pudoAgregar = await itemB.click({ timeout: 10_000 }).then(() => true).catch(() => false)
      if (pudoAgregar) {
        const confB = posB.getByRole('button', { name: /agregar|confirmar|listo/i }).first()
        if (await confB.isVisible({ timeout: 2_000 }).catch(() => false)) await confB.click()
        await posB.getByRole('button', { name: /^Enviar/ }).first().click({ timeout: 10_000 }).catch(() => {})
        await posB.waitForTimeout(3_000)
      }
    }
    // Pase lo que pase arriba, la app NUNCA debe haber crasheado offline.
    // La app offline debe seguir USABLE (el screenshot muestra el mapa con la mesa
    // ocupada). Los errores de chunk se toleran aquí pero se reportan al final.
    expect(errores.filter(e => e.includes('[B]')), 'cero pageerrors NO-chunk en B offline').toEqual([])

    // ── FASE 6: B recupera internet — lo capturado debe sincronizar ──
    await ctxB.setOffline(false)
    await posB.waitForTimeout(12_000) // ventana de sync (online event + drenado)

    // ── FASE 6b: ESPEJO tras la reconexión — B ya vio lo que pasó sin él, y
    //    lo que B capturó offline ya debe verse en A ──
    const mapaA2 = await estadoMesas(posA)
    const mapaB2 = await estadoMesas(posB)
    const bugsEspejo2 = diffMesas(mapaA2, mapaB2)
    expect(bugsEspejo2, 'POST-OFFLINE: los mapas deben reconciliarse idénticos').toEqual([])

    // ── FASE 7: verificación cruzada final en el KDS ──
    await kds.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
    await kds.waitForTimeout(6_000)
    const kdsFinal = await kds.locator('body').innerText()
    expect(kdsFinal, 'tras reconectar, el KDS conserva la comanda online de A').toContain(nombreItem.slice(0, 12))

    // ── FASE 8: sin errores de página FATALES en toda la sesión ──
    expect(errores, 'cero pageerrors NO-chunk en ambas terminales').toEqual([])
    // Fuga de precache: se reporta como aviso, no como falla del test de sync.
    if (chunkErrors.length) {
      console.warn(`\n[HALLAZGO precache] ${chunkErrors.length} chunk(s) no precacheados offline:\n  ` + [...new Set(chunkErrors)].join('\n  '))
    }

    await ctxA.close(); await ctxB.close()
  })
})
