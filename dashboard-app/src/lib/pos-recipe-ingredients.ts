import { RECIPE_ALIASES, type Ingredient, type RecipeRow } from '@/lib/pos-data'

export function getRecipeIngredientNames(
  itemName: unknown,
  recipes: RecipeRow[],
  ingredients: Ingredient[],
): string[] {
  if (typeof itemName !== 'string' || !itemName.trim()) return []

  const name = itemName.toLowerCase()
  const validRecipes = recipes.filter(
    (row) => typeof row?.menu_item_name === 'string' && row.menu_item_name.trim().length > 0,
  )
  const ingMap = new Map(ingredients.filter(i => i?.id).map(i => [i.id, i]))
  const aliases = RECIPE_ALIASES[name]
  let rows: RecipeRow[] = []

  if (aliases) {
    for (const alias of aliases) {
      const matched = validRecipes.filter(r => r.menu_item_name.toLowerCase() === alias.toLowerCase())
      if (matched.length > 0) { rows = matched; break }
    }
  }

  if (rows.length === 0) {
    rows = validRecipes.filter(r => {
      const recipeName = r.menu_item_name.toLowerCase()
      return recipeName === name || recipeName.includes(name) || name.includes(recipeName)
    })
  }

  const names = new Set<string>()
  for (const row of rows) {
    const candidate = ingMap.get(row.ingredient_id)?.name || row.ingredient_id
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    const ingredientName = candidate.trim()
    if (['agua de filtro', 'aceite vegetal', 'sal', 'pimienta', 'aceite de oliva'].includes(ingredientName.toLowerCase())) continue
    names.add(ingredientName.charAt(0).toUpperCase() + ingredientName.slice(1))
  }
  return Array.from(names).slice(0, 12)
}
