import { describe, it, expect } from 'vitest'
import { cacheTrasElCierre, cachePreferidaAlAbrir } from '@/lib/cache-de-cuenta'

// La caché `pos_cuenta_<tenant>_mesa:N` no se limpiaba al cobrar. La mesa se veía
// libre en el mapa, pero al abrirla el editor readoptaba `confirmed.id` de la
// orden ya liquidada, pintaba sus platillos, y la lectura devolvía «cerrada» para
// siempre. Mover y anular no servían de salida porque exigen una cuenta remota
// viva: la mesa quedaba inservible en esa terminal, con platillos de una cuenta
// cerrada en pantalla. Es el síntoma que se reportó en campo el 2026-09-02, en
// forma nueva y peor.
//
// Lo que el editor readopta es exactamente `saved.confirmed.id`, así que la
// prueba mira eso: después de cerrar, no debe quedar ninguna identidad.

const cuentaCobrada = {
  confirmed: { id: 'orden-liquidada', items: [{ id: 'r1' }, { id: 'r2' }] },
  base: { items: [{ id: 'r1' }, { id: 'r2' }] },
  draft: { items: [{ id: 'r1' }, { id: 'r2' }] },
  confirmedAt: 1_700_000_000_000,
}

describe('la caché de una mesa cuya cuenta ya se cerró', () => {
  it('al cobrar aquí no deja nada: la mesa vuelve a estar libre de verdad', () => {
    expect(cacheTrasElCierre(cuentaCobrada, 'cobrada-aqui')).toBeNull()
  })

  it('nunca conserva la identidad de la cuenta liquidada', () => {
    // Éste es el corazón del defecto: mientras `confirmed.id` sobreviva, el
    // editor lo readopta al montar y la mesa queda trabada.
    for (const motivo of ['cobrada-aqui', 'cerrada-en-caja'] as const) {
      const queda = cacheTrasElCierre(cuentaCobrada, motivo)
      expect(queda?.confirmed ?? null).toBeNull()
      expect(queda?.base ?? null).toBeNull()
    }
  })

  it('si la cerraron en otra terminal y aquí no había nada nuevo, tampoco deja nada', () => {
    expect(cacheTrasElCierre(cuentaCobrada, 'cerrada-en-caja')).toBeNull()
  })

  it('si la cerraron en otra terminal, conserva lo que este mesero alcanzó a teclear', () => {
    const conTrabajoLocal = {
      ...cuentaCobrada,
      draft: { items: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3-nuevo', nombre: 'Café' }] },
    }
    const queda = cacheTrasElCierre(conTrabajoLocal, 'cerrada-en-caja')
    expect(queda?.draft).toEqual({ items: [{ id: 'r3-nuevo', nombre: 'Café' }] })
    // Se conserva el trabajo, no la cuenta: sin esto la mesa seguiría trabada.
    expect(queda?.confirmed ?? null).toBeNull()
  })

  it('una caché vacía o corrupta no estorba', () => {
    expect(cacheTrasElCierre(null, 'cobrada-aqui')).toBeNull()
    expect(cacheTrasElCierre(undefined, 'cerrada-en-caja')).toBeNull()
    expect(cacheTrasElCierre({} as never, 'cerrada-en-caja')).toBeNull()
    expect(cacheTrasElCierre({ draft: { items: 'no es lista' } } as never, 'cerrada-en-caja')).toBeNull()
  })

  it('un borrador sin cuenta confirmada se conserva entero', () => {
    // Mesa nueva: alguien tecleó y otra terminal cerró una cuenta distinta.
    const soloBorrador = { draft: { items: [{ id: 'a' }, { id: 'b' }] } }
    expect(cacheTrasElCierre(soloBorrador, 'cerrada-en-caja')?.draft)
      .toEqual({ items: [{ id: 'a' }, { id: 'b' }] })
  })
})


it('reopening after a remote payment keeps new unsent products instead of reimporting the paid account', () => {
  const saved = cacheTrasElCierre({ ...cuentaCobrada,
    draft: { items: [...cuentaCobrada.draft.items, { id: 'new-beer', nombre: 'Lager' }] },
  }, 'cerrada-en-caja')
  const reopened = cachePreferidaAlAbrir(saved, () => cuentaCobrada)
  expect(reopened?.confirmed).toBeUndefined()
  expect(reopened?.draft?.items).toEqual([{ id: 'new-beer', nombre: 'Lager' }])
})
it('a deliberately empty current draft does not bring back products from legacy storage', () => {
  const reopened = cachePreferidaAlAbrir({ draft: { items: [] }, draftOrderId: 'fresh-order' }, () => cuentaCobrada)
  expect(reopened?.draft?.items).toEqual([])
  expect(reopened?.draftOrderId).toBe('fresh-order')
})

it('old storage still migrates when there is no recoverable current account', () => {
  expect(cachePreferidaAlAbrir(null, () => cuentaCobrada)).toEqual(cuentaCobrada)
  expect(cachePreferidaAlAbrir({ draft: { items: 'corrupt' } }, () => cuentaCobrada)).toEqual(cuentaCobrada)
})
