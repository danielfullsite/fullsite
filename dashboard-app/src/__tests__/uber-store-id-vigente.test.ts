import { describe, expect, it } from 'vitest'

/**
 * El test store de Uber es un blanco móvil.
 *
 * Uber dio de baja `0f655507-7337-41e9-b536-5fd6171bb0da` y provisionó
 * `a4f298f4-202f-47f5-b375-d2eefec0126c` el 2026-08-25. El viejo estaba hardcodeado en
 * OCHO lugares — 5 workflows, el default de la ruta y 3 docs — así que la certificación
 * siguió midiéndose contra una tienda dada de baja sin que nadie lo notara. Los resultados
 * se veían verdes y no valían.
 *
 * Esta prueba existe para que la próxima vez que Uber cambie de tienda, el repo grite en vez
 * de quedarse callado midiendo la equivocada.
 */

const VIGENTE = 'a4f298f4-202f-47f5-b375-d2eefec0126c'
const DADA_DE_BAJA = '0f655507-7337-41e9-b536-5fd6171bb0da'

/** Docs que son registro histórico de mensajes ya enviados a Uber: NO se reescriben. */
const REGISTRO_HISTORICO = ['ACTION-EXERCISE-ENDPOINTS.md']

async function archivosOperativos(): Promise<{ ruta: string; texto: string }[]> {
  const fs = await import('fs')
  const path = await import('path')
  const raiz = path.resolve(__dirname, '../../..')

  const rutas: string[] = []
  const wf = path.join(raiz, '.github/workflows')
  if (fs.existsSync(wf)) {
    for (const f of fs.readdirSync(wf)) {
      if (f.startsWith('uber-') && f.endsWith('.yml')) rutas.push(path.join(wf, f))
    }
  }
  const ruta = path.resolve(__dirname, '../app/api/integrations/uber-eats/sandbox/route.ts')
  if (fs.existsSync(ruta)) rutas.push(ruta)

  const docs = path.join(raiz, 'docs/integrations/uber-eats')
  if (fs.existsSync(docs)) {
    for (const f of fs.readdirSync(docs)) {
      if (f.endsWith('.md') && !REGISTRO_HISTORICO.includes(f)) rutas.push(path.join(docs, f))
    }
  }
  return rutas.map((r) => ({ ruta: r, texto: fs.readFileSync(r, 'utf-8') }))
}

describe('Uber — el test store vigente', () => {
  it('ningún archivo operativo apunta a la tienda dada de baja', async () => {
    const culpables = (await archivosOperativos())
      .filter((a) => a.texto.includes(DADA_DE_BAJA))
      .map((a) => a.ruta.split('/').slice(-2).join('/'))

    expect(
      culpables,
      `Estos apuntan a la tienda que Uber dio de baja (${DADA_DE_BAJA}). ` +
      `La vigente es ${VIGENTE}. Medir contra la vieja da resultados verdes que no valen.`,
    ).toEqual([])
  })

  it('los workflows de certificación usan la tienda vigente', async () => {
    const wfs = (await archivosOperativos()).filter((a) => a.ruta.includes('/workflows/'))
    expect(wfs.length, 'no se encontró ningún workflow uber-*.yml').toBeGreaterThan(0)

    const conStore = wfs.filter((a) => /store_id|CERT_STORE_ID|STORE_ID/i.test(a.texto))
    expect(conStore.length).toBeGreaterThan(0)
    for (const a of conStore) {
      expect(a.texto, `${a.ruta} no menciona la tienda vigente`).toContain(VIGENTE)
    }
  })

  it('el default de la ruta sandbox es la tienda vigente', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../app/api/integrations/uber-eats/sandbox/route.ts'),
      'utf-8',
    )
    expect(src).toContain(`body.store_id || '${VIGENTE}'`)
  })

  it('el registro histórico se deja intacto, pero avisa que el store cambió', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const p = path.resolve(__dirname, '../../../docs/integrations/uber-eats/ACTION-EXERCISE-ENDPOINTS.md')
    if (!fs.existsSync(p)) return
    const src = fs.readFileSync(p, 'utf-8')
    // Conserva el store viejo (es lo que se le dijo a Uber en su momento)...
    expect(src).toContain(DADA_DE_BAJA)
    // ...pero no puede leerse como vigente sin la advertencia.
    expect(src).toContain(VIGENTE)
    expect(src).toMatch(/REGISTRO HISTÓRICO|YA NO ES EL VIGENTE/)
  })
})
