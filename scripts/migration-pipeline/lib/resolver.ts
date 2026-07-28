import { slugify } from '../maps/names'

export interface NormalizedIngredient {
  id: string
  name: string
}

export interface SlugCollision {
  slug: string
  firstId: string
  secondId: string
}

/**
 * Builds a reverse-lookup index from slugified name to stable catalog ID.
 *
 * Why: wansoft_recetas.json references ingredients by name ("ACEITE OLIVA"),
 * but wansoft_products.json uses opaque codes ("ABA003") as IDs. Direct
 * comparison between slug("ACEITE OLIVA") and "ABA003" always fails.
 * This index bridges the two key spaces without modifying source data.
 *
 * Throws if two distinct catalog entries produce the same slug — that case
 * is ambiguous and must be resolved before the pipeline can continue.
 */
export function buildSlugIndex(
  ingredients: NormalizedIngredient[]
): Map<string, string> {
  const index = new Map<string, string>()
  const collisions: SlugCollision[] = []

  for (const ing of ingredients) {
    const slug = slugify(ing.name)
    const existing = index.get(slug)

    if (existing !== undefined && existing !== ing.id) {
      collisions.push({ slug, firstId: existing, secondId: ing.id })
    } else {
      index.set(slug, ing.id)
    }
  }

  if (collisions.length > 0) {
    const detail = collisions
      .map(c => `  slug="${c.slug}" → "${c.firstId}" vs "${c.secondId}"`)
      .join('\n')
    throw new Error(`Slug collision detected in catalog:\n${detail}`)
  }

  return index
}

/**
 * Resolves a raw slug (from a recipe reference) to a stable catalog ID.
 *
 * If the slug exists in the index, returns the corresponding catalog ID.
 * If not, returns the slug unchanged — the caller will record it as an orphan.
 * This function never throws; unknown slugs are surfaced through the normal
 * orphan-tracking path.
 */
export function resolveIngredientId(
  rawSlug: string,
  slugIndex: Map<string, string>
): string {
  return slugIndex.get(rawSlug) ?? rawSlug
}
