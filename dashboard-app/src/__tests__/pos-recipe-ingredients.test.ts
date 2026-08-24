import { describe, expect, it } from 'vitest'
import { getRecipeIngredientNames } from '@/lib/pos-recipe-ingredients'
import type { Ingredient, RecipeRow } from '@/lib/pos-data'

describe('getRecipeIngredientNames offline cache hardening', () => {
  it('ignores incomplete cached recipe and ingredient rows instead of crashing the POS', () => {
    const recipes = [
      { menu_item_name: null, ingredient_id: null },
      { menu_item_name: 'AGUA EMBOTELLADA', ingredient_id: null },
      { menu_item_name: 'AGUA EMBOTELLADA', ingredient_id: 'water' },
    ] as unknown as RecipeRow[]
    const ingredients = [
      { id: 'water', name: 'agua mineral' },
      { id: '', name: null },
    ] as unknown as Ingredient[]

    expect(getRecipeIngredientNames('Agua embotellada', recipes, ingredients)).toEqual(['Agua mineral'])
  })

  it('returns an empty list for a malformed cached menu item name', () => {
    expect(getRecipeIngredientNames(null, [], [])).toEqual([])
  })
})
