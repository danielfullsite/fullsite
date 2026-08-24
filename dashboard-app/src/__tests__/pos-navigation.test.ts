import { describe, expect, it, vi } from 'vitest'

import { navigateToMesaMap, POS_MESA_MAP_PATH } from '@/lib/pos-navigation'

describe('POS table navigation', () => {
  it('leaves every order for the canonical table map with a hard replace', () => {
    const replace = vi.fn()

    navigateToMesaMap({ replace } as Pick<Location, 'replace'>)

    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/pos/mesas')
    expect(POS_MESA_MAP_PATH).toBe('/pos/mesas')
  })
})
