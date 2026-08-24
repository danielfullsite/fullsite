import { describe, expect, it } from 'vitest'
import { normalizeMenuPayload, type UberMenuUpload } from '@/lib/integrations/uber-eats/menu'

describe('Uber menu payload normalization', () => {
  it('adds the required default title to every localized menu resource', () => {
    const menu: UberMenuUpload = {
      menus: [{
        id: 'menu-1',
        title: { es_mx: 'Menú Fullsite' },
        service_availability: [{
          day_of_week: ['monday', 'tuesday'],
          time_period: [{ start_time: '00:00', end_time: '23:59' }],
        }],
        category_ids: ['category-1'],
      }],
      categories: [{
        id: 'category-1',
        title: { es: 'Bebidas' },
        entities: [{ id: 'item-1', type: 'ITEM' }],
      }],
      items: [{
        id: 'item-1',
        external_data: 'item-1',
        title: { en_us: 'Americano' },
        description: { en: 'Black coffee' },
        price_info: { price: 5000, currency_code: 'MXN' },
        modifier_group_ids: ['group-1'],
      }],
      modifier_groups: [{
        id: 'group-1',
        title: { es_mx: 'Leche' },
        quantity_info: { quantity: { min_permitted: 0, max_permitted: 1 } },
        modifier_options: [{
          id: 'option-1',
          title: { es: 'Avena' },
          price_info: { price: 1000, currency_code: 'MXN' },
        }],
      }],
    }

    const result = normalizeMenuPayload(menu)

    expect(result.menus[0].title.default).toBe('Menú Fullsite')
    expect(result.categories[0].title.default).toBe('Bebidas')
    expect(result.items[0].title.default).toBe('Americano')
    expect(result.items[0].description?.default).toBe('Black coffee')
    expect(result.modifier_groups?.[0].title.default).toBe('Leche')
    expect(result.modifier_groups?.[0].modifier_options[0].title.default).toBe('Avena')
    expect(result.menus[0].service_availability).toEqual([
      { day_of_week: 'monday', time_periods: [{ start_time: '00:00', end_time: '23:59' }] },
      { day_of_week: 'tuesday', time_periods: [{ start_time: '00:00', end_time: '23:59' }] },
    ])
  })

  it('does not overwrite an explicit default translation', () => {
    const result = normalizeMenuPayload({
      menus: [{ id: 'm', title: { default: 'Canonical', es: 'Otro' }, service_availability: [], category_ids: [] }],
      categories: [],
      items: [],
    })

    expect(result.menus[0].title.default).toBe('Canonical')
  })
})
